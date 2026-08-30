import { describe, expect, it } from "vitest";
import { createInitialMarketSnapshot } from "../lib/simulation/market-snapshot";

describe("simulation snapshot", () => {
  it("starts with no-trade discipline and paper-only mode", () => {
    const snapshot = createInitialMarketSnapshot();

    expect(snapshot.health.mode).toBe("simulation");
    expect(snapshot.signal.direction).toBe("NO TRADE");
    expect(snapshot.signal.quality).toBe("NO SETUP");
    expect(snapshot.signal.suggestedOption).toBeUndefined();
  });

  it("covers the initial index universe", () => {
    const snapshot = createInitialMarketSnapshot();

    expect(snapshot.underlyings.map((underlying) => underlying.symbol)).toEqual([
      "NIFTY",
      "BANKNIFTY",
      "FINNIFTY",
    ]);
    expect(snapshot.optionChain.some((row) => row.isAtm)).toBe(true);
  });
});
