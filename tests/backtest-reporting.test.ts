import { describe, expect, it } from "vitest";
import {
  backtestReportRecordFromResult,
  filterBacktestReportRecords,
  isBacktestReportRecord,
  summarizeBacktestReportRecords,
} from "../lib/backtesting/backtest-reporting";
import {
  backtestReportCsvFilename,
  backtestReportRecordsToCsv,
} from "../lib/backtesting/backtest-report-export";
import { backtestReportDetailFromResult } from "../lib/backtesting/backtest-report-detail";
import {
  backtestReportQueryString,
  parseBacktestReportFilters,
  parseBacktestReportLimit,
} from "../lib/backtesting/backtest-report-query";
import { backtestReportSharePath } from "../lib/backtesting/backtest-report-share";
import {
  runSampleMultiDayVwapBreakoutBacktest,
  runSampleVwapBreakoutBacktest,
} from "../lib/backtesting/vwap-breakout-backtest";
import { backtestRecordFromDatabase } from "../lib/persistence/backtest-store";

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

  it("exports report records as safe CSV rows", () => {
    const record = {
      ...backtestReportRecordFromResult(runSampleVwapBreakoutBacktest(), SAVED_AT),
      name: 'NIFTY "comma, test"',
      underlying: "NIFTY, INDEX",
    };
    const csv = backtestReportRecordsToCsv([record]);
    const [header, row] = csv.split("\r\n");

    expect(header).toBe(
      "Run ID,Name,Status,Type,Underlying,Data Source,Started At,Ended At,Trades,Net P&L,Win Rate %,Max Drawdown,Saved At,Live Orders Enabled",
    );
    expect(row).toContain('"NIFTY ""comma, test"""');
    expect(row).toContain('"NIFTY, INDEX"');
    expect(row?.endsWith(",false")).toBe(true);
  });

  it("builds predictable report export filenames", () => {
    expect(backtestReportCsvFilename(new Date("2026-09-01T04:30:00.000Z"))).toBe(
      "groww-backtest-report-2026-09-01.csv",
    );
  });

  it("parses and serializes report query filters", () => {
    const params = new URLSearchParams(
      "underlying=NIFTY&kind=multi_day&result=profitable&limit=25",
    );
    const invalidParams = new URLSearchParams(
      "underlying=SENSEX&kind=intraday&result=great&limit=-1",
    );

    expect(parseBacktestReportFilters(params)).toEqual({
      underlying: "NIFTY",
      kind: "multi_day",
      result: "profitable",
    });
    expect(parseBacktestReportLimit(params.get("limit"))).toBe(25);
    expect(parseBacktestReportFilters(invalidParams)).toEqual({
      underlying: undefined,
      kind: undefined,
      result: undefined,
    });
    expect(parseBacktestReportLimit(invalidParams.get("limit"))).toBeUndefined();
    expect(
      backtestReportQueryString({
        filters: { underlying: "NIFTY", kind: "multi_day", result: "profitable" },
        limit: 25,
      }),
    ).toBe("underlying=NIFTY&kind=multi_day&result=profitable&limit=25");
    expect(
      backtestReportQueryString({
        filters: { underlying: "ALL", kind: "all", result: "all" },
      }),
    ).toBe("");
  });

  it("builds read-only detail records for shared report pages", () => {
    const result = runSampleMultiDayVwapBreakoutBacktest();
    const detail = backtestReportDetailFromResult(result, SAVED_AT);

    expect(detail.record.id).toBe(result.metadata.id);
    expect(detail.record.kind).toBe("multi_day");
    expect(detail.record.savedAt).toBe(SAVED_AT.toISOString());
    expect(detail.summary.liveOrdersEnabled).toBe(false);
    expect(detail.assumptions.liveOrdersEnabled).toBe(false);
    expect(detail.liveOrdersEnabled).toBe(false);
    expect(detail.sessions.length).toBe(result.sessions.length);
    expect(detail.trades).toHaveLength(result.trades.length);
    expect(detail.trades.every((trade) => trade.liveOrdersEnabled === false)).toBe(true);
  });

  it("creates encoded share paths for saved report links", () => {
    expect(backtestReportSharePath("SIM-REPORT 1/CE")).toBe("/backtests/SIM-REPORT%201%2FCE");
  });

  it("preserves multi-day kind when reading saved database reports", () => {
    const record = backtestRecordFromDatabase({
      id: "SIM-MULTI",
      name: "Saved multi-day report",
      status: "COMPLETED",
      trainingStart: new Date("2026-09-01T03:45:00.000Z"),
      trainingEnd: new Date("2026-09-03T05:20:00.000Z"),
      updatedAt: SAVED_AT,
      assumptions: {
        kind: "multi_day",
        dataSource: "SIMULATED_HISTORICAL_REPLAY",
        liveOrdersEnabled: false,
      },
      metrics: {
        metadata: {
          sessionCount: 3,
          underlying: "NIFTY",
          dataSource: "SIMULATED_HISTORICAL_REPLAY",
        },
        summary: {
          netPnl: "1484.80",
          winRate: "100.00",
          maxDrawdown: "0.00",
        },
      },
      _count: {
        trades: 2,
      },
    } as unknown as Parameters<typeof backtestRecordFromDatabase>[0]);

    expect(record.kind).toBe("multi_day");
    expect(record.liveOrdersEnabled).toBe(false);
  });
});
