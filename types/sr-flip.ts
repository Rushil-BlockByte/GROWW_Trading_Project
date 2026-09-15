import type { UnderlyingSymbol } from "@/types/market";

/** A single OHLC candle used for level detection and flip evaluation. */
export type LevelCandle = {
  startTime: string;
  high: number;
  low: number;
  close: number;
};

export type SwingType = "HIGH" | "LOW";

export type SrSwing = {
  price: number;
  index: number;
  type: SwingType;
};

/** A horizontal support/resistance level: a price where many swing reversals cluster. */
export type SrLevel = {
  price: number;
  touches: number;
  firstIndex: number;
  lastIndex: number;
};

/** A level classified relative to a reference (current) price. */
export type SrLevelContext = SrLevel & {
  role: "SUPPORT" | "RESISTANCE";
  distance: number; // signed points from the reference price
};

export type FlipDirection = "LONG" | "SHORT" | "NO TRADE";

/**
 * Lifecycle of a break-and-retest flip:
 * - NONE: no recent break of a strong level
 * - AWAITING_RETEST: a level broke; price has not yet returned to it
 * - CONFIRMED: price is retesting the broken (flipped) level now — the tradeable event
 * - INVALIDATED: price broke back through the level, cancelling the flip
 */
export type FlipState = "NONE" | "AWAITING_RETEST" | "CONFIRMED" | "INVALIDATED";

/** A completed flip trade produced by the backtest core. */
export type FlipTrade = {
  level: number;
  direction: "LONG" | "SHORT";
  breakIndex: number;
  retestIndex: number;
  entry: number;
  stop: number;
  target: number;
  outcome: "TARGET" | "STOP" | "TIME";
  exit: number;
  pnl: number;
};

export type FlipPlan = {
  level: number;
  entry: number;
  stop: number;
  target: number; // first target — bank a partial here
  trail: number; // trail the runner by this many points after the first target
  riskReward: string;
};

/** The live S/R flip evaluation attached to a market snapshot. */
export type SrFlipEvaluation = {
  name: string;
  version: string;
  underlying: UnderlyingSymbol;
  referencePrice: number;
  vix: number | null;
  vixRegime: string;
  direction: FlipDirection;
  state: FlipState;
  quality: "NO SETUP" | "WATCH" | "READY";
  nearestSupport: SrLevelContext | null;
  nearestResistance: SrLevelContext | null;
  supports: SrLevelContext[];
  resistances: SrLevelContext[];
  plan: FlipPlan | null;
  reasons: string[];
  risks: string[];
  liveOrdersEnabled: false;
  /** True when the session range has exceeded the VIX expectation — a trend/gap day. */
  trendRisk: boolean;
  /** Where the levels came from: the day's anchor and the 5-year history span. */
  levelSource?: SrLevelSource;
};

/** Provenance for the fixed daily level set (5-year backtested, anchored once). */
export type SrLevelSource = {
  anchor: number | null;
  anchorType: "open" | "prevClose" | null;
  anchorDate: string | null;
  historyStart: string | null;
  historyEnd: string | null;
  historyYears: number | null;
  barCount: number | null;
  computedAt: string | null;
  stale: boolean;
};
