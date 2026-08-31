import type { IndicatorCandle } from "@/types/indicators";
import type { DataQualityStatus, MarketRegime, SignalQuality, UnderlyingSymbol } from "@/types/market";
import type { OptionChainSourceRow, OptionSide } from "@/types/options";
import type { StrategyDirection } from "@/types/strategy";
import type { RiskConfiguration } from "@/lib/risk/defaults";

export type BacktestDataSource = "SIMULATED_HISTORICAL_REPLAY" | "USER_SUPPLIED";

export type BacktestExitReason = "TARGET_1" | "TARGET_2" | "STOP" | "SESSION_CLOSE";

export type BacktestTradeOutcome = "WIN" | "LOSS" | "FLAT";

export type BacktestPreviousDayContext = {
  high: string;
  low: string;
  close: string;
};

export type BacktestOptionRowsInput = {
  underlying: UnderlyingSymbol;
  underlyingLastPrice: string;
  expiry: string;
  candle: IndicatorCandle;
  candleIndex: number;
};

export type BacktestOptionRowsFactory = (
  input: BacktestOptionRowsInput,
) => OptionChainSourceRow[];

export type BacktestRunInput = {
  id?: string;
  name?: string;
  underlying?: UnderlyingSymbol;
  expiry?: string;
  candles: IndicatorCandle[];
  previousDay: BacktestPreviousDayContext;
  risk?: RiskConfiguration;
  lotSize?: number;
  warmupCandles?: number;
  maximumTrades?: number;
  cooldownCandles?: number;
  slippagePercent?: string;
  brokeragePerOrder?: string;
  dataSource?: BacktestDataSource;
  marketRegimeForCandle?: (candle: IndicatorCandle, candleIndex: number) => MarketRegime;
  dataQualityForCandle?: (
    candle: IndicatorCandle,
    candleIndex: number,
  ) => DataQualityStatus;
  optionRowsForPrice?: BacktestOptionRowsFactory;
};

export type BacktestMetadata = {
  id: string;
  name: string;
  strategyName: string;
  strategyVersion: string;
  underlying: UnderlyingSymbol;
  expiry: string;
  startedAt: string;
  endedAt: string;
  candleCount: number;
  warmupCandles: number;
  lotSize: number;
  slippagePercent: string;
  brokeragePerOrder: string;
  dataSource: BacktestDataSource;
  liveOrdersEnabled: false;
};

export type BacktestTrade = {
  id: string;
  signalId: string;
  signalTime: string;
  signalCandleIndex: number;
  entryTime: string;
  entryCandleIndex: number;
  exitTime: string;
  exitCandleIndex: number;
  underlying: UnderlyingSymbol;
  direction: Exclude<StrategyDirection, "NO TRADE">;
  optionSymbol: string;
  optionSide: OptionSide;
  strike: number;
  quantity: number;
  lots: number;
  entryUnderlying: string;
  exitUnderlying: string;
  entryPrice: string;
  exitPrice: string;
  stopPrice: string;
  targetOne: string;
  targetTwo: string;
  grossPnl: string;
  costs: string;
  netPnl: string;
  returnOnRisk: string | null;
  outcome: BacktestTradeOutcome;
  exitReason: BacktestExitReason;
  score: number;
  quality: SignalQuality;
  reasons: string[];
  risks: string[];
};

export type BacktestEquityPoint = {
  timestamp: string;
  tradeId: string;
  equity: string;
  drawdown: string;
};

export type BacktestSummary = {
  evaluatedSignals: number;
  confirmedSignals: number;
  skippedSignals: number;
  trades: number;
  wins: number;
  losses: number;
  flats: number;
  winRate: string;
  grossPnl: string;
  costs: string;
  netPnl: string;
  averageWin: string;
  averageLoss: string;
  largestWin: string;
  largestLoss: string;
  expectancy: string;
  profitFactor: string | null;
  maxDrawdown: string;
  liveOrdersEnabled: false;
};

export type BacktestResult = {
  metadata: BacktestMetadata;
  summary: BacktestSummary;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  warnings: string[];
};
