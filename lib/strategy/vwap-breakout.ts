import Decimal from "decimal.js";
import type { IndicatorContext, PriceLevel } from "@/types/indicators";
import type { DataQualityStatus, MarketRegime, SignalQuality } from "@/types/market";
import type {
  OptionChainContext,
  OptionLegLiquidity,
  OptionSide,
} from "@/types/options";
import type {
  StrategyBias,
  StrategyComponentKey,
  StrategyComponentScore,
  StrategyComponentStatus,
  StrategyDirection,
  StrategyEntryPlan,
  StrategyEvaluation,
  StrategySelectedContract,
  StrategyWatchedLevel,
} from "@/types/strategy";

export const VWAP_BREAKOUT_STRATEGY_NAME = "VWAP + Trend + Breakout + Volume";
export const VWAP_BREAKOUT_STRATEGY_VERSION = "1.0.0";

const COMPONENT_WEIGHTS: Record<StrategyComponentKey, number> = {
  trend: 20,
  vwap: 15,
  breakout: 20,
  volume: 15,
  momentum: 10,
  option_chain: 10,
  liquidity: 5,
  risk_reward: 5,
};

const DEFAULT_RULES = {
  minRelativeVolume: "1.20",
  watchRelativeVolume: "1.00",
  bullishRsiMin: "55",
  bullishRsiMax: "74",
  bullishRsiWatchMin: "50",
  bullishRsiWatchMax: "80",
  bearishRsiMin: "26",
  bearishRsiMax: "45",
  bearishRsiWatchMin: "20",
  bearishRsiWatchMax: "50",
  breakoutBufferPercent: "0.02",
  watchDistanceAtrMultiple: "0.70",
  minRiskReward: "1.50",
};

function toDecimal(value: Decimal.Value) {
  return new Decimal(value);
}

function toFixed(value: Decimal.Value, places = 2) {
  return toDecimal(value).toFixed(places);
}

function maybeDecimal(value: Decimal.Value | null | undefined) {
  if (value === null || value === undefined || value === "") return null;

  return toDecimal(value);
}

function isZero(value: Decimal.Value | null | undefined) {
  const decimal = maybeDecimal(value);

  return Boolean(decimal?.eq(0));
}

function component({
  key,
  status,
  points,
  detail,
}: {
  key: StrategyComponentKey;
  status: StrategyComponentStatus;
  points: number;
  detail: string;
}): StrategyComponentScore {
  return {
    key,
    label: componentLabel(key),
    status,
    points,
    maxPoints: COMPONENT_WEIGHTS[key],
    detail,
  };
}

function componentLabel(key: StrategyComponentKey) {
  switch (key) {
    case "trend":
      return "Trend";
    case "vwap":
      return "VWAP";
    case "breakout":
      return "Breakout";
    case "volume":
      return "Volume";
    case "momentum":
      return "Momentum";
    case "option_chain":
      return "Option chain";
    case "liquidity":
      return "Liquidity";
    case "risk_reward":
      return "Risk/reward";
  }
}

export function qualityFromScore(score: number): SignalQuality {
  if (score >= 85) return "HIGH QUALITY";
  if (score >= 75) return "STRONG";
  if (score >= 65) return "WATCH";
  if (score >= 50) return "WEAK";
  return "NO SETUP";
}

function determineBias(indicator: IndicatorContext): StrategyBias {
  const latestClose = maybeDecimal(indicator.latestClose);
  const vwap = maybeDecimal(indicator.vwap);

  if (!latestClose || !vwap) {
    return "NEUTRAL";
  }

  if (latestClose.gt(vwap) && indicator.emaTrend === "Bullish") {
    return "BULLISH";
  }

  if (latestClose.lt(vwap) && indicator.emaTrend === "Bearish") {
    return "BEARISH";
  }

  return "NEUTRAL";
}

function directionalHintFromIndicators(indicator: IndicatorContext): StrategyBias {
  if (indicator.emaTrend === "Bullish") return "BULLISH";
  if (indicator.emaTrend === "Bearish") return "BEARISH";

  return "NEUTRAL";
}

