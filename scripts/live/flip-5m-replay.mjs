// Replay any day through the SAME logic the live 5-min flip monitor uses.
// Usage: node scripts/live/flip-5m-replay.mjs <YYYY-MM-DD> <open>
// Uses that day's locked list if today_levels.json is for that date, else builds
// the 15-min list (5 R + 5 S, ±250) from the open you pass. Needs a live Kite token.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readLock, buildAllLevels, pickLevels } from "./levels-lock.mjs";
import { scanFlips, closeHM } from "./flip-logic.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, "..", "..");
const env = Object.fromEntries(fs.readFileSync(path.join(PROJ, ".env"), "utf8").split(/\r?\n/).filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const DATE = process.argv[2], OPEN = Number(process.argv[3]);
if (!DATE) { console.log("usage: node scripts/live/flip-5m-replay.mjs <YYYY-MM-DD> <open>"); process.exit(1); }
const lock = readLock(PROJ, DATE);
if (!lock && !(OPEN > 0)) { console.log("no locked list for " + DATE + " — pass the open price"); process.exit(1); }
const open = lock ? lock.open : OPEN;
const levels = lock ? lock.levels : pickLevels(buildAllLevels(PROJ), open).levels;

const j = await fetch(`https://api.kite.trade/instruments/historical/256265/5minute?from=${DATE}+09:15:00&to=${DATE}+15:30:00`, { headers: { "X-Kite-Version": "3", Authorization: `token ${env.KITE_API_KEY}:${env.KITE_ACCESS_TOKEN}` } }).then(r => r.json());
if (j.status !== "success") { console.log("Kite error: " + (j.message || "")); process.exit(1); }
const candles = j.data.candles.map(c => ({ t: c[0], open: c[1], high: c[2], low: c[3], close: c[4] }));

console.log(`${DATE} | open ${open} | ${lock ? "LOCKED list" : "15-min list built from the open"}: ${levels.map(L => L.price).join(", ")}`);
let net = 0, w = 0, l = 0;
const rejected = [];
for (const s of scanFlips(candles, levels, open, undefined, rejected)) {
  let res = "no exit by close", pts = 0, at = "";
  for (let k = s.i + 1; k < candles.length; k++) { const b = candles[k];
    const hitStop = s.dir === "LONG" ? b.low <= s.stop : b.high >= s.stop;
    const hitTgt = s.dir === "LONG" ? b.high >= s.target : b.low <= s.target;
    if (hitStop) { res = "STOP"; pts = -25; at = closeHM(b.t); l++; break; }
    if (hitTgt) { res = "TARGET"; pts = 40; at = closeHM(b.t); w++; break; } }
  net += pts;
  console.log(`  ${closeHM(s.t)}  ${s.dir.padEnd(5)} ${s.level} | ${s.pattern} | ${s.dir === "LONG" ? "low " + s.low : "high " + s.high} close ${s.close} | stop ${s.stop} tgt ${s.target} -> ${res}${at ? " @" + at : ""}${pts ? ` (${pts > 0 ? "+" : ""}${pts} from the level)` : ""}`);
}
if (rejected.length) { console.log("  retests skipped (candle was not a reversal pattern):"); for (const r of rejected) console.log(`    ${closeHM(r.t)}  ${r.dir.padEnd(5)} ${r.level} | O ${r.c.open} H ${r.c.high} L ${r.c.low} C ${r.c.close}`); }
console.log(`  ${w} target, ${l} stop | net ${net >= 0 ? "+" : ""}${net} pts if each was filled at the level (stop checked before target in the same candle)`);
