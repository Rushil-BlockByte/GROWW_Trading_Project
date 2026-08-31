import Decimal from "decimal.js";
import { buildIndicatorContext } from "@/lib/indicators/core";
import { buildOptionChainContext } from "@/lib/options/chain-context";
import { PAPER_OPTION_STOP_PERCENT, PAPER_TRADE_LOT_SIZE } from "@/lib/paper-trading/journal";
import { DEFAULT_RISK_CONFIGURATION, type RiskConfiguration } from "@/lib/risk/defaults";
import { calculatePositionSize } from "@/lib/risk/position-sizing";
import {
  evaluateVwapBreakoutStrategy,
  VWAP_BREAKOUT_STRATEGY_NAME,
  VWAP_BREAKOUT_STRATEGY_VERSION,
} from "@/lib/strategy/vwap-breakout";
import type {
  BacktestEquityPoint,
  BacktestExitReason,
  BacktestOptionRowsFactory,
  BacktestResult,
  BacktestRunInput,
  BacktestTrade,
  BacktestTradeOutcome,
} from "@/types/backtest";
import type { IndicatorCandle, IndicatorContext, PriceLevel } from "@/types/indicators";
import type { DataQualityStatus, MarketRegime, UnderlyingSymbol } from "@/types/market";
import type { OptionChainContext, OptionLegLiquidity, OptionSide } from "@/types/options";
import type { StrategyDirection, StrategyEntryPlan } from "@/types/strategy";

export const SAMPLE_BACKTEST_ID = "SIM-VWAP-BREAKOUT-2026-09-01";
export const SAMPLE_BACKTEST_EXPIRY = "2026-09-03";

const DEFAULT_BACKTEST_NAME = "Phase 8 simulated VWAP breakout replay";
const DEFAULT_BACKTEST_WARMUP_CANDLES = 50;
const DEFAULT_BACKTEST_COOLDOWN_CANDLES = 5;
const DEFAULT_SLIPPAGE_PERCENT = "0.10";
const DEFAULT_BROKERAGE_PER_ORDER = "20.00";
const SAMPLE_START_TIME = new Date("2026-09-01T03:45:00.000Z");
const SAMPLE_PREVIOUS_DAY = {
  high: "25210.00",
  low: "24980.00",
  close: "25060.00",
};

type OpenBacktestTrade = {
  id: string;
  signalId: string;
  signalTime: string;
  signalCandleIndex: number;
  entryTime: string;
  entryCandleIndex: number;
  underlying: UnderlyingSymbol;
  direction: Exclude<StrategyDirection, "NO TRADE">;
  optionSymbol: string;
  optionSide: OptionSide;
  strike: number;
  quantity: number;
  lots: number;
  entryUnderlying: Decimal;
  entryPrice: Decimal;
  stopPrice: Decimal;
  maximumRisk: Decimal;
  entryPlan: StrategyEntryPlan;
  score: number;
  quality: BacktestTrade["quality"];
  reasons: string[];
  risks: string[];
};

type ExitDecision = {
  reason: BacktestExitReason;
  underlyingPrice: Decimal;
};

function toDecimal(value: Decimal.Value) {
  return new Decimal(value);
}

function toFixed(value: Decimal.Value, places = 2) {
  return toDecimal(value).toFixed(places);
}

function round(value: Decimal.Value, places = 2) {
  return toDecimal(value).toDecimalPlaces(places).toNumber();
}

function sortCandles(candles: IndicatorCandle[]) {
  return [...candles].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );
}

function applyBuySlippage(price: Decimal, slippagePercent: Decimal) {
  return price.mul(new Decimal(1).plus(slippagePercent.div(100)));
}

function applySellSlippage(price: Decimal, slippagePercent: Decimal) {
  return price.mul(new Decimal(1).minus(slippagePercent.div(100)));
}