function watchedLevelForBias(
  indicator: IndicatorContext,
  bias: StrategyBias,
): StrategyWatchedLevel | null {
  const level: PriceLevel | undefined =
    bias === "BULLISH"
      ? indicator.potentialResistance[0]
      : bias === "BEARISH"
        ? indicator.potentialSupport[0]
        : undefined;

  if (!level) {
    return null;
  }

  return {
    label: level.label,
    value: level.value,
    type: bias === "BULLISH" ? "resistance" : "support",
  };
}

function directionFromState(bias: StrategyBias, confirmed: boolean): StrategyDirection {
  if (!confirmed) return "NO TRADE";
  if (bias === "NEUTRAL") return "NO TRADE";

  return bias;
}

function scoreTrend(indicator: IndicatorContext) {
  if (indicator.emaTrend === "Insufficient data") {
    return component({
      key: "trend",
      status: "PENDING",
      points: 0,
      detail: "EMA trend is still building.",
    });
  }

  if (indicator.emaTrend === "Bullish") {
    return component({
      key: "trend",
      status: "PASS",
      points: COMPONENT_WEIGHTS.trend,
      detail: "EMA 9 is above EMA 20 and EMA 50.",
    });
  }

  if (indicator.emaTrend === "Bearish") {
    return component({
      key: "trend",
      status: "PASS",
      points: COMPONENT_WEIGHTS.trend,
      detail: "EMA 9 is below EMA 20 and EMA 50.",
    });
  }

  return component({
    key: "trend",
    status: "FAIL",
    points: 0,
    detail: "EMA structure is mixed.",
  });
}

function scoreVwap(indicator: IndicatorContext, bias: StrategyBias) {
  const latestClose = maybeDecimal(indicator.latestClose);
  const vwap = maybeDecimal(indicator.vwap);

  if (!latestClose || !vwap) {
    const detail = isZero(indicator.volumeAverage20)
      ? "Spot index feed has no traded volume, so exact VWAP is unavailable."
      : "VWAP is not ready.";

    return component({
      key: "vwap",
      status: "PENDING",
      points: 0,
      detail,
    });
  }

  if (bias === "BULLISH" && latestClose.gt(vwap)) {
    return component({
      key: "vwap",
      status: "PASS",
      points: COMPONENT_WEIGHTS.vwap,
      detail: `Price is ${toFixed(latestClose.minus(vwap))} above VWAP.`,
    });
  }

  if (bias === "BEARISH" && latestClose.lt(vwap)) {
    return component({
      key: "vwap",
      status: "PASS",
      points: COMPONENT_WEIGHTS.vwap,
      detail: `Price is ${toFixed(vwap.minus(latestClose))} below VWAP.`,
    });
  }

  return component({
    key: "vwap",
    status: "FAIL",
    points: 0,
    detail: "Price and VWAP do not support the same side.",
  });
}

function scoreBreakout({
  indicator,
  bias,
  watchedLevel,
}: {
  indicator: IndicatorContext;
  bias: StrategyBias;
  watchedLevel: StrategyWatchedLevel | null;
}) {
  const latestClose = maybeDecimal(indicator.latestClose);
  const atr = maybeDecimal(indicator.atr14);

  if (bias === "NEUTRAL") {
    return component({
      key: "breakout",
      status: "PENDING",
      points: 0,
      detail: "No directional bias yet.",
    });
  }

  if (!latestClose || !atr || !watchedLevel) {
    return component({
      key: "breakout",
      status: "PENDING",
      points: 0,
      detail: "Breakout level is not ready.",
    });
  }

  const level = toDecimal(watchedLevel.value);
  const buffer = latestClose.mul(DEFAULT_RULES.breakoutBufferPercent).div(100);
  const watchDistance = atr.mul(DEFAULT_RULES.watchDistanceAtrMultiple);
  const hasBreakout =
    bias === "BULLISH"
      ? latestClose.gt(level.plus(buffer))
      : latestClose.lt(level.minus(buffer));

  if (hasBreakout) {
    return component({
      key: "breakout",
      status: "PASS",
      points: COMPONENT_WEIGHTS.breakout,
      detail: `Closed beyond ${watchedLevel.label}.`,
    });
  }

  const distance = latestClose.minus(level).abs();

  if (distance.lte(watchDistance)) {
    return component({
      key: "breakout",
      status: "PARTIAL",
      points: 10,
      detail: `${toFixed(distance)} away from ${watchedLevel.label}.`,
    });
  }

  return component({
    key: "breakout",
    status: "FAIL",
    points: 0,
    detail: `Needs a candle close beyond ${watchedLevel.label}.`,
  });
}

