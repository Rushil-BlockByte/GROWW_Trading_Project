import Decimal from "decimal.js";
import type {
  OptionChainContext,
  OptionChainRowContext,
  OptionLegLiquidity,
  OptionSide,
} from "@/types/options";
import type {
  OptionMoneyness,
  StrategyBias,
  StrategyContractCandidate,
  StrategySelectedContract,
} from "@/types/strategy";

/**
 * Contract selection ranks the tradable options on the setup side and picks the
 * best directional buy. It replaces the old "nearest strike to spot" heuristic.
 *
 * Ranking blends three transparent factors:
 *   1. Moneyness fit  - prefer contracts near the ideal delta band.
 *   2. Liquidity      - prefer higher volume and open interest.
 *   3. Spread         - prefer tighter bid/ask spreads.
 *
 * The delta figure is an ESTIMATE. Kite candle/quote data does not include
 * implied volatility or time value, so a real Black-Scholes delta cannot be
 * computed here. We approximate it from moneyness measured in strike steps,
 * which is good enough to keep selection inside a near-the-money band and to
 * rank contracts consistently. It is always labelled as an estimate.
 */

// Ideal directional-buy delta band. Near 0.50 (ATM) gives enough directional
// move without paying deep-ITM premium or buying low-delta OTM lottery tickets.
export const IDEAL_DELTA = 0.5;
export const DELTA_BAND_MIN = 0.4;
export const DELTA_BAND_MAX = 0.6;

// Rough delta change per one strike step away from at-the-money for near-expiry
// index options. Only an approximation; see the note above.
const DELTA_PER_STRIKE_STEP = 0.06;

// Ranking weights (must sum to 1).
const WEIGHT_DELTA = 0.45;
const WEIGHT_LIQUIDITY = 0.35;
const WEIGHT_SPREAD = 0.2;

export type ContractRanking = {
  side: OptionSide;
  strike: number;
  label: string;
  ltp: string;
  status: "TRADABLE" | "NOT_TRADABLE";
  moneyness: OptionMoneyness;
  estimatedDelta: string;
  selectionScore: number;
  distanceFromSpot: string;
  withinIdealBand: boolean;
  reason: string;
};

function toDecimal(value: Decimal.Value) {
  return new Decimal(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function legForSide(row: OptionChainRowContext, side: OptionSide): OptionLegLiquidity {
  return side === "CE" ? row.call : row.put;
}

/**
 * Infer the strike spacing from the sorted strikes (e.g. 50 for NIFTY, 100 for
 * BANKNIFTY). Uses the smallest positive gap so an occasional missing strike
 * does not inflate the step.
 */
export function inferStrikeStep(strikes: number[]): number {
  const sorted = [...new Set(strikes)].sort((a, b) => a - b);
  let step = Infinity;

  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index] - sorted[index - 1];

    if (gap > 0 && gap < step) {
      step = gap;
    }
  }

  return Number.isFinite(step) ? step : 0;
}

/**
 * Estimate option delta from how many strike steps the contract sits away from
 * the spot price. ATM ~= 0.50; each step toward ITM raises it, each step toward
 * OTM lowers it. Clamped to a sane open interval. This is an estimate only.
 */
export function estimateDelta({
  side,
  strike,
  spot,
  strikeStep,
}: {
  side: OptionSide;
  strike: number;
  spot: number;
  strikeStep: number;
}): number {
  if (strikeStep <= 0) return IDEAL_DELTA;

  // Positive = in the money for the given side.
  const stepsItm =
    side === "CE" ? (spot - strike) / strikeStep : (strike - spot) / strikeStep;

  return clamp(IDEAL_DELTA + stepsItm * DELTA_PER_STRIKE_STEP, 0.02, 0.98);
}

function moneynessLabel({
  side,
  strike,
  spot,
  strikeStep,
}: {
  side: OptionSide;
  strike: number;
  spot: number;
  strikeStep: number;
}): OptionMoneyness {
  const halfStep = strikeStep > 0 ? strikeStep / 2 : 0;

  if (Math.abs(strike - spot) <= halfStep) return "ATM";

  if (side === "CE") return strike < spot ? "ITM" : "OTM";

  return strike > spot ? "ITM" : "OTM";
}

function deltaScore(estimatedDelta: number): number {
  // 100 at the ideal delta, 50 at the band edges, 0 at 0.30/0.70.
  return clamp(100 - Math.abs(estimatedDelta - IDEAL_DELTA) * 500, 0, 100);
}

function spreadScore(spreadPercent: number): number {
  // 100 at a zero spread, 0 at a 5% spread.
  return clamp(100 - spreadPercent * 20, 0, 100);
}

