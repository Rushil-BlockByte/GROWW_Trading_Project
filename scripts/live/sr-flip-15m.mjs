// 15-minute S/R flip — LIVE signal runner (the main strategy from 2026-11-09).
// Fetches today's NIFTY 5-min candles from Kite, aggregates to 15-min, builds 15-min
// levels from the 5yr cache, and sends ONLY HIGH-conviction confirmed retests to the
// Telegram group (bt: ~1.3-1.7/day, ~89% win, stable across 1yr and 5yr). Per-level
// dedup = one trade per level per day. Self-contained: needs only the Kite token in
// .env + the 5yr cache; does NOT need the app/stream running.
// Usage: node scripts/live/sr-flip-15m.mjs [YYYY-MM-DD]   (SEND_TELEGRAM=0 => dry-run, log only)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, "..", "..");
const env = Object.fromEntries(fs.readFileSync(path.join(PROJ, ".env"), "utf8").split(/\r?\n/).filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const AUTH = { "X-Kite-Version": "3", Authorization: `token ${env.KITE_API_KEY}:${env.KITE_ACCESS_TOKEN}` };
const NIFTY = 256265;
const DATE = process.argv[2] || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const RUNTIME = path.join(HERE, ".runtime"); fs.mkdirSync(RUNTIME, { recursive: true });
const LOG = path.join(RUNTIME, "paper15m_" + DATE + ".jsonl");
const FEED = path.join(RUNTIME, "feed_" + DATE + ".jsonl"); // the actual SENT alerts (gated) — the dashboard mirrors this exactly
const STATE = path.join(RUNTIME, "paper15m_state_" + DATE + ".json");
const POLL_MS = 60_000;
const COOLDOWN_MS = 30 * 60_000; // one NEW trade per 30 min: kills same-dir cascades + opposite-dir whipsaws; the confirm of an already-armed level still passes
const SEND_TELEGRAM = process.env.SEND_TELEGRAM !== "0"; // default ON; SEND_TELEGRAM=0 => journal/log only (dry-run)
const EXT_RAN_FAR = 34;
const FLIP = { breakBuffer: 15, retestBars: 9, touchBuffer: 12, target: 40, stop: 25, retestCloseMargin: 5 };

// ---- level building (same algo as the engine, pivot3/cluster20/minTouches6) ----
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

// aggregate an array of 5-min {t,high,low,close} into 15-min groups of 3
function to15(fiveMin, completeOnly) {
  const out = [];
  for (let i = 0; i < fiveMin.length; i += 3) { const g = fiveMin.slice(i, i + 3);
    if (completeOnly && g.length < 3) break;
    out.push({ t: g[0].t, high: Math.max(...g.map(x => x.high)), low: Math.min(...g.map(x => x.low)), close: g[g.length - 1].close }); }
  return out; }

// detect break->confirmed-retest events on today's 15-min bars for one level
function detectEvents(bars, level, P) {
  const { breakBuffer, retestBars, touchBuffer, target, stop, retestCloseMargin } = P;
  const open = bars[0]?.close ?? level; const ev = [];
  for (let k = 1; k < bars.length; k++) {
    const bu = bars[k - 1].close <= level && bars[k].close >= level + breakBuffer;
    const bd = bars[k - 1].close >= level && bars[k].close <= level - breakBuffer;
    if (!bu && !bd) continue; const dir = bu ? "LONG" : "SHORT";
    for (let j = k + 1; j <= Math.min(k + retestBars, bars.length - 1); j++) {
      const tag = dir === "LONG" ? (bars[j].low <= level + touchBuffer && bars[j].low >= level - breakBuffer) : (bars[j].high >= level - touchBuffer && bars[j].high <= level + breakBuffer);
      const cr = dir === "LONG" ? bars[j].close >= level + retestCloseMargin : bars[j].close <= level - retestCloseMargin;
      if (tag && cr) {
        const seg = bars.slice(k, j + 1);
        const ext = dir === "LONG" ? Math.max(...seg.map(b => b.high)) - level : level - Math.min(...seg.map(b => b.low));
        const aligned = dir === "LONG" ? bars[j].close > open : bars[j].close < open;
        const ranFar = ext > EXT_RAN_FAR; const score = (aligned ? 1 : 0) + (ranFar ? 1 : 0);
        const tier = score === 2 ? "HIGH" : score === 1 ? "MED" : "LOW";
        ev.push({ retestTime: bars[j].t, dir, level, entry: level, stop: dir === "LONG" ? level - stop : level + stop, target: dir === "LONG" ? level + target : level - target, tier, aligned, ranFar, ext: Math.round(ext) });
        break;
      }
      const ra = dir === "LONG" ? bars[j].high >= level + target + breakBuffer : bars[j].low <= level - target - breakBuffer;
      if (ra) break;
    }
  }
  return ev;
}
// Fresh break on the LATEST closed 15m bar -> ARM (place a limit at the level
// BEFORE the retest; the confirmed signal lags on 15-min). Trend-aligned only
// (the breaks that can become HIGH). Returns {dir,level,stop,breakTime} or null.
function detectBreak(bars15, level, open, P) {
  const n = bars15.length; if (n < 2) return null;
  const prev = bars15[n - 2], cur = bars15[n - 1];
  const bu = prev.close <= level && cur.close >= level + P.breakBuffer;
  const bd = prev.close >= level && cur.close <= level - P.breakBuffer;
  if (!bu && !bd) return null;
  const dir = bu ? "LONG" : "SHORT";
  const aligned = dir === "LONG" ? cur.close > open : cur.close < open;
  if (!aligned) return null;
  return { dir, level, stop: dir === "LONG" ? level - P.stop : level + P.stop, breakTime: cur.t };
}
function itmOption(dir, ref) { return dir === "LONG" ? `${Math.round((ref - 125) / 50) * 50} CE` : `${Math.round((ref + 125) / 50) * 50} PE`; }
async function sendTelegram(text) {
  if (!SEND_TELEGRAM) return "telegram OFF (dry-run)";
  try { const r = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }) }); return (await r.json()).ok ? "telegram sent" : "telegram FAILED"; } catch { return "telegram error"; }
}
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return { seen: {} }; } };
const saveState = s => fs.writeFileSync(STATE, JSON.stringify(s));
const appendFeed = r => { try { fs.appendFileSync(FEED, JSON.stringify(r) + "\n"); } catch {} }; // record a SENT alert for the site to read
// One-trade-per-direction gate (whipsaw + same-direction cascade). Returns true if
// this (dir,level) alert may be SENT. The arm->confirm of the SAME level always
// passes; any OTHER level/direction within COOLDOWN_MS of the active trade is held.
function gate(st, dir, level) {
  const now = Date.now();
  const a = st.activeTrade;
  if (a && now - a.ms < COOLDOWN_MS) {
    if (a.dir === dir && a.level === level) { a.ms = now; return true; }
    return false;
  }
  st.activeTrade = { dir, level, ms: now };
  return true;
}