function scoreVolume(indicator: IndicatorContext) {
  const relativeVolume = maybeDecimal(indicator.relativeVolume20);

  if (!relativeVolume) {
    const detail = isZero(indicator.volumeAverage20)
      ? "Spot index feed has no traded volume, so relative volume cannot be calculated."
      : "Relative volume is still building.";

    return component({
      key: "volume",
      status: "PENDING",
      points: 0,
      detail,
    });
  }

  if (relativeVolume.gte(DEFAULT_RULES.minRelativeVolume)) {
    return component({
      key: "volume",
      status: "PASS",
      points: COMPONENT_WEIGHTS.volume,
      detail: `${toFixed(relativeVolume)}x relative volume.`,
    });
  }

  if (relativeVolume.gte(DEFAULT_RULES.watchRelativeVolume)) {
    return component({
      key: "volume",
      status: "PARTIAL",
      points: 8,
      detail: `${toFixed(relativeVolume)}x relative volume.`,
    });
  }

  return component({
    key: "volume",
    status: "FAIL",
    points: 0,
    detail: `${toFixed(relativeVolume)}x relative volume is low.`,
  });
}

function isBetween(value: Decimal, min: Decimal.Value, max: Decimal.Value) {
  return value.gte(min) && value.lte(max);
}

function scoreMomentum(indicator: IndicatorContext, bias: StrategyBias) {
  const rsi = maybeDecimal(indicator.rsi14);

  if (bias === "NEUTRAL") {
    return component({
      key: "momentum",
      status: "PENDING",
      points: 0,
      detail: "No directional bias yet.",
    });
  }

  if (!rsi) {
    return component({
      key: "momentum",
      status: "PENDING",
      points: 0,
      detail: "RSI is not ready.",
    });
  }

  const pass =
    bias === "BULLISH"
      ? isBetween(rsi, DEFAULT_RULES.bullishRsiMin, DEFAULT_RULES.bullishRsiMax)
      : isBetween(rsi, DEFAULT_RULES.bearishRsiMin, DEFAULT_RULES.bearishRsiMax);
  const watch =
    bias === "BULLISH"
      ? isBetween(rsi, DEFAULT_RULES.bullishRsiWatchMin, DEFAULT_RULES.bullishRsiWatchMax)
      : isBetween(rsi, DEFAULT_RULES.bearishRsiWatchMin, DEFAULT_RULES.bearishRsiWatchMax);

  if (pass) {
    return component({
      key: "momentum",
      status: "PASS",
      points: COMPONENT_WEIGHTS.momentum,
      detail: `RSI ${toFixed(rsi)} supports ${bias.toLowerCase()} bias.`,
    });
  }

  if (watch) {
    return component({
      key: "momentum",
      status: "PARTIAL",
      points: 5,
      detail: `RSI ${toFixed(rsi)} is acceptable but not ideal.`,
    });
  }

  return component({
    key: "momentum",
    status: "FAIL",
    points: 0,
    detail: `RSI ${toFixed(rsi)} does not confirm momentum.`,
  });
}

