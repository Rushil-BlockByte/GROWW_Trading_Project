// ONE level list per day. Built once from the open (±250), written to
// today_levels.json with locked:true, and then read by everything:
// morning.mjs (what you're shown), sr-flip-15m.mjs (what fires Telegram) and
// /feed15 (the dashboard). Nothing rebuilds it during the day. A new list is
// only made when asked: `node scripts/morning.mjs - <open> --new`.
// Level algorithm = the morning one (5-min swings, pivot3 / cluster20 / minTouches6).
import fs from "node:fs";
import path from "node:path";

export const LOCK_SPAN = 250;
export const PER_SIDE = 5; // 5 resistances + 5 supports, nearest the open, within ±250

function detectSwings(bars, pivot) { const sw = [];
  for (let i = pivot; i < bars.length - pivot; i++) { const w = bars.slice(i - pivot, i + pivot + 1);
    if (w.every((c, k) => k === pivot || bars[i].high >= c.high) && w.some((c, k) => k !== pivot && bars[i].high > c.high)) sw.push(bars[i].high);
    if (w.every((c, k) => k === pivot || bars[i].low <= c.low) && w.some((c, k) => k !== pivot && bars[i].low < c.low)) sw.push(bars[i].low); }
  return sw; }
function buildLevels(bars, pivot = 3, cl = 20, mt = 6) {
  const sw = detectSwings(bars, pivot); const uniq = [...new Set(sw.map(s => Math.round(s)))];
  const clustered = uniq.map(p => { const t = sw.filter(s => Math.abs(s - p) <= cl); const pr = t.slice().sort((a, b) => a - b);
    return { price: Math.round(pr[Math.floor(pr.length / 2)]), touches: t.length }; }).sort((a, b) => b.touches - a.touches);
  const out = []; for (const c of clustered) { if (out.some(L => Math.abs(L.price - c.price) <= cl)) continue; out.push(c); }
  return out.filter(L => L.touches >= mt); }
function to15(fiveMin) { const out = [];
  for (let i = 0; i < fiveMin.length; i += 3) { const g = fiveMin.slice(i, i + 3);
    out.push({ t: g[0].t, high: Math.max(...g.map(x => x.high)), low: Math.min(...g.map(x => x.low)), close: g[g.length - 1].close }); }
  return out; }

// MORNING levels = the list you are given each morning: 5-min swings over the whole
// 5yr cache (pivot3 / cluster20 / minTouches6), same as morning.mjs always printed.
export function buildAllLevels(proj) {
  const cache = JSON.parse(fs.readFileSync(path.join(proj, "data/sr-5min-cache.json"), "utf8"));
  const bars = cache.barsByUnderlying.NIFTY.map(b => ({ high: b.high, low: b.low, close: b.close }));
  return buildLevels(bars);
}

export const lockPath = proj => path.join(proj, "today_levels.json");

// the locked list for `date`, or null if there isn't one for that day
export function readLock(proj, date) {
  try { const j = JSON.parse(fs.readFileSync(lockPath(proj), "utf8"));
    if (j.locked && j.date === date && Array.isArray(j.levels)) return j; } catch {}
  return null;
}

// build + write the day's list from the open. `extra` = prevClose/vix/etc for display.
export function lockLevels(proj, date, open, extra = {}) {
  const near = buildAllLevels(proj).filter(L => Math.abs(L.price - open) <= LOCK_SPAN);
  const up = near.filter(L => L.price > open).sort((a, b) => a.price - b.price).slice(0, PER_SIDE);   // 5 nearest above
  const dn = near.filter(L => L.price <= open).sort((a, b) => b.price - a.price).slice(0, PER_SIDE);  // 5 nearest below
  const levels = [...up, ...dn].sort((a, b) => b.price - a.price);
  const resistances = up.map(L => ({ level: L.price, touches: L.touches }));
  const supports = dn.map(L => ({ level: L.price, touches: L.touches }));
  const obj = { date, open, span: LOCK_SPAN, locked: true, lockedAt: new Date().toISOString(), ...extra, levels, resistances, supports };
  fs.writeFileSync(lockPath(proj), JSON.stringify(obj, null, 2));
  return obj;
}

export function printLock(L) {
  const sign = n => (n >= 0 ? "+" : "") + Math.round(n);
  console.log(`\n  LOCKED LEVELS ${L.date} | open ${L.open} | ±${L.span} | ${L.levels.length} levels (locked ${new Date(L.lockedAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" }).slice(0, 5)} IST)`);
  for (const x of L.levels) console.log(`     ${String(x.price).padEnd(6)} ${sign(x.price - L.open).padStart(5)}   ${x.price > L.open ? "R" : "S"}   ${x.touches}t`);
}
