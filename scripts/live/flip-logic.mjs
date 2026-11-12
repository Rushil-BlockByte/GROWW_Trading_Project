// 5-min FLIP monitor logic (the user's rules, 2026-11-12):
//  1. levels are fixed for the day (today_levels.json)
//  2. every 5-min candle CLOSE is checked for a broken level. BROKEN = the close is at least
//     15 pts past the level (breakBuffer). It stays broken until a close 15+ pts back the
//     other way (that is a break in the other direction).
//  3. a broken level becomes the FLIP level; wait for a retest + bounce from it
//  4. if price breaks several levels, the furthest one it is still beyond is the flip
//     (R1,R2,R3 broken -> flip R3; then R4 broken -> flip R4)
//  5. if a newer break fails (a candle closes back through it), that level drops out
//     and the flip falls back to the next level price is still beyond
//     (R5 broken then a close back below R5 -> flip is R4 again)
//  6. RETEST + BOUNCE = a later candle whose low reaches the flip (low <= flip, for a LONG) and
//     which closes back above it -> signal LONG at the flip. Mirror image for SHORT.
//  8. BREAK EVENTS: when a candle closes through one or more levels, a break event names the
//     FARTHEST level broken on that candle as the flip to watch (sent as a "level broken" alert).
//  7. NO SIGNAL BEFORE 9:30 IST. Candles are still tracked from 9:15 (breaks and flips
//     count from the first candle), but a retest on a candle closing before 9:30 sends nothing.
// Pure function: same input candles -> same signals. Used by the live monitor AND
// by the replay, so the replay shows exactly what the live monitor would have sent.

export const FLIP5 = {
  breakBuffer: 15, // a level is broken only when a 5-min close is 15+ pts past it
  touch: 0,   // retest = candle low must actually REACH the flip (low <= flip for a LONG)...
  stop: 25,   // ...but not deeper than the stop (25 pts past the flip = it failed)
  target: 40,
  firstSignal: "09:30", // IMPORTANT RULE: no signal from a candle that closes before 9:30 IST
};

// candles: [{t, open, high, low, close}] closed 5-min candles, in time order
// levels:  [{price}] fixed day list; dayOpen: the day's open price
// breaks (optional array): filled with { i, t, dir, flip, broken: [...], close } per break candle
export function scanFlips(candles, levels, dayOpen, P = FLIP5, breaks = null) {
  const st = new Map(); // price -> { dir: "UP"|"DOWN", at: index of break candle, real: broken today? }
  const signals = [];
  const fired = new Set();
  // every level starts on its side of the OPEN; that is not a break (real: false)
  for (const L of levels) st.set(L.price, { dir: dayOpen >= L.price ? "UP" : "DOWN", at: -1, real: false });
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    // (2) breaks on this candle's close
    const brokeUp = [], brokeDown = [];
    for (const L of levels) {
      const p = L.price;
      const was = st.get(p)?.dir;
      if (c.close >= p + P.breakBuffer && was !== "UP") { st.set(p, { dir: "UP", at: i, real: true }); brokeUp.push(p); }
      else if (c.close <= p - P.breakBuffer && was !== "DOWN") { st.set(p, { dir: "DOWN", at: i, real: true }); brokeDown.push(p); }
    }
    // (4)(5) current flips: furthest broken level price is STILL beyond
    let longFlip = null, shortFlip = null;
    for (const [p, s] of st) {
      if (!s.real) continue; // only levels actually broken today can be a flip
      if (s.dir === "UP" && c.close > p && (longFlip == null || p > longFlip.price)) longFlip = { price: p, at: s.at };
      if (s.dir === "DOWN" && c.close < p && (shortFlip == null || p < shortFlip.price)) shortFlip = { price: p, at: s.at };
    }
    // (8) break events: the farthest level broken on this candle is the flip to watch
    if (breaks && brokeUp.length && longFlip) breaks.push({ i, t: c.t, dir: "LONG", flip: longFlip.price, broken: brokeUp.sort((a, b) => a - b), close: c.close });
    if (breaks && brokeDown.length && shortFlip) breaks.push({ i, t: c.t, dir: "SHORT", flip: shortFlip.price, broken: brokeDown.sort((a, b) => b - a), close: c.close });
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
