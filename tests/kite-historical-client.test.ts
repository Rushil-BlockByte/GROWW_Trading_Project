import { describe, expect, it } from "vitest";
import {
  assertValidHistoricalWindow,
  fetchKiteHistoricalCandles,
  isKiteHistoricalInterval,
  normalizeKiteHistoricalCandles,
  type KiteHistoricalDataClient,
} from "../lib/zerodha/historical-data-client";

describe("Kite historical data client", () => {
  it("validates the supported historical candle intervals", () => {
    expect(isKiteHistoricalInterval("minute")).toBe(true);
    expect(isKiteHistoricalInterval("15minute")).toBe(true);
    expect(isKiteHistoricalInterval("2hour")).toBe(false);
  });

  it("normalizes Kite candles into the internal indicator candle shape", () => {
    const candles = normalizeKiteHistoricalCandles({
      instrumentToken: 256265,
      candles: [
        {
          date: new Date("2026-08-31T03:45:00.000Z"),
          open: 24117.55,
          high: 24128.7,
          low: 24040.9,
          close: 24042.3,
          volume: 0,
          oi: 123456,
        },
      ],
    });

    expect(candles).toEqual([
      {
        instrumentToken: 256265,
        source: "KITE",
        startTime: "2026-08-31T03:45:00.000Z",
        open: "24117.55",
        high: "24128.70",
        low: "24040.90",
        close: "24042.30",
        volume: 0,
        openInterest: 123456,
      },
    ]);
  });

  it("fetches historical candles through an injectable Kite client without exposing credentials", async () => {
    const calls: unknown[][] = [];
    const fakeClient: KiteHistoricalDataClient = {
      async getHistoricalData(...args) {
        calls.push(args);

        return [
          {
            date: new Date("2026-08-31T03:45:00.000Z"),
            open: 100,
            high: 110,
            low: 95,
            close: 105,
            volume: 1000,
          },
        ];
      },
    };

    const result = await fetchKiteHistoricalCandles({
      apiKey: "api-key",
      accessToken: "access-token",
      instrumentToken: 256265,
      interval: "minute",
      from: "2026-08-31 09:15:00",
      to: "2026-08-31 15:30:00",
      includeOpenInterest: true,
      client: fakeClient,
    });

    expect(calls[0]).toEqual([
      256265,
      "minute",
      "2026-08-31 09:15:00",
      "2026-08-31 15:30:00",
      false,
      true,
    ]);
    expect(result.candleCount).toBe(1);
    expect(result.liveOrdersEnabled).toBe(false);
    expect(result).not.toHaveProperty("apiKey");
    expect(result).not.toHaveProperty("accessToken");
  });

  it("rejects invalid historical windows before calling Kite", () => {
    expect(() =>
      assertValidHistoricalWindow({
        from: "2026-08-31T15:30:00.000Z",
        to: "2026-08-31T09:15:00.000Z",
      }),
    ).toThrow("Historical date window must end after it starts.");
  });
});
