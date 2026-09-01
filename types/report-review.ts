import type { BacktestReportRecord } from "@/types/backtest-report";

export type ReportReviewCadence = "daily" | "weekly";

export type ReportReviewInput = {
  cadence: ReportReviewCadence;
  periodStart: string;
  periodEnd: string;
  title: string;
  notes: string;
  reportIds: string[];
};

export type ReportReviewComparison = {
  reportCount: number;
  trades: number;
  winningRuns: number;
  losingRuns: number;
  flatRuns: number;
  netPnl: string;
  averageWinRate: string;
  maxDrawdown: string;
  bestRun: BacktestReportRecord | null;
  worstRun: BacktestReportRecord | null;
  changedSincePrevious: string[];
  liveOrdersEnabled: false;
};

export type ReportReviewRecord = {
  id: string;
  cadence: ReportReviewCadence;
  periodStart: string;
  periodEnd: string;
  title: string;
  notes: string;
  reportIds: string[];
  comparison: ReportReviewComparison;
  createdAt: string;
  updatedAt: string;
  liveOrdersEnabled: false;
};

export type ReportReviewPersistenceResult = {
  persistence: {
    configured: boolean;
    status: "database" | "local_only" | "error";
    message: string;
  };
  review: ReportReviewRecord | null;
  reviews: ReportReviewRecord[];
  savedCount: number;
  liveOrdersEnabled: false;
};
