import Decimal from "decimal.js";
import { DEFAULT_UNDERLYINGS } from "@/lib/config/market";
import { InstrumentRepository } from "@/lib/instruments/instrument-repository";
import { createSimulatedInstrumentMaster } from "@/lib/instruments/simulated-instruments";
import { CandleBuilder } from "@/lib/market/candle-builder";
import { MarketStateStore } from "@/lib/market/market-state";
import { SimulatedMarketDataProvider } from "@/lib/providers/simulated-market-data-provider";
import type { SimulatedPhase2Pipeline } from "@/types/simulation";
import type { InstrumentRecord } from "@/types/instruments";

const SIMULATION_SESSION_START = new Date("2026-09-01T03:45:00.000Z");

function getBasePrice(instrument: InstrumentRecord) {
  if (instrument.underlyingSymbol === "BANKNIFTY" && instrument.kind === "INDEX") return "53840";
  if (instrument.underlyingSymbol === "FINNIFTY" && instrument.kind === "INDEX") return "24170";
  if (instrument.underlyingSymbol === "NIFTY" && instrument.kind === "INDEX") return "25180";

  const strike = new Decimal(instrument.strike ?? 0);
  const reference =
    instrument.underlyingSymbol === "BANKNIFTY"
      ? new Decimal(53800)
      : instrument.underlyingSymbol === "FINNIFTY"
        ? new Decimal(24200)
        : new Decimal(25200);
  const distance = strike.minus(reference).abs();
  const basePremium = Decimal.max(28, new Decimal(190).minus(distance.mul(0.75)));

  if (instrument.instrumentType === "CE") {
    return basePremium.plus(strike.lte(reference) ? 18 : 0).toFixed(2);
  }

  return basePremium.plus(strike.gte(reference) ? 15 : 0).toFixed(2);
}

export function createPhase2PipelineSnapshot(
  step: number,
  underlyingLastPrice: string,
): SimulatedPhase2Pipeline {
  const instruments = createSimulatedInstrumentMaster();
  const repository = new InstrumentRepository(instruments);
  const selectedUnderlying = "NIFTY";
  const underlyingConfig = DEFAULT_UNDERLYINGS.find(
    (config) => config.symbol === selectedUnderlying,
  );

  if (!underlyingConfig) {
    throw new Error("Missing NIFTY configuration.");
  }

  const selectedExpiry = repository.getNearestExpiry(selectedUnderlying, SIMULATION_SESSION_START);

  if (!selectedExpiry) {
    throw new Error("Missing simulated NIFTY expiry.");
  }

  const optionUniverse = repository.buildAtmOptionUniverse({
    underlyingSymbol: selectedUnderlying,
    underlyingLastPrice,
    expiry: selectedExpiry,
    strikeInterval: underlyingConfig.strikeInterval,
    strikeWindow: underlyingConfig.atmStrikeWindow,
  });
  const underlyingInstruments = instruments.filter((instrument) => instrument.kind === "INDEX");
  const subscriptions = [...underlyingInstruments, ...optionUniverse.instruments].map(
    (instrument) => ({
      instrumentToken: instrument.instrumentToken,
      mode: instrument.kind === "INDEX" ? underlyingConfig.underlyingMode : underlyingConfig.optionMode,
    }),
  );
  const subscriptionTokens = new Set(subscriptions.map((subscription) => subscription.instrumentToken));
  const seeds = instruments
    .filter((instrument) => subscriptionTokens.has(instrument.instrumentToken))
    .map((instrument) => ({
      instrumentToken: instrument.instrumentToken,
      basePrice: getBasePrice(instrument),
      volumeBase: instrument.kind === "INDEX" ? 50_000 : 110_000,
      openInterestBase: instrument.kind === "INDEX" ? 0 : 850_000,
    }));
  const provider = new SimulatedMarketDataProvider(seeds);
  const stateStore = new MarketStateStore(repository);
  const candleBuilder = new CandleBuilder(["1m", "5m", "15m"]);

  provider.onTick((tick) => {
    stateStore.applyTick(tick, SIMULATION_SESSION_START);
    candleBuilder.applyTick(tick);
  });
  void provider.connect();
  void provider.subscribe(subscriptions);

  const emissions = Math.max(1, Math.min(5, step + 1));
  let latestTickToken: number | undefined;

  for (let index = 0; index < emissions; index += 1) {
    const emittedAt = new Date(SIMULATION_SESSION_START.getTime() + index * 30_000);
    const ticks = provider.emitNextTick(emittedAt);
    latestTickToken = ticks.at(-1)?.instrumentToken;
  }

  const status = provider.getStatus();
  const stateSummary = stateStore.getSummary(
    new Date(SIMULATION_SESSION_START.getTime() + emissions * 30_000),
  );
  const niftyToken = repository.findByTradingsymbol("NSE", "NIFTY")?.instrumentToken;
  const activeCandles = candleBuilder
    .getActiveCandles()
    .filter((candle) => candle.instrumentToken === niftyToken);

  return {
    instrumentMasterCount: instruments.length,
    selectedUnderlying,
    selectedExpiry,
    atmStrike: optionUniverse.atmStrike,
    optionUniverseCount: optionUniverse.instruments.length,
    missingContracts: optionUniverse.missingContracts.length,
    subscriptionCount: status.subscriptionCount,
    rejectedSubscriptions: status.rejectedSubscriptions,
    trackedInstruments: stateSummary.instrumentsTracked,
    dataQuality: stateSummary.dataQuality,
    latestTickToken,
    activeCandles,
    completedCandleCount: candleBuilder.getCompletedCandles().length,
  };
}
