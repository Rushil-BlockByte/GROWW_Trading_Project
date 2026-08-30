export type CandleInterval = "1m" | "3m" | "5m" | "15m";

export type MarketCandleData = {
  instrumentToken: number;
  interval: CandleInterval;
  startTime: string;
  endTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: number;
  openInterest?: number;
  tickCount: number;
  isComplete: boolean;
};

export type CandleBuilderResult = {
  updated: MarketCandleData[];
  completed: MarketCandleData[];
  ignoredReason?: string;
};
