import { describe, expect, it } from "vitest";
import {
  evaluateVwapBreakoutStrategy,
  qualityFromScore,
  strategyContractSideForBias,
} from "../lib/strategy/vwap-breakout";
import type { IndicatorContext } from "../types/indicators";
import type { OptionChainContext } from "../types/options";
import type { StrategyEvaluation } from "../types/strategy";

function indicator(overrides: Partial<IndicatorContext> = {}): IndicatorContext {
  return {
    underlying: "NIFTY",
    candleCount: 60,
    latestClose: "107.00",
    vwap: "100.00",
    vwapDistance: "7.00",
    ema9: "106.00",
    ema20: "103.00",
    ema50: "101.00",
    emaTrend: "Bullish",
    atr14: "4.00",
    rsi14: "62.00",
    volumeAverage20: "100000.00",
    relativeVolume20: "1.40",
    openingRange15: {
      minutes: 15,
      startTime: "2026-09-01T03:45:00.000Z",
      endTime: "2026-09-01T04:00:00.000Z",
      high: "105.00",
      low: "98.00",
      complete: true,
    },
    potentialSupport: [
      { label: "Opening range low", value: "98.00", source: "opening_range" },
    ],
    potentialResistance: [
      { label: "Opening range high", value: "105.00", source: "opening_range" },
    ],
    ...overrides,
  };
}

function optionContext(overrides: Partial<OptionChainContext> = {}): OptionChainContext {
  return {
    underlying: "NIFTY",
    underlyingLastPrice: "107.00",
    expiry: "2026-09-03",
    rowCount: 1,
    totalCallOpenInterest: 700_000,
    totalPutOpenInterest: 1_100_000,
    totalCallOiChange: 12_000,
    totalPutOiChange: 24_000,
    totalCallVolume: 120_000,
    totalPutVolume: 130_000,
    putCallOpenInterestRatio: "1.57",
    putCallOiChangeRatio: "2.00",
    maxCallOpenInterest: {
      strike: 105,
      side: "CE",
      label: "Max CE OI",
      ltp: "120.00",
      volume: 120_000,
      openInterest: 700_000,
      oiChange: 12_000,
    },
    maxPutOpenInterest: {
      strike: 105,
      side: "PE",
      label: "Max PE OI",
      ltp: "84.00",
      volume: 130_000,
      openInterest: 1_100_000,
      oiChange: 24_000,
    },
    maxCallOiChange: {
      strike: 105,
      side: "CE",
      label: "Max CE OI change",
      ltp: "120.00",
      volume: 120_000,
      openInterest: 700_000,
      oiChange: 12_000,
    },
    maxPutOiChange: {
      strike: 105,
      side: "PE",
      label: "Max PE OI change",
      ltp: "84.00",
      volume: 130_000,
      openInterest: 1_100_000,
      oiChange: 24_000,
    },
    oiSupportLevels: [
      {
        strike: 105,
        side: "PE",
        label: "PE OI support",
        openInterest: 1_100_000,
        oiChange: 24_000,
        role: "support",
      },
    ],
    oiResistanceLevels: [
      {
        strike: 105,
        side: "CE",
        label: "CE OI resistance",
        openInterest: 700_000,
        oiChange: 12_000,
        role: "resistance",
      },
    ],
    tradableContracts: 2,
    notTradableContracts: 0,
    liquidityRules: {
      minVolume: 50_000,
      minOpenInterest: 500_000,
      maxSpreadPercent: "2.50",
      minLtp: "20.00",
      maxLtp: "500.00",
      minVolumeToOpenInterestRatio: "0.03",
    },
    rows: [
      {
        strike: 105,
        isAtm: true,
        distanceFromSpot: "2.00",
        call: {
          side: "CE",
          strike: 105,
          ltp: 120,
          volume: 120_000,
          openInterest: 700_000,
          oiChange: 12_000,
          bid: 119,
          ask: 121,
          spreadPercent: 1.67,
          volumeToOpenInterestRatio: "0.17",
          status: "TRADABLE",
          reasons: [],
        },
        put: {
          side: "PE",
          strike: 105,
          ltp: 84,
          volume: 130_000,
          openInterest: 1_100_000,
          oiChange: 24_000,
          bid: 83,
          ask: 85,
          spreadPercent: 2.38,
          volumeToOpenInterestRatio: "0.12",
          status: "TRADABLE",
          reasons: [],
        },
      },
    ],
    ...overrides,
  };
}

function evaluate(
  indicatorOverrides: Partial<IndicatorContext> = {},
  optionOverrides: Partial<OptionChainContext> = {},
): StrategyEvaluation {
  return evaluateVwapBreakoutStrategy({
    indicator: indicator(indicatorOverrides),
    optionContext: optionContext(optionOverrides),
    marketRegime: "BULLISH",
    dataQuality: "GOOD",
  });
}

describe("VWAP breakout strategy", () => {
  it("uses the documented quality bands", () => {
    expect(qualityFromScore(49)).toBe("NO SETUP");
    expect(qualityFromScore(50)).toBe("WEAK");
    expect(qualityFromScore(65)).toBe("WATCH");
    expect(qualityFromScore(75)).toBe("STRONG");
    expect(qualityFromScore(85)).toBe("HIGH QUALITY");
  });

  it("confirms a bullish setup only when all hard gates pass", () => {
    const result = evaluate();

    expect(result.bias).toBe("BULLISH");
    expect(result.direction).toBe("BULLISH");
    expect(result.state).toBe("CONFIRMED");
    expect(result.score).toBe(100);
    expect(result.selectedContract?.side).toBe("CE");
    expect(result.entryPlan?.riskReward).toBe("1.99");
    expect(result.liveOrdersEnabled).toBe(false);
  });

  it("keeps direction as no trade when the breakout candle is not confirmed", () => {
    const result = evaluate({ latestClose: "104.50", vwapDistance: "4.50" });

    expect(result.bias).toBe("BULLISH");
    expect(result.direction).toBe("NO TRADE");
    expect(result.state).toBe("FORMING");
    expect(result.components.find((item) => item.key === "breakout")).toMatchObject({
      status: "PARTIAL",
      points: 10,
    });
    expect(result.entryPlan).toBeNull();
  });

  it("invalidates the setup when market data quality is not good", () => {
    const result = evaluateVwapBreakoutStrategy({
      indicator: indicator(),
      optionContext: optionContext(),
      marketRegime: "BULLISH",
      dataQuality: "STALE",
    });

    expect(result.state).toBe("INVALIDATED");
    expect(result.direction).toBe("NO TRADE");
    expect(result.score).toBe(0);
    expect(result.reasons[0]).toBe("Data quality is STALE.");
  });

  it("maps strategy bias to the option side watched by the engine", () => {
    expect(strategyContractSideForBias("BULLISH")).toBe("CE");
    expect(strategyContractSideForBias("BEARISH")).toBe("PE");
    expect(strategyContractSideForBias("NEUTRAL")).toBeNull();
  });
});
