import { describe, expect, it } from "vitest";
import { buildLevels, classifyLevels, detectSwings } from "../lib/strategy/sr-levels";
import type { LevelCandle, SrLevel } from "../types/sr-flip";

function candle(high: number, low: number, close = (high + low) / 2, i = 0): LevelCandle {
  return { startTime: new Date(2026, 0, 1, 9, 15 + i).toISOString(), high, low, close };
}

describe("sr-levels", () => {
  it("detects swing highs and lows", () => {
    const bars: LevelCandle[] = [
      candle(100, 90, 95, 0),
      candle(120, 95, 110, 1), // swing high
      candle(110, 80, 90, 2), // swing low
      candle(115, 85, 100, 3), // swing high
      candle(105, 95, 100, 4),
    ];
    const swings = detectSwings(bars, 1);

    expect(swings).toContainEqual({ price: 120, index: 1, type: "HIGH" });
    expect(swings).toContainEqual({ price: 80, index: 2, type: "LOW" });
  });

  it("clusters repeated swings into a level with a touch count", () => {
    const bars: LevelCandle[] = [
      candle(150, 100, 120, 0),
      candle(202, 150, 180, 1), // high
      candle(150, 100, 120, 2), // low
      candle(199, 150, 175, 3), // high
      candle(150, 100, 120, 4), // low
      candle(201, 150, 180, 5), // high
      candle(150, 100, 120, 6),
    ];
    const levels = buildLevels(bars, { pivot: 1, clusterPoints: 10, minTouches: 2 });
    const top = levels[0];

    expect(top.price).toBeGreaterThanOrEqual(199);
    expect(top.price).toBeLessThanOrEqual(202);
    expect(top.touches).toBe(3);
    // the 100 support cluster (2 touches) also survives minTouches: 2
    expect(levels.some((l) => Math.abs(l.price - 100) <= 10)).toBe(true);
  });

  it("filters out levels below the minimum touch count", () => {
    const bars: LevelCandle[] = [
      candle(150, 100, 120, 0),
      candle(202, 150, 180, 1),
      candle(150, 100, 120, 2),
      candle(199, 150, 175, 3),
      candle(150, 100, 120, 4),
    ];
    const levels = buildLevels(bars, { pivot: 1, clusterPoints: 10, minTouches: 5 });

    expect(levels).toHaveLength(0);
  });

  it("classifies levels into supports and resistances around a reference", () => {
    const levels: SrLevel[] = [
      { price: 80, touches: 6, firstIndex: 0, lastIndex: 0 },
      { price: 90, touches: 6, firstIndex: 0, lastIndex: 0 },
      { price: 110, touches: 6, firstIndex: 0, lastIndex: 0 },
      { price: 120, touches: 6, firstIndex: 0, lastIndex: 0 },
    ];
    const { supports, resistances, nearestSupport, nearestResistance } = classifyLevels(levels, 100);

    expect(supports.map((s) => s.price)).toEqual([90, 80]);
    expect(resistances.map((r) => r.price)).toEqual([110, 120]);
    expect(nearestSupport?.price).toBe(90);
    expect(nearestResistance?.price).toBe(110);
    expect(nearestSupport?.role).toBe("SUPPORT");
    expect(nearestResistance?.distance).toBe(10);
  });
});
