import Decimal from "decimal.js";
import type {
  OptionChainContext,
  OptionChainRowContext,
  OptionChainSourceRow,
  OptionLegLiquidity,
  OptionLegMarketData,
  OptionLiquidityRules,
  OptionOpenInterestLeader,
  OptionOpenInterestLevel,
  OptionSide,
} from "@/types/options";
import type { UnderlyingSymbol } from "@/types/market";

export const DEFAULT_OPTION_LIQUIDITY_RULES: OptionLiquidityRules = {
  minVolume: 50_000,
  minOpenInterest: 500_000,
  maxSpreadPercent: "2.50",
  minLtp: "20.00",
  maxLtp: "500.00",
  minVolumeToOpenInterestRatio: "0.03",
};

function toDecimal(value: Decimal.Value) {
  return new Decimal(value);
}

function toFixed(value: Decimal.Value, places = 2) {
  return toDecimal(value).toFixed(places);
}

function ratio(numerator: Decimal.Value, denominator: Decimal.Value, places = 2) {
  const divisor = toDecimal(denominator);

  if (divisor.lte(0)) return null;

  return toDecimal(numerator).div(divisor).toFixed(places);
}

function calculateSpreadPercent(leg: OptionLegMarketData) {
  if (Number.isFinite(leg.spreadPercent) && leg.spreadPercent !== undefined) {
    return toDecimal(leg.spreadPercent).toNumber();
  }

  const ltp = toDecimal(leg.ltp);
  const bid = toDecimal(leg.bid);
  const ask = toDecimal(leg.ask);

  if (ltp.lte(0) || bid.lte(0) || ask.lte(bid)) {
    return 999;
  }

  return ask.minus(bid).div(ltp).mul(100).toDecimalPlaces(2).toNumber();
}

export function evaluateOptionLegLiquidity({
  strike,
  side,
  leg,
  rules = DEFAULT_OPTION_LIQUIDITY_RULES,
}: {
  strike: number;
  side: OptionSide;
  leg: OptionLegMarketData;
  rules?: OptionLiquidityRules;
}): OptionLegLiquidity {
  const ltp = toDecimal(leg.ltp);
  const bid = toDecimal(leg.bid);
  const ask = toDecimal(leg.ask);
  const spreadPercent = calculateSpreadPercent(leg);
  const volumeToOpenInterestRatio = ratio(leg.volume, leg.openInterest);
  const reasons: string[] = [];

  if (ltp.lt(rules.minLtp)) {
    reasons.push("Premium below minimum.");
  }

  if (ltp.gt(rules.maxLtp)) {
    reasons.push("Premium above maximum.");
  }

  if (leg.volume < rules.minVolume) {
    reasons.push("Volume below minimum.");
  }

  if (leg.openInterest < rules.minOpenInterest) {
    reasons.push("Open interest below minimum.");
  }

  if (!volumeToOpenInterestRatio || toDecimal(volumeToOpenInterestRatio).lt(rules.minVolumeToOpenInterestRatio)) {
    reasons.push("Volume/OI below minimum.");
  }

  if (bid.lte(0) || ask.lte(0) || ask.lte(bid)) {
    reasons.push("Invalid bid/ask.");
  }

  if (toDecimal(spreadPercent).gt(rules.maxSpreadPercent)) {
    reasons.push("Spread above maximum.");
  }

  return {
    ...leg,
    side,
    strike,
    spreadPercent,
    volumeToOpenInterestRatio,
    status: reasons.length === 0 ? "TRADABLE" : "NOT_TRADABLE",
    reasons,
  };
}

function sumBy<T>(values: T[], selector: (value: T) => number) {
  return values.reduce((sum, value) => sum + selector(value), 0);
}

function maxBy<T>(values: T[], selector: (value: T) => number): T | null {
  if (values.length === 0) return null;

  return values.reduce((leader, value) =>
    selector(value) > selector(leader) ? value : leader,
  );
}

function toLeader(leg: OptionLegLiquidity | null, label: string): OptionOpenInterestLeader | null {
  if (!leg) return null;

  return {
    strike: leg.strike,
    side: leg.side,
    label,
    ltp: toFixed(leg.ltp),
    volume: leg.volume,
    openInterest: leg.openInterest,
    oiChange: leg.oiChange,
  };
}

