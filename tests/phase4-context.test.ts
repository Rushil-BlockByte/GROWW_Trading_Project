import { describe, expect, it } from "vitest";
import {
  createPhase4IndicatorContext,
  createSimulatedIndicatorCandles,
} from "../lib/simulation/phase4-context";
import { createInitialMarketSnapshot } from "../lib/simulation/market-snapshot";

describe("phase 4 indicator simulation", () => {
  it("creates enough deterministic NIFTY candles for the core indicators", () => {
    const candles = createSimulatedIndicatorCandles(0);

    expect(candles).toHaveLength(60);
    expect(candles[0].startTime).toBe("2026-09-01T03:45:00.000Z");
    expect(candles.at(-1)?.volume).toBeGreaterThan(candles[0].volume);
  });

  it("provides a populated indicator context for the dashboard", () => {
    const context = createPhase4IndicatorContext(0);

    expect(context.candleCount).toBe(60);
    expect(context.vwap).not.toBeNull();
    expect(context.ema50).not.toBeNull();
    expect(context.atr14).not.toBeNull();
    expect(context.rsi14).not.toBeNull();
    expect(context.openingRange15?.complete).toBe(true);
    expect(context.potentialSupport.length).toBeGreaterThan(0);
    expect(context.potentialResistance.length).toBeGreaterThan(0);
  });

  it("attaches phase 4 context to the market snapshot while keeping no-trade discipline", () => {
    const snapshot = createInitialMarketSnapshot();

    expect(snapshot.phase4.underlying).toBe("NIFTY");
    expect(snapshot.phase4.vwap).toBe(String(snapshot.underlyings[0].vwap?.toFixed(2)));
    expect(snapshot.signal.direction).toBe("NO TRADE");
    expect(snapshot.health.mode).toBe("simulation");
  });
});
