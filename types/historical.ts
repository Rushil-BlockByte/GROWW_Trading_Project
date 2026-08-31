import type { IndicatorCandle } from "@/types/indicators";
import type { InstrumentRecord } from "@/types/instruments";
import type { UnderlyingSymbol } from "@/types/market";
import type { OptionSide } from "@/types/options";

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

export type HistoricalOptionSeriesInstrument = Pick<
  InstrumentRecord,
  | "exchange"
  | "tradingsymbol"
  | "instrumentToken"
  | "expiry"
  | "strike"
  | "instrumentType"
  | "lotSize"
  | "tickSize"
> & {
  optionSide: OptionSide;
};

export type HistoricalOptionUniverseRequest = {
  underlying: UnderlyingSymbol;
  underlyingLastPrice: string;
  expiry: string;
  strikeInterval: number;
  strikeWindow: number;
  interval: HistoricalCandleInterval;
  from: string;
  to: string;
  includeOpenInterest: boolean;
  spreadAssumptionPercent: string;
};

export type HistoricalOptionSeries = {
  source: HistoricalDataSource;
  instrument: HistoricalOptionSeriesInstrument;
  candleCount: number;
  candles: HistoricalCandle[];
  warnings: string[];
};

export type HistoricalOptionUniverseResult = {
  source: HistoricalDataSource;
  request: HistoricalOptionUniverseRequest;
  atmStrike: string;
  instrumentCount: number;
  rowCount: number;
  series: HistoricalOptionSeries[];
  missingContracts: Array<{
    strike: string;
    instrumentType: OptionSide;
  }>;
  warnings: string[];
  quoteAssumptions: {
    bidAskSpreadPercent: string;
    reason: string;
  };
  liveOrdersEnabled: false;
};
