import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_CONFIGURATION } from "../lib/risk/defaults";
import {
  calculatePaperJournalSummary,
  canCreatePaperTrade,
  closePaperTrade,
  createJournalNoteFromSnapshot,
  createPaperTradeFromSnapshot,
  parsePaperJournalEntries,
  serializePaperJournalEntries,
} from "../lib/paper-trading/journal";
import { createInitialMarketSnapshot } from "../lib/simulation/market-snapshot";
import type { SimulatedMarketSnapshot } from "../types/simulation";

const NOW = "2026-09-01T04:30:00.000Z";

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

describe("paper-trade journal", () => {
  it("blocks paper-trade capture when strategy setup is not confirmed", () => {
    const guard = canCreatePaperTrade(createInitialMarketSnapshot());

    expect(guard.allowed).toBe(false);
    expect(guard.reason).toBe("Strategy setup is not confirmed.");
  });

  it("blocks paper-trade capture until a closed 1-minute candle is ready", () => {
    const snapshot = confirmedSnapshot();
    const guard = canCreatePaperTrade({
      ...snapshot,
      phase2: {
        ...snapshot.phase2,
        candleConfirmation: {
          ...snapshot.phase2.candleConfirmation,
          decisionReady: false,
          message: "Wait for the first 1-minute candle to close before taking a paper trade.",
        },
      },
    });

    expect(guard.allowed).toBe(false);
    expect(guard.reason).toBe(
      "Wait for the first 1-minute candle to close before taking a paper trade.",
    );
  });

  it("creates a journal note for any scanner state", () => {
    const entry = createJournalNoteFromSnapshot({
      id: "note-1",
      now: NOW,
      notes: "  Waited for candle close.  ",
      snapshot: createInitialMarketSnapshot(),
    });

    expect(entry.type).toBe("NOTE");
    expect(entry.status).toBe("NOTE");
    expect(entry.notes).toBe("Waited for candle close.");
    expect(entry.quantity).toBe(0);
  });

  it("creates a paper trade from a confirmed strategy setup", () => {
    const entry = createPaperTradeFromSnapshot({
      id: "trade-1",
      now: NOW,
      notes: "Confirmed breakout paper capture.",
      snapshot: confirmedSnapshot(),
      risk: {
        ...DEFAULT_RISK_CONFIGURATION,
        tradingCapital: "100000",
        riskPerTradePercent: "2",
      },
    });

    expect(entry.type).toBe("PAPER_TRADE");
    expect(entry.status).toBe("OPEN");
    expect(entry.optionSide).toBe("CE");
    expect(entry.tradeSide).toBe("LONG_CALL");
    expect(entry.entryPrice).toBe("100.00");
    expect(entry.stopPrice).toBe("80.00");
    expect(entry.quantity).toBe(75);
    expect(entry.lots).toBe(1);
    expect(entry.ruleViolations).toEqual([]);
  });

  it("throws instead of creating a paper trade from an unconfirmed setup", () => {
    expect(() =>
      createPaperTradeFromSnapshot({
        id: "trade-2",
        now: NOW,
        notes: "",
        snapshot: createInitialMarketSnapshot(),
      }),
    ).toThrow("Strategy setup is not confirmed.");
  });

  it("closes an open paper trade and calculates realized P&L", () => {
    const entry = createPaperTradeFromSnapshot({
      id: "trade-3",
      now: NOW,
      notes: "",
      snapshot: confirmedSnapshot(),
      risk: {
        ...DEFAULT_RISK_CONFIGURATION,
        tradingCapital: "100000",
        riskPerTradePercent: "2",
      },
    });
    const closed = closePaperTrade({
      entry,
      exitPrice: "110",
      now: "2026-09-01T05:00:00.000Z",
    });

    expect(closed.status).toBe("CLOSED");
    expect(closed.realizedPnl).toBe("750.00");
    expect(closed.unrealizedPnl).toBe("0.00");
  });

  it("summarizes saved notes, trades, and P&L", () => {
    const note = createJournalNoteFromSnapshot({
      id: "note-2",
      now: NOW,
      notes: "No trade.",
      snapshot: createInitialMarketSnapshot(),
    });
    const trade = createPaperTradeFromSnapshot({
      id: "trade-4",
      now: NOW,
      notes: "",
      snapshot: confirmedSnapshot(),
      risk: {
        ...DEFAULT_RISK_CONFIGURATION,
        tradingCapital: "100000",
        riskPerTradePercent: "2",
      },
    });
    const closedTrade = closePaperTrade({
      entry: trade,
      exitPrice: "95",
      now: "2026-09-01T05:00:00.000Z",
    });

    expect(calculatePaperJournalSummary([note, closedTrade])).toMatchObject({
      totalEntries: 2,
      notes: 1,
      openTrades: 0,
      closedTrades: 1,
      realizedPnl: "-375.00",
      unrealizedPnl: "0.00",
    });
  });

  it("parses stored entries defensively", () => {
    const note = createJournalNoteFromSnapshot({
      id: "note-3",
      now: NOW,
      notes: "Stored.",
      snapshot: createInitialMarketSnapshot(),
    });

    expect(parsePaperJournalEntries(serializePaperJournalEntries([note]))).toHaveLength(1);
    expect(parsePaperJournalEntries("{bad json")).toEqual([]);
  });
});
