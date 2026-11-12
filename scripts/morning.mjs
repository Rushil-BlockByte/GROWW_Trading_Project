// Morning setup helper: (1) exchange request_token -> access_token into .env,
// (2) build + LOCK today's level list (±250 from the open) into today_levels.json.
//     That ONE list is what you're shown, what the runner trades and what /feed15 shows,
//     until you ask for a new one.
// Usage: node scripts/morning.mjs "<request_token or - to skip>" "<open price or blank>" [--new]
//   --new  = replace today's locked list (otherwise an existing list is never changed)
import fs from "node:fs";
import crypto from "node:crypto";
import { readLock, lockLevels, printLock } from "./live/levels-lock.mjs";

const readEnv = () => Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\r?\n/).filter(l => l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
function writeToken(at) {
  let env = fs.readFileSync(".env", "utf8"); const crlf = env.includes("\r\n"); let lf = env.replace(/\r\n/g, "\n");
  if (/^KITE_ACCESS_TOKEN=.*$/m.test(lf)) lf = lf.replace(/^KITE_ACCESS_TOKEN=.*$/m, "KITE_ACCESS_TOKEN=" + at);
  else lf += (lf.endsWith("\n") ? "" : "\n") + "KITE_ACCESS_TOKEN=" + at + "\n";
  fs.writeFileSync(".env", crlf ? lf.replace(/\n/g, "\r\n") : lf);
}

const REQ = (process.argv[2] || "").trim();
const OPEN = parseFloat(process.argv[3]);
let env = readEnv();
const KEY = env.KITE_API_KEY, SECRET = env.KITE_API_SECRET;
if (!KEY || !SECRET) { console.error("Missing KITE_API_KEY/SECRET in .env"); process.exit(1); }

// 1) token exchange
if (REQ && REQ !== "-") {
  const chk = crypto.createHash("sha256").update(KEY + REQ + SECRET).digest("hex");
  const j = await fetch("https://api.kite.trade/session/token", {
    method: "POST", headers: { "X-Kite-Version": "3", "Content-Type": "application/x-www-form-urlencoded" },
    body: `api_key=${KEY}&request_token=${REQ}&checksum=${chk}`,
  }).then(r => r.json());
  if (j.status !== "success") { console.error("TOKEN EXCHANGE FAILED: " + (j.message || JSON.stringify(j))); process.exit(1); }
  writeToken(j.data.access_token); env = readEnv();
  console.log("  token updated for " + j.data.user_name);
} else {
  console.log("  (token exchange skipped)");
}

const TOK = env.KITE_ACCESS_TOKEN;
const AUTH = { "X-Kite-Version": "3", Authorization: `token ${KEY}:${TOK}` };

// verify token live
const vq = await fetch("https://api.kite.trade/quote?i=NSE:NIFTY+50", { headers: AUTH }).then(r => r.json()).catch(() => null);
if (!vq || vq.status !== "success") { console.error("TOKEN VERIFY FAILED: " + (vq && vq.message)); process.exit(1); }
const PREVCLOSE = vq.data["NSE:NIFTY 50"].ohlc.close;
console.log("  token live | prev close " + PREVCLOSE);

// 2) levels (only if an open was given)
if (isNaN(OPEN)) { console.log("  (no open price given -> levels skipped)"); process.exit(0); }

const f = d => d.toISOString().slice(0, 10);
const from = f(new Date(Date.now() - 20 * 86400000)), to = f(new Date());
let VIX = null;
try {
  const v = await fetch(`https://api.kite.trade/instruments/historical/264969/day?from=${from}+00:00:00&to=${to}+23:59:00`, { headers: AUTH }).then(r => r.json());
  if (v.status === "success" && v.data.candles.length) VIX = v.data.candles.at(-1)[4];
} catch {}
const reg = VIX == null ? "unknown" : VIX < 12 ? "calm" : VIX < 15 ? "normal" : VIX < 20 ? "elevated" : "stressed";
const WIN = VIX == null ? 180 : VIX < 12 ? 150 : VIX < 15 ? 180 : VIX < 20 ? 240 : 340;

const DATE = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const gap = OPEN - PREVCLOSE;
const gapTag = Math.abs(gap) <= 50 ? "FLAT" : gap >= 100 ? "GAP-UP" : gap <= -100 ? "GAP-DOWN" : "mild";
const sign = n => (n >= 0 ? "+" : "") + Math.round(n);

const existing = readLock(".", DATE);
if (existing && !process.argv.includes("--new")) {
  console.log("\n  today's list is already LOCKED — not changing it (add --new to replace it)");
  if (existing.open !== OPEN) console.log("  note: locked list was built from open " + existing.open + ", not " + OPEN);
  printLock(existing);
  process.exit(0);
}
console.log("\n  OPEN " + OPEN + " | prev close " + PREVCLOSE + " | gap " + sign(gap) + " (" + gapTag + ") | VIX " + (VIX ?? "n/a") + " (" + reg + ")");
const L = lockLevels(".", DATE, OPEN, { prevClose: PREVCLOSE, gap, gapTag, vix: VIX, regime: reg });
printLock(L);
console.log("\n  wrote today_levels.json — the runner and /feed15 use this exact list until you run with --new");
