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
  const strengths: string[] = [];

  if (signal.nearestResistance) {
    strengths.push(`Resistance ${signal.nearestResistance.price} (${signal.nearestResistance.touches} touches).`);
  }
  if (signal.nearestSupport) {
    strengths.push(`Support ${signal.nearestSupport.price} (${signal.nearestSupport.touches} touches).`);
  }

  const cautions = [...signal.reasons, ...snapshot.signal.risks].slice(0, 6);

  return {
    headline: noTrade
      ? "No break-and-retest setup right now."
      : `A ${signal.direction} flip setup is ${signal.state === "CONFIRMED" ? "confirmed" : "forming"}.`,
    verdict: noTrade ? "no_trade" : signal.state === "CONFIRMED" ? "positive" : "watch",
    summary: noTrade
      ? `Price sits between support and resistance with no broken level to retest (VIX regime ${signal.vixRegime}).`
      : `A level broke and price is ${signal.state === "CONFIRMED" ? "retesting it now" : "expected to retest it"}; plan enter ${signal.plan?.entry}, stop ${signal.plan?.stop}, target ${signal.plan?.target}.`,
    strengths: strengths.length ? strengths : ["No strong nearby level yet."],
    cautions: cautions.length ? cautions : ["Keep watching for stale data and levels failing to hold."],
    nextSteps: noTrade
      ? ["Wait for a level to break and retest.", "Keep the setup in paper-only review.", "Do not force a trade while the direction is NO TRADE."]
      : ["Confirm the retest holds before journaling.", "Respect the stop beyond the level.", "Capture only a paper trade unless live execution is explicitly built later."],
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
