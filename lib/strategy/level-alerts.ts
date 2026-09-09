import type { LevelCandle, SrLevel } from "@/types/sr-flip";

export type LevelAlertStage =
  | "NONE"
  | "NEAR"
  | "ABC_FORMING"
  | "BROKEN"
  | "RETEST_CONFIRMED";

export type LevelAlert = {
  level: number;
  role: "SUPPORT" | "RESISTANCE";
  stage: LevelAlertStage;
  direction: "LONG" | "SHORT" | null;
  distance: number; // signed pts from reference price to the level
  plan: { entry: number; stop: number; target: number } | null;
  message: string;
};

export type LevelAlertParams = {
  nearDistance: number; // within this of a level = NEAR
  touchBuffer: number; // within this = touched the level
  breakBuffer: number; // close beyond by this = broke the level
  stop: number; // stop distance beyond the level
};

export const DEFAULT_LEVEL_ALERT_PARAMS: LevelAlertParams = {
  nearDistance: 20,
  touchBuffer: 12,
  breakBuffer: 15,
  stop: 25, // matches the tested flip default (target ~40 / stop 25)
};

function nextLevelBeyond(levels: SrLevel[], from: number, direction: "up" | "down"): number | null {
  const candidates = levels
    .map((level) => level.price)
    .filter((price) => (direction === "up" ? price > from : price < from))
    .sort((a, b) => (direction === "up" ? a - b : b - a));

  return candidates[0] ?? null;
}

/**
 * Detect a confirmed ABC reversal against a held level.
 * Support (LONG): A = the low at the level, B = the bounce high, C = a HIGHER
 * low that holds above the level; confirmed when a later bar closes above B.
 * Resistance (SHORT) mirrors it (A high, B dip low, C lower high, confirmed on
 * a close below B).
 */
export function detectAbc(
  bars: LevelCandle[],
  touchIndex: number,
  role: "SUPPORT" | "RESISTANCE",
): { confirmed: boolean; a: number; b: number; c: number } | null {
  const after = bars.slice(touchIndex);

  if (after.length < 3) return null;

  if (role === "SUPPORT") {
    let aIdx = 0;
    for (let i = 1; i < after.length; i += 1) if (after[i].low < after[aIdx].low) aIdx = i;
    const a = after[aIdx].low;
    const afterA = after.slice(aIdx + 1);
    if (afterA.length < 2) return null;
    // B = bounce high, searched over all but the last bar (reserve it for C).
    const bSearch = afterA.slice(0, afterA.length - 1);
    let bIdx = 0;
    for (let i = 1; i < bSearch.length; i += 1) if (bSearch[i].high > bSearch[bIdx].high) bIdx = i;
    const b = bSearch[bIdx].high;
    const afterB = afterA.slice(bIdx + 1);
    if (afterB.length < 1) return null;
    let c = afterB[0].low;
    for (const bar of afterB) if (bar.low < c) c = bar.low;
    if (!(c > a)) return null;

    return { confirmed: afterB.some((bar) => bar.close > b), a, b, c };
  }

  let aIdx = 0;
  for (let i = 1; i < after.length; i += 1) if (after[i].high > after[aIdx].high) aIdx = i;
  const a = after[aIdx].high;
  const afterA = after.slice(aIdx + 1);
  if (afterA.length < 2) return null;
  // B = reaction dip, searched over all but the last bar (reserve it for C).
  const bSearch = afterA.slice(0, afterA.length - 1);
  let bIdx = 0;
  for (let i = 1; i < bSearch.length; i += 1) if (bSearch[i].low < bSearch[bIdx].low) bIdx = i;
  const b = bSearch[bIdx].low;
  const afterB = afterA.slice(bIdx + 1);
  if (afterB.length < 1) return null;
  let c = afterB[0].high;
  for (const bar of afterB) if (bar.high > c) c = bar.high;
  if (!(c < a)) return null;

  return { confirmed: afterB.some((bar) => bar.close < b), a, b, c };
}

/**
 * Per-level alert state machine, run against the session's CLOSED candles and
 * the current price. Returns the alert for the single most relevant level.
 * Feed it only completed candles (e.g. closed 5-min bars).
 */
