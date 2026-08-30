import { describe, expect, it } from "vitest";
import type { FullTick, QuoteTick } from "kiteconnect";
import { normalizeKiteTick } from "../lib/zerodha/kite-tick-normalizer";

describe("Kite tick normalizer", () => {
  it("normalizes full option ticks into the internal market tick shape", () => {
    const raw: FullTick = {
      tradable: true,
      mode: "full",
      instrument_token: 1100000,
      last_price: 152.35,
      last_traded_quantity: 75,
      average_traded_price: 148.42,
      volume_traded: 125000,
      total_buy_quantity: 20000,
      total_sell_quantity: 23000,
      ohlc: {
        open: 140,
        high: 156,
        low: 138.2,
        close: 133,
      },
      change: 14.55,
      exchange_timestamp: new Date("2026-09-01T04:00:00.000Z"),
      last_trade_time: new Date("2026-09-01T04:00:00.000Z"),
      oi: 850000,
      oi_day_high: 890000,
      oi_day_low: 810000,
      depth: {
        buy: [{ price: 152.25, quantity: 750, orders: 4 }],
        sell: [{ price: 152.5, quantity: 900, orders: 5 }],
      },
    };

    expect(normalizeKiteTick(raw)).toMatchObject({
      instrumentToken: 1100000,
      timestamp: "2026-09-01T04:00:00.000Z",
      exchangeTimestamp: "2026-09-01T04:00:00.000Z",
      lastPrice: "152.35",
      lastQuantity: 75,
      volume: 125000,
      averagePrice: "148.42",
      open: "140.00",
      high: "156.00",
      low: "138.20",
      close: "133.00",
      openInterest: 850000,
      oiDayHigh: 890000,
      oiDayLow: 810000,
      bid: "152.25",
      ask: "152.50",
    });
  });

  it("uses receive time when a quote tick has no exchange timestamp", () => {
    const raw: QuoteTick = {
      tradable: false,
      mode: "quote",
      instrument_token: 256265,
      last_price: 25180,
      ohlc: {
        open: 25100,
        high: 25200,
        low: 25080,
        close: 25090,
      },
      change: 0.35,
    };

    expect(normalizeKiteTick(raw, new Date("2026-09-01T04:01:00.000Z"))).toMatchObject({
      instrumentToken: 256265,
      timestamp: "2026-09-01T04:01:00.000Z",
      exchangeTimestamp: undefined,
      lastPrice: "25180.00",
    });
  });
});
