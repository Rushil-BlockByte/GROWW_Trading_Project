import { describe, expect, it } from "vitest";
import {
  backtestReportRecordFromResult,
  filterBacktestReportRecords,
  isBacktestReportRecord,
  summarizeBacktestReportRecords,
} from "../lib/backtesting/backtest-reporting";
import {
  runSampleMultiDayVwapBreakoutBacktest,
  runSampleVwapBreakoutBacktest,
} from "../lib/backtesting/vwap-breakout-backtest";

const SAVED_AT = new Date("2026-09-01T04:30:00.000Z");

describe("backtest reporting", () => {
  it("builds report records and summary totals from single-day and multi-day replays", () => {
    const single = backtestReportRecordFromResult(runSampleVwapBreakoutBacktest(), SAVED_AT);
    const multi = backtestReportRecordFromResult(
      runSampleMultiDayVwapBreakoutBacktest(),
      SAVED_AT,
    );
    const summary = summarizeBacktestReportRecords([single, multi]);

    expect(single.kind).toBe("single_day");
    expect(multi.kind).toBe("multi_day");
    expect(single.savedAt).toBe(SAVED_AT.toISOString());
    expect(summary.runCount).toBe(2);
    expect(summary.singleDayRuns).toBe(1);
    expect(summary.multiDayRuns).toBe(1);
    expect(summary.trades).toBe(3);
    expect(summary.netPnl).toBe("2227.20");
    expect(summary.winningRuns).toBe(2);
    expect(summary.bestRun?.id).toBe(multi.id);
    expect(summary.worstRun?.id).toBe(single.id);
    expect(summary.liveOrdersEnabled).toBe(false);
  });

  it("filters report records by underlying, run type, and result", () => {
    const single = backtestReportRecordFromResult(runSampleVwapBreakoutBacktest(), SAVED_AT);
    const multi = backtestReportRecordFromResult(
      runSampleMultiDayVwapBreakoutBacktest(),
      SAVED_AT,
    );
    const losing = {
      ...single,
      id: "SIM-LOSING-RUN",
      name: "Losing replay",
      kind: "single_day" as const,
      netPnl: "-125.00",
      winRate: "0.00",
    };
    const records = [single, multi, losing];

    expect(filterBacktestReportRecords(records, { kind: "multi_day" })).toEqual([multi]);
    expect(filterBacktestReportRecords(records, { underlying: "BANKNIFTY" })).toEqual([]);
    expect(filterBacktestReportRecords(records, { result: "profitable" })).toEqual([
      single,
      multi,
    ]);
    expect(filterBacktestReportRecords(records, { result: "losing" })).toEqual([losing]);
  });

  it("accepts only safe report records for dashboard rendering", () => {
    const record = backtestReportRecordFromResult(runSampleVwapBreakoutBacktest(), SAVED_AT);

    expect(isBacktestReportRecord(record)).toBe(true);
    expect(isBacktestReportRecord({ ...record, liveOrdersEnabled: true })).toBe(false);
    expect(isBacktestReportRecord({ ...record, netPnl: 742.4 })).toBe(false);
  });
});
