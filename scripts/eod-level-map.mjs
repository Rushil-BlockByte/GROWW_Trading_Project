/**
 * End-of-day S/R level map generator.
 *
 * After the market closes, computes the fresh 5-minute support/resistance level
 * map (through the day's close) that we watch the next session. Uses the same
 * swing-cluster logic as lib/strategy/sr-levels (pivot ± 3, cluster ± 20 pts),
 * ranking levels by touch count, and prints the ladder around the close.
 *
 * Requires the local dev server running and an owner session. Configure via env:
 *   APP_URL                 (default http://localhost:3000)
 *   APP_OWNER_ACCESS_CODE   (owner login code for the diagnostic session)
 *   EOD_INDEX_TOKEN         (default 256265 = NIFTY 50 index)
 *   EOD_VIX_TOKEN           (default 264969 = India VIX)
 *   EOD_TO / EOD_FROM       (YYYY-MM-DD window; default ~180 days to today IST)
 *
 * Usage: node scripts/eod-level-map.mjs [outFile.json]
 */
import fs from "node:fs";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const CODE = process.env.APP_OWNER_ACCESS_CODE ?? "";
const INDEX_TOKEN = Number(process.env.EOD_INDEX_TOKEN ?? 256265);
const VIX_TOKEN = Number(process.env.EOD_VIX_TOKEN ?? 264969);
const PIVOT = 3;
const CLUSTER = 20;
const NEAR_WINDOW = 350; // report levels within this of the close
const MIN_TOUCHES = 5;

if (!CODE) {
  console.error("Set APP_OWNER_ACCESS_CODE to the owner login code.");
  process.exit(1);
}

const istDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
};
const to = process.env.EOD_TO ?? istDate(0);
const from = process.env.EOD_FROM ?? istDate(-180);

const login = await fetch(`${APP_URL}/api/auth/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ accessCode: CODE }),
});
const cookie = login.headers
  .getSetCookie()
  .find((c) => c.startsWith("groww_scanner_session="))
  ?.split(";")[0];

if (!cookie) {
  console.error("Login failed — check APP_OWNER_ACCESS_CODE and that the server is running.");
  process.exit(1);
}

async function candles(token, exch, interval, f, t) {
  const url = `${APP_URL}/api/kite/historical?instrumentToken=${token}&exchange=${exch}&interval=${interval}&from=${f}%2009:15:00&to=${t}%2015:30:00`;
  const res = await fetch(url, { headers: { Cookie: cookie } });
  const json = await res.json();
  if (!json.ok) throw new Error(json.message);
  return json.historical.candles;
}

// 5-min index bars across the window (chunk to respect the per-request limit)
const bars = [];
const start = new Date(`${from}T00:00:00Z`);
const end = new Date(`${to}T00:00:00Z`);
let cursor = start;
while (cursor < end) {
  const f = cursor.toISOString().slice(0, 10);
  const next = new Date(cursor.getTime() + 85 * 864e5);
  const t = (next < end ? next : end).toISOString().slice(0, 10);
  for (const c of await candles(INDEX_TOKEN, "NSE", "5minute", f, t)) {
    bars.push({ h: Number(c.high), l: Number(c.low), c: Number(c.close) });
  }
  cursor = new Date(next.getTime());
}

const daily = await candles(INDEX_TOKEN, "NSE", "day", istDate(-8), to);
const close = Number(daily.at(-1).close);
const vixDaily = await candles(VIX_TOKEN, "NSE", "day", istDate(-8), to);
const vix = Number(vixDaily.at(-1).close);

// swings + cluster (mirrors lib/strategy/sr-levels)
const swings = [];
for (let k = PIVOT; k < bars.length - PIVOT; k += 1) {
  const w = bars.slice(k - PIVOT, k + PIVOT + 1);
  if (w.every((b, i) => i === PIVOT || bars[k].h >= b.h) && w.some((b, i) => i !== PIVOT && bars[k].h > b.h)) swings.push(bars[k].h);
  if (w.every((b, i) => i === PIVOT || bars[k].l <= b.l) && w.some((b, i) => i !== PIVOT && bars[k].l < b.l)) swings.push(bars[k].l);
}
const unique = [...new Set(swings.map((s) => Math.round(s)))];
const clustered = unique
  .map((p) => {
    const touching = swings.filter((s) => Math.abs(s - p) <= CLUSTER);
    return {
      level: Math.round(touching.slice().sort((a, b) => a - b)[Math.floor(touching.length / 2)]),
      touches: touching.length,
    };
  })
  .sort((a, b) => b.touches - a.touches);
const levels = [];
for (const candidate of clustered) {
  if (!levels.some((l) => Math.abs(l.level - candidate.level) <= CLUSTER)) levels.push(candidate);
}

const near = levels.filter((l) => Math.abs(l.level - close) <= NEAR_WINDOW && l.touches >= MIN_TOUCHES);
const resistances = near.filter((l) => l.level > close).sort((a, b) => a.level - b.level);
const supports = near.filter((l) => l.level < close).sort((a, b) => b.level - a.level);
const vixRegime = vix < 12 ? "calm" : vix < 15 ? "normal" : vix < 20 ? "elevated" : "stressed";

const map = {
  computedFor: istDate(1),
  basedOnClose: close,
  vix,
  vixRegime,
  fiveMinBars: bars.length,
  resistances: resistances.map((l) => ({ level: l.level, dist: l.level - close, touches: l.touches })),
  supports: supports.map((l) => ({ level: l.level, dist: l.level - close, touches: l.touches })),
};

if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(map, null, 2));

console.log(`Level map (close ${close}, VIX ${vix} ${vixRegime}, ${bars.length} 5-min bars):`);
console.log("Resistance above:");
for (const l of resistances) console.log(`  ${l.level}  +${l.level - close}  ${l.touches} touches`);
console.log("Support below:");
for (const l of supports) console.log(`  ${l.level}  ${l.level - close}  ${l.touches} touches`);
