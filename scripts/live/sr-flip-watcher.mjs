import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Repo root = two levels up from scripts/live/<this file>.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, "..", "..");
const require = createRequire(path.join(PROJ, "package.json"));
const env = Object.fromEntries(fs.readFileSync(path.join(PROJ, ".env"), "utf8").split(/\r?\n/).filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const AUTH = { "X-Kite-Version": "3", Authorization: `token ${env.KITE_API_KEY}:${env.KITE_ACCESS_TOKEN}` };
const BASE = "http://localhost:3000";
// Today in IST (YYYY-MM-DD). Override for replay: node sr-flip-watcher.mjs 2026-11-06
const DATE = process.argv[2] || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const [YY, MM] = DATE.split("-");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][parseInt(MM, 10) - 1];
// Runtime state/logs live here (gitignored); monthly journal sits at the repo root.
const RUNTIME = path.join(HERE, ".runtime");
fs.mkdirSync(RUNTIME, { recursive: true });
const STATE = path.join(RUNTIME, "watch_state_" + DATE + ".json");
const SIGLOG = path.join(RUNTIME, "signals_" + DATE + ".jsonl");
const FUT_TOKEN_FILE = path.join(RUNTIME, "fut_token_" + DATE + ".json");
const JOURNAL = path.join(PROJ, `Trading_Journal_${MON}${YY}.xlsx`);
const POLL_MS = 20_000, HEARTBEAT_MS = 600_000;
const VOL_MIN = 1.0;            // high-conviction volume ratio (real futures vol vs trailing avg)
const WHIPSAW_MS = 30 * 60_000; // opposite-direction alert within 30 min = whipsaw
const SEND_TELEGRAM = process.env.SEND_TELEGRAM !== "0"; // default ON; SEND_TELEGRAM=0 => journal-only (dry run)

function loadState(){ try { return JSON.parse(fs.readFileSync(STATE,"utf8")); } catch { return { attempts:{}, lastConfirmedKey:null, lastPush:null, lastBeat:0 }; } }
function saveState(s){ fs.writeFileSync(STATE, JSON.stringify(s)); }
const ist = () => new Date().toLocaleTimeString("en-GB",{timeZone:"Asia/Kolkata"});

// --- real NIFTY futures volume ratio (engine's own volume field is unreliable/0) ---
async function getFutToken(){
  try { const v = JSON.parse(fs.readFileSync(FUT_TOKEN_FILE,"utf8")); if (v.token) return v.token; } catch {}
  const csv = await fetch("https://api.kite.trade/instruments/NFO",{headers:AUTH}).then(r=>r.text());
  const rows = csv.split(/\r?\n/).filter(Boolean); const unq=s=>s.replace(/^"|"$/g,"");
  const head = rows[0].split(",").map(unq); const ix = Object.fromEntries(head.map((h,i)=>[h,i]));
  let tok=null, exp=null;
  for (let i=1;i<rows.length;i++){ const f=rows[i].split(","); if (unq(f[ix.name])==="NIFTY" && unq(f[ix.instrument_type])==="FUT"){ const ex=unq(f[ix.expiry]); if(!exp||ex<exp){exp=ex;tok=unq(f[ix.instrument_token]);} } }
  try { fs.writeFileSync(FUT_TOKEN_FILE, JSON.stringify({token:tok})); } catch {}
  return tok;
}
const median = a => { const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };
async function volRatio(){
  try {
    const tok = await getFutToken(); if(!tok) return null;
    const j = await fetch(`https://api.kite.trade/instruments/historical/${tok}/5minute?from=${DATE}+09:15:00&to=${DATE}+15:30:00`,{headers:AUTH}).then(r=>r.json());
    const c = j.data && j.data.candles; if(!c || c.length<4) return null; // need a few candles for a baseline (lenient early-session)
    const last = c[c.length-1][5];
    // local window: last ~6 candles (~30 min), skip the 09:15 opening spike; median is robust to outliers
    const prior = c.slice(Math.max(1, c.length-7), c.length-1).map(b=>b[5]);
    if (prior.length < 2) return null;
    const med = median(prior);
    return med>0 ? +(last/med).toFixed(2) : null;
  } catch { return null; }
}

function itmOption(dir, price){ const O=125; return dir==="SHORT" ? (Math.round((price+O)/50)*50+" PE") : (Math.round((price-O)/50)*50+" CE"); }