function scoreOptionChain(optionContext: OptionChainContext, bias: StrategyBias) {
  const oiRatio = maybeDecimal(optionContext.putCallOpenInterestRatio);

  if (bias === "NEUTRAL") {
    return component({
      key: "option_chain",
      status: "PENDING",
      points: 0,
      detail: "No directional bias yet.",
    });
  }

  if (!oiRatio) {
    return component({
      key: "option_chain",
      status: "PENDING",
      points: 0,
      detail: "PE/CE OI ratio is not ready.",
    });
  }

  const bullishPass = bias === "BULLISH" && oiRatio.gte(1);
  const bearishPass = bias === "BEARISH" && oiRatio.lte(1);
  const nearBalanced = oiRatio.gte("0.90") && oiRatio.lte("1.10");

  if (bullishPass || bearishPass) {
    return component({
      key: "option_chain",
      status: "PASS",
      points: COMPONENT_WEIGHTS.option_chain,
      detail: `PE/CE OI ratio is ${toFixed(oiRatio)}.`,
    });
  }

  if (nearBalanced) {
    return component({
      key: "option_chain",
      status: "PARTIAL",
      points: 5,
      detail: `PE/CE OI ratio is balanced at ${toFixed(oiRatio)}.`,
    });
  }

  return component({
    key: "option_chain",
    status: "FAIL",
    points: 0,
    detail: `PE/CE OI ratio ${toFixed(oiRatio)} conflicts with ${bias.toLowerCase()} bias.`,
  });
}

function getLegForSide(row: OptionChainContext["rows"][number], side: OptionSide) {
  return side === "CE" ? row.call : row.put;
}

function selectContract(
  optionContext: OptionChainContext,
  bias: StrategyBias,
): StrategySelectedContract | null {
  if (bias === "NEUTRAL") return null;

  const side: OptionSide = bias === "BULLISH" ? "CE" : "PE";
  const spot = toDecimal(optionContext.underlyingLastPrice);
  const candidates = optionContext.rows
    .map((row) => getLegForSide(row, side))
    .filter((leg) => leg.status === "TRADABLE")
    .sort((a, b) =>
      toDecimal(a.strike).minus(spot).abs().minus(toDecimal(b.strike).minus(spot).abs()).toNumber(),
    );
  const selected = candidates[0];

  if (!selected) {
    return null;
  }

  return {
    side,
    strike: selected.strike,
    label: `${optionContext.underlying} ${optionContext.expiry} ${selected.strike} ${side}`,
    ltp: toFixed(selected.ltp),
    status: selected.status,
    reason: selected.reasons[0] ?? "Nearest liquid contract.",
  };
}

function scoreLiquidity(selectedContract: StrategySelectedContract | null, bias: StrategyBias) {
  if (bias === "NEUTRAL") {
    return component({
      key: "liquidity",
      status: "PENDING",
      points: 0,
      detail: "No directional contract selected.",
    });
  }

  if (!selectedContract) {
    return component({
      key: "liquidity",
      status: "FAIL",
      points: 0,
      detail: "No liquid option contract passed the gate.",
    });
  }

  return component({
    key: "liquidity",
    status: "PASS",
    points: COMPONENT_WEIGHTS.liquidity,
    detail: `${selectedContract.strike} ${selectedContract.side} passed liquidity checks.`,
  });
}