export function detectLevelAlert({
  levels,
  sessionBars,
  referencePrice,
  params = DEFAULT_LEVEL_ALERT_PARAMS,
}: {
  levels: SrLevel[];
  sessionBars: LevelCandle[];
  referencePrice: number;
  params?: LevelAlertParams;
}): LevelAlert {
  if (levels.length === 0 || sessionBars.length === 0) {
    return { level: 0, role: "SUPPORT", stage: "NONE", direction: null, distance: 0, plan: null, message: "No level interaction." };
  }

  const active = [...levels].sort(
    (a, b) => Math.abs(a.price - referencePrice) - Math.abs(b.price - referencePrice),
  )[0];
  const L = active.price;
  const above = referencePrice >= L;
  const role: "SUPPORT" | "RESISTANCE" = above ? "SUPPORT" : "RESISTANCE";
  const distance = Math.round(referencePrice - L);
  const { nearDistance, touchBuffer, breakBuffer, stop } = params;
  const last = sessionBars[sessionBars.length - 1];

  const make = (
    stage: LevelAlertStage,
    direction: LevelAlert["direction"],
    message: string,
    plan: LevelAlert["plan"],
  ): LevelAlert => ({ level: L, role, stage, direction, distance, plan, message });

  // A break is a genuine cross of the level, not merely being beyond it.
  const brokeUp = sessionBars.some(
    (bar, i) => i > 0 && sessionBars[i - 1].close <= L && bar.close >= L + breakBuffer,
  );
  const brokeDown = sessionBars.some(
    (bar, i) => i > 0 && sessionBars[i - 1].close >= L && bar.close <= L - breakBuffer,
  );

  // Breakout (flip) — resistance broke up, price now above it.
  if (above && brokeUp) {
    const target = nextLevelBeyond(levels, L, "up");
    const plan = { entry: L, stop: L - stop, target: target ?? L + 60 };

    return last.low <= L + touchBuffer
      ? make("RETEST_CONFIRMED", "LONG", `Breakout retest confirmed at ${L} — paper LONG: entry ${plan.entry}, stop ${plan.stop}, target ${plan.target}.`, plan)
      : make("BROKEN", "LONG", `${L} broke up — it now flips to support. Watching for a retest.`, plan);
  }

  // Breakout (flip) — support broke down, price now below it.
  if (!above && brokeDown) {
    const target = nextLevelBeyond(levels, L, "down");
    const plan = { entry: L, stop: L + stop, target: target ?? L - 60 };

    return last.high >= L - touchBuffer
      ? make("RETEST_CONFIRMED", "SHORT", `Breakout retest confirmed at ${L} — paper SHORT: entry ${plan.entry}, stop ${plan.stop}, target ${plan.target}.`, plan)
      : make("BROKEN", "SHORT", `${L} broke down — it now flips to resistance. Watching for a retest.`, plan);
  }

  // Held → ABC bounce.
  const touchIndex = sessionBars.findIndex((bar) =>
    above ? bar.low <= L + touchBuffer : bar.high >= L - touchBuffer,
  );

  if (touchIndex >= 0) {
    const abc = detectAbc(sessionBars, touchIndex, role);

    if (abc?.confirmed) {
      const direction = above ? "LONG" : "SHORT";
      const target = nextLevelBeyond(levels, L, above ? "up" : "down");
      const entry = Math.round(abc.b);
      const plan = {
        entry,
        stop: above ? L - stop : L + stop,
        target: target ?? (above ? entry + 60 : entry - 60),
      };

      return make(
        "ABC_FORMING",
        direction,
        `ABC bounce confirmed at ${L} ${role.toLowerCase()} — paper ${direction}: entry ${plan.entry} (break of B), stop ${plan.stop}, target ${plan.target}.`,
        plan,
      );
    }

    return make("NEAR", null, `Price is at ${L} ${role.toLowerCase()} (${active.touches} touches) — watching for an ABC bounce or a break.`, null);
  }

  // Approaching but not yet touched.
  if (Math.abs(distance) <= nearDistance) {
    return make("NEAR", null, `Approaching ${L} ${role.toLowerCase()} (${active.touches} touches), ${Math.abs(distance)} pts away — watch the reaction.`, null);
  }

  return make("NONE", null, "No level interaction.", null);
}
