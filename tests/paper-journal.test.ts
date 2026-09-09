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
      direction: "LONG",
      state: "CONFIRMED",
      quality: "READY",
      plan: {
        level: 25200,
        entry: 25200,
        stop: 25170,
        target: 25250,
        trail: 25,
        riskReward: "1.67",
      },
      liveOrdersEnabled: false,
    },
  };
}

describe("paper-trade journal", () => {
  it("blocks paper-trade capture when strategy setup is not confirmed", () => {
    const guard = canCreatePaperTrade(createInitialMarketSnapshot());

    expect(guard.allowed).toBe(false);
    expect(guard.reason).toBe("No confirmed break-and-retest setup.");
  });

  it("blocks paper-trade capture until a closed 1-minute candle is ready", () => {
    const snapshot = confirmedSnapshot();
    const guard = canCreatePaperTrade({
      ...snapshot,
      phase2: {
        ...snapshot.phase2,
        candleConfirmation: {
          status: "BUILDING",
          currentCandleStart: "2026-09-01T04:30:00.000Z",
          currentCandleEnd: "2026-09-01T04:31:00.000Z",
          lastCompletedCandleStart: null,
          lastCompletedCandleEnd: null,
          nextConfirmationTime: "2026-09-01T04:31:00.000Z",
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

  it("blocks paper-trade capture when candle confirmation is missing", () => {
    const snapshot = confirmedSnapshot();
    const guard = canCreatePaperTrade({
      ...snapshot,
      phase2: {
        ...snapshot.phase2,
        candleConfirmation: undefined,
      },
    });

    expect(guard.allowed).toBe(false);
    expect(guard.reason).toBe(
      "Restart the stream once so candle-close confirmation is available.",
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
        riskPerTradePercent: "3",
      },
    });

    expect(entry.type).toBe("PAPER_TRADE");
    expect(entry.status).toBe("OPEN");
    expect(entry.optionSide).toBe("CE");
    expect(entry.tradeSide).toBe("LONG_CALL");
    expect(entry.entryPrice).toBe("25200.00");
    expect(entry.stopPrice).toBe("25170.00");
    expect(entry.targetOne).toBe("25250.00");
    expect(entry.targetTwo).toBeNull();
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
    ).toThrow("No confirmed break-and-retest setup.");
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
        riskPerTradePercent: "3",
      },
    });
    const closed = closePaperTrade({
      entry,
      exitPrice: "25250",
      now: "2026-09-01T05:00:00.000Z",
    });

    expect(closed.status).toBe("CLOSED");
    expect(closed.realizedPnl).toBe("3750.00");
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
        riskPerTradePercent: "3",
      },
    });
    const closedTrade = closePaperTrade({
      entry: trade,
      exitPrice: "25150",
      now: "2026-09-01T05:00:00.000Z",
    });

    expect(calculatePaperJournalSummary([note, closedTrade])).toMatchObject({
      totalEntries: 2,
      notes: 1,
      openTrades: 0,
      closedTrades: 1,
      realizedPnl: "-3750.00",
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
