// 5-min LEVEL-BREAK monitor — LIVE (paper alerts to Telegram). Break rules in flip-logic.mjs.
// Levels: the day's LOCKED list (today_levels.json = 15-min levels, 6 R + 6 S within
// ±250 of the open, made by morning.mjs). Checks every closed 5-min candle; when a candle
// closes 15+ pts through one or more levels it sends ONE Telegram message:
// "RESISTANCE BROKEN" (up) / "SUPPORT BROKEN" (down), naming the farthest level broken,
// with that candle's volume from the current-month NIFTY futures contract (the index has
// no volume) and how it compares with the usual volume for that 5-min slot.
// Retest trade alerts are OFF (user, 2026-11-15); RETEST_ALERTS=1 turns them back on.
// Run INSTEAD of sr-flip-15m.mjs (running both = two different sets of alerts).
// Usage: node scripts/live/flip-5m.mjs [YYYY-MM-DD]     SEND_TELEGRAM=0 => dry-run
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readLock, lockLevels } from "./levels-lock.mjs";
import { scanFlips, closeHM } from "./flip-logic.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, "..", "..");
const env = Object.fromEntries(fs.readFileSync(path.join(PROJ, ".env"), "utf8").split(/\r?\n/).filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const AUTH = { "X-Kite-Version": "3", Authorization: `token ${env.KITE_API_KEY}:${env.KITE_ACCESS_TOKEN}` };
const DATE = process.argv[2] || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const RUNTIME = path.join(HERE, ".runtime"); fs.mkdirSync(RUNTIME, { recursive: true });
const STATE = path.join(RUNTIME, `flip5_state_${DATE}.json`);
const FEED = path.join(RUNTIME, `flip5_feed_${DATE}.jsonl`);
const POLL_MS = 20_000;                                // look for a newly closed candle every 20s
const SEND_TELEGRAM = process.env.SEND_TELEGRAM !== "0";
const RETEST_ALERTS = process.env.RETEST_ALERTS === "1"; // default OFF: break alerts only
const STALE_MIN = Number(process.env.STALE_MIN || 10); // an alert older than this (e.g. started late) is logged, not sent
const VOL_DAYS = 5;                                     // "usual" volume = average of this slot over the last 5 sessions

const itm = (dir, ref) => dir === "LONG" ? `${Math.round((ref - 125) / 50) * 50} CE` : `${Math.round((ref + 125) / 50) * 50} PE`;
const fmt = n => Math.round(n).toLocaleString("en-IN");
async function sendTelegram(text) {
  if (!SEND_TELEGRAM) return "telegram OFF (dry-run)";
  try { const r = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }) }); return (await r.json()).ok ? "telegram sent" : "telegram FAILED"; } catch { return "telegram error"; }
}
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return { done: {} }; } };
async function hist(token, from, to) {
  const r = await fetch(`https://api.kite.trade/instruments/historical/${token}/5minute?from=${from}+09:15:00&to=${to}+15:30:00`, { headers: AUTH }).then(x => x.json());
  if (r.status !== "success") throw new Error(JSON.stringify(r).slice(0, 160));
  return r.data.candles; // [t, o, h, l, c, v]
}
async function fetchClosed() {
  const now = Date.now();
  return (await hist(256265, DATE, DATE)).map(c => ({ t: c[0], open: c[1], high: c[2], low: c[3], close: c[4] }))
    .filter(c => new Date(c.t).getTime() + 5 * 60_000 <= now); // CLOSED candles only
}

// ---- volume: current-month NIFTY futures (nearest expiry on/after today) ----
let FUT = null, USUAL = new Map(), futToday = new Map();
async function setupVolume() {
  try {
    const csv = await fetch("https://api.kite.trade/instruments/NFO", { headers: AUTH }).then(r => r.text());
    const rows = csv.split("\n").slice(1).map(l => l.split(","))
      .filter(c => c[3] === '"NIFTY"' && c[9] === "FUT" && c[5] >= DATE).sort((a, b) => a[5] < b[5] ? -1 : 1);
    if (!rows.length) throw new Error("no NIFTY FUT found");
    FUT = { token: rows[0][0], symbol: rows[0][2], lot: Number(rows[0][8]) || 1, expiry: rows[0][5] };
    const from = new Date(new Date(DATE + "T00:00:00Z").getTime() - 12 * 864e5).toISOString().slice(0, 10);
    const prev = new Date(new Date(DATE + "T00:00:00Z").getTime() - 864e5).toISOString().slice(0, 10);
    const past = await hist(FUT.token, from, prev);
    const days = [...new Set(past.map(c => c[0].slice(0, 10)))].sort().slice(-VOL_DAYS);
    const slots = new Map();
    for (const c of past) { if (!days.includes(c[0].slice(0, 10))) continue; const hm = c[0].slice(11, 16); if (!slots.has(hm)) slots.set(hm, []); slots.get(hm).push(c[5]); }
    for (const [hm, v] of slots) USUAL.set(hm, v.reduce((s, x) => s + x, 0) / v.length);
    console.log(`volume from ${FUT.symbol} (lot ${FUT.lot}, expiry ${FUT.expiry}) | usual-by-slot from ${days.length} sessions`);
  } catch (e) { console.log("volume setup failed (alerts will say volume n/a):", e.message); }
}
async function refreshFutToday() {
  if (!FUT) return;
  try { futToday = new Map((await hist(FUT.token, DATE, DATE)).map(c => [c[0], c[5]])); } catch (e) { console.log("futures volume fetch failed:", e.message); }
}
function volumeLine(t) {
  if (!FUT) return "Volume: n/a";
  const v = futToday.get(t);
  if (v == null) return `Volume (${FUT.symbol}): n/a`;
  const usual = USUAL.get(t.slice(11, 16));
  const ratio = usual ? ` · ${(v / usual).toFixed(1)}× usual for the ${closeHM(t)} candle` : "";
  return `Volume (${FUT.symbol}): ${fmt(v / FUT.lot)} lots${ratio}`;
}

