import type {
  DataQualityStatus,
  MarketRegime,
  SignalLifecycleState,
  SignalQuality,
  UnderlyingSymbol,
} from "@/types/market";
import type { MarketCandleData } from "@/types/candles";
import type { IndicatorContext } from "@/types/indicators";
import type { InstrumentKind } from "@/types/instruments";
import type { OptionChainContext } from "@/types/options";
import type { SrFlipEvaluation } from "@/types/sr-flip";
import type { LevelAlert } from "@/lib/strategy/level-alerts";

export type SimulatedUnderlying = {
  symbol: UnderlyingSymbol;
  label: string;
  lastPrice: number | null;
  change: number | null;
  changePercent: number | null;
  vwap: number | null;
  vwapDistance: number | null;
  trend: "Bullish" | "Bearish" | "Flat";
  volumeRelative: number | null;
  openInterest: number | null;
  oiChange: number | null;
  regime: MarketRegime;
  dataQuality: DataQualityStatus;
  support: number | null;
  resistance: number | null;
};

export type SimulatedOptionLeg = {
  ltp: number;
  volume: number;
  openInterest: number;
  oiChange: number;
  bid: number;
  ask: number;
  spreadPercent: number;
  lotSize?: number;
};

export type SimulatedOptionRow = {
  strike: number;
  isAtm: boolean;
  call: SimulatedOptionLeg;
  put: SimulatedOptionLeg;
};

export type SimulatedSignal = {
  id: string;
  underlying: UnderlyingSymbol;
  direction: "BULLISH" | "BEARISH" | "NO TRADE";
  setupName: string;
  score: number;
  quality: SignalQuality;
  suggestedOption?: string;
  entryRange?: string;
  underlyingInvalidation?: number;
  optionStopEstimate?: number;
  targetOne?: number;
  targetTwo?: number;
  riskReward?: string;
  reasons: string[];
  risks: string[];
  state: SignalLifecycleState;
};

export type SimulatedSystemHealth = {
  websocket: "NOT_CONNECTED" | "CONNECTED" | "RECONNECTING" | "DISCONNECTED";
  lastTickSecondsAgo: number;
  subscriptions: number;
  rejectedSubscriptions: number;
  dataQuality: DataQualityStatus;
  signalEngine: "PARKED" | "RUNNING" | "STOPPED";
  database: "CONFIGURED" | "NOT_CONFIGURED";
  mode: "simulation" | "live";
};

export type SimulatedMarketSnapshot = {
  generatedAt: string;
  underlyings: SimulatedUnderlying[];
  optionChain: SimulatedOptionRow[];
  optionChains?: Partial<Record<UnderlyingSymbol, SimulatedOptionRow[]>>;
  signal: SimulatedSignal;
  health: SimulatedSystemHealth;
  phase2: SimulatedPhase2Pipeline;
  phase4: IndicatorContext;
  phase4ByUnderlying?: Partial<Record<UnderlyingSymbol, IndicatorContext>>;
  phase5: OptionChainContext;
  phase5ByUnderlying?: Partial<Record<UnderlyingSymbol, OptionChainContext>>;
  phase6: SrFlipEvaluation;
  /** Staged per-level alert (NEAR / BROKEN / RETEST_CONFIRMED) on the 5-min feed. */
  levelAlert?: LevelAlert;
};

export type CandleConfirmation = {
  status: "WAITING_FOR_TICK" | "BUILDING" | "CONFIRMED";
  currentCandleStart: string | null;
  currentCandleEnd: string | null;
  lastCompletedCandleStart: string | null;
  lastCompletedCandleEnd: string | null;
  nextConfirmationTime: string | null;
  decisionReady: boolean;
  message: string;
};

export type IndicatorSourceInstrument = {
  underlying: UnderlyingSymbol;
  exchange: string;
  tradingsymbol: string;
  instrumentToken: number;
  kind: Extract<InstrumentKind, "INDEX" | "FUTURE">;
  expiry?: string;
};

export type SimulatedPhase2Pipeline = {
  instrumentMasterCount: number;
  selectedUnderlying: UnderlyingSymbol;
  selectedExpiry: string;
  atmStrike: string;
  optionUniverseCount: number;
  missingContracts: number;
  subscriptionCount: number;
  rejectedSubscriptions: number;
  trackedInstruments: number;
  dataQuality: DataQualityStatus;
  latestTickToken?: number;
  indicatorSource?: IndicatorSourceInstrument;
  indicatorSources?: Partial<Record<UnderlyingSymbol, IndicatorSourceInstrument>>;
  activeCandles: MarketCandleData[];
  completedCandleCount: number;
  candleConfirmation?: CandleConfirmation;
  candleConfirmations?: Partial<Record<UnderlyingSymbol, CandleConfirmation>>;
};
