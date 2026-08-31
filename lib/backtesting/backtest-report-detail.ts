import {
  backtestReportRecordFromResult,
  type PersistableBacktestResult,
} from "@/lib/backtesting/backtest-reporting";
import type {
  BacktestSessionResult,
  BacktestTrade,
  MultiDayBacktestResult,
} from "@/types/backtest";
import type {
  BacktestReportDetail,
  BacktestReportDetailSession,
  BacktestReportDetailTrade,
} from "@/types/backtest-report";

function hasSessions(result: PersistableBacktestResult): result is MultiDayBacktestResult {
  return "sessions" in result;
}

function tradeSide(trade: BacktestTrade): BacktestReportDetailTrade["side"] {
  return trade.optionSide === "CE" ? "LONG_CALL" : "LONG_PUT";
}

function expiryForReplayTrade(result: PersistableBacktestResult, trade: BacktestTrade) {
  if (!hasSessions(result)) {
    return result.metadata.expiry;
  }

  const signalTime = new Date(trade.signalTime).getTime();
  const session = result.sessions.find((item) => {
    const startedAt = new Date(item.metadata.startedAt).getTime();
    const endedAt = new Date(item.metadata.endedAt).getTime();

    return (
      Number.isFinite(signalTime) &&
      Number.isFinite(startedAt) &&
      Number.isFinite(endedAt) &&
      signalTime >= startedAt &&
      signalTime <= endedAt
    );
  });

  return session?.metadata.expiry ?? result.sessions[0]?.metadata.expiry ?? "";
}

function detailTradeFromReplay(
  result: PersistableBacktestResult,
  trade: BacktestTrade,
): BacktestReportDetailTrade {
  return {
    id: trade.id,
    signalTime: trade.signalTime,
    entryTime: trade.entryTime,
    exitTime: trade.exitTime,
    underlying: trade.underlying,
    optionSymbol: trade.optionSymbol,
    side: tradeSide(trade),
    strike: String(trade.strike),
    expiry: expiryForReplayTrade(result, trade),
    quantity: trade.quantity,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    stopPrice: trade.stopPrice,
    targetOne: trade.targetOne,
    targetTwo: trade.targetTwo,
    transactionCost: trade.costs,
    realizedPnl: trade.netPnl,
    rMultiple: trade.returnOnRisk,
    score: trade.score,
    outcome: trade.outcome,
    liveOrdersEnabled: false,
  };
}

function detailSessionFromReplay(session: BacktestSessionResult): BacktestReportDetailSession {
  return {
    id: session.id,
    date: session.date,
    label: session.label,
    trades: session.summary.trades,
    netPnl: session.summary.netPnl,
    winRate: session.summary.winRate,
    maxDrawdown: session.summary.maxDrawdown,
    warnings: session.warnings,
    liveOrdersEnabled: false,
  };
}

export function backtestReportDetailFromResult(
  result: PersistableBacktestResult,
  savedAt = new Date(),
): BacktestReportDetail {
  const record = backtestReportRecordFromResult(result, savedAt);
  const slippagePercent = "slippagePercent" in result.metadata ? result.metadata.slippagePercent : null;
  const brokeragePerOrder =
    "brokeragePerOrder" in result.metadata ? result.metadata.brokeragePerOrder : null;

  return {
    record,
    summary: {
      ...result.summary,
      liveOrdersEnabled: false,
    },
    assumptions: {
      kind: record.kind,
      dataSource: result.metadata.dataSource,
      slippagePercent,
      brokeragePerOrder,
      warnings: result.warnings,
      liveOrdersEnabled: false,
    },
    sessions: hasSessions(result) ? result.sessions.map(detailSessionFromReplay) : [],
    trades: result.trades.map((trade) => detailTradeFromReplay(result, trade)),
    equityCurve: result.equityCurve,
    liveOrdersEnabled: false,
  };
}
