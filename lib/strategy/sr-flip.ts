import { classifyLevels, DEFAULT_SR_LEVEL_PARAMS } from "@/lib/strategy/sr-levels";
import type {
  FlipPlan,
  FlipTrade,
  LevelCandle,
  SrFlipEvaluation,
  SrLevel,
} from "@/types/sr-flip";
import type { UnderlyingSymbol } from "@/types/market";

export const SR_FLIP_STRATEGY_NAME = "Support/Resistance Break-and-Retest Flip";
export const SR_FLIP_STRATEGY_VERSION = "1.0.0";

export type SrFlipParams = {
  breakBuffer: number; // close must clear the level by this to count as a break
  retestBars: number; // retest must occur within this many bars of the break
  touchBuffer: number; // price within this of the level counts as a retest touch
  target: number; // first target in points (bank a partial here)
  stop: number; // stop distance beyond the level in points
  trail: number; // after the first target, trail the runner by this many points
  partialFraction: number; // fraction of the position banked at the first target
  holdBars: number; // max bars to hold before a time exit
  retestCloseMargin: number; // retest candle must CLOSE this far on the correct side to confirm
};

export const DEFAULT_SR_FLIP_PARAMS: SrFlipParams = {
  breakBuffer: 15,
  retestBars: 26,
  touchBuffer: 12,
  // Target 40 / stop 25 tested best over 5 years: 76% win vs 67% at the same
  // expectancy (a closer target is hit more reliably before it stalls).
  target: 40,
  stop: 25,
  // Bank half at the target, then trail the runner by 25 pts. Over 5 years this
  // lifts avg from 24.2 to 26.2 pts/trade at the same 76% win rate by capturing
  // the big trending days a flat target would cap.
  trail: 25,
  partialFraction: 0.5,
  holdBars: 26,
  // The retest only confirms when the candle CLOSES on the correct side of the
  // level by this margin. Over 5 years this lifts the win rate 65%->71% (keeping
  // ~78% of trades): retests that close back on the WRONG side win only 40% —
  // those are the fakeouts this gate removes. Wait for the close, not a wick tag.
  retestCloseMargin: 5,
};

export function vixRegime(vix: number | null | undefined): string {
  if (vix == null) return "unknown";
  if (vix < 12) return "calm";
  if (vix < 15) return "normal";
  if (vix < 20) return "elevated";
  return "stressed";
}

/** A break/retest bar's volume at or above this multiple of the recent average is a "surge". */
export const VOLUME_SURGE_RATIO = 1.3;

/** VIX-scaled search window (points each side) for classifying nearby levels. */
export function vixWindow(vix: number | null | undefined): number {
  if (vix == null) return 180;
  if (vix < 12) return 150;
  if (vix < 15) return 180;
  if (vix < 20) return 240;
  return 340;
}

/**
 * Backtest core: scan a continuous candle series for break-and-retest flips
 * against the given levels. When a strong level's close breaks beyond it and
 * price returns to retest it, trade the continuation in the break direction.
 */