let LOCK = readLock(PROJ, DATE);
console.log(`5-min LEVEL-BREAK monitor | ${DATE} | ${LOCK ? `levels ${LOCK.levels.map(L => L.price).join(", ")} | open ${LOCK.open}` : "no locked list yet (will lock from the first candle's open)"} | telegram ${SEND_TELEGRAM ? "ON" : "OFF"} | retest alerts ${RETEST_ALERTS ? "ON" : "OFF"}`);
await setupVolume();

let lastSeen = null;
for (let stop = false; !stop;) {
  try {
    const candles = await fetchClosed();
    if (candles.length) {
      LOCK = readLock(PROJ, DATE) ?? LOCK;
      if (!LOCK) { LOCK = lockLevels(PROJ, DATE, candles[0].open, { source: "flip-5m (first-candle open)" }); console.log(`locked from first candle open ${candles[0].open}: ${LOCK.levels.map(L => L.price).join(", ")}`); }
      const last = candles[candles.length - 1];
      if (last.t !== lastSeen) {
        lastSeen = last.t;
        await refreshFutToday();
        const st = loadState();
        const breaks = [];
        const trades = scanFlips(candles, LOCK.levels, LOCK.open, undefined, breaks);
        const events = [...breaks.map(e => ({ ...e, kind: "BREAK" })), ...(RETEST_ALERTS ? trades.map(e => ({ ...e, kind: "TRADE" })) : [])]
          .sort((x, y) => x.i - y.i || (x.kind === "BREAK" ? -1 : 1));
        for (const e of events) {
          const ageMin = (Date.now() - (new Date(e.t).getTime() + 5 * 60_000)) / 60_000;
          let key, msg, line, rec;
          if (e.kind === "BREAK") {
            // one message per break candle: the farthest level broken on it, with volume
            key = `BRK:${e.dir}:${e.flip}:${e.t}`;
            if (st.done[key] || (RETEST_ALERTS && st.done[`${e.dir}:${e.flip}`])) continue;
            const up = e.dir === "LONG";
            const others = e.broken.filter(p => p !== e.flip);
            const vol = volumeLine(e.t);
            msg = `${up ? "🟢 RESISTANCE BROKEN" : "🔴 SUPPORT BROKEN"} — ${e.flip}
${closeHM(e.t)} 5-min candle closed ${e.close} (${Math.round(Math.abs(e.close - e.flip))} pts ${up ? "above" : "below"})${others.length ? `
Also broke: ${others.join(", ")} → farthest is ${e.flip}` : ""}
${vol}`;
            line = `[BREAK ${closeHM(e.t)}] ${up ? "UP" : "DOWN"} ${e.broken.join(",")} -> ${e.flip} | close ${e.close} | ${vol}`;
            rec = { kind: "BREAK", time: e.t, closeAt: closeHM(e.t), dir: e.dir, flip: e.flip, broken: e.broken, close: e.close, volume: futToday.get(e.t) ?? null, usual: USUAL.get(e.t.slice(11, 16)) ?? null };
          } else {
            key = `${e.dir}:${e.level}`;
            if (st.done[key]) continue;
            const opt = itm(e.dir, e.level);
            const touch = e.dir === "LONG" ? `low ${e.low}` : `high ${e.high}`;
            msg = `${e.dir === "LONG" ? "🟢" : "🔴"} RETEST WORKED at ${e.level} — take the ${e.dir} trade
${closeHM(e.t)} 5-min candle came back to ${e.level} (${touch}) and closed ${e.close}
Entry ${e.level} · stop ${e.stop} · target ${e.target}
Option: NIFTY ${opt} (ITM)`;
            line = `[TRADE ${closeHM(e.t)}] ${e.dir} ${e.level} | ${touch} close ${e.close} | stop ${e.stop} tgt ${e.target} | ${opt}`;
            rec = { kind: "TRADE", time: e.t, closeAt: closeHM(e.t), dir: e.dir, level: e.level, stop: e.stop, target: e.target, close: e.close, opt };
          }
          const tg = ageMin > STALE_MIN ? `NOT sent — candle closed ${Math.round(ageMin)} min ago` : await sendTelegram(msg);
          st.done[key] = { at: closeHM(e.t), tg };
          fs.writeFileSync(STATE, JSON.stringify(st));
          fs.appendFileSync(FEED, JSON.stringify({ ...rec, tg }) + "\n");
          console.log(`${line} | [${tg}]`);
        }
        console.log(`[${new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" })} IST] candles ${candles.length} | last closed ${closeHM(last.t)} @ ${last.close}`);
      }
    }
  } catch (e) { console.log("tick error:", e.message); }
  const hm = new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
  if (hm >= "15:35") { console.log("past 15:35 IST — stopping"); stop = true; break; }
  await new Promise(r => setTimeout(r, POLL_MS));
}
