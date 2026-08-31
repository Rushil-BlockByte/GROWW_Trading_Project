import type { SignalLifecycleState, SignalQuality, UnderlyingSymbol } from "@/types/market";
import type { OptionSide } from "@/types/options";
import type { StrategyBias } from "@/types/strategy";

export type PaperJournalEntryType = "NOTE" | "PAPER_TRADE";

export type PaperTradeSide = "LONG_CALL" | "LONG_PUT";

export type PaperTradeJournalStatus = "NOTE" | "OPEN" | "CLOSED" | "CANCELLED";

export type PaperTradeGuard = {
  allowed: boolean;
  reason: string;
};

export type PaperJournalEntry = {
  id: string;
  type: PaperJournalEntryType;
  status: PaperTradeJournalStatus;
  createdAt: string;
  updatedAt: string;
  signalId: string;
  strategyName: string;
  strategyVersion: string;
  underlying: UnderlyingSymbol;
  signalState: SignalLifecycleState;
  bias: StrategyBias;
  quality: SignalQuality;
  score: number;
  marketRegime: string;
  optionSymbol: string | null;
  optionSide: OptionSide | null;
  tradeSide: PaperTradeSide | null;
  strike: number | null;
  expiry: string | null;
  entryPrice: string | null;
  stopPrice: string | null;
  targetOne: string | null;
  targetTwo: string | null;
  quantity: number;
  lots: number;
  notes: string;
  reasons: string[];
  risks: string[];
  ruleViolations: string[];
  realizedPnl: string;
  unrealizedPnl: string;
};

export type PaperJournalSummary = {
  totalEntries: number;
  notes: number;
  openTrades: number;
  closedTrades: number;
  ruleViolations: number;
  realizedPnl: string;
  unrealizedPnl: string;
};
