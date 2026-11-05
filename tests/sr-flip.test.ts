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

  it("reports the volume confirmation as a soft cue", () => {
    const bars: LevelCandle[] = [candle(95, 90, 92, 0), candle(96, 91, 93, 1)];
    const noVol = evaluateSrFlipSignal({ underlying: "NIFTY", levels: supports, sessionBars: bars, referencePrice: 93, vix: 11 });
    expect(noVol.volumeConfirmation).toEqual({ ratio: null, surge: false });

    const surge = evaluateSrFlipSignal({ underlying: "NIFTY", levels: supports, sessionBars: bars, referencePrice: 93, vix: 11, volumeRatio: 1.5 });
    expect(surge.volumeConfirmation).toEqual({ ratio: 1.5, surge: true });

    const light = evaluateSrFlipSignal({ underlying: "NIFTY", levels: supports, sessionBars: bars, referencePrice: 93, vix: 11, volumeRatio: 1.0 });
    expect(light.volumeConfirmation.surge).toBe(false);
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

  // Regression (2026-11-04 10:30 SHORT @23835): the break candle must NOT count
  // as its own retest. A down-break candle comes from above, so its high still
  // tags the level while it closes below — which used to fire CONFIRMED on the
  // break bar itself, entering ~1 candle early before the real pullback.
  it("does NOT confirm on the break candle itself (retest must be a later bar)", () => {
    const bars: LevelCandle[] = [
      candle(112, 105, 110, 0), // above the level
      candle(108, 82, 84, 1),   // break DOWN and current bar: high 108 tags (>=88), close 84 (<=95)
    ];
    const result = evaluateSrFlipSignal({ underlying: "NIFTY", levels: supports, sessionBars: bars, referencePrice: 84, vix: 11 });

    expect(result.direction).toBe("SHORT");
    expect(result.state).toBe("AWAITING_RETEST"); // was wrongly CONFIRMED before the fix
    expect(result.quality).toBe("WATCH");
  });

  it("confirms a SHORT when a LATER candle genuinely retests the broken level", () => {
    const bars: LevelCandle[] = [
      candle(112, 105, 110, 0), // above the level
      candle(108, 82, 84, 1),   // break DOWN (not the current bar now)
      candle(98, 86, 88, 2),    // later bar retests: high 98 tags (>=88), closes 88 (<=95)
    ];
    const result = evaluateSrFlipSignal({ underlying: "NIFTY", levels: supports, sessionBars: bars, referencePrice: 88, vix: 11 });

    expect(result.direction).toBe("SHORT");
    expect(result.state).toBe("CONFIRMED");
    expect(result.plan).toMatchObject({ entry: 100, stop: 125, target: 60 });
  });
  // Regression (2026-11-05, the "no clean signals on a trend day" bug): a retest
  // that confirmed on an EARLIER candle must stay CONFIRMED while the trade is
  // still live, even though the latest candle no longer tags the level. The old
  // code only confirmed when the current candle was the retest, so a confirmed
  // setup evaporated after one bar and the watcher never caught it.
  it("keeps a confirmed retest live after the retest candle (persistence)", () => {
    const bars: LevelCandle[] = [
      candle(95, 88, 90, 0),
      candle(122, 100, 120, 1), // break up
      candle(115, 108, 110, 2), // retest confirms here (low 108 <= 112, closes 110)
      candle(120, 114, 118, 3), // latest bar no longer tags (low 114 > 112), trade still live
    ];
    const result = evaluateSrFlipSignal({ underlying: "NIFTY", levels: supports, sessionBars: bars, referencePrice: 118, vix: 11 });

    expect(result.direction).toBe("LONG");
    expect(result.state).toBe("CONFIRMED"); // was wrongly AWAITING_RETEST before the fix
    expect(result.plan).toMatchObject({ entry: 100, stop: 75, target: 140 });
  });

  // Regression: a brand-new break on a DIFFERENT level must not bury a still-live
  // confirmed retest. On a trending day a fresh level broke almost every candle,
  // and the old backward-scan returned that newest naked break instead of the
  // confirmed trade — which is why every signal decayed into "break-and-go".
  it("prioritises a live confirmed retest over a newer naked break", () => {
    const twoLevels: SrLevel[] = [level, { price: 120, touches: 6, firstIndex: 0, lastIndex: 0 }];
    const bars: LevelCandle[] = [
      candle(95, 88, 90, 0),
      candle(122, 100, 120, 1), // break up 100
      candle(118, 108, 110, 2), // retest 100 confirms (low 108 <= 112, closes 110)
      candle(119, 109, 117, 3), // below 120, sets up its break
      candle(139, 120, 137, 4), // 120 breaks on the LATEST candle (prev close 117 <= 120, close 137 >= 135)
    ];
    const result = evaluateSrFlipSignal({ underlying: "NIFTY", levels: twoLevels, sessionBars: bars, referencePrice: 137, vix: 11 });

    expect(result.state).toBe("CONFIRMED"); // the 100 flip, not AWAITING_RETEST on 120
    expect(result.plan).toMatchObject({ entry: 100, target: 140 });
  });

  // Regression: once price has reached the target (or stop), the setup has played
  // out and must not keep surfacing as a fresh CONFIRMED entry.
  it("stops surfacing a confirmed setup once it has hit its target", () => {
    const bars: LevelCandle[] = [
      candle(95, 88, 90, 0),
      candle(122, 100, 120, 1), // break up
      candle(118, 108, 110, 2), // retest confirms
      candle(145, 112, 142, 3), // target 140 hit -> setup played out
      candle(141, 135, 138, 4), // later bar: must NOT re-fire the same entry
    ];
    const result = evaluateSrFlipSignal({ underlying: "NIFTY", levels: supports, sessionBars: bars, referencePrice: 138, vix: 11 });

    expect(result.state).not.toBe("CONFIRMED");
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