function optionStopFromEntry(entryPrice: Decimal) {
  return entryPrice.minus(entryPrice.mul(PAPER_OPTION_STOP_PERCENT).div(100));
}

function optionRowsForUnderlyingPrice(underlyingLastPrice: Decimal.Value) {
  const spot = toDecimal(underlyingLastPrice);
  const strikes = [24950, 25000, 25050, 25100, 25150, 25200, 25250, 25300, 25350, 25400];

  return strikes.map((strike) => {
    const distance = spot.minus(strike).abs();
    const timeValue = Decimal.max(new Decimal(32), new Decimal(92).minus(distance.mul("0.16")));
    const callLtp = Decimal.max(new Decimal(22), timeValue.plus(Decimal.max(spot.minus(strike), 0).mul("0.48")));
    const putLtp = Decimal.max(new Decimal(20), timeValue.plus(Decimal.max(new Decimal(strike).minus(spot), 0).mul("0.44")));
    const callBid = Decimal.max(new Decimal("0.05"), callLtp.minus("0.85"));
    const callAsk = callLtp.plus("0.95");
    const putBid = Decimal.max(new Decimal("0.05"), putLtp.minus("0.80"));
    const putAsk = putLtp.plus("0.90");
    const distanceNumber = distance.toNumber();

    return {
      strike,
      isAtm: distanceNumber <= 25,
      call: {
        ltp: round(callLtp),
        volume: Math.max(70_000, 160_000 - Math.round(distanceNumber * 140)),
        openInterest: 760_000 + Math.max(0, strike - 24950) * 420,
        oiChange: 15_000 + (strike <= 25250 ? 6_200 : 2_500),
        bid: round(callBid),
        ask: round(callAsk),
      },
      put: {
        ltp: round(putLtp),
        volume: Math.max(72_000, 170_000 - Math.round(distanceNumber * 130)),
        openInterest: 1_050_000 - Math.max(0, strike - 24950) * 210,
        oiChange: 24_000 + (strike <= 25250 ? 9_000 : 3_000),
        bid: round(putBid),
        ask: round(putAsk),
      },
    };
  });
}

export const sampleBacktestOptionRowsForPrice: BacktestOptionRowsFactory = ({
  underlyingLastPrice,
}) => optionRowsForUnderlyingPrice(underlyingLastPrice);

function buildOptionContextAtPrice({
  underlying,
  underlyingLastPrice,
  expiry,
  candle,
  candleIndex,
  optionRowsForPrice,
}: {
  underlying: UnderlyingSymbol;
  underlyingLastPrice: Decimal.Value;
  expiry: string;
  candle: IndicatorCandle;
  candleIndex: number;
  optionRowsForPrice: BacktestOptionRowsFactory;
}): OptionChainContext {
  return buildOptionChainContext({
    underlying,
    underlyingLastPrice,
    expiry,
    rows: optionRowsForPrice({
      underlying,
      underlyingLastPrice: toFixed(underlyingLastPrice),
      expiry,
      candle,
      candleIndex,
    }),
  });
}

function findOptionQuote(
  optionContext: OptionChainContext,
  strike: number,
  side: OptionSide,
): OptionLegLiquidity | null {
  const row = optionContext.rows.find((item) => item.strike === strike);

  if (!row) return null;

  return side === "CE" ? row.call : row.put;
}

function prependWatchedLevel(level: PriceLevel | null, levels: PriceLevel[]) {
  if (!level) return levels;

  const watchedValue = toFixed(level.value);

  return [
    level,
    ...levels.filter((item) => toFixed(item.value) !== watchedValue),
  ].slice(0, 4);
}

function indicatorWithReplayLevels({
  indicator,
  watchedSupport,
  watchedResistance,
}: {
  indicator: IndicatorContext;
  watchedSupport: PriceLevel | null;
  watchedResistance: PriceLevel | null;
}): IndicatorContext {
  return {
    ...indicator,
    potentialSupport: prependWatchedLevel(watchedSupport, indicator.potentialSupport),
    potentialResistance: prependWatchedLevel(watchedResistance, indicator.potentialResistance),
  };
}

