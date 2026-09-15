import { describe, expect, it } from "vitest";
import {
  DEFAULT_SR_FLIP_PARAMS,
  evaluateSrFlipSignal,
  findFlipTrades,
  vixRegime,
  vixWindow,
} from "../lib/strategy/sr-flip";
import type { LevelCandle, SrLevel } from "../types/sr-flip";

function candle(high: number, low: number, close: number, i = 0): LevelCandle {
  return { startTime: new Date(2026, 0, 1, 9, 15 + i).toISOString(), high, low, close };
}

const level: SrLevel = { price: 100, touches: 6, firstIndex: 0, lastIndex: 0 };

describe("sr-flip backtest core", () => {
  it("produces a winning long flip on break-up then retest then target", () => {
    const bars: LevelCandle[] = [
      candle(95, 88, 90, 0),
      candle(96, 89, 91, 1),
      candle(94, 88, 90, 2),
      candle(97, 90, 92, 3),
      candle(122, 100, 120, 4), // break up (prev close 92, close 120 >= 115)
      candle(121, 110, 116, 5),
      candle(115, 108, 110, 6), // retest (low 108 <= 112)
      candle(130, 112, 128, 7),
      candle(162, 130, 160, 8), // target 150 hit
    ];
    const trades = findFlipTrades(bars, [level]);

    expect(trades).toHaveLength(1);
    // First target (140) hit -> bank the half (+20); the runner has no further
    // bars, so it exits at breakeven -> total +20 on this trade.
    expect(trades[0]).toMatchObject({
      direction: "LONG",
      entry: 100,
      target: 140,
      stop: 75,
      outcome: "TARGET",
      pnl: 20,
    });
  });

  it("lets the runner trail for extra profit beyond the first target", () => {
    const bars: LevelCandle[] = [
      candle(95, 88, 90, 0),
      candle(96, 89, 91, 1),
      candle(94, 88, 90, 2),
      candle(97, 90, 92, 3),
      candle(122, 100, 120, 4), // break up
      candle(121, 110, 116, 5),
      candle(115, 108, 110, 6), // retest
      candle(142, 130, 141, 7), // first target 140 hit -> bank half
      candle(175, 150, 172, 8), // runner rides higher; trail exits this move
      candle(168, 145, 150, 9),
    ];
    const trades = findFlipTrades(bars, [level]);

    expect(trades[0].outcome).toBe("TARGET");
    expect(trades[0].pnl).toBeGreaterThan(20); // more than the banked half alone
  });

  it("does not trade when price never retests after the break", () => {
    const bars: LevelCandle[] = [
      candle(95, 88, 90, 0),
      candle(96, 89, 91, 1),
      candle(94, 88, 90, 2),
      candle(97, 90, 92, 3),
      candle(122, 118, 120, 4), // break up
      candle(140, 135, 138, 5), // runs away, never comes back
      candle(165, 155, 160, 6),
    ];
    expect(findFlipTrades(bars, [level])).toHaveLength(0);
  });
});

describe("sr-flip live signal", () => {
  const supports: SrLevel[] = [level];

  it("returns NO TRADE when no level has broken", () => {
    const bars: LevelCandle[] = [candle(95, 90, 92, 0), candle(96, 91, 93, 1), candle(97, 92, 94, 2)];
    const result = evaluateSrFlipSignal({ underlying: "NIFTY", levels: supports, sessionBars: bars, referencePrice: 94, vix: 11 });

    expect(result.direction).toBe("NO TRADE");
    expect(result.state).toBe("NONE");
    expect(result.liveOrdersEnabled).toBe(false);
    expect(result.trendRisk).toBe(false);
  });

  it("flags trendRisk when the session range exceeds the VIX window", () => {
    const bars: LevelCandle[] = [candle(95, 90, 92, 0), candle(300, 90, 295, 1), candle(305, 300, 302, 2)];
    const result = evaluateSrFlipSignal({ underlying: "NIFTY", levels: supports, sessionBars: bars, referencePrice: 302, vix: 11 });

    expect(result.trendRisk).toBe(true); // range 215 > calm window 150
  });

  it("flags CONFIRMED when a broken level is being retested now", () => {
    const bars: LevelCandle[] = [
      candle(95, 88, 90, 0),
      candle(122, 100, 120, 1), // break up
      candle(125, 118, 122, 2),
      candle(115, 108, 110, 3), // current bar retesting (low 108 <= 112)
    ];
    const result = evaluateSrFlipSignal({ underlying: "NIFTY", levels: supports, sessionBars: bars, referencePrice: 110, vix: 11 });

    expect(result.direction).toBe("LONG");
    expect(result.state).toBe("CONFIRMED");
    expect(result.quality).toBe("READY");
    expect(result.plan).toMatchObject({ entry: 100, stop: 75, target: 140 });
  });

  it("does NOT confirm when the retest tags the level but closes on the wrong side", () => {
    const bars: LevelCandle[] = [
      candle(95, 88, 90, 0),
      candle(122, 100, 120, 1), // break up
      candle(125, 118, 122, 2),
      candle(112, 104, 103, 3), // tags (low 104<=112) but closes 103 < 100+5 => fakeout
    ];
    const result = evaluateSrFlipSignal({ underlying: "NIFTY", levels: supports, sessionBars: bars, referencePrice: 103, vix: 11 });

    expect(result.direction).toBe("LONG");
    expect(result.state).toBe("AWAITING_RETEST");
    expect(result.quality).toBe("WATCH");
  });

  it("flags AWAITING_RETEST when broken but price is still away", () => {
    const bars: LevelCandle[] = [
      candle(95, 88, 90, 0),
      candle(122, 100, 120, 1), // break up
      candle(128, 122, 125, 2), // still elevated, no retest
    ];
    const result = evaluateSrFlipSignal({ underlying: "NIFTY", levels: supports, sessionBars: bars, referencePrice: 125, vix: 11 });

    expect(result.state).toBe("AWAITING_RETEST");
    expect(result.direction).toBe("LONG");
  });
});

describe("sr-flip helpers", () => {
  it("classifies VIX regimes and windows", () => {
    expect(vixRegime(11)).toBe("calm");
    expect(vixRegime(13)).toBe("normal");
    expect(vixRegime(18)).toBe("elevated");
    expect(vixRegime(25)).toBe("stressed");
    expect(vixWindow(11)).toBe(150);
    expect(vixWindow(25)).toBe(340);
  });

  it("exposes deterministic default parameters", () => {
    expect(DEFAULT_SR_FLIP_PARAMS.target).toBe(40);
    expect(DEFAULT_SR_FLIP_PARAMS.stop).toBe(25);
  });
});
