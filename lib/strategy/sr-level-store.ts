import fs from "node:fs";
import path from "node:path";
import type { UnderlyingSymbol } from "@/types/market";
import type { LevelCandle } from "@/types/sr-flip";

/**
 * On-disk store for the S/R level engine. Two artifacts, both under `data/`:
 *
 * - `sr-5min-cache.json`: the raw 5-minute history the levels are built from.
 *   Fetched at most once per Kolkata day (5 years is ~92k bars / ~22 requests),
 *   then reused so the daily "compute once" stays cheap. Levels themselves are
 *   rebuilt from these bars with the real `buildLevels`, so the algorithm lives
 *   in one place.
 * - `sr-anchor.json`: the day's anchor (the open OR yesterday's close) that the
 *   user provides each morning. Levels are classified into support/resistance
 *   around this anchor for the day's map.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const RAW_CACHE_PATH = path.join(DATA_DIR, "sr-5min-cache.json");
const ANCHOR_PATH = path.join(DATA_DIR, "sr-anchor.json");

export type SrRawBarCache = {
  asOfDate: string; // Kolkata date the bars were fetched for
  fetchedAt: string; // ISO timestamp
  historyStart: string; // ISO of the first bar
  historyEnd: string; // ISO of the last bar
  barsByUnderlying: Partial<Record<UnderlyingSymbol, LevelCandle[]>>;
};

export type SrAnchorType = "open" | "prevClose";

export type SrDayAnchor = {
  date: string; // Kolkata date this anchor applies to
  anchor: number;
  type: SrAnchorType;
};

function ensureDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    // best-effort; write will surface a real failure
  }
}

export function readSrRawBarCache(): SrRawBarCache | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(RAW_CACHE_PATH, "utf8")) as SrRawBarCache;

    if (!parsed || typeof parsed.asOfDate !== "string" || typeof parsed.barsByUnderlying !== "object") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function writeSrRawBarCache(cache: SrRawBarCache): void {
  ensureDataDir();
  fs.writeFileSync(RAW_CACHE_PATH, JSON.stringify(cache));
}

export function readSrDayAnchor(): SrDayAnchor | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(ANCHOR_PATH, "utf8")) as SrDayAnchor;

    if (
      !parsed ||
      typeof parsed.anchor !== "number" ||
      !Number.isFinite(parsed.anchor) ||
      (parsed.type !== "open" && parsed.type !== "prevClose") ||
      typeof parsed.date !== "string"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function writeSrDayAnchor(anchor: SrDayAnchor): void {
  ensureDataDir();
  fs.writeFileSync(ANCHOR_PATH, JSON.stringify(anchor, null, 2));
}

/** The cache is usable for `today` only if it was fetched for the same day. */
export function isSrRawBarCacheFresh(cache: SrRawBarCache | null, today: string): cache is SrRawBarCache {
  return Boolean(cache && cache.asOfDate === today);
}