function marketRegimeForDefault(): MarketRegime {
  return "BULLISH";
}

function dataQualityForDefault(): DataQualityStatus {
  return "GOOD";
}

function tradeOutcome(netPnl: Decimal): BacktestTradeOutcome {
  if (netPnl.gt(0)) return "WIN";
  if (netPnl.lt(0)) return "LOSS";

  return "FLAT";
}

function resolveExit({
  openTrade,
  candle,
  isFinalCandle,
}: {
  openTrade: OpenBacktestTrade;
  candle: IndicatorCandle;
  isFinalCandle: boolean;
}): ExitDecision | null {
  const high = toDecimal(candle.high);
  const low = toDecimal(candle.low);
  const close = toDecimal(candle.close);
  const invalidation = toDecimal(openTrade.entryPlan.invalidation);
  const targetOne = toDecimal(openTrade.entryPlan.targetOne);

  if (openTrade.direction === "BULLISH") {
    if (low.lte(invalidation)) {
      return { reason: "STOP", underlyingPrice: invalidation };
    }

    if (high.gte(targetOne)) {
      return { reason: "TARGET_1", underlyingPrice: targetOne };
    }
  } else {
    if (high.gte(invalidation)) {
      return { reason: "STOP", underlyingPrice: invalidation };
    }

    if (low.lte(targetOne)) {
      return { reason: "TARGET_1", underlyingPrice: targetOne };
    }
  }

  if (isFinalCandle) {
    return { reason: "SESSION_CLOSE", underlyingPrice: close };
  }

  return null;
}

function closeTrade({
  openTrade,
  exitDecision,
  exitQuote,
  exitCandle,
  exitCandleIndex,
  slippagePercent,
  brokeragePerOrder,
}: {
  openTrade: OpenBacktestTrade;
  exitDecision: ExitDecision;
  exitQuote: OptionLegLiquidity;
  exitCandle: IndicatorCandle;
  exitCandleIndex: number;
  slippagePercent: Decimal;
  brokeragePerOrder: Decimal;
}): BacktestTrade {
  const exitPrice = applySellSlippage(toDecimal(exitQuote.ltp), slippagePercent);
  const grossPnl = exitPrice.minus(openTrade.entryPrice).mul(openTrade.quantity);
  const costs = brokeragePerOrder.mul(2);
  const netPnl = grossPnl.minus(costs);
  const returnOnRisk = openTrade.maximumRisk.gt(0)
    ? netPnl.div(openTrade.maximumRisk).mul(100).toFixed(2)
    : null;

  return {
    id: openTrade.id,
    signalId: openTrade.signalId,
    signalTime: openTrade.signalTime,
    signalCandleIndex: openTrade.signalCandleIndex,
    entryTime: openTrade.entryTime,
    entryCandleIndex: openTrade.entryCandleIndex,
    exitTime: exitCandle.startTime,
    exitCandleIndex,
    underlying: openTrade.underlying,
    direction: openTrade.direction,
    optionSymbol: openTrade.optionSymbol,
    optionSide: openTrade.optionSide,
    strike: openTrade.strike,
    quantity: openTrade.quantity,
    lots: openTrade.lots,
    entryUnderlying: toFixed(openTrade.entryUnderlying),
    exitUnderlying: toFixed(exitDecision.underlyingPrice),
    entryPrice: toFixed(openTrade.entryPrice),
    exitPrice: toFixed(exitPrice),
    stopPrice: toFixed(openTrade.stopPrice),
    targetOne: openTrade.entryPlan.targetOne,
    targetTwo: openTrade.entryPlan.targetTwo,
    grossPnl: toFixed(grossPnl),
    costs: toFixed(costs),
    netPnl: toFixed(netPnl),
    returnOnRisk,
    outcome: tradeOutcome(netPnl),
    exitReason: exitDecision.reason,
    score: openTrade.score,
    quality: openTrade.quality,
    reasons: openTrade.reasons,
    risks: openTrade.risks,
  };
}

