import { describe, expect, it } from "vitest";
import {
  DELTA_BAND_MAX,
  DELTA_BAND_MIN,
  estimateDelta,
  inferStrikeStep,
  rankStrategyContracts,
  selectStrategyContract,
} from "../lib/options/contract-selection";
import { buildOptionChainContext } from "../lib/options/chain-context";
import type { OptionChainSourceRow } from "../types/options";

const SPOT = 25180;

function leg(ltp: number, volume: number, openInterest: number, spread = 1.2) {
  const half = (ltp * spread) / 100 / 2;

  return {
    ltp,
    volume,
    openInterest,
    oiChange: 5_000,
    bid: Number((ltp - half).toFixed(2)),
    ask: Number((ltp + half).toFixed(2)),
  };
}

function chain() {
  const strikes = [25050, 25100, 25150, 25200, 25250, 25300, 25350];
  const rows: OptionChainSourceRow[] = strikes.map((strike) => {
    const distance = Math.abs(strike - 25200);
    // Calls: deeper ITM strikes carry more premium; volume peaks near the money.
    const callLtp = Math.max(30, 180 - (strike - 25200) * 0.9);

    return {
      strike,
      isAtm: strike === 25200,
      call: leg(callLtp, 120_000 - distance * 60, 900_000 - distance * 200),
      put: leg(Math.max(30, 90 + (strike - 25200) * 0.9), 100_000 - distance * 60, 900_000 - distance * 200),
    };
  });

  return buildOptionChainContext({
    underlying: "NIFTY",
    underlyingLastPrice: String(SPOT),
    expiry: "2026-09-03",
    rows,
  });
}

describe("contract selection", () => {
  it("infers strike spacing from the chain", () => {
    expect(inferStrikeStep([25050, 25100, 25150, 25200])).toBe(50);
    expect(inferStrikeStep([25000, 25100, 25300])).toBe(100);
    expect(inferStrikeStep([25000])).toBe(0);
  });

  it("estimates delta near 0.50 at the money and higher when in the money", () => {
    const atm = estimateDelta({ side: "CE", strike: 25200, spot: 25200, strikeStep: 50 });
    const itm = estimateDelta({ side: "CE", strike: 25000, spot: 25200, strikeStep: 50 });
    const otm = estimateDelta({ side: "CE", strike: 25400, spot: 25200, strikeStep: 50 });

    expect(atm).toBeCloseTo(0.5, 5);
    expect(itm).toBeGreaterThan(atm);
    expect(otm).toBeLessThan(atm);

    // Puts mirror calls: a lower strike is out of the money.
    expect(estimateDelta({ side: "PE", strike: 25000, spot: 25200, strikeStep: 50 })).toBeLessThan(
      0.5,
    );
  });

  it("picks a near-the-money contract inside the ideal delta band", () => {
    const { selected } = selectStrategyContract(chain(), "BULLISH");

    expect(selected).not.toBeNull();
    expect(selected?.side).toBe("CE");
    expect(selected?.moneyness).toBe("ATM");
    const delta = Number(selected?.estimatedDelta);
    expect(delta).toBeGreaterThanOrEqual(DELTA_BAND_MIN);
    expect(delta).toBeLessThanOrEqual(DELTA_BAND_MAX);
  });

  it("returns candidates ranked by selection score, best first", () => {
    const { selected, candidates } = selectStrategyContract(chain(), "BULLISH");

    expect(candidates.length).toBeGreaterThan(1);
    for (let index = 1; index < candidates.length; index += 1) {
      expect(candidates[index - 1].selectionScore).toBeGreaterThanOrEqual(
        candidates[index].selectionScore,
      );
    }
    // The selected contract is the top candidate.
    expect(candidates[0].strike).toBe(selected?.strike);
    // A deep OTM strike must not win over the near-the-money contracts.
    expect(selected?.strike).not.toBe(25350);
  });

  it("returns nothing for a neutral bias", () => {
    const { selected, candidates } = selectStrategyContract(chain(), "NEUTRAL");

    expect(selected).toBeNull();
    expect(candidates).toEqual([]);
    expect(rankStrategyContracts(chain(), "NEUTRAL")).toEqual([]);
  });

  it("returns nothing when no contract passes the liquidity gate", () => {
    const illiquid = buildOptionChainContext({
      underlying: "NIFTY",
      underlyingLastPrice: String(SPOT),
      expiry: "2026-09-03",
      rows: [
        {
          strike: 25200,
          isAtm: true,
          call: leg(180, 100, 100), // volume/OI far below the gate
          put: leg(90, 100, 100),
        },
      ],
    });

    const { selected, candidates } = selectStrategyContract(illiquid, "BULLISH");

    expect(selected).toBeNull();
    expect(candidates).toEqual([]);
  });
});
