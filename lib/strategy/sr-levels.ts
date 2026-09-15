import type { LevelCandle, SrLevel, SrLevelContext, SrSwing } from "@/types/sr-flip";

export type SrLevelParams = {
  pivot: number; // bars on each side that define a swing pivot
  clusterPoints: number; // swings within this price distance are the same level
  minTouches: number; // a level needs at least this many reversal touches
};

export const DEFAULT_SR_LEVEL_PARAMS: SrLevelParams = {
  pivot: 3,
  clusterPoints: 20,
  minTouches: 6,
};

/**
 * Detect swing highs and lows. A swing high is a candle whose high is the
 * maximum of the `pivot` candles on each side (and strictly greater than at
 * least one neighbour); a swing low mirrors it.
 */
export function detectSwings(candles: LevelCandle[], pivot = DEFAULT_SR_LEVEL_PARAMS.pivot): SrSwing[] {
  if (pivot <= 0) throw new Error("pivot must be positive.");

  const swings: SrSwing[] = [];

  for (let index = pivot; index < candles.length - pivot; index += 1) {
    const window = candles.slice(index - pivot, index + pivot + 1);
    const current = candles[index];
    const isHigh =
      window.every((c, k) => k === pivot || current.high >= c.high) &&
      window.some((c, k) => k !== pivot && current.high > c.high);
    const isLow =
      window.every((c, k) => k === pivot || current.low <= c.low) &&
      window.some((c, k) => k !== pivot && current.low < c.low);

    if (isHigh) swings.push({ price: current.high, index, type: "HIGH" });
    if (isLow) swings.push({ price: current.low, index, type: "LOW" });
  }

  return swings;
}

/**
 * Cluster swings into horizontal levels. Each candidate price counts the swings
 * within `clusterPoints` of it (its "touches"); the strongest, non-overlapping
 * clusters become the levels. More touches = stronger level.
 */
export function buildLevels(
  candles: LevelCandle[],
  params: SrLevelParams = DEFAULT_SR_LEVEL_PARAMS,
): SrLevel[] {
  const { pivot, clusterPoints, minTouches } = params;
  const swings = detectSwings(candles, pivot);
  const uniquePrices = [...new Set(swings.map((swing) => Math.round(swing.price)))];

  const clustered = uniquePrices
    .map((price) => {
      const touching = swings.filter((swing) => Math.abs(swing.price - price) <= clusterPoints);
      const prices = touching.map((swing) => swing.price).sort((a, b) => a - b);

      return {
        price: Math.round(prices[Math.floor(prices.length / 2)]),
        touches: touching.length,
        firstIndex: Math.min(...touching.map((swing) => swing.index)),
        lastIndex: Math.max(...touching.map((swing) => swing.index)),
      };
    })
    .sort((a, b) => b.touches - a.touches);

  // Greedily keep the strongest non-overlapping clusters.
  const levels: SrLevel[] = [];

  for (const candidate of clustered) {
    if (levels.some((level) => Math.abs(level.price - candidate.price) <= clusterPoints)) continue;

    levels.push(candidate);
  }

  return levels.filter((level) => level.touches >= minTouches);
}

/**
 * Classify levels relative to a reference price into supports (below) and
 * resistances (above), sorted from nearest to furthest, optionally within a
 * search window (points on each side). Returns the nearest of each too.
 */
export function classifyLevels(
  levels: SrLevel[],
  referencePrice: number,
  window?: number,
): {
  supports: SrLevelContext[];
  resistances: SrLevelContext[];
  nearestSupport: SrLevelContext | null;
  nearestResistance: SrLevelContext | null;
} {
  const withinWindow = (level: SrLevel) =>
    window === undefined || Math.abs(level.price - referencePrice) <= window;

  const supports = levels
    .filter((level) => level.price < referencePrice && withinWindow(level))
    .map((level) => ({ ...level, role: "SUPPORT" as const, distance: Math.round(level.price - referencePrice) }))
    .sort((a, b) => b.price - a.price);

  const resistances = levels
    .filter((level) => level.price > referencePrice && withinWindow(level))
    .map((level) => ({ ...level, role: "RESISTANCE" as const, distance: Math.round(level.price - referencePrice) }))
    .sort((a, b) => a.price - b.price);

  return {
    supports,
    resistances,
    nearestSupport: supports[0] ?? null,
    nearestResistance: resistances[0] ?? null,
  };
}
