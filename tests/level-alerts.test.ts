import { describe, expect, it } from "vitest";
import { detectLevelAlert } from "../lib/strategy/level-alerts";
import type { LevelCandle, SrLevel } from "../types/sr-flip";

function candle(high: number, low: number, close: number): LevelCandle {
  return { startTime: new Date().toISOString(), high, low, close };
}

const support: SrLevel = { price: 100, touches: 12, firstIndex: 0, lastIndex: 0 };
const resistance: SrLevel = { price: 100, touches: 12, firstIndex: 0, lastIndex: 0 };

describe("level alerts", () => {
  it("fires NEAR when price approaches a level but has not touched it", () => {
    const alert = detectLevelAlert({
      levels: [support],
      sessionBars: [candle(118, 114, 116), candle(117, 113, 115)],
      referencePrice: 115, // 15 pts above the 100 support... use a closer level
    });
    // 100 support is 15 pts below 115 -> within nearDistance(20), not touched (low 113 > 112)
    expect(alert.stage).toBe("NEAR");
    expect(alert.role).toBe("SUPPORT");
    expect(alert.direction).toBeNull();
  });

  it("fires ABC_FORMING LONG when a held support prints an A-B-C bounce", () => {
    const bars: LevelCandle[] = [
      candle(120, 98, 106), // A: touches 100 support (low 98)
      candle(130, 104, 128), // B: bounce high 130
      candle(126, 110, 112), // C: higher low 110 (> A low 98)
      candle(135, 120, 132), // confirm: close 132 > B 130
    ];
    const alert = detectLevelAlert({ levels: [support], sessionBars: bars, referencePrice: 132 });

    expect(alert.stage).toBe("ABC_FORMING");
    expect(alert.direction).toBe("LONG");
    expect(alert.plan).toMatchObject({ entry: 130, stop: 70 });
  });

  it("fires ABC_FORMING SHORT when a held resistance prints a lower-high", () => {
    const bars: LevelCandle[] = [
      candle(102, 80, 94), // A: pokes 100 resistance (high 102)
      candle(96, 70, 72), // B: dip low 70
      candle(90, 74, 88), // C: lower high 90 (< A high 102)
      candle(85, 65, 68), // confirm: close 68 < B 70
    ];
    const alert = detectLevelAlert({ levels: [resistance], sessionBars: bars, referencePrice: 68 });

    expect(alert.stage).toBe("ABC_FORMING");
    expect(alert.direction).toBe("SHORT");
    expect(alert.plan).toMatchObject({ entry: 70, stop: 130 });
  });

  it("fires BROKEN then RETEST_CONFIRMED on a resistance breakout", () => {
    // resistance at 100, price crosses up and runs away
    const broken = detectLevelAlert({
      levels: [support],
      sessionBars: [candle(99, 90, 96), candle(130, 116, 128)], // prev close 96<=100, close 128>=115 cross up
      referencePrice: 128,
    });
    expect(broken.stage).toBe("BROKEN");
    expect(broken.direction).toBe("LONG");

    // then price dips back to retest the flipped level (now support)
    const retest = detectLevelAlert({
      levels: [support],
      sessionBars: [candle(99, 90, 96), candle(130, 116, 128), candle(126, 108, 118)], // last low 108 <= 112
      referencePrice: 118,
    });
    expect(retest.stage).toBe("RETEST_CONFIRMED");
    expect(retest.direction).toBe("LONG");
    expect(retest.plan).toMatchObject({ entry: 100, stop: 70 });
  });
});
