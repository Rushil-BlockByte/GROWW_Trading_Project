import { describe, expect, it } from "vitest";
import { InstrumentRepository } from "../lib/instruments/instrument-repository";
import { createSimulatedInstrumentMaster } from "../lib/instruments/simulated-instruments";
import { MarketStateStore } from "../lib/market/market-state";
import { normalizeSimulatedTick } from "../lib/market/tick-normalization";

describe("market state store", () => {
  it("accepts valid normalized ticks and rejects duplicates", () => {
    const repository = new InstrumentRepository(createSimulatedInstrumentMaster());
    const store = new MarketStateStore(repository);
    const now = new Date("2026-09-01T03:45:10.000Z");
    const tick = normalizeSimulatedTick({
      instrumentToken: 256265,
      timestamp: now,
      lastPrice: "25180",
      lastQuantity: 75,
      volume: 1000,
      openInterest: 0,
      sequence: 1,
    });

    expect(store.applyTick(tick, now).accepted).toBe(true);
    expect(store.applyTick(tick, now)).toEqual({
      accepted: false,
      reason: "Duplicate tick.",
    });
    expect(store.getSummary(now).dataQuality).toBe("GOOD");
  });

  it("rejects stale ticks before they can update state", () => {
    const repository = new InstrumentRepository(createSimulatedInstrumentMaster());
    const store = new MarketStateStore(repository);
    const tick = normalizeSimulatedTick({
      instrumentToken: 256265,
      timestamp: new Date("2026-09-01T03:45:00.000Z"),
      lastPrice: "25180",
    });

    const result = store.applyTick(tick, new Date("2026-09-01T03:46:00.000Z"));

    expect(result).toEqual({ accepted: false, reason: "Stale tick." });
    expect(store.getSummary().instrumentsTracked).toBe(0);
  });
});
