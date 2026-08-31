import type {
  DataQualityStatus,
  MarketRegime,
  SignalLifecycleState,
  SignalQuality,
  UnderlyingSymbol,
} from "@/types/market";
import type { OptionSide } from "@/types/options";

export type StrategyBias = "BULLISH" | "BEARISH" | "NEUTRAL";

export type StrategyDirection = "BULLISH" | "BEARISH" | "NO TRADE";

export type StrategyComponentKey =
  | "trend"
  | "vwap"
  | "breakout"
  | "volume"
  | "momentum"
  | "option_chain"
  | "liquidity"
  | "risk_reward";

export type StrategyComponentStatus = "PASS" | "PARTIAL" | "FAIL" | "PENDING";

export type StrategyComponentScore = {
  key: StrategyComponentKey;
  label: string;
  status: StrategyComponentStatus;
  points: number;
  maxPoints: number;
  detail: string;
};

export type StrategyWatchedLevel = {
  label: string;
  value: string;
  type: "support" | "resistance";
};

export type StrategySelectedContract = {
  side: OptionSide;
  strike: number;
  label: string;
  ltp: string;
  status: "TRADABLE" | "NOT_TRADABLE";
  reason: string;
};

export type StrategyEntryPlan = {
  entryTrigger: string;
  invalidation: string;
  targetOne: string;
  targetTwo: string;
  riskReward: string;
};

export type StrategyEvaluation = {
  id: string;
  name: string;
  version: string;
  underlying: UnderlyingSymbol;
  marketRegime: MarketRegime;
  dataQuality: DataQualityStatus;
  bias: StrategyBias;
  direction: StrategyDirection;
  state: SignalLifecycleState;
  score: number;
  quality: SignalQuality;
  components: StrategyComponentScore[];
  watchedLevel: StrategyWatchedLevel | null;
  selectedContract: StrategySelectedContract | null;
  entryPlan: StrategyEntryPlan | null;
  reasons: string[];
  risks: string[];
  liveOrdersEnabled: false;
};
