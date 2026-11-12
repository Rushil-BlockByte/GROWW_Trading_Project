// 5-min FLIP monitor logic (the user's rules, 2026-11-12):
//  1. levels are fixed for the day (today_levels.json)
//  2. every 5-min candle CLOSE is checked for a broken level
//  3. a broken level becomes the FLIP level; wait for a retest + bounce from it
//  4. if price breaks several levels, the furthest one it is still beyond is the flip
//     (R1,R2,R3 broken -> flip R3; then R4 broken -> flip R4)
//  5. if a newer break fails (a candle closes back through it), that level drops out
//     and the flip falls back to the next level price is still beyond
//     (R5 broken then a close back below R5 -> flip is R4 again)
//  6. RETEST + BOUNCE = a later candle whose low reaches the flip (low <= flip, for a LONG) and
//     which closes back above it -> signal LONG at the flip. Mirror image for SHORT.
//  7. NO SIGNAL BEFORE 9:30 IST. Candles are still tracked from 9:15 (breaks and flips
//     count from the first candle), but a retest on a candle closing before 9:30 sends nothing.
// Pure function: same input candles -> same signals. Used by the live monitor AND
// by the replay, so the replay shows exactly what the live monitor would have sent.

export const FLIP5 = {
  touch: 0,   // retest = candle low must actually REACH the flip (low <= flip for a LONG)...
  stop: 25,   // ...but not deeper than the stop (25 pts past the flip = it failed)
  target: 40,
  firstSignal: "09:30", // IMPORTANT RULE: no signal from a candle that closes before 9:30 IST
};

// candles: [{t, open, high, low, close}] closed 5-min candles, in time order
// levels:  [{price}] fixed day list; dayOpen: the day's open price
export function scanFlips(candles, levels, dayOpen, P = FLIP5) {
  const st = new Map(); // price -> { dir: "UP"|"DOWN", at: index of break candle }
  const signals = [];
  const fired = new Set();
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prev = i === 0 ? dayOpen : candles[i - 1].close;
    // (2) breaks on this candle's close
    for (const L of levels) {
      const p = L.price;
      if (prev <= p && c.close > p) st.set(p, { dir: "UP", at: i });
      else if (prev >= p && c.close < p) st.set(p, { dir: "DOWN", at: i });
    }
    // (4)(5) current flips: furthest broken level price is STILL beyond
    let longFlip = null, shortFlip = null;
    for (const [p, s] of st) {
      if (s.dir === "UP" && c.close > p && (longFlip == null || p > longFlip.price)) longFlip = { price: p, at: s.at };
      if (s.dir === "DOWN" && c.close < p && (shortFlip == null || p < shortFlip.price)) shortFlip = { price: p, at: s.at };
    }
    // (7) before 9:30: keep tracking breaks/flips, but never signal
    if (closeHM(c.t) < P.firstSignal) continue;
    // (6) retest + bounce on THIS candle (not the break candle itself)
    if (longFlip && i > longFlip.at) {
      const F = longFlip.price;
      if (c.low <= F + P.touch && c.low >= F - P.stop && c.close > F && !fired.has("LONG:" + F)) {
        fired.add("LONG:" + F);
        signals.push({ i, t: c.t, dir: "LONG", level: F, entry: F, stop: F - P.stop, target: F + P.target, low: c.low, close: c.close });
      }
    }
    if (shortFlip && i > shortFlip.at) {
      const F = shortFlip.price;
      if (c.high >= F - P.touch && c.high <= F + P.stop && c.close < F && !fired.has("SHORT:" + F)) {
        fired.add("SHORT:" + F);
        signals.push({ i, t: c.t, dir: "SHORT", level: F, entry: F, stop: F + P.stop, target: F - P.target, high: c.high, close: c.close });
      }
    }
  }
  return signals;
}

// time the candle CLOSES (signal goes out then): candle start + 5 min, as HH:MM
export function closeHM(t) {
  const d = new Date(new Date(t).getTime() + 5 * 60_000);
  return d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}
