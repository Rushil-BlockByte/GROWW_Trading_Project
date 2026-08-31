import { describe, expect, it } from "vitest";
import { createInitialMarketSnapshot } from "../lib/simulation/market-snapshot";

describe("phase 6 strategy simulation", () => {
  it("attaches deterministic strategy evaluation to the market snapshot", () => {
    const snapshot = createInitialMarketSnapshot();

    expect(snapshot.phase6.name).toBe("VWAP + Trend + Breakout + Volume");
    expect(snapshot.phase6.components).toHaveLength(8);
    expect(snapshot.phase6.score).toBe(snapshot.signal.score);
    expect(snapshot.phase6.quality).toBe(snapshot.signal.quality);
    expect(snapshot.health.signalEngine).toBe("RUNNING");
  });

  it("keeps live order execution disabled after strategy evaluation", () => {
    const snapshot = createInitialMarketSnapshot();

    expect(snapshot.phase6.liveOrdersEnabled).toBe(false);
    expect(snapshot.signal.suggestedOption).toBeUndefined();
    expect(snapshot.signal.direction).toBe("NO TRADE");
  });
});