async function logToJournal(sig){
  try {
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(JOURNAL);
    const ws = wb.getWorksheet("Signals");
    let last=0; ws.eachRow((r,i)=>{ const v=r.getCell(1).value; if(v!=null&&String(v).trim()!=="") last=i; });
    const R = ws.getRow(last+1);
    const vals = [DATE, sig.time, sig.dir, sig.level, sig.entry, sig.stop, sig.tgt, sig.rr,
      (sig.vol!=null?sig.vol.toFixed(2)+"x":"n/a"), (sig.breakAndGo?"Break-and-go":"Dashboard engine"), (sig.alert?"ALERTED":""),
      `[${sig.conviction}] attempt ${sig.attempt}. ${sig.dir} @${sig.level} ${sig.breakAndGo?"BREAK-AND-GO":"CONFIRMED"} (ref ${sig.ref}). Take NIFTY ${itmOption(sig.dir, sig.ref!=null?sig.ref:sig.entry)} (ITM).${sig.alert?" -> Telegram.":" Journal-only."}`];
    vals.forEach((v,i)=>{ R.getCell(i+1).value=v; }); R.commit();
    await wb.xlsx.writeFile(JOURNAL); return "Nov journal";
  } catch { return "jsonl-only"; }
}
async function sendTelegram(sig){
  if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID) return "no-telegram-config";
  try {
    const emoji = sig.dir==="LONG"?"🟢":"🔴";
    const opt = itmOption(sig.dir, sig.ref!=null?sig.ref:sig.entry);
    const conv = sig.conviction==="HIGH"
      ? (sig.breakAndGo ? "⭐ HIGH CONVICTION · break-and-go (momentum)" : "⭐ HIGH CONVICTION")
      : "⚠️ LESS CONVICTION · 2nd attempt (repeat)";
    const tier = sig.engineConv;
    const sizeHint = tier==="HIGH" ? "size UP (~1.5x)" : tier==="LOW" ? "size DOWN (~0.5x)" : "normal size";
    const tierLine = tier ? `\n📊 Backtested tier: ${tier} → ${sizeHint}` : "";
    const text = `${emoji} ${sig.dir} @ ${sig.level}\n${conv}${tierLine}\n➡️ TAKE: NIFTY ${opt} (ITM)\nEnter NEAR ${sig.entry} (limit — don't chase past +15) · Stop ${sig.stop} · Target ${sig.tgt}\nR:R ${sig.rr} · Vol ${sig.vol!=null?sig.vol.toFixed(2)+"x":"n/a"} · ${sig.time} IST\n(paper signal — not auto-traded)`;
    const r = await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text})});
    return (await r.json()).ok ? "telegram sent" : "telegram failed";
  } catch { return "telegram error"; }
}
async function sendTelegramText(text){
  if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID) return "no-telegram-config";
  try { const r=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text})}); return (await r.json()).ok?"telegram sent":"telegram failed"; } catch { return "telegram error"; }
}

