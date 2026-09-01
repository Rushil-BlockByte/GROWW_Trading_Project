import Decimal from "decimal.js";
import { DEFAULT_RISK_CONFIGURATION, type RiskConfiguration } from "@/lib/risk/defaults";
import { calculatePositionSize } from "@/lib/risk/position-sizing";
import {
  OPTION_TARGET_MAX_POINTS,
  OPTION_TARGET_MIN_POINTS,
} from "@/lib/trading/option-targets";
import type {
  PaperJournalEntry,
  PaperJournalSummary,
  PaperTradeGuard,
  PaperTradeSide,
} from "@/types/paper-trading";
import type { SimulatedMarketSnapshot } from "@/types/simulation";

export const PAPER_JOURNAL_STORAGE_KEY = "groww-paper-journal-v1";
export const PAPER_TRADE_LOT_SIZE = 75;
export const PAPER_OPTION_STOP_PERCENT = "20";
export const MAX_PAPER_JOURNAL_ENTRIES = 100;

function toDecimal(value: Decimal.Value) {
  return new Decimal(value);
}

function toFixed(value: Decimal.Value, places = 2) {
  return toDecimal(value).toFixed(places);
}

function sanitizeNotes(notes: string) {
  return notes.trim().slice(0, 4_000);
}

function tradeSideForOption(optionSide: PaperJournalEntry["optionSide"]): PaperTradeSide | null {
  if (optionSide === "CE") return "LONG_CALL";
  if (optionSide === "PE") return "LONG_PUT";

  return null;
}

function optionStopFromEntry(entryPrice: Decimal.Value) {
  const entry = toDecimal(entryPrice);

  return entry.minus(entry.mul(PAPER_OPTION_STOP_PERCENT).div(100));
}

function optionTargetFromEntry(entryPrice: Decimal.Value, points: number) {
  return toDecimal(entryPrice).plus(points);
}

function baseEntry({
  id,
  now,
  notes,
  snapshot,
}: {
  id: string;
  now: string;
  notes: string;
  snapshot: SimulatedMarketSnapshot;
}): Omit<
  PaperJournalEntry,
  | "type"
  | "status"
  | "optionSymbol"
  | "optionSide"
  | "tradeSide"
  | "strike"
  | "expiry"
  | "entryPrice"
  | "stopPrice"
  | "targetOne"
  | "targetTwo"
  | "quantity"
  | "lots"
> {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    signalId: snapshot.signal.id,
    strategyName: snapshot.phase6.name,
    strategyVersion: snapshot.phase6.version,
    underlying: snapshot.phase6.underlying,
    signalState: snapshot.phase6.state,
    bias: snapshot.phase6.bias,
    quality: snapshot.phase6.quality,
    score: snapshot.phase6.score,
    marketRegime: snapshot.phase6.marketRegime,
    notes: sanitizeNotes(notes),
    reasons: snapshot.phase6.reasons,
    risks: snapshot.phase6.risks,
    ruleViolations: [],
    realizedPnl: "0.00",
    unrealizedPnl: "0.00",
  };
}

export function canCreatePaperTrade(snapshot: SimulatedMarketSnapshot): PaperTradeGuard {
  const selectedContract = snapshot.phase6.selectedContract;
  const entryPlan = snapshot.phase6.entryPlan;

  if (snapshot.phase6.liveOrdersEnabled !== false) {
    return {
      allowed: false,
      reason: "Live order mode is not allowed for this journal action.",
    };
  }

  if (!snapshot.phase2.candleConfirmation.decisionReady) {
    return {
      allowed: false,
      reason:
        snapshot.phase2.candleConfirmation.message ||
        "Wait for the current 1-minute candle to close before taking a paper trade.",
    };
  }

  if (snapshot.phase6.state !== "CONFIRMED" || snapshot.phase6.direction === "NO TRADE") {
    return {
      allowed: false,
      reason: "Strategy setup is not confirmed.",
    };
  }

  if (!selectedContract) {
    return {
      allowed: false,
      reason: "No option contract is selected.",
    };
  }

  if (selectedContract.status !== "TRADABLE") {
    return {
      allowed: false,
      reason: "Selected option contract is not liquid enough.",
    };
  }

  if (!entryPlan) {
    return {
      allowed: false,
      reason: "Entry and risk plan is not available.",
    };
  }

  return {
    allowed: true,
    reason: "Confirmed paper setup.",
  };
}

export function createJournalNoteFromSnapshot({
  id,
  now,
  notes,
  snapshot,
}: {
  id: string;
  now: string;
  notes: string;
  snapshot: SimulatedMarketSnapshot;
}): PaperJournalEntry {
  return {
    ...baseEntry({ id, now, notes, snapshot }),
    type: "NOTE",
    status: "NOTE",
    optionSymbol: snapshot.phase6.selectedContract?.label ?? null,
    optionSide: snapshot.phase6.selectedContract?.side ?? null,
    tradeSide: tradeSideForOption(snapshot.phase6.selectedContract?.side ?? null),
    strike: snapshot.phase6.selectedContract?.strike ?? null,
    expiry: snapshot.phase5.expiry,
    entryPrice: null,
    stopPrice: null,
    targetOne: null,
    targetTwo: null,
    quantity: 0,
    lots: 0,
  };
}