export function findFlipTrades(
  bars: LevelCandle[],
  levels: SrLevel[],
  params: SrFlipParams = DEFAULT_SR_FLIP_PARAMS,
  pivot = DEFAULT_SR_LEVEL_PARAMS.pivot,
): FlipTrade[] {
  const { breakBuffer, retestBars, touchBuffer, target, stop, trail, partialFraction, holdBars, retestCloseMargin } = params;
  const trades: FlipTrade[] = [];

  for (const level of levels) {
    const start = Math.max(level.firstIndex + pivot + 1, 1);

    for (let k = start; k < bars.length; k += 1) {
      const brokeUp = bars[k - 1].close <= level.price && bars[k].close >= level.price + breakBuffer;
      const brokeDown = bars[k - 1].close >= level.price && bars[k].close <= level.price - breakBuffer;

      if (!brokeUp && !brokeDown) continue;

      const direction = brokeUp ? "LONG" : "SHORT";
      let retestIndex = -1;

      for (let j = k + 1; j <= Math.min(k + retestBars, bars.length - 1); j += 1) {
        const tagged =
          direction === "LONG"
            ? bars[j].low <= level.price + touchBuffer && bars[j].low >= level.price - breakBuffer
            : bars[j].high >= level.price - touchBuffer && bars[j].high <= level.price + breakBuffer;
        // Quality gate: only a candle that CLOSES on the correct side of the
        // level confirms the retest (a wick tag that closes back through is a
        // fakeout — 40% win vs 71% for a confirming close).
        const closedRight =
          direction === "LONG"
            ? bars[j].close >= level.price + retestCloseMargin
            : bars[j].close <= level.price - retestCloseMargin;

        if (tagged && closedRight) {
          retestIndex = j;
          break;
        }

        // Price ran away past the target before retesting — no trade.
        const ranAway =
          direction === "LONG"
            ? bars[j].high >= level.price + target + breakBuffer
            : bars[j].low <= level.price - target - breakBuffer;

        if (ranAway) break;
      }

      if (retestIndex < 0) continue;

      const entry = level.price;
      const stopPrice = direction === "LONG" ? entry - stop : entry + stop;
      const targetPrice = direction === "LONG" ? entry + target : entry - target;
      const lastIdx = Math.min(retestIndex + holdBars, bars.length - 1);

      // Phase 1: run to the first target or the stop (stop checked first).
      let outcome: FlipTrade["outcome"] = "TIME";
      let exit = bars[lastIdx].close;
      let firstTargetIndex = -1;

      for (let j = retestIndex; j <= lastIdx; j += 1) {
        const bar = bars[j];

        if (direction === "LONG") {
          if (bar.low <= stopPrice) {
            outcome = "STOP";
            exit = stopPrice;
            break;
          }
          if (bar.high >= targetPrice) {
            firstTargetIndex = j;
            break;
          }
        } else {
          if (bar.high >= stopPrice) {
            outcome = "STOP";
            exit = stopPrice;
            break;
          }
          if (bar.low <= targetPrice) {
            firstTargetIndex = j;
            break;
          }
        }
      }

      let pnl: number;

      if (outcome === "STOP") {
        pnl = -stop;
      } else if (firstTargetIndex < 0) {
        pnl = Math.round(direction === "LONG" ? exit - entry : entry - exit);
      } else {
        // Phase 2: banked a partial at the target; trail the runner (floored at
        // breakeven) for the rest of the move.
        outcome = "TARGET";
        let best = targetPrice;
        let runnerExit = entry;

        for (let j = firstTargetIndex + 1; j <= lastIdx; j += 1) {
          const bar = bars[j];

          if (direction === "LONG") {
            best = Math.max(best, bar.high);
            const trailStop = Math.max(entry, best - trail);
            if (bar.low <= trailStop) {
              runnerExit = trailStop;
              break;
            }
            runnerExit = bar.close;
          } else {
            best = Math.min(best, bar.low);
            const trailStop = Math.min(entry, best + trail);
            if (bar.high >= trailStop) {
              runnerExit = trailStop;
              break;
            }
            runnerExit = bar.close;
          }
        }

        const runnerPts = direction === "LONG" ? runnerExit - entry : entry - runnerExit;
        exit = runnerExit;
        pnl = Math.round(partialFraction * target + (1 - partialFraction) * runnerPts);
      }

      trades.push({
        level: level.price,
        direction,
        breakIndex: k,
        retestIndex,
        entry,
        stop: stopPrice,
        target: targetPrice,
        outcome,
        exit,
        pnl,
      });

      k = retestIndex + 1; // move past this event
    }
  }

  return trades.sort((a, b) => a.retestIndex - b.retestIndex);
}

function buildPlan(level: number, direction: "LONG" | "SHORT", params: SrFlipParams): FlipPlan {
  const entry = level;
  const stop = direction === "LONG" ? level - params.stop : level + params.stop;
  const target = direction === "LONG" ? level + params.target : level - params.target;
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);

  return {
    level,
    entry,
    stop,
    target,
    trail: params.trail,
    riskReward: risk > 0 ? (reward / risk).toFixed(2) : "0.00",
  };
}

/**
 * Live evaluation: given the strong levels and the current session's candles,
 * report the nearest support/resistance and any active break-and-retest flip.
 */
