import type { SignalLifecycleState, SignalQuality } from "@/types/market";
import type { SimulatedSignal } from "@/types/simulation";
import type { SrFlipEvaluation } from "@/types/sr-flip";

function directionForSignal(evaluation: SrFlipEvaluation): SimulatedSignal["direction"] {
  if (evaluation.direction === "LONG") return "BULLISH";
  if (evaluation.direction === "SHORT") return "BEARISH";

  return "NO TRADE";
}

function qualityForSignal(evaluation: SrFlipEvaluation): SignalQuality {
  if (evaluation.quality === "READY") return "STRONG";
  if (evaluation.quality === "WATCH") return "WATCH";

  return "NO SETUP";
}

function scoreForSignal(evaluation: SrFlipEvaluation): number {
  if (evaluation.state === "CONFIRMED") return 85;
  if (evaluation.state === "AWAITING_RETEST") return 60;

  return 0;
}

function lifecycleForSignal(evaluation: SrFlipEvaluation): SignalLifecycleState {
  if (evaluation.state === "CONFIRMED") return "CONFIRMED";
  if (evaluation.state === "INVALIDATED") return "INVALIDATED";

  return "FORMING";
}

/** Map an S/R flip evaluation to the compact snapshot `signal` summary. */
export function srFlipSignalSummary(evaluation: SrFlipEvaluation): SimulatedSignal {
  const { plan } = evaluation;

  return {
    id: `SR_FLIP-${evaluation.underlying}`,
    underlying: evaluation.underlying,
    direction: directionForSignal(evaluation),
    setupName: evaluation.name,
    score: scoreForSignal(evaluation),
    quality: qualityForSignal(evaluation),
    suggestedOption: plan ? `${evaluation.underlying} ${evaluation.direction === "LONG" ? "CE" : "PE"} (level ${plan.level})` : undefined,
    entryRange: plan ? `Trigger ${plan.entry}` : undefined,
    underlyingInvalidation: plan ? plan.stop : undefined,
    optionStopEstimate: plan ? plan.stop : undefined,
    targetOne: plan ? plan.target : undefined,
    targetTwo: undefined,
    riskReward: plan ? plan.riskReward : undefined,
    reasons: evaluation.reasons,
    risks: evaluation.risks,
    state: lifecycleForSignal(evaluation),
  };
}
