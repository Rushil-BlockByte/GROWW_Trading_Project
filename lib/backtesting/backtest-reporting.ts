import Decimal from "decimal.js";
import type { BacktestResult, MultiDayBacktestResult } from "@/types/backtest";
import type {
  BacktestReportFilters,
  BacktestReportRecord,
  BacktestReportSummary,
} from "@/types/backtest-report";

export type PersistableBacktestResult = BacktestResult | MultiDayBacktestResult;

function toDecimal(value: Decimal.Value) {
  return new Decimal(value);
}

function toFixed(value: Decimal.Value, places = 2) {
  return toDecimal(value).toFixed(places);
}

function hasSessions(result: PersistableBacktestResult): result is MultiDayBacktestResult {
  return "sessions" in result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isResultMatch(record: BacktestReportRecord, result: BacktestReportFilters["result"]) {
  const pnl = toDecimal(record.netPnl);

  if (!result || result === "all") return true;
  if (result === "profitable") return pnl.gt(0);
  if (result === "losing") return pnl.lt(0);

  return pnl.eq(0);
}

export function backtestReportRecordFromResult(
  result: PersistableBacktestResult,
  savedAt = new Date(),
): BacktestReportRecord {
  return {
    id: result.metadata.id,
    name: result.metadata.name,
    status: "COMPLETED",
    kind: hasSessions(result) ? "multi_day" : "single_day",
    underlying: result.metadata.underlying,
    dataSource: result.metadata.dataSource,
    startedAt: result.metadata.startedAt || null,
    endedAt: result.metadata.endedAt || null,
    trades: result.summary.trades,
    netPnl: result.summary.netPnl,
    winRate: result.summary.winRate,
    maxDrawdown: result.summary.maxDrawdown,
    savedAt: savedAt.toISOString(),
    liveOrdersEnabled: false,
  };
}

export function filterBacktestReportRecords(
  records: BacktestReportRecord[],
  filters: BacktestReportFilters = {},
) {
  return records.filter((record) => {
    if (
      filters.underlying &&
      filters.underlying !== "ALL" &&
      record.underlying !== filters.underlying
    ) {
      return false;
    }

    if (filters.kind && filters.kind !== "all" && record.kind !== filters.kind) {
      return false;
    }

    return isResultMatch(record, filters.result);
  });
}

export function summarizeBacktestReportRecords(
  records: BacktestReportRecord[],
): BacktestReportSummary {
  const netPnl = records.reduce((sum, record) => sum.plus(record.netPnl), new Decimal(0));
  const trades = records.reduce((sum, record) => sum + record.trades, 0);
  const winRateTotal = records.reduce((sum, record) => sum.plus(record.winRate), new Decimal(0));
  const drawdowns = records.map((record) => toDecimal(record.maxDrawdown));
  const bestRun = records.length
    ? records.reduce((best, record) => (toDecimal(record.netPnl).gt(best.netPnl) ? record : best))
    : null;
  const worstRun = records.length
    ? records.reduce((worst, record) => (toDecimal(record.netPnl).lt(worst.netPnl) ? record : worst))
    : null;

  return {
    runCount: records.length,
    singleDayRuns: records.filter((record) => record.kind === "single_day").length,
    multiDayRuns: records.filter((record) => record.kind === "multi_day").length,
    trades,
    winningRuns: records.filter((record) => toDecimal(record.netPnl).gt(0)).length,
    losingRuns: records.filter((record) => toDecimal(record.netPnl).lt(0)).length,
    flatRuns: records.filter((record) => toDecimal(record.netPnl).eq(0)).length,
    netPnl: toFixed(netPnl),
    averageWinRate: records.length ? winRateTotal.div(records.length).toFixed(2) : "0.00",
    maxDrawdown: drawdowns.length ? toFixed(Decimal.max(...drawdowns)) : "0.00",
    bestRun,
    worstRun,
    liveOrdersEnabled: false,
  };
}

export function isBacktestReportRecord(value: unknown): value is BacktestReportRecord {
  if (!isObject(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.status === "string" &&
    (value.kind === "single_day" || value.kind === "multi_day") &&
    typeof value.underlying === "string" &&
    typeof value.dataSource === "string" &&
    (typeof value.startedAt === "string" || value.startedAt === null) &&
    (typeof value.endedAt === "string" || value.endedAt === null) &&
    typeof value.trades === "number" &&
    typeof value.netPnl === "string" &&
    typeof value.winRate === "string" &&
    typeof value.maxDrawdown === "string" &&
    typeof value.savedAt === "string" &&
    value.liveOrdersEnabled === false
  );
}
