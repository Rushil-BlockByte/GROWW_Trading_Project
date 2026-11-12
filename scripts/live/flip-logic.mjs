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
//  8. THE RETEST CANDLE MUST BE A REVERSAL PATTERN (see candlePattern below):
//     LONG  = bullish engulfing / bullish marubozu / hammer / bullish pin bar
//     SHORT = bearish engulfing / bearish marubozu / shooting star / bearish pin bar
//     A retest without one of these sends nothing (the level stays open for a later retest).
// Pure function: same input candles -> same signals. Used by the live monitor AND
// by the replay, so the replay shows exactly what the live monitor would have sent.

export const FLIP5 = {
  touch: 0,   // retest = candle low must actually REACH the flip (low <= flip for a LONG)...
  stop: 25,   // ...but not deeper than the stop (25 pts past the flip = it failed)
  target: 40,
  firstSignal: "09:30", // IMPORTANT RULE: no signal from a candle that closes before 9:30 IST
  marubozuBody: 0.65,   // marubozu: body is at least 65% of the candle's high-low range
  wickVsBody: 2,        // hammer / shooting star: rejection wick at least 2x the body
  pinTail: 2 / 3,       // pin bar: rejection wick at least 2/3 of the range
};

// Which reversal pattern (if any) candle c makes for direction dir. prev = the candle before.
//   ENGULFING  bullish: green candle whose body covers the previous RED candle's whole body
//   MARUBOZU   bullish: green candle, body >= 65% of the range
//   HAMMER     bullish: green candle, lower wick >= 2x body, upper wick <= body
//   PIN BAR    bullish: lower wick >= 2/3 of the range, open AND close in the top third (any colour)
// SHORT is the mirror image: red candles; bearish engulfing / bearish marubozu /
// shooting star (upper wick >= 2x body, lower wick <= body) / bearish pin bar (upper tail).
export function candlePattern(c, prev, dir, P = FLIP5) {
  const range = c.high - c.low;
  if (!(range > 0)) return null;
  const body = Math.abs(c.close - c.open);
  const up = c.high - Math.max(c.open, c.close);   // upper wick
  const dn = Math.min(c.open, c.close) - c.low;    // lower wick
  const green = c.close > c.open, red = c.close < c.open;
  if (dir === "LONG") {
    if (green && prev && prev.close < prev.open && c.open <= prev.close && c.close >= prev.open) return "Bullish Engulfing";
    if (green && body >= P.marubozuBody * range) return "Bullish Marubozu";
    if (green && dn >= P.wickVsBody * body && up <= body) return "Hammer";
    if (dn >= P.pinTail * range && Math.min(c.open, c.close) >= c.high - range / 3) return "Bullish Pin Bar";
  } else {
    if (red && prev && prev.close > prev.open && c.open >= prev.close && c.close <= prev.open) return "Bearish Engulfing";
    if (red && body >= P.marubozuBody * range) return "Bearish Marubozu";
    if (red && up >= P.wickVsBody * body && dn <= body) return "Shooting Star";
    if (up >= P.pinTail * range && Math.max(c.open, c.close) <= c.low + range / 3) return "Bearish Pin Bar";
  }
  return null;
}

// candles: [{t, open, high, low, close}] closed 5-min candles, in time order
// levels:  [{price}] fixed day list; dayOpen: the day's open price
// rejected (optional array): retests skipped because the candle was not a pattern
export function scanFlips(candles, levels, dayOpen, P = FLIP5, rejected = null) {
  const st = new Map(); // price -> { dir: "UP"|"DOWN", at: index of break candle }
  const signals = [];
  const fired = new Set();
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prevC = i === 0 ? null : candles[i - 1];
    const prev = i === 0 ? dayOpen : prevC.close;
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
    // (6) retest + bounce on THIS candle (not the break candle itself), (8) as a pattern
    if (longFlip && i > longFlip.at) {
      const F = longFlip.price;
      if (c.low <= F + P.touch && c.low >= F - P.stop && c.close > F && !fired.has("LONG:" + F)) {
        const pattern = candlePattern(c, prevC, "LONG", P);
        if (pattern) {
          fired.add("LONG:" + F);
          signals.push({ i, t: c.t, dir: "LONG", level: F, entry: F, stop: F - P.stop, target: F + P.target, low: c.low, close: c.close, pattern });
        } else if (rejected) rejected.push({ i, t: c.t, dir: "LONG", level: F, c });
      }
    }
    if (shortFlip && i > shortFlip.at) {
      const F = shortFlip.price;
      if (c.high >= F - P.touch && c.high <= F + P.stop && c.close < F && !fired.has("SHORT:" + F)) {
        const pattern = candlePattern(c, prevC, "SHORT", P);
        if (pattern) {
          fired.add("SHORT:" + F);
          signals.push({ i, t: c.t, dir: "SHORT", level: F, entry: F, stop: F + P.stop, target: F - P.target, high: c.high, close: c.close, pattern });
        } else if (rejected) rejected.push({ i, t: c.t, dir: "SHORT", level: F, c });
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
