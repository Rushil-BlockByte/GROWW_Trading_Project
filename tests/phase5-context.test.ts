import { describe, expect, it } from "vitest";
import { createInitialMarketSnapshot } from "../lib/simulation/market-snapshot";

describe("phase 5 option-chain simulation", () => {
  it("attaches option-chain context to the simulated market snapshot", () => {
    const snapshot = createInitialMarketSnapshot();

    expect(snapshot.phase5.underlying).toBe("NIFTY");
    expect(snapshot.phase5.rowCount).toBe(snapshot.optionChain.length);
    expect(snapshot.phase5.totalCallOpenInterest).toBeGreaterThan(0);
    expect(snapshot.phase5.totalPutOpenInterest).toBeGreaterThan(0);
    expect(snapshot.phase5.putCallOpenInterestRatio).not.toBeNull();
    expect(snapshot.phase5.oiSupportLevels.length).toBeGreaterThan(0);
    expect(snapshot.phase5.oiResistanceLevels.length).toBeGreaterThan(0);
  });

  it("keeps liquidity gating separate from strategy signals", () => {
    const snapshot = createInitialMarketSnapshot();
    const totalContracts = snapshot.phase5.rowCount * 2;

    expect(snapshot.phase5.tradableContracts + snapshot.phase5.notTradableContracts).toBe(
      totalContracts,
    );
    expect(snapshot.signal.direction).toBe("NO TRADE");
    expect(snapshot.signal.suggestedOption).toBeUndefined();
    expect(snapshot.health.signalEngine).toBe("PARKED");
  });
});