function estimateRiskReward({
  indicator,
  bias,
  watchedLevel,
  selectedContract,
  breakoutStatus,
}: {
  indicator: IndicatorContext;
  bias: StrategyBias;
  watchedLevel: StrategyWatchedLevel | null;
  selectedContract: StrategySelectedContract | null;
  breakoutStatus: StrategyComponentStatus;
}): { component: StrategyComponentScore; entryPlan: StrategyEntryPlan | null } {
  const atr = maybeDecimal(indicator.atr14);

  if (
    bias === "NEUTRAL" ||
    !watchedLevel ||
    !selectedContract ||
    !atr ||
    breakoutStatus !== "PASS"
  ) {
    return {
      component: component({
        key: "risk_reward",
        status: "PENDING",
        points: 0,
        detail: "Risk/reward waits for a confirmed breakout.",
      }),
      entryPlan: null,
    };
  }

  const level = toDecimal(watchedLevel.value);
  const buffer = level.mul(DEFAULT_RULES.breakoutBufferPercent).div(100);
  const entryTrigger = bias === "BULLISH" ? level.plus(buffer) : level.minus(buffer);
  const invalidation =
    bias === "BULLISH" ? level.minus(atr.mul("0.75")) : level.plus(atr.mul("0.75"));
  const targetOne =
    bias === "BULLISH" ? entryTrigger.plus(atr.mul("1.50")) : entryTrigger.minus(atr.mul("1.50"));
  const targetTwo =
    bias === "BULLISH" ? entryTrigger.plus(atr.mul("2.50")) : entryTrigger.minus(atr.mul("2.50"));
  const risk = entryTrigger.minus(invalidation).abs();
  const reward = targetOne.minus(entryTrigger).abs();
  const riskReward = risk.gt(0) ? reward.div(risk) : new Decimal(0);
  const entryPlan: StrategyEntryPlan = {
    entryTrigger: toFixed(entryTrigger),
    invalidation: toFixed(invalidation),
    targetOne: toFixed(targetOne),
    targetTwo: toFixed(targetTwo),
    riskReward: riskReward.toFixed(2),
  };

  if (riskReward.gte(DEFAULT_RULES.minRiskReward)) {
    return {
      component: component({
        key: "risk_reward",
        status: "PASS",
        points: COMPONENT_WEIGHTS.risk_reward,
        detail: `Estimated risk/reward is ${riskReward.toFixed(2)}.`,
      }),
      entryPlan,
    };
  }

  if (riskReward.gte(1)) {
    return {
      component: component({
        key: "risk_reward",
        status: "PARTIAL",
        points: 2,
        detail: `Estimated risk/reward is ${riskReward.toFixed(2)}.`,
      }),
      entryPlan,
    };
  }

  return {
    component: component({
      key: "risk_reward",
      status: "FAIL",
      points: 0,
      detail: `Estimated risk/reward is ${riskReward.toFixed(2)}.`,
    }),
    entryPlan,
  };
}

function isConfirmed({
  bias,
  score,
  dataQuality,
  marketRegime,
  components,
}: {
  bias: StrategyBias;
  score: number;
  dataQuality: DataQualityStatus;
  marketRegime: MarketRegime;
  components: StrategyComponentScore[];
}) {
  const statusByKey = new Map(components.map((item) => [item.key, item.status]));
  const disallowedRegime = marketRegime === "SIDEWAYS" || marketRegime === "HIGH_VOLATILITY";

  return (
    bias !== "NEUTRAL" &&
    score >= 75 &&
    dataQuality === "GOOD" &&
    !disallowedRegime &&
    statusByKey.get("breakout") === "PASS" &&
    statusByKey.get("liquidity") === "PASS" &&
    statusByKey.get("risk_reward") === "PASS" &&
    statusByKey.get("option_chain") !== "FAIL"
  );
}

function buildReasons(components: StrategyComponentScore[], confirmed: boolean) {
  if (confirmed) {
    return ["All hard gates passed for a confirmed setup."];
  }

  const blockers = components
    .filter((item) => item.status === "FAIL" || item.status === "PENDING")
    .map((item) => `${item.label}: ${item.detail}`);

  return blockers.length ? blockers.slice(0, 5) : ["Setup is still forming."];
}

function buildRisks({
  dataQuality,
  marketRegime,
  confirmed,
}: {
  dataQuality: DataQualityStatus;
  marketRegime: MarketRegime;
  confirmed: boolean;
}) {
  const risks = ["Live orders disabled.", "Paper-only workflow."];

  if (dataQuality !== "GOOD") {
    risks.push(`Data quality is ${dataQuality.replace("_", " ")}.`);
  }

  if (marketRegime === "SIDEWAYS" || marketRegime === "HIGH_VOLATILITY") {
    risks.push(`Market regime is ${marketRegime.replace("_", " ")}.`);
  }

  if (!confirmed) {
    risks.push("No confirmed trade setup.");
  }

  return risks;
}

