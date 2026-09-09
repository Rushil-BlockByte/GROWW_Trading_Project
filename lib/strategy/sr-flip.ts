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
  target: number; // continuation target in points
  stop: number; // stop distance beyond the level in points
  holdBars: number; // max bars to hold before a time exit
};

export const DEFAULT_SR_FLIP_PARAMS: SrFlipParams = {
  breakBuffer: 15,
  retestBars: 26,
  touchBuffer: 12,
  target: 50,
  stop: 30,
  holdBars: 26,
};

export function vixRegime(vix: number | null | undefined): string {
  if (vix == null) return "unknown";
  if (vix < 12) return "calm";
  if (vix < 15) return "normal";
  if (vix < 20) return "elevated";
  return "stressed";
}

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
  const { breakBuffer, retestBars, touchBuffer, target, stop, holdBars } = params;
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
        const retested =
          direction === "LONG"
            ? bars[j].low <= level.price + touchBuffer && bars[j].low >= level.price - breakBuffer
            : bars[j].high >= level.price - touchBuffer && bars[j].high <= level.price + breakBuffer;

        if (retested) {
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
      const stopPrice = direction === "LONG" ? level.price - stop : level.price + stop;
      const targetPrice = direction === "LONG" ? level.price + target : level.price - target;
      let outcome: FlipTrade["outcome"] = "TIME";
      let exit = bars[Math.min(retestIndex + holdBars, bars.length - 1)].close;

      for (let j = retestIndex; j <= Math.min(retestIndex + holdBars, bars.length - 1); j += 1) {
        const bar = bars[j];

        // Check the stop first within a bar (conservative).
        if (direction === "LONG") {
          if (bar.low <= stopPrice) {
            outcome = "STOP";
            exit = stopPrice;
            break;
          }
          if (bar.high >= targetPrice) {
            outcome = "TARGET";
            exit = targetPrice;
            break;
          }
        } else {
          if (bar.high >= stopPrice) {
            outcome = "STOP";
            exit = stopPrice;
            break;
          }
          if (bar.low <= targetPrice) {
            outcome = "TARGET";
            exit = targetPrice;
            break;
          }
        }
      }

      const pnl = Math.round(direction === "LONG" ? exit - entry : entry - exit);

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
  params = DEFAULT_SR_FLIP_PARAMS,
}: {
  underlying: UnderlyingSymbol;
  levels: SrLevel[];
  sessionBars: LevelCandle[];
  referencePrice: number;
  vix: number | null;
  params?: SrFlipParams;
}): SrFlipEvaluation {
  const window = vixWindow(vix);
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
    risks: ["Live orders disabled.", "Paper-only workflow."],
    liveOrdersEnabled: false,
  };

  if (sessionBars.length < 2 || levels.length === 0) {
    return base;
  }

  // Find the most recent break of a strong level within the session.
  const { breakBuffer, retestBars, touchBuffer } = params;
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

      // Is price currently retesting the flipped level?
      const current = sessionBars[lastIndex];
      const retesting =
        direction === "LONG"
          ? current.low <= level.price + touchBuffer
          : current.high >= level.price - touchBuffer;

      if (retesting) {
        return {
          ...base,
          direction,
          state: "CONFIRMED",
          quality: "READY",
          plan,
          reasons: [
            `${level.price} broke ${direction === "LONG" ? "up" : "down"} (${level.touches} touches) and price is retesting it as ${direction === "LONG" ? "support" : "resistance"}.`,
            `Plan: enter ${plan.entry}, stop ${plan.stop}, target ${plan.target} (R:R ${plan.riskReward}).`,
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
          `${level.price} broke ${direction === "LONG" ? "up" : "down"} (${level.touches} touches). Waiting for a pullback to retest it.`,
        ],
      };
    }
  }

  return base;
}
