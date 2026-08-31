import type { UnderlyingSymbol } from "@/types/market";

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
