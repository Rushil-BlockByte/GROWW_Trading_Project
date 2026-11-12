import fs from "node:fs";
import path from "node:path";
import { getOptionalAppUser, isAuthenticationRequired } from "@/lib/auth/session";
import { getServerConfig } from "@/lib/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FeedRow = {
  time: string;
  stage: "ARM" | "CONFIRM";
  dir: "LONG" | "SHORT";
  level: number;
  entry: number;
  stop: number;
  target: number | null;
  opt: string;
};
type Candle = { t: string; o: number; h: number; l: number; c: number };
type Bar = { high: number; low: number; close: number; t: string };
type Lvl = { price: number; touches: number };

// ---- 15-min levels from the 5yr cache (same algo as the runner), memoized ----
let LEVELS_MEMO: Lvl[] | null = null;
function detectSwings(bars: Bar[], pivot: number): number[] {
  const sw: number[] = [];
  for (let i = pivot; i < bars.length - pivot; i++) {
    const w = bars.slice(i - pivot, i + pivot + 1);
    if (w.every((c, k) => k === pivot || bars[i].high >= c.high) && w.some((c, k) => k !== pivot && bars[i].high > c.high)) sw.push(bars[i].high);
    if (w.every((c, k) => k === pivot || bars[i].low <= c.low) && w.some((c, k) => k !== pivot && bars[i].low < c.low)) sw.push(bars[i].low);
  }
  return sw;
}
function buildLevels(bars: Bar[]): Lvl[] {
  const sw = detectSwings(bars, 3);
  const uniq = [...new Set(sw.map((s) => Math.round(s)))];
  const clustered = uniq
    .map((p) => {
      const t = sw.filter((s) => Math.abs(s - p) <= 20);
      const pr = t.slice().sort((a, b) => a - b);
      return { price: Math.round(pr[Math.floor(pr.length / 2)]), touches: t.length };
    })
    .sort((a, b) => b.touches - a.touches);
  const out: Lvl[] = [];
  for (const c of clustered) {
    if (out.some((L) => Math.abs(L.price - c.price) <= 20)) continue;
    out.push(c);
  }
  return out.filter((L) => L.touches >= 6);
}
function allLevels(): Lvl[] {
  if (LEVELS_MEMO) return LEVELS_MEMO;
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "sr-5min-cache.json"), "utf8"));
    const byDay = new Map<string, Bar[]>();
    for (const b of cache.barsByUnderlying.NIFTY) {
      const d = (b.startTime as string).slice(0, 10);
      const list = byDay.get(d) ?? [];
      list.push({ high: b.high, low: b.low, close: b.close, t: b.startTime });
      byDay.set(d, list);
    }
    const h15: Bar[] = [];
    for (const d of [...byDay.keys()].sort()) {
      const db = byDay.get(d)!.slice().sort((a, b) => (a.t < b.t ? -1 : 1));
      for (let i = 0; i < db.length; i += 3) {
        const g = db.slice(i, i + 3);
        h15.push({ high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)), close: g[g.length - 1].close, t: g[0].t });
      }
    }
    LEVELS_MEMO = buildLevels(h15);
  } catch {
    LEVELS_MEMO = [];
  }
  return LEVELS_MEMO;
}

