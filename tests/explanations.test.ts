import { describe, expect, it } from "vitest";
import { backtestReportDetailFromResult } from "../lib/backtesting/backtest-report-detail";
import { runSampleMultiDayVwapBreakoutBacktest } from "../lib/backtesting/vwap-breakout-backtest";
import {
  explainBacktestReport,
  explainScannerSnapshot,
} from "../lib/explanations/trading-explanations";
import { createInitialMarketSnapshot } from "../lib/simulation/market-snapshot";

const REPLAY_TEST_TIMEOUT_MS = 15_000;

describe("plain-language trading explanations", () => {
  it("explains why the scanner should stay out of a blocked trade", () => {
    const explanation = explainScannerSnapshot(createInitialMarketSnapshot());

    expect(explanation.headline).toContain("No trade");
    expect(explanation.summary).toContain("hard gates");
    expect(explanation.liveOrdersEnabled).toBe(false);
  });

  it("explains saved backtest reports without enabling live orders", () => {
    const detail = backtestReportDetailFromResult(runSampleMultiDayVwapBreakoutBacktest());
    const explanation = explainBacktestReport(detail);

    expect(explanation.summary).toContain("paper-only");
    expect(explanation.nextSteps.join(" ")).toContain("live order execution disabled");
    expect(explanation.liveOrdersEnabled).toBe(false);
  }, REPLAY_TEST_TIMEOUT_MS);
});
