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

function page(body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>15-min Live Feed</title><style>
    :root{color-scheme:dark;--bg:#0b0e13;--card:#141922;--bd:#28313e;--fg:#e8edf4;--mut:#93a0b1;--up:#2cb66d;--dn:#e2615b;--amb:#e0a53a}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;padding:24px}
    .wrap{max-width:820px;margin:0 auto}h1{font-size:1.4rem;margin:0 0 .2rem}.sub{color:var(--mut);margin:0 0 1.2rem;font-size:.9rem}
    table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--bd);border-radius:12px;overflow:hidden}
    th,td{padding:.6rem .8rem;text-align:left;border-bottom:1px solid var(--bd);font-variant-numeric:tabular-nums}
    th{color:var(--mut);font-weight:600;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em}
    tr:last-child td{border-bottom:none}.long{color:var(--up);font-weight:600}.short{color:var(--dn);font-weight:600}
    .arm{color:var(--amb)}.win{color:var(--up);font-weight:600}.loss{color:var(--dn);font-weight:600}.open{color:var(--mut)}
    .pill{display:inline-block;padding:.1rem .5rem;border:1px solid var(--bd);border-radius:999px;font-size:.72rem}
    .foot{color:var(--mut);font-size:.78rem;margin-top:1rem}mono{font-family:ui-monospace,monospace}</style></head><body><div class="wrap">${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function istDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

async function fetchFive(apiKey: string, token: string, date: string) {
  try {
    const r = await fetch(
      `https://api.kite.trade/instruments/historical/256265/5minute?from=${date}+09:15:00&to=${date}+15:30:00`,
      { headers: { "X-Kite-Version": "3", Authorization: `token ${apiKey}:${token}` }, cache: "no-store" },
    ).then((x) => x.json());
    if (r.status !== "success") return null;
    return (r.data.candles as number[][]).map((c) => ({ t: c[0] as unknown as string, h: c[2], l: c[3], c: c[4] }));
  } catch {
    return null;
  }
}

function outcome(
  five: { t: string; h: number; l: number; c: number }[] | null,
  row: FeedRow,
): { res: string; cls: string } {
  if (!five || !five.length || row.target == null) return { res: "—", cls: "open" };
  const { dir, level, entry, stop, target } = row;
  let fi = -1;
  for (let i = 0; i < five.length; i++) {
    if (five[i].t < row.time) continue;
    const tag = dir === "SHORT" ? five[i].h >= level : five[i].l <= level;
    if (tag) {
      fi = i;
      break;
    }
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
  const file = path.join(process.cwd(), "scripts", "live", ".runtime", `feed_${date}.jsonl`);
  let rows: FeedRow[] = [];
  try {
    rows = fs
      .readFileSync(file, "utf8")
      .trim()
      .split(/\n/)
      .filter(Boolean)
      .map((l) => JSON.parse(l) as FeedRow);
  } catch {
    rows = [];
  }

  const config = getServerConfig();
  const five =
    config.kiteApiKey && config.kiteAccessToken
      ? await fetchFive(config.kiteApiKey, config.kiteAccessToken, date)
      : null;

  const confirms = rows.filter((r) => r.stage === "CONFIRM");
  let net = 0;
  let wins = 0;
  const outcomes = confirms.map((r) => {
    const o = outcome(five, r);
    if (o.res.startsWith("TARGET")) {
      net += 40;
      wins += 1;
    } else if (o.res.startsWith("STOP")) net -= 25;
    return o;
  });

  if (!rows.length) {
    return page(
      `<h1>15-min Live Feed</h1><p class="sub">${date} — exactly what the runner sent to Telegram. Auto-refreshes every 30s.</p><table><tr><th>Status</th></tr><tr><td class="open">No alerts yet today. The feed fills as the runner sends.</td></tr></table>`,
    );
  }

  const body = rows
    .slice()
    .reverse()
    .map((r) => {
      const dcls = r.dir === "LONG" ? "long" : "short";
      const stageLabel = r.stage === "ARM" ? `<span class="arm">📍 ARM</span>` : `<span class="${dcls}">✓ CONFIRM</span>`;
      let out = "—";
      let ocls = "open";
      if (r.stage === "CONFIRM") {
        const idx = confirms.indexOf(r);
        const o = outcomes[idx];
        out = o.res;
        ocls = o.cls;
      }
      const tgt = r.target == null ? "—" : r.target;
      return `<tr><td>${(r.time || "").slice(11, 16)}</td><td>${stageLabel}</td><td class="${dcls}">${r.dir} ${r.level}</td><td>${r.opt}</td><td>${r.entry} / ${r.stop} / ${tgt}</td><td class="${ocls}">${out}</td></tr>`;
    })
    .join("");

  const summary = `${confirms.length} trade${confirms.length === 1 ? "" : "s"} · ${wins} win${wins === 1 ? "" : "s"} · net ${net >= 0 ? "+" : ""}${net} pts`;

  return page(
    `<h1>15-min Live Feed</h1><p class="sub">${date} — exactly what the runner sent to Telegram. Auto-refreshes every 30s.</p>
    <p><span class="pill">${summary}</span></p>
    <table><tr><th>Time</th><th>Stage</th><th>Trade</th><th>Option</th><th>Entry / Stop / Tgt</th><th>Outcome</th></tr>${body}</table>
    <p class="foot">This mirrors the Telegram feed one-to-one (gated: closed-candle only, whipsaw + 30-min cooldown). The runner remains the source of truth.</p>`,
  );
}