function page(body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>15-min Live Feed</title><style>
    :root{color-scheme:dark;--bg:#0b0e13;--card:#141922;--bd:#28313e;--fg:#e8edf4;--mut:#93a0b1;--up:#2cb66d;--dn:#e2615b;--amb:#e0a53a}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;padding:24px}
    .wrap{max-width:860px;margin:0 auto}h1{font-size:1.4rem;margin:0 0 .2rem}.sub{color:var(--mut);margin:0 0 1rem;font-size:.9rem}
    .head{display:flex;flex-wrap:wrap;gap:.8rem;margin-bottom:1rem}
    .stat{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:.6rem .9rem;flex:1 1 120px;min-width:0}
    .stat .n{font-size:1.25rem;font-weight:700;font-variant-numeric:tabular-nums}.stat .l{color:var(--mut);font-size:.72rem;text-transform:uppercase;letter-spacing:.05em}
    .cols{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin-bottom:1.2rem}
    @media(max-width:560px){.cols{grid-template-columns:1fr}}
    .lvlbox{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:.7rem .9rem}
    .lvlbox h3{margin:0 0 .4rem;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}
    .lvl{display:flex;justify-content:space-between;font-variant-numeric:tabular-nums;padding:.1rem 0}
    .lvl .t{color:var(--mut);font-size:.8rem}
    table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--bd);border-radius:12px;overflow:hidden}
    th,td{padding:.6rem .8rem;text-align:left;border-bottom:1px solid var(--bd);font-variant-numeric:tabular-nums}
    th{color:var(--mut);font-weight:600;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em}
    tr:last-child td{border-bottom:none}.long{color:var(--up);font-weight:600}.short{color:var(--dn);font-weight:600}
    .arm{color:var(--amb)}.win{color:var(--up);font-weight:600}.loss{color:var(--dn);font-weight:600}.open{color:var(--mut)}
    .pill{display:inline-block;padding:.1rem .5rem;border:1px solid var(--bd);border-radius:999px;font-size:.72rem}
    .foot{color:var(--mut);font-size:.78rem;margin-top:1rem}</style></head><body><div class="wrap">${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function istDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

async function fetchFive(apiKey: string, token: string, date: string): Promise<Candle[] | null> {
  try {
    const r = await fetch(
      `https://api.kite.trade/instruments/historical/256265/5minute?from=${date}+09:15:00&to=${date}+15:30:00`,
      { headers: { "X-Kite-Version": "3", Authorization: `token ${apiKey}:${token}` }, cache: "no-store" },
    ).then((x) => x.json());
    if (r.status !== "success") return null;
    return (r.data.candles as number[][]).map((c) => ({ t: c[0] as unknown as string, o: c[1], h: c[2], l: c[3], c: c[4] }));
  } catch {
    return null;
  }
}

function outcome(five: Candle[] | null, row: FeedRow): { res: string; cls: string } {
  if (!five || !five.length || row.target == null) return { res: "—", cls: "open" };
  const { dir, level, entry, stop, target } = row;
  let fi = -1;
  for (let i = 0; i < five.length; i++) {
    if (five[i].t < row.time) continue;
    if (dir === "SHORT" ? five[i].h >= level : five[i].l <= level) { fi = i; break; }
  }
  if (fi < 0) return { res: "no fill", cls: "open" };
  for (let i = fi + 1; i < five.length; i++) {
    const b = five[i];
    if (dir === "SHORT") {
      if (b.h >= stop) return { res: "STOP −25", cls: "loss" };
      if (b.l <= target) return { res: "TARGET +40", cls: "win" };
    } else {
      if (b.l <= stop) return { res: "STOP −25", cls: "loss" };
      if (b.h >= target) return { res: "TARGET +40", cls: "win" };
    }
  }
  const last = five[five.length - 1].c;
  const pnl = Math.round(dir === "SHORT" ? entry - last : last - entry);
  return { res: `OPEN ${pnl >= 0 ? "+" : ""}${pnl}`, cls: "open" };
}

export async function GET() {
  const user = await getOptionalAppUser();
  if (!user && isAuthenticationRequired()) {
    return page(`<h1>15-min Live Feed</h1><p class="sub">Owner login required — open <a href="/" style="color:#e0a53a">the dashboard</a> and sign in first.</p>`, 401);
  }

  const date = istDate();
  const config = getServerConfig();
  const five = config.kiteApiKey && config.kiteAccessToken ? await fetchFive(config.kiteApiKey, config.kiteAccessToken, date) : null;

  // day stats + open
  let open: number | null = null;
  let regime = "";
  let locked: Lvl[] | null = null; // today's ONE locked list (today_levels.json) — same list the runner trades
  try {
    const tl = JSON.parse(fs.readFileSync(path.join(process.cwd(), "today_levels.json"), "utf8"));
    open = tl.open ?? null;
    if (tl.locked && tl.date === date && Array.isArray(tl.levels)) locked = tl.levels as Lvl[];
    regime = tl.regime ? `${tl.regime} · VIX ${tl.vix ?? "?"}` : "";
  } catch {
    /* ignore */
  }
  const ltp = five && five.length ? five[five.length - 1].c : null;
  const dHigh = five && five.length ? Math.max(...five.map((c) => c.h)) : null;
  const dLow = five && five.length ? Math.min(...five.map((c) => c.l)) : null;
  if (open == null && five && five.length) open = five[0].o;

  // nearest 15-min levels around the live price
  const ref = ltp ?? open ?? 0;
  const levels = locked ?? allLevels();
  const res = levels.filter((L) => L.price > ref).sort((a, b) => a.price - b.price).slice(0, 4);
  const sup = levels.filter((L) => L.price < ref).sort((a, b) => b.price - a.price).slice(0, 4);

  // feed
  const file = path.join(process.cwd(), "scripts", "live", ".runtime", `feed_${date}.jsonl`);
  let rows: FeedRow[] = [];
  try {
    rows = fs.readFileSync(file, "utf8").trim().split(/\n/).filter(Boolean).map((l) => JSON.parse(l) as FeedRow);
  } catch {
    rows = [];
  }
  const confirms = rows.filter((r) => r.stage === "CONFIRM");
  let net = 0;
  let wins = 0;
  const outs = confirms.map((r) => {
    const o = outcome(five, r);
    if (o.res.startsWith("TARGET")) { net += 40; wins += 1; } else if (o.res.startsWith("STOP")) net -= 25;
    return o;
  });

  const head = `<div class="head">
    <div class="stat"><div class="n">${ltp ?? "—"}</div><div class="l">NIFTY LTP</div></div>
    <div class="stat"><div class="n">${open ?? "—"}</div><div class="l">Open</div></div>
    <div class="stat"><div class="n">${dHigh ?? "—"} / ${dLow ?? "—"}</div><div class="l">Day H / L</div></div>
    <div class="stat"><div class="n ${net >= 0 ? "win" : "loss"}">${net >= 0 ? "+" : ""}${net}</div><div class="l">Net pts · ${wins}/${confirms.length} win</div></div>
  </div>${regime ? `<p class="sub">Regime: ${regime}</p>` : ""}`;

  const lvlCol = (title: string, arr: Lvl[], cls: string) =>
    `<div class="lvlbox"><h3>${title}</h3>${arr.length ? arr.map((L) => `<div class="lvl"><span class="${cls}">${L.price}</span><span class="t">${L.touches}t · ${L.price > ref ? "+" : ""}${Math.round(L.price - ref)}</span></div>`).join("") : '<div class="lvl open">—</div>'}</div>`;
  const cols = `<div class="cols">${lvlCol("Resistance (15-min)", res, "short")}${lvlCol("Support (15-min)", sup, "long")}</div>`;

  const feedBody = rows.length
    ? rows.slice().reverse().map((r) => {
        const dcls = r.dir === "LONG" ? "long" : "short";
        const stage = r.stage === "ARM" ? `<span class="arm">📍 ARM</span>` : `<span class="${dcls}">✓ CONFIRM</span>`;
        let out = "—";
        let ocls = "open";
        if (r.stage === "CONFIRM") { const o = outs[confirms.indexOf(r)]; out = o.res; ocls = o.cls; }
        return `<tr><td>${(r.time || "").slice(11, 16)}</td><td>${stage}</td><td class="${dcls}">${r.dir} ${r.level}</td><td>${r.opt}</td><td>${r.entry} / ${r.stop} / ${r.target ?? "—"}</td><td class="${ocls}">${out}</td></tr>`;
      }).join("")
    : `<tr><td colspan="6" class="open">No alerts yet today — the feed fills as the runner sends.</td></tr>`;

  return page(
    `<h1>15-min Live Feed</h1><p class="sub">${date} — the live monitor on the web: same levels, same gated signals, same outcomes as your Telegram. Auto-refreshes 30s.</p>
    ${head}${cols}
    <table><tr><th>Time</th><th>Stage</th><th>Trade</th><th>Option</th><th>Entry/Stop/Tgt</th><th>Outcome</th></tr>${feedBody}</table>
    <p class="foot">Gated exactly like Telegram: closed-candle only, whipsaw + 30-min cooldown. This is the one view to trade from.</p>`,
  );
}
