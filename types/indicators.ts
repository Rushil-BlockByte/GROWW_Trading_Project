import type { UnderlyingSymbol } from "@/types/market";

export type IndicatorCandle = {
  startTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: number;
  openInterest?: number;
};

export type IndicatorPoint = {
  timestamp: string;
  value: string | null;
};

export type OpeningRange = {
  minutes: number;
  startTime: string;
  endTime: string;
  high: string;
  low: string;
  complete: boolean;
};

export type PriceLevel = {
  label: string;
  value: string;
  source: "previous_day" | "opening_range" | "swing";
};

export type IndicatorContext = {
  underlying: UnderlyingSymbol;
  candleCount: number;
  warmupCandleCount?: number;
  latestClose: string;
  vwap: string | null;
  vwapDistance: string | null;
  ema9: string | null;
  ema20: string | null;
  ema50: string | null;
  emaTrend: "Bullish" | "Bearish" | "Mixed" | "Insufficient data";
  atr14: string | null;
  rsi14: string | null;
  volumeAverage20: string | null;
  relativeVolume20: string | null;
  openingRange15: OpeningRange | null;
  potentialSupport: PriceLevel[];
  potentialResistance: PriceLevel[];
};