function createOpenTrade({
  tradeNumber,
  signalCandle,
  signalCandleIndex,
  entryCandle,
  entryCandleIndex,
  entryOptionContext,
  direction,
  optionSide,
  strike,
  optionSymbol,
  signalId,
  entryPlan,
  score,
  quality,
  reasons,
  risks,
  underlying,
  risk,
  lotSize,
  slippagePercent,
}: {
  tradeNumber: number;
  signalCandle: IndicatorCandle;
  signalCandleIndex: number;
  entryCandle: IndicatorCandle;
  entryCandleIndex: number;
  entryOptionContext: OptionChainContext;
  direction: Exclude<StrategyDirection, "NO TRADE">;
  optionSide: OptionSide;
  strike: number;
  optionSymbol: string;
  signalId: string;
  entryPlan: StrategyEntryPlan;
  score: number;
  quality: BacktestTrade["quality"];
  reasons: string[];
  risks: string[];
  underlying: UnderlyingSymbol;
  risk: RiskConfiguration;
  lotSize: number;
  slippagePercent: Decimal;
}): { trade: OpenBacktestTrade | null; skippedReason: string | null } {
  const entryQuote = findOptionQuote(entryOptionContext, strike, optionSide);

  if (!entryQuote) {
    return { trade: null, skippedReason: "Selected contract quote was unavailable on entry candle." };
  }

  if (entryQuote.status !== "TRADABLE") {
    return { trade: null, skippedReason: "Selected contract was not tradable on entry candle." };
  }

  const entryPrice = applyBuySlippage(toDecimal(entryQuote.ltp), slippagePercent);
  const stopPrice = optionStopFromEntry(entryPrice);
  const positionSize = calculatePositionSize({
    tradingCapital: risk.tradingCapital,
    riskPerTradePercent: risk.riskPerTradePercent,
    entryPrice,
    stopPrice,
    lotSize,
  });

  if (!positionSize.canTrade) {
    return {
      trade: null,
      skippedReason: positionSize.reason ?? "Position size was blocked by risk rules.",
    };
  }

  return {
    skippedReason: null,
    trade: {
      id: `BT-${String(tradeNumber).padStart(3, "0")}`,
      signalId,
      signalTime: signalCandle.startTime,
      signalCandleIndex,
      entryTime: entryCandle.startTime,
      entryCandleIndex,
      underlying,
      direction,
      optionSymbol,
      optionSide,
      strike,
      quantity: positionSize.quantity,
      lots: positionSize.lots,
      entryUnderlying: toDecimal(entryCandle.open),
      entryPrice,
      stopPrice,
      maximumRisk: toDecimal(positionSize.maximumRisk),
      entryPlan,
      score,
      quality,
      reasons,
      risks,
    },
  };
}

function buildEquityCurve(trades: BacktestTrade[]): BacktestEquityPoint[] {
  let equity = new Decimal(0);
  let peak = new Decimal(0);

  return trades.map((trade) => {
    equity = equity.plus(trade.netPnl);
    peak = Decimal.max(peak, equity);

    return {
      timestamp: trade.exitTime,
      tradeId: trade.id,
      equity: toFixed(equity),
      drawdown: toFixed(peak.minus(equity)),
    };
  });
}

function sum(values: BacktestTrade[], selector: (trade: BacktestTrade) => Decimal.Value) {
  return values.reduce((total, trade) => total.plus(selector(trade)), new Decimal(0));
}

