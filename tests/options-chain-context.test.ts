import { describe, expect, it } from "vitest";
import {
  buildOptionChainContext,
  evaluateOptionLegLiquidity,
} from "../lib/options/chain-context";
import type {
  OptionChainSourceRow,
  OptionLegMarketData,
  OptionLiquidityRules,
} from "../types/options";

const testRules: OptionLiquidityRules = {
  minVolume: 100,
  minOpenInterest: 1_000,
  maxSpreadPercent: "5.00",
  minLtp: "10.00",
  maxLtp: "300.00",
  minVolumeToOpenInterestRatio: "0.05",
};

function leg(overrides: Partial<OptionLegMarketData> = {}): OptionLegMarketData {
  return {
    ltp: 100,
    volume: 250,
    openInterest: 2_000,
    oiChange: 120,
    bid: 99,
    ask: 101,
    ...overrides,
  };
}

function row(
  strike: number,
  overrides: Partial<OptionChainSourceRow> = {},
): OptionChainSourceRow {
  return {
    strike,
    isAtm: strike === 105,
    call: leg(),
    put: leg(),
    ...overrides,
  };
}

describe("option-chain context", () => {
  it("marks a contract tradable when every liquidity rule passes", () => {
    const result = evaluateOptionLegLiquidity({
      strike: 105,
      side: "CE",
      leg: leg(),
      rules: testRules,
    });

    expect(result.status).toBe("TRADABLE");
    expect(result.volumeToOpenInterestRatio).toBe("0.13");
    expect(result.reasons).toEqual([]);
  });

  it("blocks contracts with weak volume, OI, spread, or invalid quotes", () => {
    const result = evaluateOptionLegLiquidity({
      strike: 105,
      side: "PE",
      leg: leg({
        volume: 20,
        openInterest: 500,
        bid: 100,
        ask: 108,
      }),
      rules: testRules,
    });

    expect(result.status).toBe("NOT_TRADABLE");
    expect(result.reasons).toContain("Volume below minimum.");
    expect(result.reasons).toContain("Open interest below minimum.");
    expect(result.reasons).toContain("Volume/OI below minimum.");
    expect(result.reasons).toContain("Spread above maximum.");
  });

  it("summarizes OI, OI-change, volume, and explicit PE/CE ratios", () => {
    const context = buildOptionChainContext({
      underlying: "NIFTY",
      underlyingLastPrice: "105",
      expiry: "2026-09-03",
      rules: testRules,
      rows: [
        row(100, {
          call: leg({ openInterest: 1_000, oiChange: 100, volume: 200 }),
          put: leg({ openInterest: 5_000, oiChange: 500, volume: 600 }),
        }),
        row(105, {
          call: leg({ openInterest: 3_000, oiChange: 300, volume: 400 }),
          put: leg({ openInterest: 4_000, oiChange: 400, volume: 500 }),
        }),
        row(110, {
          call: leg({ openInterest: 7_000, oiChange: 700, volume: 800 }),
          put: leg({ openInterest: 1_000, oiChange: 100, volume: 200 }),
        }),
      ],
    });

    expect(context.totalCallOpenInterest).toBe(11_000);
    expect(context.totalPutOpenInterest).toBe(10_000);
    expect(context.totalCallOiChange).toBe(1_100);
    expect(context.totalPutOiChange).toBe(1_000);
    expect(context.putCallOpenInterestRatio).toBe("0.91");
    expect(context.putCallOiChangeRatio).toBe("0.91");
    expect(context.totalCallVolume).toBe(1_400);
    expect(context.totalPutVolume).toBe(1_300);
  });

  it("identifies OI support below spot and OI resistance above spot", () => {
    const context = buildOptionChainContext({
      underlying: "NIFTY",
      underlyingLastPrice: "105",
      expiry: "2026-09-03",
      rules: testRules,
      rows: [
        row(100, {
          call: leg({ openInterest: 1_000 }),
          put: leg({ openInterest: 5_000 }),
        }),
        row(105, {
          call: leg({ openInterest: 3_000 }),
          put: leg({ openInterest: 4_000 }),
        }),
        row(110, {
          call: leg({ openInterest: 7_000 }),
          put: leg({ openInterest: 1_000 }),
        }),
      ],
    });

    expect(context.maxCallOpenInterest?.strike).toBe(110);
    expect(context.maxPutOpenInterest?.strike).toBe(100);
    expect(context.oiSupportLevels.map((level) => level.strike)).toEqual([100, 105]);
    expect(context.oiResistanceLevels.map((level) => level.strike)).toEqual([110, 105]);
  });
});
