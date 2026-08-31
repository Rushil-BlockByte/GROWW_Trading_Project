import type { IndicatorCandle } from "@/types/indicators";

export type HistoricalCandleInterval =
  | "minute"
  | "3minute"
  | "5minute"
  | "10minute"
  | "15minute"
  | "30minute"
  | "60minute"
  | "day";

export type HistoricalDataSource = "KITE";

export type HistoricalCandle = IndicatorCandle & {
  instrumentToken: number;
  source: HistoricalDataSource;
};

export type HistoricalCandleRequest = {
  instrumentToken: number;
  interval: HistoricalCandleInterval;
  from: string;
  to: string;
  continuous: boolean;
  includeOpenInterest: boolean;
};

export type HistoricalCandleFetchResult = {
  source: HistoricalDataSource;
  request: HistoricalCandleRequest;
  candleCount: number;
  candles: HistoricalCandle[];
  warnings: string[];
  liveOrdersEnabled: false;
};
