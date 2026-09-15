import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  isSrRawBarCacheFresh,
  readSrDayAnchor,
  readSrRawBarCache,
  writeSrDayAnchor,
  writeSrRawBarCache,
  type SrRawBarCache,
} from "../lib/strategy/sr-level-store";

const DATA_DIR = path.join(process.cwd(), "data");
const RAW_PATH = path.join(DATA_DIR, "sr-5min-cache.json");
const ANCHOR_PATH = path.join(DATA_DIR, "sr-anchor.json");

function snapshot(file: string) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}
const rawBefore = snapshot(RAW_PATH);
const anchorBefore = snapshot(ANCHOR_PATH);

afterEach(() => {
  for (const [file, before] of [
    [RAW_PATH, rawBefore],
    [ANCHOR_PATH, anchorBefore],
  ] as const) {
    if (before === null) {
      if (fs.existsSync(file)) fs.rmSync(file);
    } else {
      fs.writeFileSync(file, before);
    }
  }
});

describe("sr level store", () => {
  it("round-trips the raw bar cache and reports freshness by date", () => {
    const cache: SrRawBarCache = {
      asOfDate: "2026-09-10",
      fetchedAt: "2026-09-10T03:45:00.000Z",
      historyStart: "2021-09-13T03:45:00.000Z",
      historyEnd: "2026-09-10T09:55:00.000Z",
      barsByUnderlying: {
        NIFTY: [{ startTime: "2026-09-10T03:45:00.000Z", high: 23450, low: 23440, close: 23446 }],
      },
    };
    writeSrRawBarCache(cache);
    const read = readSrRawBarCache();

    expect(read?.asOfDate).toBe("2026-09-10");
    expect(read?.barsByUnderlying.NIFTY).toHaveLength(1);
    expect(isSrRawBarCacheFresh(read, "2026-09-10")).toBe(true);
    expect(isSrRawBarCacheFresh(read, "2026-09-11")).toBe(false);
    expect(isSrRawBarCacheFresh(null, "2026-09-10")).toBe(false);
  });

  it("round-trips the day anchor and rejects malformed anchors", () => {
    writeSrDayAnchor({ date: "2026-09-10", anchor: 23446.5, type: "open" });
    expect(readSrDayAnchor()).toEqual({ date: "2026-09-10", anchor: 23446.5, type: "open" });

    fs.writeFileSync(ANCHOR_PATH, JSON.stringify({ date: "2026-09-10", anchor: "oops", type: "open" }));
    expect(readSrDayAnchor()).toBeNull();

    fs.writeFileSync(ANCHOR_PATH, JSON.stringify({ date: "2026-09-10", anchor: 23446.5, type: "sideways" }));
    expect(readSrDayAnchor()).toBeNull();
  });
});
