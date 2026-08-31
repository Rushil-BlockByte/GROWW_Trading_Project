import type { UnderlyingSymbol } from "@/types/market";
import type { BacktestEquityPoint, BacktestSummary } from "@/types/backtest";

export type BacktestReportKind = "single_day" | "multi_day";

export type BacktestReportResultFilter = "all" | "profitable" | "losing" | "flat";

export type BacktestReportFilters = {
  underlying?: UnderlyingSymbol | "ALL";
  kind?: BacktestReportKind | "all";
  result?: BacktestReportResultFilter;
};

export type BacktestReportRecord = {
  id: string;
  name: string;
  status: string;
  kind: BacktestReportKind;
  underlying: string;
  dataSource: string;
  startedAt: string | null;
  endedAt: string | null;
  trades: number;
  netPnl: string;
  winRate: string;
  maxDrawdown: string;
  savedAt: string;
  liveOrdersEnabled: false;
};

export type BacktestReportSummary = {
  runCount: number;
  singleDayRuns: number;
  multiDayRuns: number;
  trades: number;
  winningRuns: number;
  losingRuns: number;
  flatRuns: number;
  netPnl: string;
  averageWinRate: string;
  maxDrawdown: string;
  bestRun: BacktestReportRecord | null;
  worstRun: BacktestReportRecord | null;
  liveOrdersEnabled: false;
};

export type BacktestReportAssumptions = {
  kind: BacktestReportKind;
  dataSource: string;
  slippagePercent: string | null;
  brokeragePerOrder: string | null;
  warnings: string[];
  liveOrdersEnabled: false;
};

export type BacktestReportDetailSession = {
  id: string;
  date: string;
  label: string;
  trades: number;
  netPnl: string;
  winRate: string;
  maxDrawdown: string;
  warnings: string[];
  liveOrdersEnabled: false;
};

export type BacktestReportDetailTrade = {
  id: string;
  signalTime: string;
  entryTime: string;
  exitTime: string | null;
  underlying: string;
  optionSymbol: string;
  side: "LONG_CALL" | "LONG_PUT";
  strike: string;
  expiry: string;
  quantity: number;
  entryPrice: string;
  exitPrice: string | null;
  stopPrice: string;
  targetOne: string | null;
  targetTwo: string | null;
  transactionCost: string | null;
  realizedPnl: string | null;
  rMultiple: string | null;
  score: number;
  outcome: string | null;
  liveOrdersEnabled: false;
};

export type BacktestReportDetail = {
  record: BacktestReportRecord;
  summary: BacktestSummary;
  assumptions: BacktestReportAssumptions;
  sessions: BacktestReportDetailSession[];
  trades: BacktestReportDetailTrade[];
  equityCurve: BacktestEquityPoint[];
  liveOrdersEnabled: false;
};
