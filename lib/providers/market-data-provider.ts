import type { MarketTick, SubscriptionMode } from "@/types/market";

export type InstrumentSubscription = {
  instrumentToken: number;
  mode: SubscriptionMode;
};

export type MarketDataProviderStatus = {
  connected: boolean;
  reconnecting: boolean;
  lastTickAt?: string;
  lastError?: string;
  subscriptionCount: number;
  rejectedSubscriptions: number;
  reconnectCount: number;
  uptimeSeconds: number;
};

export type MarketDataProvider = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(subscriptions: InstrumentSubscription[]): Promise<void>;
  unsubscribe(instrumentTokens: number[]): Promise<void>;
  onTick(handler: (tick: MarketTick) => void): () => void;
  getStatus(): MarketDataProviderStatus;
};

export type HistoricalCandleRequest = {
  instrumentToken: number;
  interval: "minute" | "3minute" | "5minute" | "15minute" | "day";
  from: Date;
  to: Date;
};

export type HistoricalCandle = {
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: number;
  openInterest?: number;
};

export type HistoricalMarketDataProvider = {
  getCandles(request: HistoricalCandleRequest): Promise<HistoricalCandle[]>;
};