function liquidityScore({
  volume,
  openInterest,
  maxVolume,
  maxOpenInterest,
}: {
  volume: number;
  openInterest: number;
  maxVolume: number;
  maxOpenInterest: number;
}): number {
  const volumeShare = maxVolume > 0 ? (volume / maxVolume) * 100 : 0;
  const oiShare = maxOpenInterest > 0 ? (openInterest / maxOpenInterest) * 100 : 0;

  return clamp(volumeShare * 0.5 + oiShare * 0.5, 0, 100);
}

function rankReason({
  moneyness,
  estimatedDelta,
  withinIdealBand,
}: {
  moneyness: OptionMoneyness;
  estimatedDelta: number;
  withinIdealBand: boolean;
}): string {
  const deltaText = `~${estimatedDelta.toFixed(2)} delta (est.)`;

  if (withinIdealBand) {
    return `${moneyness} contract, ${deltaText}, in the ideal band with the best liquidity and spread.`;
  }

  return `${moneyness} contract, ${deltaText}, outside the ideal ${DELTA_BAND_MIN.toFixed(
    2,
  )}-${DELTA_BAND_MAX.toFixed(2)} band; best available liquid contract.`;
}

/**
 * Rank all tradable contracts on the setup side, best first.
 */
export function rankStrategyContracts(
  optionContext: OptionChainContext,
  bias: StrategyBias,
): ContractRanking[] {
  if (bias === "NEUTRAL") return [];

  const side: OptionSide = bias === "BULLISH" ? "CE" : "PE";
  const spot = toDecimal(optionContext.underlyingLastPrice).toNumber();
  const strikeStep = inferStrikeStep(optionContext.rows.map((row) => row.strike));
  const tradableLegs = optionContext.rows
    .map((row) => legForSide(row, side))
    .filter((leg) => leg.status === "TRADABLE");

  if (tradableLegs.length === 0) return [];

  const maxVolume = Math.max(...tradableLegs.map((leg) => leg.volume));
  const maxOpenInterest = Math.max(...tradableLegs.map((leg) => leg.openInterest));

  return tradableLegs
    .map((leg) => {
      const estimatedDelta = estimateDelta({ side, strike: leg.strike, spot, strikeStep });
      const moneyness = moneynessLabel({ side, strike: leg.strike, spot, strikeStep });
      const withinIdealBand =
        estimatedDelta >= DELTA_BAND_MIN && estimatedDelta <= DELTA_BAND_MAX;
      const selectionScore = Math.round(
        WEIGHT_DELTA * deltaScore(estimatedDelta) +
          WEIGHT_LIQUIDITY *
            liquidityScore({
              volume: leg.volume,
              openInterest: leg.openInterest,
              maxVolume,
              maxOpenInterest,
            }) +
          WEIGHT_SPREAD * spreadScore(leg.spreadPercent),
      );

      return {
        side,
        strike: leg.strike,
        label: `${optionContext.underlying} ${optionContext.expiry} ${leg.strike} ${side}`,
        ltp: toDecimal(leg.ltp).toFixed(2),
        status: leg.status,
        moneyness,
        estimatedDelta: estimatedDelta.toFixed(2),
        selectionScore,
        distanceFromSpot: toDecimal(Math.abs(leg.strike - spot)).toFixed(2),
        withinIdealBand,
        reason: rankReason({ moneyness, estimatedDelta, withinIdealBand }),
      };
    })
    .sort((a, b) => {
      if (b.selectionScore !== a.selectionScore) return b.selectionScore - a.selectionScore;

      // Break ties toward the strike closest to spot.
      return Number(a.distanceFromSpot) - Number(b.distanceFromSpot);
    });
}

export function toStrategyContractCandidate(
  ranking: ContractRanking,
): StrategyContractCandidate {
  return {
    side: ranking.side,
    strike: ranking.strike,
    label: ranking.label,
    ltp: ranking.ltp,
    status: ranking.status,
    moneyness: ranking.moneyness,
    estimatedDelta: ranking.estimatedDelta,
    selectionScore: ranking.selectionScore,
    distanceFromSpot: ranking.distanceFromSpot,
  };
}

/**
 * Pick the best tradable contract on the setup side and return it plus the full
 * ranked candidate list (best first) for transparency in the UI.
 */
export function selectStrategyContract(
  optionContext: OptionChainContext,
  bias: StrategyBias,
): {
  selected: StrategySelectedContract | null;
  candidates: StrategyContractCandidate[];
} {
  const rankings = rankStrategyContracts(optionContext, bias);
  const candidates = rankings.map(toStrategyContractCandidate);
  const best = rankings[0];

  if (!best) {
    return { selected: null, candidates };
  }

  return {
    selected: {
      side: best.side,
      strike: best.strike,
      label: best.label,
      ltp: best.ltp,
      status: best.status,
      reason: best.reason,
      moneyness: best.moneyness,
      estimatedDelta: best.estimatedDelta,
      selectionScore: best.selectionScore,
      distanceFromSpot: best.distanceFromSpot,
    },
    candidates,
  };
}
