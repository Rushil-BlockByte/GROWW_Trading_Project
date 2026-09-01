import Decimal from "decimal.js";
import type { BacktestReportDetail } from "@/types/backtest-report";
import type { TradingExplanation } from "@/types/explanations";
import type { SimulatedMarketSnapshot } from "@/types/simulation";

function toDecimal(value: Decimal.Value) {
  return new Decimal(value);
}

function signed(value: string) {
  const decimal = toDecimal(value);

  return `${decimal.gte(0) ? "+" : ""}${decimal.toFixed(2)}`;
}

export function explainScannerSnapshot(snapshot: SimulatedMarketSnapshot): TradingExplanation {
  const signal = snapshot.phase6;
  const noTrade = signal.direction === "NO TRADE";
  const blockedComponents = signal.components
    .filter((component) => component.status === "FAIL")
    .map((component) => `${component.label}: ${component.detail}`);
  const strengths = signal.components
    .filter((component) => component.status === "PASS")
    .slice(0, 4)
    .map((component) => `${component.label}: ${component.detail}`);
  const cautions = [
    ...blockedComponents,
    ...snapshot.signal.risks,
  ].slice(0, 6);

  return {
    headline: noTrade ? "No trade is the correct state right now." : "A paper setup is forming.",
    verdict: noTrade ? "no_trade" : signal.score >= 75 ? "positive" : "watch",
    summary: noTrade
      ? `The scanner score is ${signal.score}/100, but one or more hard gates still block a trade.`
      : `The scanner has a ${signal.direction} bias with a ${signal.score}/100 score and ${signal.quality.toLowerCase()} quality.`,
    strengths: strengths.length ? strengths : ["No strong component has passed yet."],
    cautions: cautions.length ? cautions : ["Keep watching for stale data, spread expansion, and failed follow-through."],
    nextSteps: noTrade
      ? ["Wait for all hard gates to pass.", "Keep the setup in paper-only review.", "Do not force a trade while the direction is NO TRADE."]
      : ["Verify liquidity again before journaling.", "Check the invalidation level.", "Capture only a paper trade unless live execution is explicitly built later."],
    changed: [
      `Signal state is ${snapshot.signal.state}.`,
      `Data quality is ${snapshot.health.dataQuality.replace("_", " ")}.`,
      `Live orders are off.`,
    ],
    liveOrdersEnabled: false,
  };
}

export function explainBacktestReport(report: BacktestReportDetail): TradingExplanation {
  const pnl = toDecimal(report.summary.netPnl);
  const winRate = toDecimal(report.summary.winRate);
  const hasTrades = report.summary.trades > 0;
  const verdict: TradingExplanation["verdict"] = !hasTrades
    ? "caution"
    : pnl.gt(0) && winRate.gte(50)
      ? "positive"
      : pnl.lt(0)
        ? "caution"
        : "watch";

  return {
    headline: hasTrades
      ? `${report.record.name} finished ${pnl.gte(0) ? "positive" : "negative"} in replay.`
      : `${report.record.name} produced no replay trades.`,
    verdict,
    summary: hasTrades
      ? `Across ${report.summary.trades} paper-only trades, net P&L was ${signed(report.summary.netPnl)} with a ${report.summary.winRate}% win rate.`
      : "The strategy found no confirmed entries in this report, so the review should focus on filters and market regime.",
    strengths: [
      report.summary.wins
        ? `${report.summary.wins} winning trade${report.summary.wins === 1 ? "" : "s"} were recorded.`
        : "No winning trades were recorded.",
      `Largest win: ${signed(report.summary.largestWin)}.`,
      `Expectancy: ${signed(report.summary.expectancy)}.`,
    ],
    cautions: [
      `Max drawdown: ${signed(report.summary.maxDrawdown)}.`,
      report.assumptions.slippagePercent
        ? `Slippage assumption: ${report.assumptions.slippagePercent}.`
        : "Slippage was not stored for this report.",
      report.assumptions.warnings.length
        ? report.assumptions.warnings.join(" ")
        : "Treat replay results as evidence for review, not permission to place live orders.",
    ],
    nextSteps: [
      "Compare this report with at least one other session before changing rules.",
      "Record what market condition helped or hurt the setup.",
      "Keep live order execution disabled until a separate execution phase is designed.",
    ],
    changed: report.sessions.length
      ? report.sessions.map(
          (session) =>
            `${session.label}: ${session.trades} trades, ${signed(session.netPnl)} net.`,
        )
      : ["Single-session report; no session breakdown is stored."],
    liveOrdersEnabled: false,
  };
}
