import Decimal from "decimal.js";
import type { Tick } from "kiteconnect";
import type { MarketDepth, MarketTick } from "@/types/market";

function decimal(value: number | undefined) {
  return value === undefined ? undefined : new Decimal(value).toFixed(2);
}

function toIsoDate(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeDepth(raw: Tick): MarketDepth | undefined {
  if (!("depth" in raw) || !raw.depth) return undefined;

  return {
    buy: raw.depth.buy.map((level) => ({
      price: new Decimal(level.price).toFixed(2),
      quantity: level.quantity,
      orders: level.orders,
    })),
    sell: raw.depth.sell.map((level) => ({
      price: new Decimal(level.price).toFixed(2),
      quantity: level.quantity,
      orders: level.orders,
    })),
  };
}

export function normalizeKiteTick(raw: Tick, receivedAt = new Date()): MarketTick {
  const exchangeTimestamp =
    "exchange_timestamp" in raw ? toIsoDate(raw.exchange_timestamp) : undefined;
  const timestamp = exchangeTimestamp ?? receivedAt.toISOString();
  const depth = normalizeDepth(raw);
  const bid = depth?.buy[0]?.price;
  const ask = depth?.sell[0]?.price;

  return {
    instrumentToken: raw.instrument_token,
    timestamp,
    exchangeTimestamp,
    lastPrice: new Decimal(raw.last_price).toFixed(2),
    lastQuantity: "last_traded_quantity" in raw ? raw.last_traded_quantity : undefined,
    volume: "volume_traded" in raw ? raw.volume_traded : undefined,
    averagePrice:
      "average_traded_price" in raw ? decimal(raw.average_traded_price) : undefined,
    open: "ohlc" in raw ? decimal(raw.ohlc.open) : undefined,
    high: "ohlc" in raw ? decimal(raw.ohlc.high) : undefined,
    low: "ohlc" in raw ? decimal(raw.ohlc.low) : undefined,
    close: "ohlc" in raw ? decimal(raw.ohlc.close) : undefined,
    openInterest: "oi" in raw ? raw.oi : undefined,
    oiDayHigh: "oi_day_high" in raw ? raw.oi_day_high : undefined,
    oiDayLow: "oi_day_low" in raw ? raw.oi_day_low : undefined,
    bid,
    ask,
    depth,
  };
}