function summarizeBacktest({
  trades,
  equityCurve,
  evaluatedSignals,
  confirmedSignals,
  skippedSignals,
}: {
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  evaluatedSignals: number;
  confirmedSignals: number;
  skippedSignals: number;
}) {
  const wins = trades.filter((trade) => toDecimal(trade.netPnl).gt(0));
  const losses = trades.filter((trade) => toDecimal(trade.netPnl).lt(0));
  const flats = trades.filter((trade) => toDecimal(trade.netPnl).eq(0));
  const grossPnl = sum(trades, (trade) => trade.grossPnl);
  const costs = sum(trades, (trade) => trade.costs);
  const netPnl = sum(trades, (trade) => trade.netPnl);
  const winTotal = sum(wins, (trade) => trade.netPnl);
  const lossTotal = sum(losses, (trade) => trade.netPnl);
  const largestWin = wins.length
    ? Decimal.max(...wins.map((trade) => toDecimal(trade.netPnl)))
    : new Decimal(0);
  const largestLoss = losses.length
    ? Decimal.min(...losses.map((trade) => toDecimal(trade.netPnl)))
    : new Decimal(0);
  const profitFactor = lossTotal.lt(0)
    ? winTotal.div(lossTotal.abs()).toFixed(2)
    : winTotal.gt(0)
      ? null
      : "0.00";
  const maxDrawdown = equityCurve.length
    ? Decimal.max(...equityCurve.map((point) => toDecimal(point.drawdown)))
    : new Decimal(0);

  return {
    evaluatedSignals,
    confirmedSignals,
    skippedSignals,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    flats: flats.length,
    winRate: trades.length ? new Decimal(wins.length).div(trades.length).mul(100).toFixed(2) : "0.00",
    grossPnl: toFixed(grossPnl),
    costs: toFixed(costs),
    netPnl: toFixed(netPnl),
    averageWin: wins.length ? winTotal.div(wins.length).toFixed(2) : "0.00",
    averageLoss: losses.length ? lossTotal.div(losses.length).toFixed(2) : "0.00",
    largestWin: toFixed(largestWin),
    largestLoss: toFixed(largestLoss),
    expectancy: trades.length ? netPnl.div(trades.length).toFixed(2) : "0.00",
    profitFactor,
    maxDrawdown: toFixed(maxDrawdown),
    liveOrdersEnabled: false as const,
  };
}

export function createSampleBacktestCandles(): IndicatorCandle[] {
  let previousClose = new Decimal("25090");

  return Array.from({ length: 96 }, (_, index) => {
    const open = previousClose;
    const change =
      index < 20
        ? new Decimal(index % 5 === 0 ? "-1.80" : "2.40")
        : index < 50
          ? new Decimal(index % 6 === 0 ? "-2.20" : "2.60")
          : index < 58
            ? new Decimal(index % 2 === 0 ? "1.20" : "-0.80")
            : index === 58
              ? new Decimal("16.00")
              : index === 59
                ? new Decimal("18.00")
                : index === 60
                  ? new Decimal("10.00")
                  : index < 72
                    ? new Decimal(index % 4 === 0 ? "-3.00" : "4.80")
                    : index < 82
                      ? new Decimal(index % 3 === 0 ? "-4.20" : "2.20")
                      : new Decimal(index % 2 === 0 ? "-2.10" : "1.20");
    const close = open.plus(change);
    const breakoutRange = index >= 58 && index <= 68;
    const setupVolatility = index >= 42 && index <= 60;
    const high = Decimal.max(open, close).plus(
      setupVolatility ? "13.50" : breakoutRange ? "7.50" : "4.25",
    );
    const low = Decimal.min(open, close).minus(
      setupVolatility ? "12.50" : index === 78 ? "12.50" : "4.00",
    );
    const volume =
      86_000 +
      index * 650 +
      (breakoutRange ? 78_000 : 0) +
      (index % 7 === 0 ? 9_000 : 0);

    previousClose = close;

    return {
      startTime: new Date(SAMPLE_START_TIME.getTime() + index * 60_000).toISOString(),
      open: toFixed(open),
      high: toFixed(high),
      low: toFixed(low),
      close: toFixed(close),
      volume,
      openInterest: 1_850_000 + index * 3_250,
    };
  });
}