async function login0(){ const r=await fetch(BASE+"/api/auth/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accessCode:env.APP_OWNER_ACCESS_CODE})}); return (r.headers.get("set-cookie")||"").split(";")[0]; }
async function snap(cookie){ const r=await fetch(BASE+"/api/kite/stream",{headers:{Cookie:cookie}}); return r.json(); }

const st = loadState(); st.attempts = st.attempts || {};
let cookie = await login0();
const t0 = Date.now();
const out = { ist: ist(), events: [], signal: null };

// handle one distinct new signal occurrence (confirmed OR break-and-go)
async function handleSignal(p6, key, breakAndGo){
  const attempt = (st.attempts[key] || 0) + 1; st.attempts[key] = attempt;
  const ratio = await volRatio();
  const nowMs = Date.now();
  const whipsaw = !!(st.lastPush && st.lastPush.dir !== p6.direction && (nowMs - st.lastPush.ms) < WHIPSAW_MS);
  const volOk = ratio != null && ratio >= VOL_MIN;
  const highConv = volOk && !whipsaw; // guard: a break-and-go must ALSO have volume (>=1.0x) to count HIGH/alert; a dead-volume pop stays journal-only
  const secondAttempt = !highConv && !whipsaw && attempt >= 2 && (volOk || !breakAndGo); // a dead-volume break-and-go never alerts (not even 2nd-attempt); clean-retest repeats still do        // low-conviction but repeated -> take 2nd attempt
  const alert = highConv && !breakAndGo; // STRICT BAR: push only a clean confirmed retest (not break-and-go) with volume >=1.0x and no whipsaw; pushedKeys dedup below blocks repeats. 2nd-attempts stay journal-only.
  const conviction = highConv ? "HIGH" : (secondAttempt ? "2ND-ATTEMPT" : "low");
  const sig = { date:DATE, time:ist(), dir:p6.direction, level:p6.plan.level, entry:p6.plan.entry, stop:p6.plan.stop, tgt:p6.plan.target, ref:p6.referencePrice, vol:ratio, rr:p6.plan.riskReward, attempt, conviction, engineConv:p6.conviction||null, breakAndGo, alert };
  try { fs.appendFileSync(SIGLOG, JSON.stringify(sig)+"\n"); } catch {}
  const dest = await logToJournal(sig);
  let tg = "not alerted (" + (whipsaw ? "whipsaw" : "1st low-conviction — awaiting repeat") + ")";
  st.pushedKeys = st.pushedKeys || {};
  const prevPush = st.pushedKeys[key];
  const freshPush = alert && (!prevPush || (conviction === "HIGH" && prevPush !== "HIGH")); // push a level once; re-push only if it UPGRADES to HIGH
  if (alert) st.lastPush = { dir:p6.direction, level:p6.plan.level, ms:nowMs };
  if (freshPush) { st.pushedKeys[key] = conviction; tg = SEND_TELEGRAM ? await sendTelegram(sig) : "telegram OFF (journal only)"; }
  else if (alert) tg = "suppressed (already pushed " + prevPush + " for this level)";
  saveState(st);
  out.signal = sig;
  const head = alert ? (highConv ? (breakAndGo?"🔔 BREAK-AND-GO":"🔔 HIGH-CONVICTION") : "🔔 2ND-ATTEMPT (repeat)") : "(not alerted)";
  out.events.push(`[${ist()}] ${head} ${p6.direction} @ ${p6.plan.level} — entry ${p6.plan.entry}, stop ${p6.plan.stop}, target ${p6.plan.target} (R:R ${p6.plan.riskReward}). ref ${p6.referencePrice}, vol ${ratio!=null?ratio.toFixed(2)+"x":"n/a"}, attempt ${attempt}${whipsaw?" [whipsaw]":""}. [journal ${dest}; ${tg}]`);
}

// Break-stage "arm your limit" alert: fires on a FRESH break, before the retest,
// so you can place a resting limit AT the level instead of chasing the confirm.
async function handleArm(p6, key){
  const dir = p6.direction, L = p6.plan.level, stop = p6.plan.stop;
  const emoji = dir==="LONG"?"🟢":"🔴", side = dir==="LONG"?"BUY":"SELL";
  const opt = itmOption(dir, p6.referencePrice!=null?p6.referencePrice:L);
  const text = `📍 ${emoji} ${L} BROKE ${dir==="LONG"?"UP":"DOWN"} — ARM YOUR LIMIT\nPlace a ${side} limit at ${L} (stop ${stop}).\nWAIT for the retest — do NOT chase. If price runs >15 past ${L}, skip it.\nLikely: NIFTY ${opt} (ITM) · ${ist()} IST\n(paper setup — wait for the pullback)`;
  const tg = SEND_TELEGRAM ? await sendTelegramText(text) : "telegram OFF";
  try { fs.appendFileSync(SIGLOG, JSON.stringify({date:DATE,time:ist(),stage:"ARM",dir,level:L,stop,ref:p6.referencePrice})+"\n"); } catch {}
  out.events.push(`[${ist()}] 📍 ARM LIMIT ${dir} @ ${L} (stop ${stop}). ref ${p6.referencePrice}. [${tg}]`);
}

while (true) {
  let j; try { j = await snap(cookie); } catch { cookie = await login0(); await new Promise(r=>setTimeout(r,POLL_MS)); continue; }
  if (!("running" in j)) { cookie = await login0(); await new Promise(r=>setTimeout(r,POLL_MS)); continue; } // re-auth: an auth-failed GET returns JSON (no throw), so re-login instead of idling
  const sess = j.marketSession;
  if (sess && sess.open === false) { out.events.push(`[${ist()}] SESSION: market closed. app-watch done.`); break; }
  const p6 = j.marketSnapshot && j.marketSnapshot.phase6;

  if (p6 && p6.plan) {
    const key = `${p6.direction}:${p6.plan.level}`;
    const confirmed = p6.state === "CONFIRMED";
    // break-and-go: broke and ran past the level toward target without a clean retest
    const dist = Math.abs(p6.plan.target - p6.plan.level) || 40;
    const beyond = p6.direction === "LONG" ? (p6.referencePrice - p6.plan.level) : (p6.plan.level - p6.referencePrice);
    const breakAndGo = p6.state === "AWAITING_RETEST" && beyond >= 0.75 * dist;

    // BREAK-STAGE: a fresh break -> arm a limit at the level (precursor alert; keep watching for the retest)
    st.armedKeys = st.armedKeys || {};
    if (p6.state === "AWAITING_RETEST" && p6.freshBreak && (Date.now() - (st.armedKeys[key] || 0)) > 1800_000) {
      st.armedKeys[key] = Date.now(); saveState(st);
      await handleArm(p6, key);
    }

    st.lastFired = st.lastFired || {};
    const cooled = (Date.now() - (st.lastFired[key] || 0)) > 180_000; // 3-min per-key cooldown: stops a repeating suppressed signal re-logging every poll
    if ((confirmed || breakAndGo) && st.lastConfirmedKey !== key && cooled) {
      st.lastConfirmedKey = key; st.lastFired[key] = Date.now();
      await handleSignal(p6, key, breakAndGo && !confirmed);
      break;
    }
    if (!confirmed && !breakAndGo && st.lastConfirmedKey) { st.lastConfirmedKey = null; }
  } else if (st.lastConfirmedKey) {
    st.lastConfirmedKey = null;
  }

  if (Date.now() - st.lastBeat > HEARTBEAT_MS) {
    st.lastBeat = Date.now(); saveState(st);
    out.events.push(`[${ist()}] heartbeat — phase6 ${p6?("state="+p6.state+" dir="+p6.direction+" ref="+p6.referencePrice):"(no snapshot)"} | signalGen ${j.signalGenerationAllowed}`);
    break;
  }
  if (Date.now() - t0 > HEARTBEAT_MS + 60_000) break;
  await new Promise(r=>setTimeout(r,POLL_MS));
}
console.log(JSON.stringify(out));