export function createPaperTradeFromSnapshot({
  id,
  now,
  notes,
  snapshot,
  risk = DEFAULT_RISK_CONFIGURATION,
  lotSize = PAPER_TRADE_LOT_SIZE,
}: {
  id: string;
  now: string;
  notes: string;
  snapshot: SimulatedMarketSnapshot;
  risk?: RiskConfiguration;
  lotSize?: number;
}): PaperJournalEntry {
  const guard = canCreatePaperTrade(snapshot);

  if (!guard.allowed) {
    throw new Error(guard.reason);
  }

  const selectedContract = snapshot.phase6.selectedContract;

  if (!selectedContract) {
    throw new Error("No option contract is selected.");
  }

  const entryPrice = selectedContract.ltp;
  const stopPrice = optionStopFromEntry(entryPrice);
  const positionSize = calculatePositionSize({
    tradingCapital: risk.tradingCapital,
    riskPerTradePercent: risk.riskPerTradePercent,
    entryPrice,
    stopPrice,
    lotSize,
  });
  const ruleViolations = positionSize.canTrade ? [] : [positionSize.reason ?? "Position size blocked."];

  return {
    ...baseEntry({ id, now, notes, snapshot }),
    type: "PAPER_TRADE",
    status: "OPEN",
    optionSymbol: selectedContract.label,
    optionSide: selectedContract.side,
    tradeSide: tradeSideForOption(selectedContract.side),
    strike: selectedContract.strike,
    expiry: snapshot.phase5.expiry,
    entryPrice: toFixed(entryPrice),
    stopPrice: toFixed(stopPrice),
    targetOne: toFixed(optionTargetFromEntry(entryPrice, OPTION_TARGET_MIN_POINTS)),
    targetTwo: toFixed(optionTargetFromEntry(entryPrice, OPTION_TARGET_MAX_POINTS)),
    quantity: positionSize.quantity,
    lots: positionSize.lots,
    ruleViolations,
  };
}

export function closePaperTrade({
  entry,
  exitPrice,
  now,
}: {
  entry: PaperJournalEntry;
  exitPrice: Decimal.Value;
  now: string;
}): PaperJournalEntry {
  if (entry.type !== "PAPER_TRADE" || entry.status !== "OPEN") {
    return entry;
  }

  const entryPrice = toDecimal(entry.entryPrice ?? 0);
  const exit = toDecimal(exitPrice);
  const pnl = exit.minus(entryPrice).mul(entry.quantity);

  return {
    ...entry,
    status: "CLOSED",
    updatedAt: now,
    realizedPnl: pnl.toFixed(2),
    unrealizedPnl: "0.00",
  };
}

export function calculatePaperJournalSummary(entries: PaperJournalEntry[]): PaperJournalSummary {
  const realizedPnl = entries.reduce(
    (sum, entry) => sum.plus(entry.realizedPnl),
    new Decimal(0),
  );
  const unrealizedPnl = entries.reduce(
    (sum, entry) => sum.plus(entry.unrealizedPnl),
    new Decimal(0),
  );

  return {
    totalEntries: entries.length,
    notes: entries.filter((entry) => entry.type === "NOTE").length,
    openTrades: entries.filter((entry) => entry.status === "OPEN").length,
    closedTrades: entries.filter((entry) => entry.status === "CLOSED").length,
    ruleViolations: entries.reduce((sum, entry) => sum + entry.ruleViolations.length, 0),
    realizedPnl: realizedPnl.toFixed(2),
    unrealizedPnl: unrealizedPnl.toFixed(2),
  };
}

export function isPaperJournalEntry(value: unknown): value is PaperJournalEntry {
  if (!value || typeof value !== "object") return false;

  const entry = value as Partial<PaperJournalEntry>;

  return (
    typeof entry.id === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.updatedAt === "string" &&
    (entry.type === "NOTE" || entry.type === "PAPER_TRADE") &&
    typeof entry.notes === "string" &&
    Array.isArray(entry.reasons) &&
    Array.isArray(entry.risks) &&
    Array.isArray(entry.ruleViolations)
  );
}

export function parsePaperJournalEntries(contents: string | null): PaperJournalEntry[] {
  if (!contents) return [];

  try {
    const parsed = JSON.parse(contents) as unknown;

    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isPaperJournalEntry).slice(0, MAX_PAPER_JOURNAL_ENTRIES);
  } catch {
    return [];
  }
}

export function serializePaperJournalEntries(entries: PaperJournalEntry[]) {
  return JSON.stringify(entries.slice(0, MAX_PAPER_JOURNAL_ENTRIES));
}
