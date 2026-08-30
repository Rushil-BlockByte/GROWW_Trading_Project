import type { MarketDataMode, SubscriptionMode, UnderlyingSymbol } from "@/types/market";

export const INDIA_MARKET_TIME_ZONE = "Asia/Kolkata";

export const MARKET_SESSION = {
  preOpenStart: "09:00",
  open: "09:15",
  equityClose: "15:30",
  equityDerivativesClose: "15:40",
  postMarketEnd: "16:00",
} as const;

export type UnderlyingConfig = {
  symbol: UnderlyingSymbol;
  label: string;
  exchange: "NSE" | "NFO";
  strikeInterval: number;
  atmStrikeWindow: number;
  includeNextExpiry: boolean;
  underlyingMode: SubscriptionMode;
  optionMode: SubscriptionMode;
};

export const DEFAULT_UNDERLYINGS: UnderlyingConfig[] = [
  {
    symbol: "NIFTY",
    label: "NIFTY 50",
    exchange: "NSE",
    strikeInterval: 50,
    atmStrikeWindow: 10,
    includeNextExpiry: false,
    underlyingMode: "QUOTE",
    optionMode: "QUOTE",
  },
  {
    symbol: "BANKNIFTY",
    label: "BANKNIFTY",
    exchange: "NSE",
    strikeInterval: 100,
    atmStrikeWindow: 10,
    includeNextExpiry: false,
    underlyingMode: "QUOTE",
    optionMode: "QUOTE",
  },
  {
    symbol: "FINNIFTY",
    label: "FINNIFTY",
    exchange: "NSE",
    strikeInterval: 50,
    atmStrikeWindow: 10,
    includeNextExpiry: false,
    underlyingMode: "QUOTE",
    optionMode: "QUOTE",
  },
];

export const SIGNAL_QUALITY_THRESHOLDS = {
  noSetupMax: 49,
  weakMin: 50,
  watchMin: 65,
  strongMin: 75,
  highQualityMin: 85,
} as const;

export const KITE_WEBSOCKET_LIMITS = {
  maxInstrumentsPerConnection: 3000,
  primaryConnectionCount: 1,
} as const;

export function normalizeMarketDataMode(value: string | undefined): MarketDataMode {
  return value?.toLowerCase() === "live" ? "live" : "simulation";
}

export function getConfiguredMarketDataMode(): MarketDataMode {
  return normalizeMarketDataMode(process.env.NEXT_PUBLIC_MARKET_DATA_MODE);
}

export function getMarketDataModeLabel(mode: MarketDataMode) {
  if (mode === "live") {
    return {
      label: "LIVE MARKET DATA",
      description: "Zerodha Kite stream required",
      tone: "success" as const,
    };
  }

  return {
    label: "SIMULATION MODE",
    description: "Paper trading only",
    tone: "warning" as const,
  };
}