async function fetch5min() {
  const r = await fetch(`https://api.kite.trade/instruments/historical/${NIFTY}/5minute?from=${DATE}+09:15:00&to=${DATE}+15:30:00`, { headers: AUTH }).then(x => x.json());
  if (r.status !== "success") throw new Error(JSON.stringify(r).slice(0, 160));
  const nowMs = Date.now();
  // CLOSED-CANDLE ONLY: drop any 5-min candle still forming (its close time is in
  // the future) so a 15-min bar is detected only after all three 5-min subs close.
  return r.data.candles.map(c => ({ t: c[0], high: c[2], low: c[3], close: c[4] }))
    .filter(c => new Date(c.t).getTime() + 5 * 60_000 <= nowMs); // [time,o,h,l,c,v]
}

// ---- build 15-min levels once from the cache, around today's open ----
const cache = JSON.parse(fs.readFileSync(path.join(PROJ, "data/sr-5min-cache.json"), "utf8"));
const histByDay = new Map();
for (const b of cache.barsByUnderlying.NIFTY) { const d = b.startTime.slice(0, 10); if (!histByDay.has(d)) histByDay.set(d, []); histByDay.get(d).push({ t: b.startTime, high: b.high, low: b.low, close: b.close }); }
const hist15 = [];
for (const [d, bars] of [...histByDay.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) { bars.sort((a, b) => a.t < b.t ? -1 : 1); for (const b of to15(bars, false)) hist15.push(b); }
const ALL_LEVELS = buildLevels(hist15);
let OPEN = null; try { OPEN = JSON.parse(fs.readFileSync(path.join(PROJ, "today_levels.json"), "utf8")).open; } catch {}

async function tick() {
  const five = await fetch5min();
  if (!five.length) return "no bars yet";
  if (OPEN == null) OPEN = five[0].close;
  const SPAN = 400;
  const levels = ALL_LEVELS.filter(L => Math.abs(L.price - OPEN) <= SPAN);
  const bars15 = to15(five, true); // completed 15-min bars only
  if (bars15.length < 2) return `warming up (${bars15.length} x 15m bars)`;
  const st = loadState();
  let found = 0, highs = 0;
  for (const L of levels) {
    for (const e of detectEvents(bars15, L.price, FLIP)) {
      found++;
      // per-level dedup: a HIGH level fires ONCE per day (take a level once — no
      // re-entries, which is the overtrading trap). non-HIGH keyed by retest time.
      const key = e.tier === "HIGH" ? `HIGH:${e.dir}:${e.level}` : `${e.dir}:${e.level}:${e.retestTime}`;
      if (st.seen[key]) continue;
      st.seen[key] = e.tier;
      const rec = { date: DATE, ...e, opt: itmOption(e.dir, e.level), loggedAt: new Date().toISOString() };
      fs.appendFileSync(LOG, JSON.stringify(rec) + "\n");
      if (e.tier === "HIGH") { highs++;
        const emoji = e.dir === "LONG" ? "🟢" : "🔴";
        const msg = `${emoji} 15-MIN FLIP — ${e.dir} @ ${e.level} (HIGH)\nBuy NIFTY ${rec.opt} (ITM)\nentry ${e.entry} · stop ${e.stop} · target ${e.target}\nRetest held ${e.retestTime.slice(11, 16)} IST. Take it AT the level — don't chase. One trade per level.`;
        const allowed = gate(st, e.dir, e.level);
        const tg = allowed ? await sendTelegram(msg) : "suppressed (cooldown — already in a trade this direction)";
        if (allowed) appendFeed({ time: e.retestTime, stage: "CONFIRM", dir: e.dir, level: e.level, entry: e.entry, stop: e.stop, target: e.target, opt: rec.opt });
        console.log(`[15m HIGH] ${e.dir} @ ${e.level} (retest ${e.retestTime}) entry ${e.entry} stop ${e.stop} tgt ${e.target} | ${rec.opt} | [${tg}]`);
      }
    }
  }
  // BREAK-STAGE ARM: the moment a level breaks on the latest closed 15m bar,
  // ping to place a limit AT the level before the retest (one per level/day).
  for (const L of levels) {
    const br = detectBreak(bars15, L.price, OPEN, FLIP);
    if (!br) continue;
    const akey = `ARM:${br.dir}:${br.level}`;
    if (st.seen[akey]) continue;
    st.seen[akey] = br.breakTime;
    const emoji = br.dir === "LONG" ? "🟢" : "🔴", side = br.dir === "LONG" ? "BUY" : "SELL", arrow = br.dir === "LONG" ? "UP" : "DOWN";
    const opt = itmOption(br.dir, br.level);
    const msg = `📍 ${emoji} 15-MIN ARM — ${br.level} BROKE ${arrow}
Place a ${side} limit at ${br.level} (stop ${br.stop}).
WAIT for the retest. Skip if price runs >15 past ${br.level} without coming back.
Likely: NIFTY ${opt} (ITM) · ${br.breakTime.slice(11, 16)} IST
(prep alert — the HIGH confirm follows if the retest holds)`;
    const allowed = gate(st, br.dir, br.level);
    const tg = allowed ? await sendTelegram(msg) : "suppressed (cooldown — already in a trade this direction)";
    if (allowed) appendFeed({ time: br.breakTime, stage: "ARM", dir: br.dir, level: br.level, entry: br.level, stop: br.stop, target: null, opt });
    fs.appendFileSync(LOG, JSON.stringify({ date: DATE, stage: "ARM", dir: br.dir, level: br.level, stop: br.stop, opt, breakTime: br.breakTime, loggedAt: new Date().toISOString() }) + "\n");
    console.log(`[15m ARM] ${br.dir} @ ${br.level} broke (${br.breakTime.slice(11, 16)}) -> arm ${side} limit | ${opt} | [${tg}]`);
  }
  saveState(st);
  const last = five[five.length - 1].t;
  return `15m bars ${bars15.length} | levels ${levels.length} | events ${found} | new HIGH ${highs} | last5m ${last}`;
}

console.log(`15m LIVE runner | ${DATE} | ${ALL_LEVELS.length} total 15m levels | open ${OPEN ?? "?"}`);
let stop = false;
for (let i = 0; i < 450 && !stop; i++) {
  try { const msg = await tick(); console.log(`[${new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" })} IST] ${msg}`); }
  catch (e) { console.log("tick error:", e.message); }
  const istHM = new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
  if (istHM >= "15:35") { console.log("past 15:35 IST — stopping paper runner"); stop = true; break; }
  await new Promise(r => setTimeout(r, POLL_MS));
}