function toOiLevel(leg: OptionLegLiquidity, role: OptionOpenInterestLevel["role"]) {
  return {
    strike: leg.strike,
    side: leg.side,
    label: role === "support" ? "PE OI support" : "CE OI resistance",
    openInterest: leg.openInterest,
    oiChange: leg.oiChange,
    role,
  };
}

function buildOiLevels({
  callLegs,
  putLegs,
  underlyingLastPrice,
}: {
  callLegs: OptionLegLiquidity[];
  putLegs: OptionLegLiquidity[];
  underlyingLastPrice: Decimal.Value;
}) {
  const spot = toDecimal(underlyingLastPrice);
  const oiSupportLevels = putLegs
    .filter((leg) => toDecimal(leg.strike).lte(spot))
    .sort((a, b) => b.openInterest - a.openInterest)
    .slice(0, 3)
    .map((leg) => toOiLevel(leg, "support"));
  const oiResistanceLevels = callLegs
    .filter((leg) => toDecimal(leg.strike).gte(spot))
    .sort((a, b) => b.openInterest - a.openInterest)
    .slice(0, 3)
    .map((leg) => toOiLevel(leg, "resistance"));

  return {
    oiSupportLevels,
    oiResistanceLevels,
  };
}

export function buildOptionChainContext({
  underlying,
  underlyingLastPrice,
  expiry,
  rows,
  rules = DEFAULT_OPTION_LIQUIDITY_RULES,
}: {
  underlying: UnderlyingSymbol;
  underlyingLastPrice: Decimal.Value;
  expiry: string;
  rows: OptionChainSourceRow[];
  rules?: OptionLiquidityRules;
}): OptionChainContext {
  const spot = toDecimal(underlyingLastPrice);
  const sortedRows = [...rows].sort((a, b) => a.strike - b.strike);
  const contextRows: OptionChainRowContext[] = sortedRows.map((row) => ({
    strike: row.strike,
    isAtm: row.isAtm,
    distanceFromSpot: toFixed(toDecimal(row.strike).minus(spot).abs()),
    call: evaluateOptionLegLiquidity({
      strike: row.strike,
      side: "CE",
      leg: row.call,
      rules,
    }),
    put: evaluateOptionLegLiquidity({
      strike: row.strike,
      side: "PE",
      leg: row.put,
      rules,
    }),
  }));
  const callLegs = contextRows.map((row) => row.call);
  const putLegs = contextRows.map((row) => row.put);
  const totalCallOpenInterest = sumBy(callLegs, (leg) => leg.openInterest);
  const totalPutOpenInterest = sumBy(putLegs, (leg) => leg.openInterest);
  const totalCallOiChange = sumBy(callLegs, (leg) => leg.oiChange);
  const totalPutOiChange = sumBy(putLegs, (leg) => leg.oiChange);
  const totalCallVolume = sumBy(callLegs, (leg) => leg.volume);
  const totalPutVolume = sumBy(putLegs, (leg) => leg.volume);
  const allLegs = [...callLegs, ...putLegs];
  const levels = buildOiLevels({
    callLegs,
    putLegs,
    underlyingLastPrice,
  });

  return {
    underlying,
    underlyingLastPrice: toFixed(underlyingLastPrice),
    expiry,
    rowCount: contextRows.length,
    totalCallOpenInterest,
    totalPutOpenInterest,
    totalCallOiChange,
    totalPutOiChange,
    totalCallVolume,
    totalPutVolume,
    putCallOpenInterestRatio: ratio(totalPutOpenInterest, totalCallOpenInterest),
    putCallOiChangeRatio: ratio(totalPutOiChange, totalCallOiChange),
    maxCallOpenInterest: toLeader(maxBy(callLegs, (leg) => leg.openInterest), "Max CE OI"),
    maxPutOpenInterest: toLeader(maxBy(putLegs, (leg) => leg.openInterest), "Max PE OI"),
    maxCallOiChange: toLeader(maxBy(callLegs, (leg) => leg.oiChange), "Max CE OI change"),
    maxPutOiChange: toLeader(maxBy(putLegs, (leg) => leg.oiChange), "Max PE OI change"),
    oiSupportLevels: levels.oiSupportLevels,
    oiResistanceLevels: levels.oiResistanceLevels,
    tradableContracts: allLegs.filter((leg) => leg.status === "TRADABLE").length,
    notTradableContracts: allLegs.filter((leg) => leg.status === "NOT_TRADABLE").length,
    liquidityRules: rules,
    rows: contextRows,
  };
}
