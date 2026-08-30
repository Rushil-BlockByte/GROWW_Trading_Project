export type MarketDataMode = "simulation" | "live";
export type SubscriptionMode = "LTP" | "QUOTE" | "FULL";
export type UnderlyingSymbol = "NIFTY" | "BANKNIFTY" | "FINNIFTY";

export type MarketRegime =
  | "STRONG_BULLISH"
  | "BULLISH"
  | "SIDEWAYS"
  | "BEARISH"
  | "STRONG_BEARISH"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY";

export type SignalLifecycleState =
  | "FORMING"
  | "CONFIRMED"
  | "ACTIVE"
  | "INVALIDATED"
  | "TARGET_1"
  | "TARGET_2"
  | "STOPPED"
  | "EXPIRED";

export type SignalQuality = "NO SETUP" | "WEAK" | "WATCH" | "STRONG" | "HIGH QUALITY";

export type MarketDepthLevel = {
  price: string;
  quantity: number;
  orders?: number;
};

export type MarketDepth = {
  buy: MarketDepthLevel[];
  sell: MarketDepthLevel[];
};

export type MarketTick = {
  instrumentToken: number;
  timestamp: string;
  exchangeTimestamp?: string;
  lastPrice: string;
  lastQuantity?: number;
  volume?: number;
  averagePrice?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  openInterest?: number;
  oiDayHigh?: number;
  oiDayLow?: number;
  bid?: string;
  ask?: string;
  depth?: MarketDepth;
  sequence?: number;
};

export type DataQualityStatus = "GOOD" | "STALE" | "INSUFFICIENT_DATA" | "MARKET_CLOSED";

export type NoTradeReason =
  | "Sideways market"
  | "Setup incomplete"
  | "Poor risk/reward"
  | "Low volume"
  | "Poor option liquidity"
  | "Wide spread"
  | "Conflicting signals"
  | "Data stale"
  | "Daily loss limit reached"
  | "Market closed"
  | "Expiry risk"
  | "Contract unavailable";