export function runVwapBreakoutBacktest(input: BacktestRunInput): BacktestResult {
  const candles = sortCandles(input.candles);
  const underlying = input.underlying ?? "NIFTY";
  const expiry = input.expiry ?? SAMPLE_BACKTEST_EXPIRY;
  const risk = input.risk ?? DEFAULT_RISK_CONFIGURATION;
  const lotSize = input.lotSize ?? PAPER_TRADE_LOT_SIZE;
  const warmupCandles = input.warmupCandles ?? DEFAULT_BACKTEST_WARMUP_CANDLES;
  const maximumTrades = input.maximumTrades ?? risk.maximumTradesPerDay;
  const cooldownCandles = input.cooldownCandles ?? DEFAULT_BACKTEST_COOLDOWN_CANDLES;
  const slippagePercent = toDecimal(input.slippagePercent ?? DEFAULT_SLIPPAGE_PERCENT);
  const brokeragePerOrder = toDecimal(input.brokeragePerOrder ?? DEFAULT_BROKERAGE_PER_ORDER);
  const optionRowsForPrice = input.optionRowsForPrice ?? sampleBacktestOptionRowsForPrice;
  const marketRegimeForCandle = input.marketRegimeForCandle ?? marketRegimeForDefault;
  const dataQualityForCandle = input.dataQualityForCandle ?? dataQualityForDefault;
  const warnings: string[] = [];
  const trades: BacktestTrade[] = [];
  let openTrade: OpenBacktestTrade | null = null;
  let evaluatedSignals = 0;
  let confirmedSignals = 0;
  let skippedSignals = 0;
  let lastExitCandleIndex = -Infinity;
  let watchedSupport: PriceLevel | null = null;
  let watchedResistance: PriceLevel | null = null;

  if (candles.length < warmupCandles + 2) {
    warnings.push("Not enough candles for warmup and next-candle entry.");
  }

  for (let candleIndex = Math.max(0, warmupCandles - 1); candleIndex < candles.length; candleIndex += 1) {
    const candle = candles[candleIndex];
    const isFinalCandle = candleIndex === candles.length - 1;

    if (openTrade) {
      const exitDecision = resolveExit({
        openTrade,
        candle,
        isFinalCandle,
      });

      if (exitDecision) {
        const exitOptionContext = buildOptionContextAtPrice({
          underlying,
          underlyingLastPrice: exitDecision.underlyingPrice,
          expiry,
          candle,
          candleIndex,
          optionRowsForPrice,
        });
        const exitQuote = findOptionQuote(
          exitOptionContext,
          openTrade.strike,
          openTrade.optionSide,
        );

        if (exitQuote) {
          trades.push(
            closeTrade({
              openTrade,
              exitDecision,
              exitQuote,
              exitCandle: candle,
              exitCandleIndex: candleIndex,
              slippagePercent,
              brokeragePerOrder,
            }),
          );
          openTrade = null;
          lastExitCandleIndex = candleIndex;
        } else if (isFinalCandle) {
          warnings.push(`Missing exit quote for ${openTrade.optionSymbol}; trade left open.`);
        }
      }
    }

    if (openTrade || isFinalCandle || trades.length >= maximumTrades) {
      continue;
    }

    if (candleIndex - lastExitCandleIndex < cooldownCandles) {
      continue;
    }

    const candlesSoFar = candles.slice(0, candleIndex + 1);
    const rawIndicator = buildIndicatorContext({
      underlying,
      candles: candlesSoFar,
      previousDay: input.previousDay,
    });
    const indicator = indicatorWithReplayLevels({
      indicator: rawIndicator,
      watchedSupport,
      watchedResistance,
    });
    const optionContext = buildOptionContextAtPrice({
      underlying,
      underlyingLastPrice: candle.close,
      expiry,
      candle,
      candleIndex,
      optionRowsForPrice,
    });
    const evaluation = evaluateVwapBreakoutStrategy({
      indicator,
      optionContext,
      marketRegime: marketRegimeForCandle(candle, candleIndex),
      dataQuality: dataQualityForCandle(candle, candleIndex),
    });

    watchedSupport = rawIndicator.potentialSupport[0] ?? watchedSupport;
    watchedResistance = rawIndicator.potentialResistance[0] ?? watchedResistance;
    evaluatedSignals += 1;

    if (
      evaluation.direction === "NO TRADE" ||
      evaluation.state !== "CONFIRMED" ||
      !evaluation.selectedContract ||
      !evaluation.entryPlan
    ) {
      continue;
    }

    confirmedSignals += 1;

    const entryCandleIndex = candleIndex + 1;
    const entryCandle = candles[entryCandleIndex];

    if (!entryCandle) {
      skippedSignals += 1;
      continue;
    }

    const entryOptionContext = buildOptionContextAtPrice({
      underlying,
      underlyingLastPrice: entryCandle.open,
      expiry,
      candle: entryCandle,
      candleIndex: entryCandleIndex,
      optionRowsForPrice,
    });
    const created = createOpenTrade({
      tradeNumber: trades.length + 1,
      signalCandle: candle,
      signalCandleIndex: candleIndex,
      entryCandle,
      entryCandleIndex,
      entryOptionContext,
      direction: evaluation.direction,
      optionSide: evaluation.selectedContract.side,
      strike: evaluation.selectedContract.strike,
      optionSymbol: evaluation.selectedContract.label,
      signalId: evaluation.id,
      entryPlan: evaluation.entryPlan,
      score: evaluation.score,
      quality: evaluation.quality,
      reasons: evaluation.reasons,
      risks: evaluation.risks,
      underlying,
      risk,
      lotSize,
      slippagePercent,
    });

    if (!created.trade) {
      skippedSignals += 1;

      if (created.skippedReason) {
        warnings.push(created.skippedReason);
      }

      continue;
    }

    openTrade = created.trade;
  }

  const equityCurve = buildEquityCurve(trades);
  const startedAt = candles[0]?.startTime ?? "";
  const endedAt = candles.at(-1)?.startTime ?? "";

  return {
    metadata: {
      id: input.id ?? SAMPLE_BACKTEST_ID,
      name: input.name ?? DEFAULT_BACKTEST_NAME,
      strategyName: VWAP_BREAKOUT_STRATEGY_NAME,
      strategyVersion: VWAP_BREAKOUT_STRATEGY_VERSION,
      underlying,
      expiry,
      startedAt,
      endedAt,
      candleCount: candles.length,
      warmupCandles,
      lotSize,
      slippagePercent: slippagePercent.toFixed(2),
      brokeragePerOrder: brokeragePerOrder.toFixed(2),
      dataSource: input.dataSource ?? "USER_SUPPLIED",
      liveOrdersEnabled: false,
    },
    summary: summarizeBacktest({
      trades,
      equityCurve,
      evaluatedSignals,
      confirmedSignals,
      skippedSignals,
    }),
    trades,
    equityCurve,
    warnings,
  };
}

export function runSampleVwapBreakoutBacktest() {
  return runVwapBreakoutBacktest({
    id: SAMPLE_BACKTEST_ID,
    name: DEFAULT_BACKTEST_NAME,
    underlying: "NIFTY",
    expiry: SAMPLE_BACKTEST_EXPIRY,
    candles: createSampleBacktestCandles(),
    previousDay: SAMPLE_PREVIOUS_DAY,
    risk: {
      ...DEFAULT_RISK_CONFIGURATION,
      tradingCapital: "100000",
      riskPerTradePercent: "2",
    },
    dataSource: "SIMULATED_HISTORICAL_REPLAY",
  });
}
