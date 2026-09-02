import { describe, expect, it } from "vitest";
import {
  createSampleBacktestCandles,
  runSampleMultiDayVwapBreakoutBacktest,
  runSampleVwapBreakoutBacktest,
  runVwapBreakoutBacktest,
} from "../lib/backtesting/vwap-breakout-backtest";
import { DEFAULT_RISK_CONFIGURATION } from "../lib/risk/defaults";

const PREVIOUS_DAY = {
  high: "25210.00",
  low: "24980.00",
  close: "25060.00",
};

describe("VWAP breakout backtest", () => {
  it("runs the sample replay in paper-only mode", () => {
    const result = runSampleVwapBreakoutBacktest();
    const trade = result.trades[0];

    expect(result.metadata.dataSource).toBe("SIMULATED_HISTORICAL_REPLAY");
    expect(result.metadata.liveOrdersEnabled).toBe(false);
    expect(result.summary.liveOrdersEnabled).toBe(false);
    expect(result.summary.confirmedSignals).toBe(1);
    expect(result.summary.trades).toBe(1);
    expect(result.summary.netPnl).toBe("742.40");
    expect(trade.direction).toBe("BULLISH");
    expect(trade.exitReason).toBe("TARGET_1");
    expect(trade.entryCandleIndex).toBe(trade.signalCandleIndex + 1);
    expect(trade.exitCandleIndex).toBeGreaterThan(trade.entryCandleIndex);
  });

  it("blocks replay signals when historical data quality is stale", () => {
    const result = runVwapBreakoutBacktest({
      candles: createSampleBacktestCandles(),
      previousDay: PREVIOUS_DAY,
      dataQualityForCandle: () => "STALE",
    });

    expect(result.summary.confirmedSignals).toBe(0);
    expect(result.summary.trades).toBe(0);
    expect(result.summary.netPnl).toBe("0.00");
  });

  it("skips confirmed signals when risk sizing cannot reach one lot", () => {
    const result = runVwapBreakoutBacktest({
      candles: createSampleBacktestCandles(),
      previousDay: PREVIOUS_DAY,
      risk: {
        ...DEFAULT_RISK_CONFIGURATION,
        tradingCapital: "1000",
        riskPerTradePercent: "1",
      },
    });

    expect(result.summary.confirmedSignals).toBeGreaterThan(0);
    expect(result.summary.skippedSignals).toBe(result.summary.confirmedSignals);
    expect(result.summary.trades).toBe(0);
    expect(result.warnings).toContain("Required position size is below minimum lot size.");
  });

  it("returns a warning when there are not enough candles to replay", () => {
    const result = runVwapBreakoutBacktest({
      candles: createSampleBacktestCandles().slice(0, 20),
      previousDay: PREVIOUS_DAY,
    });

    expect(result.summary.evaluatedSignals).toBe(0);
    expect(result.summary.trades).toBe(0);
    expect(result.warnings).toContain("Not enough candles for warmup and next-candle entry.");
  });

  it("aggregates the sample replay across multiple sessions", () => {
    const result = runSampleMultiDayVwapBreakoutBacktest();

    expect(result.metadata.sessionCount).toBe(3);
    expect(result.summary.trades).toBe(2);
    expect(result.summary.netPnl).toBe("1484.80");
    expect(result.sessions.map((session) => session.summary.trades)).toEqual([1, 0, 1]);
    expect(new Set(result.trades.map((trade) => trade.id)).size).toBe(result.trades.length);
    expect(result.equityCurve.at(-1)?.equity).toBe("1484.80");
  }, 15000);
});