export function evaluateSrFlipSignal({
  underlying,
  levels,
  sessionBars,
  referencePrice,
  vix,
  volumeRatio = null,
  params = DEFAULT_SR_FLIP_PARAMS,
}: {
  underlying: UnderlyingSymbol;
  levels: SrLevel[];
  sessionBars: LevelCandle[];
  referencePrice: number;
  vix: number | null;
  /** Latest 5-min futures volume / recent average, for the soft volume cue. */
  volumeRatio?: number | null;
  params?: SrFlipParams;
}): SrFlipEvaluation {
  // Gap/trend-day handling: once the session's realized range exceeds the VIX
  // expectation, this is a trend day (like 2026-09-15: 474 pt range vs a 180
  // window). Widen the level ladder to >=400 so a trending move never runs off
  // the map, and flag the trend risk (expect momentum over mean-reversion).
  const baseWindow = vixWindow(vix);
  const sessionHigh = sessionBars.length ? Math.max(...sessionBars.map((b) => b.high)) : referencePrice;
  const sessionLow = sessionBars.length ? Math.min(...sessionBars.map((b) => b.low)) : referencePrice;
  const trendRisk = sessionHigh - sessionLow > baseWindow;
  const window = trendRisk ? Math.max(baseWindow, 400) : baseWindow;
  const { supports, resistances, nearestSupport, nearestResistance } = classifyLevels(
    levels,
    referencePrice,
    window,
  );

  const base: SrFlipEvaluation = {
    name: SR_FLIP_STRATEGY_NAME,
    version: SR_FLIP_STRATEGY_VERSION,
    underlying,
    referencePrice: Math.round(referencePrice),
    vix: vix ?? null,
    vixRegime: vixRegime(vix),
    direction: "NO TRADE",
    state: "NONE",
    quality: "NO SETUP",
    nearestSupport,
    nearestResistance,
    supports,
    resistances,
    plan: null,
    reasons: ["No break-and-retest setup active."],
    risks: [
      "Live orders disabled.",
      "Paper-only workflow.",
      ...(trendRisk
        ? ["Trend day: the session range has exceeded the VIX expectation — levels widened, expect momentum over mean-reversion."]
        : []),
    ],
    trendRisk,
    volumeConfirmation: {
      ratio: volumeRatio,
      surge: volumeRatio != null && volumeRatio >= VOLUME_SURGE_RATIO,
    },
    liveOrdersEnabled: false,
  };

  if (sessionBars.length < 2 || levels.length === 0) {
    return base;
  }

  // Find the most recent break of a strong level within the session.
  const { breakBuffer, retestBars, touchBuffer, retestCloseMargin } = params;
  const lastIndex = sessionBars.length - 1;

  for (let k = lastIndex; k >= 1; k -= 1) {
    for (const level of levels) {
      const brokeUp = sessionBars[k - 1].close <= level.price && sessionBars[k].close >= level.price + breakBuffer;
      const brokeDown = sessionBars[k - 1].close >= level.price && sessionBars[k].close <= level.price - breakBuffer;

      if (!brokeUp && !brokeDown) continue;
      if (lastIndex - k > retestBars) continue; // break too old to still be live

      const direction: "LONG" | "SHORT" = brokeUp ? "LONG" : "SHORT";
      const plan = buildPlan(level.price, direction, params);

      // Has price broken back through since the break? -> invalidated
      const brokeBack = sessionBars
        .slice(k + 1)
        .some((bar) => (direction === "LONG" ? bar.close < level.price - breakBuffer : bar.close > level.price + breakBuffer));

      if (brokeBack) {
        return {
          ...base,
          state: "INVALIDATED",
          reasons: [`Broke ${direction === "LONG" ? "above" : "below"} ${level.price} but reversed back through it.`],
        };
      }

      // Is price currently retesting the flipped level? The retest confirms only
      // when the current (closed) candle both tags the level AND closes on the
      // correct side of it by the margin — a wick tag that closes back through is
      // a fakeout, so we keep waiting rather than fire a signal.
      const current = sessionBars[lastIndex];
      const tagged =
        direction === "LONG"
          ? current.low <= level.price + touchBuffer
          : current.high >= level.price - touchBuffer;
      const closedRight =
        direction === "LONG"
          ? current.close >= level.price + retestCloseMargin
          : current.close <= level.price - retestCloseMargin;

      if (tagged && closedRight) {
        return {
          ...base,
          direction,
          state: "CONFIRMED",
          quality: "READY",
          plan,
          reasons: [
            `${level.price} broke ${direction === "LONG" ? "up" : "down"} (${level.touches} touches) and price retested it as ${direction === "LONG" ? "support" : "resistance"} and closed ${direction === "LONG" ? "above" : "below"} it.`,
            `Plan: enter ${plan.entry}, stop ${plan.stop}, bank half at ${plan.target}, then trail the rest by ${plan.trail} (R:R ${plan.riskReward}).`,
            ...(base.volumeConfirmation.ratio != null
              ? [
                  base.volumeConfirmation.surge
                    ? `Volume confirms: this 5-min bar is ${base.volumeConfirmation.ratio.toFixed(1)}x the recent average.`
                    : `Volume is only ${base.volumeConfirmation.ratio.toFixed(1)}x average (light) — a surge would add conviction.`,
                ]
              : []),
          ],
        };
      }

      return {
        ...base,
        direction,
        state: "AWAITING_RETEST",
        quality: "WATCH",
        plan,
        reasons: [
          tagged
            ? `${level.price} broke ${direction === "LONG" ? "up" : "down"} and price tagged it, but the candle did not close ${direction === "LONG" ? "above" : "below"} it — waiting for a confirming close.`
            : `${level.price} broke ${direction === "LONG" ? "up" : "down"} (${level.touches} touches). Waiting for a pullback to retest it.`,
        ],
      };
    }
  }

  return base;
}
