// 5-min FLIP monitor — LIVE (paper signals to Telegram). Rules in flip-logic.mjs.
// Levels: the day's LOCKED list (today_levels.json = 15-min levels, 5 R + 5 S within
// ±250 of the open, made by morning.mjs). Checks every closed 5-min candle; when a
// broken level is retested and bounces, sends ONE signal for that level+direction.
// Also sends a "LEVEL BROKEN" alert when a candle closes through levels (naming the
// farthest one as the flip to watch) — that one says WAIT, not trade.
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
const STALE_MIN = Number(process.env.STALE_MIN || 10); // a signal older than this (e.g. started late) is logged, not sent

const itm = (dir, ref) => dir === "LONG" ? `${Math.round((ref - 125) / 50) * 50} CE` : `${Math.round((ref + 125) / 50) * 50} PE`;
async function sendTelegram(text) {
  if (!SEND_TELEGRAM) return "telegram OFF (dry-run)";
  try { const r = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }) }); return (await r.json()).ok ? "telegram sent" : "telegram FAILED"; } catch { return "telegram error"; }
}
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return { done: {} }; } };
async function fetchClosed() {
  const r = await fetch(`https://api.kite.trade/instruments/historical/256265/5minute?from=${DATE}+09:15:00&to=${DATE}+15:30:00`, { headers: AUTH }).then(x => x.json());
  if (r.status !== "success") throw new Error(JSON.stringify(r).slice(0, 160));
  const now = Date.now();
  return r.data.candles.map(c => ({ t: c[0], open: c[1], high: c[2], low: c[3], close: c[4] }))
    .filter(c => new Date(c.t).getTime() + 5 * 60_000 <= now); // CLOSED candles only
}

let LOCK = readLock(PROJ, DATE);
console.log(`5-min FLIP monitor | ${DATE} | ${LOCK ? `levels ${LOCK.levels.map(L => L.price).join(", ")} | open ${LOCK.open}` : "no locked list yet (will lock from the first candle's open)"} | telegram ${SEND_TELEGRAM ? "ON" : "OFF"}`);

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
        const st = loadState();
        const breaks = [];
        const trades = scanFlips(candles, LOCK.levels, LOCK.open, undefined, breaks);
        const events = [...breaks.map(e => ({ ...e, kind: "BREAK" })), ...trades.map(e => ({ ...e, kind: "TRADE" }))]
          .sort((x, y) => x.i - y.i || (x.kind === "BREAK" ? -1 : 1));
        for (const e of events) {
          const ageMin = (Date.now() - (new Date(e.t).getTime() + 5 * 60_000)) / 60_000;
          const side = e.dir === "LONG" ? "🟢" : "🔴";
          let key, msg, line, rec;
          if (e.kind === "BREAK") {
            // "level broken" — the farthest level broken on this candle is the flip to watch
            key = `BRK:${e.dir}:${e.flip}:${e.t}`;
            if (st.done[key] || st.done[`${e.dir}:${e.flip}`]) continue; // already alerted, or this level already traded
            const way = e.dir === "LONG" ? "UP" : "DOWN";
            const others = e.broken.filter(p => p !== e.flip);
            msg = `⚠️ LEVEL BROKEN ${way} — ${e.flip}
${closeHM(e.t)} 5-min candle closed ${e.close}${others.length ? `
Also broke: ${others.join(", ")} → watching the farthest, ${e.flip}` : ""}
Flip level = ${e.flip}. Wait for the retest — NO trade yet.`;
            line = `[BREAK ${closeHM(e.t)}] ${way} ${e.broken.join(",")} -> flip ${e.flip} | close ${e.close}`;
            rec = { kind: "BREAK", time: e.t, closeAt: closeHM(e.t), dir: e.dir, flip: e.flip, broken: e.broken, close: e.close };
          } else {
            key = `${e.dir}:${e.level}`;
            if (st.done[key]) continue;
            const opt = itm(e.dir, e.level);
            const touch = e.dir === "LONG" ? `low ${e.low}` : `high ${e.high}`;
            msg = `${side} RETEST WORKED at ${e.level} — take the ${e.dir} trade
${closeHM(e.t)} 5-min candle came back to ${e.level} (${touch}) and closed ${e.close}
Entry ${e.level} · stop ${e.stop} · target ${e.target}
Option: NIFTY ${opt} (ITM)
Price is ${Math.abs(Math.round(e.close - e.level))} pts from the level now.`;
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