function invalidatedEvaluation({
  indicator,
  optionContext,
  marketRegime,
  dataQuality,
}: {
  indicator: IndicatorContext;
  optionContext: OptionChainContext;
  marketRegime: MarketRegime;
  dataQuality: DataQualityStatus;
}): StrategyEvaluation {
  const components = Object.keys(COMPONENT_WEIGHTS).map((key) =>
    component({
      key: key as StrategyComponentKey,
      status: "PENDING",
      points: 0,
      detail: "Waiting for valid market data.",
    }),
  );

  return {
    id: `VWAP_BREAKOUT-${indicator.underlying}-${optionContext.expiry}`,
    name: VWAP_BREAKOUT_STRATEGY_NAME,
    version: VWAP_BREAKOUT_STRATEGY_VERSION,
    underlying: indicator.underlying,
    marketRegime,
    dataQuality,
    bias: "NEUTRAL",
    direction: "NO TRADE",
    state: "INVALIDATED",
    score: 0,
    quality: "NO SETUP",
    components,
    watchedLevel: null,
    selectedContract: null,
    entryPlan: null,
    reasons: [`Data quality is ${dataQuality.replace("_", " ")}.`],
    risks: buildRisks({ dataQuality, marketRegime, confirmed: false }),
    liveOrdersEnabled: false,
  };
}

export function evaluateVwapBreakoutStrategy({
  indicator,
  optionContext,
  marketRegime,
  dataQuality,
}: {
  indicator: IndicatorContext;
  optionContext: OptionChainContext;
  marketRegime: MarketRegime;
  dataQuality: DataQualityStatus;
}): StrategyEvaluation {
  if (dataQuality !== "GOOD") {
    return invalidatedEvaluation({
      indicator,
      optionContext,
      marketRegime,
      dataQuality,
    });
  }

  const bias = determineBias(indicator);
  const indicatorBias = bias === "NEUTRAL" ? directionalHintFromIndicators(indicator) : bias;
  const watchedLevel = watchedLevelForBias(indicator, bias);
  const selectedContract = selectContract(optionContext, bias);
  const trend = scoreTrend(indicator);
  const vwap = scoreVwap(indicator, bias);
  const breakout = scoreBreakout({ indicator, bias, watchedLevel });
  const volume = scoreVolume(indicator);
  const momentum = scoreMomentum(indicator, indicatorBias);
  const optionChain = scoreOptionChain(optionContext, indicatorBias);
  const liquidity = scoreLiquidity(selectedContract, bias);
  const riskReward = estimateRiskReward({
    indicator,
    bias,
    watchedLevel,
    selectedContract,
    breakoutStatus: breakout.status,
  });
  const components = [
    trend,
    vwap,
    breakout,
    volume,
    momentum,
    optionChain,
    liquidity,
    riskReward.component,
  ];
  const score = components.reduce((sum, item) => sum + item.points, 0);
  const confirmed = isConfirmed({
    bias,
    score,
    dataQuality,
    marketRegime,
    components,
  });

  return {
    id: `VWAP_BREAKOUT-${indicator.underlying}-${optionContext.expiry}`,
    name: VWAP_BREAKOUT_STRATEGY_NAME,
    version: VWAP_BREAKOUT_STRATEGY_VERSION,
    underlying: indicator.underlying,
    marketRegime,
    dataQuality,
    bias,
    direction: directionFromState(bias, confirmed),
    state: confirmed ? "CONFIRMED" : "FORMING",
    score,
    quality: qualityFromScore(score),
    components,
    watchedLevel,
    selectedContract,
    entryPlan: riskReward.entryPlan,
    reasons: buildReasons(components, confirmed),
    risks: buildRisks({ dataQuality, marketRegime, confirmed }),
    liveOrdersEnabled: false,
  };
}

export function strategyContractSideForBias(bias: StrategyBias): OptionSide | null {
  if (bias === "BULLISH") return "CE";
  if (bias === "BEARISH") return "PE";

  return null;
}

export function isTradableLegForStrategy(leg: OptionLegLiquidity) {
  return leg.status === "TRADABLE" && leg.volumeToOpenInterestRatio !== null;
}
