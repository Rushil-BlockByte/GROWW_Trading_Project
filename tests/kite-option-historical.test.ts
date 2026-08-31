import { describe, expect, it } from "vitest";
import { InstrumentRepository } from "../lib/instruments/instrument-repository";
import {
  createHistoricalOptionRowsFactory,
  fetchKiteHistoricalOptionUniverse,
  normalizeHistoricalOptionStrikeWindow,
  type KiteHistoricalOptionUniverseInput,
} from "../lib/zerodha/option-historical-service";
import type { KiteHistoricalDataClient } from "../lib/zerodha/historical-data-client";
import type { InstrumentRecord } from "../types/instruments";

const EXPIRY = "2026-09-03";
const CANDLE_ONE = new Date("2026-08-31T03:45:00.000Z");
const CANDLE_TWO = new Date("2026-08-31T03:46:00.000Z");

function optionInstrument({
  instrumentToken,
  strike,
  side,
}: {
  instrumentToken: number;
  strike: number;
  side: "CE" | "PE";
}): InstrumentRecord {
  return {
    exchange: "NFO",
    tradingsymbol: `NIFTY26SEP${strike}${side}`,
    instrumentToken,
    name: "NIFTY",
    expiry: EXPIRY,
    strike: String(strike),
    instrumentType: side,
    segment: "NFO-OPT",
    lotSize: 75,
    tickSize: "0.05",
    kind: side === "CE" ? "OPTION_CE" : "OPTION_PE",
    underlyingSymbol: "NIFTY",
  };
}

function instruments() {
  return [
    optionInstrument({ instrumentToken: 101, strike: 25000, side: "CE" }),
    optionInstrument({ instrumentToken: 102, strike: 25000, side: "PE" }),
    optionInstrument({ instrumentToken: 103, strike: 25050, side: "CE" }),
    optionInstrument({ instrumentToken: 104, strike: 25050, side: "PE" }),
    optionInstrument({ instrumentToken: 105, strike: 25100, side: "CE" }),
    optionInstrument({ instrumentToken: 106, strike: 25100, side: "PE" }),
  ];
}

function fakeHistoricalClient(calls: unknown[][]): KiteHistoricalDataClient {
  return {
    async getHistoricalData(...args) {
      calls.push(args);
      const token = Number(args[0]);
      const base = token - 1;

      return [
        {
          date: CANDLE_ONE,
          open: base,
          high: base + 5,
          low: base - 5,
          close: base,
          volume: 110000 + token,
          oi: 800000 + token,
        },
        {
          date: CANDLE_TWO,
          open: base + 8,
          high: base + 14,
          low: base + 6,
          close: base + 10,
          volume: 120000 + token,
          oi: 805000 + token,
        },
      ];
    },
  };
}

function baseInput(client: KiteHistoricalDataClient): KiteHistoricalOptionUniverseInput {
  return {
    apiKey: "api-key",
    accessToken: "access-token",
    repository: new InstrumentRepository(instruments()),
    underlying: "NIFTY",
    underlyingLastPrice: "25040",
    expiry: EXPIRY,
    strikeInterval: 50,
    strikeWindow: 1,
    interval: "minute",
    from: "2026-08-31 09:15:00",
    to: "2026-08-31 15:30:00",
    includeOpenInterest: true,
    spreadAssumptionPercent: "1",
    client,
  };
}

describe("Kite option historical service", () => {
  it("fetches ATM option history and builds replay rows from real option candles", async () => {
    const calls: unknown[][] = [];
    const result = await fetchKiteHistoricalOptionUniverse(baseInput(fakeHistoricalClient(calls)));

    expect(calls).toHaveLength(6);
    expect(result.instrumentCount).toBe(6);
    expect(result.rowCount).toBe(3);
    expect(result.liveOrdersEnabled).toBe(false);
    expect(result).not.toHaveProperty("apiKey");
    expect(result).not.toHaveProperty("accessToken");
    expect(result.quoteAssumptions.bidAskSpreadPercent).toBe("1.00");

    const rowsForPrice = createHistoricalOptionRowsFactory(result);
    const rows = rowsForPrice({
      underlying: "NIFTY",
      underlyingLastPrice: "25055",
      expiry: EXPIRY,
      candle: {
        startTime: CANDLE_TWO.toISOString(),
        open: "25050.00",
        high: "25070.00",
        low: "25040.00",
        close: "25055.00",
        volume: 100000,
      },
      candleIndex: 1,
    });
    const atm = rows.find((row) => row.isAtm);

    expect(rows).toHaveLength(3);
    expect(atm?.strike).toBe(25050);
    expect(atm?.call.ltp).toBe(112);
    expect(atm?.call.openInterest).toBe(805103);
    expect(atm?.call.oiChange).toBe(5000);
    expect(atm?.call.bid).toBe(111.44);
    expect(atm?.call.ask).toBe(112.56);
    expect(atm?.call.spreadPercent).toBe(1);
  });

  it("uses the latest option candle at or before the underlying candle time", async () => {
    const result = await fetchKiteHistoricalOptionUniverse(baseInput(fakeHistoricalClient([])));
    const rowsForPrice = createHistoricalOptionRowsFactory(result);
    const rows = rowsForPrice({
      underlying: "NIFTY",
      underlyingLastPrice: "25040",
      expiry: EXPIRY,
      candle: {
        startTime: "2026-08-31T03:45:30.000Z",
        open: "25040.00",
        high: "25045.00",
        low: "25035.00",
        close: "25040.00",
        volume: 100000,
      },
      candleIndex: 1,
    });

    expect(rows.find((row) => row.strike === 25050)?.call.ltp).toBe(102);
  });

  it("rejects overly wide strike windows before making historical calls", async () => {
    const calls: unknown[][] = [];

    expect(() => normalizeHistoricalOptionStrikeWindow(4)).toThrow(
      "Option historical strikeWindow cannot exceed 3.",
    );
    await expect(
      fetchKiteHistoricalOptionUniverse({
        ...baseInput(fakeHistoricalClient(calls)),
        strikeWindow: 4,
      }),
    ).rejects.toThrow("Option historical strikeWindow cannot exceed 3.");
    expect(calls).toHaveLength(0);
  });
});
