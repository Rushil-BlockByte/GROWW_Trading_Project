import { describe, expect, it } from "vitest";
import { createInitialMarketSnapshot } from "../lib/simulation/market-snapshot";

describe("phase 6 strategy simulation", () => {
  it("attaches the S/R flip evaluation to the market snapshot", () => {
    const snapshot = createInitialMarketSnapshot();

    expect(snapshot.phase6.name).toBe("Support/Resistance Break-and-Retest Flip");
    expect(Array.isArray(snapshot.phase6.supports)).toBe(true);
    expect(Array.isArray(snapshot.phase6.resistances)).toBe(true);
    expect(snapshot.phase6.direction).toBe(snapshot.signal.direction);
    expect(snapshot.health.signalEngine).toBe("RUNNING");
  });

  it("keeps live order execution disabled after strategy evaluation", () => {
    const snapshot = createInitialMarketSnapshot();

    expect(snapshot.phase6.liveOrdersEnabled).toBe(false);
    expect(snapshot.signal.direction).toBe("NO TRADE");
  });
});
