import { describe, expect, it } from "vitest";
import { createSimulatedInstrumentMaster, getSimulatedExpiry } from "../lib/instruments/simulated-instruments";
import { InstrumentRepository } from "../lib/instruments/instrument-repository";
import { CandleBuilder } from "../lib/market/candle-builder";
import { MarketStateStore } from "../lib/market/market-state";
import { normalizeSimulatedTick } from "../lib/market/tick-normalization";
import { buildLiveMarketSnapshot } from "../lib/zerodha/live-market-snapshot";

describe("live market snapshot", () => {
  it("builds dashboard market data from accepted live ticks", () => {
    const instruments = createSimulatedInstrumentMaster();
    const repository = new InstrumentRepository(instruments);
    const stateStore = new MarketStateStore(repository);
    const candleBuilder = new CandleBuilder(["1m", "5m", "15m"]);
    const now = new Date("2026-09-01T04:00:00.000Z");
    const niftyUniverse = repository.buildAtmOptionUniverse({
      underlyingSymbol: "NIFTY",
      underlyingLastPrice: "25123.45",
      expiry: getSimulatedExpiry(),
      strikeInterval: 50,
      strikeWindow: 5,
    });
    const bankniftyUniverse = repository.buildAtmOptionUniverse({
      underlyingSymbol: "BANKNIFTY",
      underlyingLastPrice: "53999.90",
      expiry: getSimulatedExpiry(),
      strikeInterval: 100,
      strikeWindow: 5,
    });
    const finniftyUniverse = repository.buildAtmOptionUniverse({
      underlyingSymbol: "FINNIFTY",
      underlyingLastPrice: "24222.20",
      expiry: getSimulatedExpiry(),
      strikeInterval: 50,
      strikeWindow: 5,
    });
    const optionUniverses = {
      NIFTY: niftyUniverse,
      BANKNIFTY: bankniftyUniverse,
      FINNIFTY: finniftyUniverse,
    };
    const niftyFuture = repository.getNearestFuture("NIFTY", now);
    const bankniftyFuture = repository.getNearestFuture("BANKNIFTY", now);
    const finniftyFuture = repository.getNearestFuture("FINNIFTY", now);

    if (!niftyFuture || !bankniftyFuture || !finniftyFuture) {
      throw new Error("Missing simulated futures contracts.");
    }

    const ticks = [
      normalizeSimulatedTick({
        instrumentToken: 256265,
        timestamp: now,
        lastPrice: "25123.45",
        volume: 1000,
        sequence: 1,
      }),
      normalizeSimulatedTick({
        instrumentToken: 260105,
        timestamp: now,
        lastPrice: "53999.90",
        volume: 1000,
        sequence: 2,
      }),
      normalizeSimulatedTick({
        instrumentToken: 257801,
        timestamp: now,
        lastPrice: "24222.20",
        volume: 1000,
        sequence: 3,
      }),
      normalizeSimulatedTick({
        instrumentToken: niftyFuture.instrumentToken,
        timestamp: now,
        lastPrice: "25130.00",
        lastQuantity: 125,
        volume: 150_000,
        openInterest: 2_500_000,
        sequence: 4,
      }),
      normalizeSimulatedTick({
        instrumentToken: bankniftyFuture.instrumentToken,
        timestamp: now,
        lastPrice: "54040.00",
        lastQuantity: 100,
        volume: 120_000,
        openInterest: 1_900_000,
        sequence: 5,
      }),
      normalizeSimulatedTick({
        instrumentToken: finniftyFuture.instrumentToken,
        timestamp: now,
        lastPrice: "24240.00",
        lastQuantity: 80,
        volume: 90_000,
        openInterest: 1_100_000,
        sequence: 6,
      }),
      ...Object.values(optionUniverses)
        .flatMap((universe) => universe.instruments)
        .map((instrument, index) =>
          normalizeSimulatedTick({
            instrumentToken: instrument.instrumentToken,
            timestamp: now,
            lastPrice: instrument.instrumentType === "CE" ? "104.25" : "98.70",
            volume: 100_000 + index,
            openInterest: 800_000 + index,
            bid: instrument.instrumentType === "CE" ? "104.00" : "98.50",
            ask: instrument.instrumentType === "CE" ? "104.50" : "98.95",
            sequence: 10 + index,
          }),
        ),
    ];

    for (const tick of ticks) {
      stateStore.applyTick(tick, now);
      candleBuilder.applyTick(tick);
    }

    const snapshot = buildLiveMarketSnapshot({
      repository,
      stateStore,
      candleBuilder,
      provider: {
        connected: true,
        lastTickAt: now.toISOString(),
        reconnecting: false,
        subscriptionCount: ticks.length,
        rejectedSubscriptions: 0,
        reconnectCount: 0,
        uptimeSeconds: 30,
      },
      instrumentMasterCount: instruments.length,
      optionUniverses: {
        NIFTY: {
          selectedUnderlying: "NIFTY",
          expiry: niftyUniverse.expiry,
          atmStrike: niftyUniverse.atmStrike,
          instruments: niftyUniverse.instruments,
          missingContracts: niftyUniverse.missingContracts.length,
        },
        BANKNIFTY: {
          selectedUnderlying: "BANKNIFTY",
          expiry: bankniftyUniverse.expiry,
          atmStrike: bankniftyUniverse.atmStrike,
          instruments: bankniftyUniverse.instruments,
          missingContracts: bankniftyUniverse.missingContracts.length,
        },
        FINNIFTY: {
          selectedUnderlying: "FINNIFTY",
          expiry: finniftyUniverse.expiry,
          atmStrike: finniftyUniverse.atmStrike,
          instruments: finniftyUniverse.instruments,
          missingContracts: finniftyUniverse.missingContracts.length,
        },
      },
      generatedAt: now,
    });

    expect(snapshot?.health.mode).toBe("live");
    expect(snapshot?.underlyings[0].lastPrice).toBe(25123.45);
    expect(snapshot?.underlyings[0].lastPrice).not.toBe(25180);
    expect(snapshot?.optionChain).toHaveLength(11);
    expect(snapshot?.optionChains?.NIFTY).toHaveLength(11);
    expect(snapshot?.optionChains?.BANKNIFTY).toHaveLength(11);
    expect(snapshot?.optionChains?.FINNIFTY).toHaveLength(11);
    expect(snapshot?.optionChain[0].call.lotSize).toBe(75);
    expect(snapshot?.phase5.rowCount).toBe(11);
    expect(snapshot?.phase5ByUnderlying?.BANKNIFTY?.rowCount).toBe(11);
    expect(snapshot?.phase5ByUnderlying?.FINNIFTY?.rowCount).toBe(11);
    expect(snapshot?.phase2.indicatorSource?.tradingsymbol).toBe("NIFTY26SEPFUT");
    expect(snapshot?.phase2.indicatorSources?.BANKNIFTY?.tradingsymbol).toBe("BANKNIFTY26SEPFUT");
    expect(snapshot?.phase4ByUnderlying?.BANKNIFTY?.underlying).toBe("BANKNIFTY");
    expect(snapshot?.phase2.candleConfirmation?.status).toBe("BUILDING");
    expect(snapshot?.phase2.candleConfirmation?.decisionReady).toBe(false);
    expect(snapshot?.phase4.candleCount).toBe(0);
  });

  it("uses the last completed 1-minute candle for live indicators", () => {
    const instruments = createSimulatedInstrumentMaster();
    const repository = new InstrumentRepository(instruments);
    const stateStore = new MarketStateStore(repository);
    const candleBuilder = new CandleBuilder(["1m", "5m", "15m"]);
    const firstTickAt = new Date("2026-09-01T04:00:00.000Z");
    const secondTickAt = new Date("2026-09-01T04:01:00.000Z");
    const niftyInstrument = repository.findByTradingsymbol("NSE", "NIFTY");
    const niftyFuture = repository.getNearestFuture("NIFTY", firstTickAt);

    if (!niftyInstrument || !niftyFuture) {
      throw new Error("Missing NIFTY instruments.");
    }

    const ticks = [
      normalizeSimulatedTick({
        instrumentToken: niftyInstrument.instrumentToken,
        timestamp: firstTickAt,
        lastPrice: "25100.00",
        volume: 1000,
        sequence: 1,
      }),
      normalizeSimulatedTick({
        instrumentToken: niftyInstrument.instrumentToken,
        timestamp: secondTickAt,
        lastPrice: "25125.00",
        volume: 1300,
        sequence: 2,
      }),
      normalizeSimulatedTick({
        instrumentToken: niftyFuture.instrumentToken,
        timestamp: firstTickAt,
        lastPrice: "25110.00",
        lastQuantity: 100,
        volume: 1000,
        sequence: 3,
      }),
      normalizeSimulatedTick({
        instrumentToken: niftyFuture.instrumentToken,
        timestamp: secondTickAt,
        lastPrice: "25135.00",
        lastQuantity: 150,
        volume: 1150,
        sequence: 4,
      }),
    ];

    for (const tick of ticks) {
      stateStore.applyTick(tick, secondTickAt);
      candleBuilder.applyTick(tick);
    }

    const snapshot = buildLiveMarketSnapshot({
      repository,
      stateStore,
      candleBuilder,
      provider: {
        connected: true,
        lastTickAt: secondTickAt.toISOString(),
        reconnecting: false,
        subscriptionCount: 1,
        rejectedSubscriptions: 0,
        reconnectCount: 0,
        uptimeSeconds: 60,
      },
      instrumentMasterCount: instruments.length,
      generatedAt: secondTickAt,
    });

    expect(snapshot?.phase2.candleConfirmation?.status).toBe("BUILDING");
    expect(snapshot?.phase2.candleConfirmation?.decisionReady).toBe(true);
    expect(snapshot?.phase2.candleConfirmation?.lastCompletedCandleEnd).toBe(
      "2026-09-01T04:01:00.000Z",
    );
    expect(snapshot?.phase2.indicatorSource?.kind).toBe("FUTURE");
    expect(snapshot?.phase4.candleCount).toBe(1);
    expect(snapshot?.phase4.latestClose).toBe("25110.00");
  });
});
