import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_CONFIGURATION } from "../lib/risk/defaults";
import {
  createJournalNoteFromSnapshot,
  createPaperTradeFromSnapshot,
} from "../lib/paper-trading/journal";
import {
  canPersistStructuredPaperTrade,
  paperJournalEntryPersistenceData,
} from "../lib/persistence/paper-journal-store";
import {
  backtestRecordFromResult,
  isBacktestResult,
  isMultiDayBacktestResult,
} from "../lib/persistence/backtest-store";
import {
  runSampleMultiDayVwapBreakoutBacktest,
  runSampleVwapBreakoutBacktest,
} from "../lib/backtesting/vwap-breakout-backtest";
import { createInitialMarketSnapshot } from "../lib/simulation/market-snapshot";
import type { SimulatedMarketSnapshot } from "../types/simulation";

const NOW = "2026-09-01T04:30:00.000Z";
const REPLAY_TEST_TIMEOUT_MS = 15_000;

function confirmedSnapshot(): SimulatedMarketSnapshot {
  const snapshot = createInitialMarketSnapshot();

  return {
    ...snapshot,
    signal: {
      ...snapshot.signal,
      direction: "BULLISH",
      state: "CONFIRMED",
      suggestedOption: "NIFTY 2026-09-03 25200 CE",
    },
    phase6: {
      ...snapshot.phase6,
      bias: "BULLISH",
      direction: "BULLISH",
      state: "CONFIRMED",
      selectedContract: {
        side: "CE",
        strike: 25200,
        label: "NIFTY 2026-09-03 25200 CE",
        ltp: "100.00",
        status: "TRADABLE",
        reason: "Nearest liquid contract.",
      },
      entryPlan: {
        entryTrigger: "25215.00",
        invalidation: "25185.00",
        targetOne: "25275.00",
        targetTwo: "25320.00",
        riskReward: "2.00",
      },
      liveOrdersEnabled: false,
    },
  };
}

describe("persistence mapping", () => {
  it("maps journal notes without requiring structured trade fields", () => {
    const entry = createJournalNoteFromSnapshot({
      id: "note-persist-1",
      now: NOW,
      notes: "Waited for a cleaner candle.",
      snapshot: createInitialMarketSnapshot(),
    });
    const data = paperJournalEntryPersistenceData({
      entry,
      paperTradeId: null,
      userId: "user-1",
    });

    expect(canPersistStructuredPaperTrade(entry)).toBe(false);
    expect(data.type).toBe("NOTE");
    expect(data.paperTradeId).toBeNull();
    expect(data.notes).toBe("Waited for a cleaner candle.");
    expect(data.snapshot).not.toHaveProperty("apiKey");
    expect(data.snapshot).not.toHaveProperty("accessToken");
  });

  it("maps paper trades with database-safe ownership and price fields", () => {
    const entry = createPaperTradeFromSnapshot({
      id: "trade-persist-1",
      now: NOW,
      notes: "Confirmed breakout.",
      snapshot: confirmedSnapshot(),
      risk: {
        ...DEFAULT_RISK_CONFIGURATION,
        tradingCapital: "100000",
        riskPerTradePercent: "2",
      },
    });
    const data = paperJournalEntryPersistenceData({
      entry,
      paperTradeId: "paper-trade-1",
      userId: "user-1",
    });

    expect(canPersistStructuredPaperTrade(entry)).toBe(true);
    expect(data.type).toBe("PAPER_TRADE");
    expect(data.paperTradeId).toBe("paper-trade-1");
    expect(data.entryPrice).toBe("100.00");
    expect(data.stopPrice).toBe("80.00");
    expect(data.quantity).toBe(75);
  });

  it("recognizes single-day and multi-day backtest payloads", () => {
    const single = runSampleVwapBreakoutBacktest();
    const multi = runSampleMultiDayVwapBreakoutBacktest();
    const singleRecord = backtestRecordFromResult(single, new Date(NOW));
    const multiRecord = backtestRecordFromResult(multi, new Date(NOW));

    expect(isBacktestResult(single)).toBe(true);
    expect(isMultiDayBacktestResult(single)).toBe(false);
    expect(isMultiDayBacktestResult(multi)).toBe(true);
    expect(singleRecord.kind).toBe("single_day");
    expect(multiRecord.kind).toBe("multi_day");
    expect(singleRecord.liveOrdersEnabled).toBe(false);
    expect(multiRecord.liveOrdersEnabled).toBe(false);
    expect(isBacktestResult({ metadata: { id: "bad" } })).toBe(false);
  }, REPLAY_TEST_TIMEOUT_MS);
});
