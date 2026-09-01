import { describe, expect, it } from "vitest";
import { backtestReportRecordFromResult } from "../lib/backtesting/backtest-reporting";
import { runSampleMultiDayVwapBreakoutBacktest } from "../lib/backtesting/vwap-breakout-backtest";
import {
  buildReportReviewComparison,
  isReportReviewInput,
} from "../lib/persistence/report-review-store";

const REPLAY_TEST_TIMEOUT_MS = 15_000;

describe("scheduled report reviews", () => {
  it("validates review input before persistence", () => {
    expect(
      isReportReviewInput({
        cadence: "weekly",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-07",
        title: "Weekly review",
        notes: "Follow the rules.",
        reportIds: ["SIM-1"],
      }),
    ).toBe(true);
    expect(isReportReviewInput({ cadence: "monthly" })).toBe(false);
  });

  it("builds read-only comparison snapshots for selected reports", () => {
    const report = backtestReportRecordFromResult(runSampleMultiDayVwapBreakoutBacktest());
    const comparison = buildReportReviewComparison({
      reports: [report],
    });

    expect(comparison.reportCount).toBe(1);
    expect(comparison.trades).toBe(report.trades);
    expect(comparison.netPnl).toBe(report.netPnl);
    expect(comparison.bestRun?.id).toBe(report.id);
    expect(comparison.changedSincePrevious).toEqual(["First saved review for this cadence."]);
    expect(comparison.liveOrdersEnabled).toBe(false);
  }, REPLAY_TEST_TIMEOUT_MS);
});
