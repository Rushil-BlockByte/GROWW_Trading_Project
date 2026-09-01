import Decimal from "decimal.js";
import { DEFAULT_UNDERLYINGS } from "@/lib/config/market";
import { buildIndicatorContext } from "@/lib/indicators/core";
import type { InstrumentRepository } from "@/lib/instruments/instrument-repository";
import type { MarketStateStore } from "@/lib/market/market-state";
import { addMinutes } from "@/lib/market/session";
import type { MarketDataProviderStatus } from "@/lib/providers/market-data-provider";
import { buildOptionChainContext } from "@/lib/options/chain-context";
import { evaluateVwapBreakoutStrategy } from "@/lib/strategy/vwap-breakout";
import type { MarketCandleData } from "@/types/candles";
import type { IndicatorCandle } from "@/types/indicators";
import type { InstrumentRecord } from "@/types/instruments";
import type { DataQualityStatus, MarketRegime, MarketTick, UnderlyingSymbol } from "@/types/market";
import type {
  OneMinuteCandleConfirmation,
  SimulatedMarketSnapshot,
  SimulatedOptionLeg,
  SimulatedOptionRow,
  SimulatedUnderlying,
} from "@/types/simulation";

const LIVE_SELECTED_UNDERLYING: UnderlyingSymbol = "NIFTY";

export type LiveIndicatorPreviousDay = {
  high: Decimal.Value;
  low: Decimal.Value;
  close: Decimal.Value;
};

export type LiveOptionUniverseSnapshot = {
  selectedUnderlying: UnderlyingSymbol;
  expiry: string;
  atmStrike: string;
  instruments: InstrumentRecord[];
  missingContracts: number;
};

export type LiveOptionUniversesSnapshot = Partial<Record<UnderlyingSymbol, LiveOptionUniverseSnapshot>>;

export type LiveMarketSnapshotInput = {
  repository?: InstrumentRepository;
  stateStore?: MarketStateStore;
  candleBuilder?: {
    getActiveCandles(): MarketCandleData[];
    getCompletedCandles(): MarketCandleData[];
  };
  sessionCandlesByToken?: ReadonlyMap<number, IndicatorCandle[]>;
  warmupCandlesByToken?: ReadonlyMap<number, IndicatorCandle[]>;
  previousDayByToken?: ReadonlyMap<number, LiveIndicatorPreviousDay>;
  provider: MarketDataProviderStatus;
  instrumentMasterCount: number;
  optionUniverse?: LiveOptionUniverseSnapshot;
  optionUniverses?: LiveOptionUniversesSnapshot;
  generatedAt?: Date;
};

export function buildLiveMarketSnapshot({
  repository,
  stateStore,
  candleBuilder,
  sessionCandlesByToken,
  warmupCandlesByToken,
  previousDayByToken,
  provider,
  instrumentMasterCount,
  optionUniverse,
  optionUniverses,
  generatedAt = new Date(),
}: LiveMarketSnapshotInput): SimulatedMarketSnapshot | undefined {
  if (!repository || !stateStore || provider.connected === false) {
    return undefined;
  }

  const stateSummary = stateStore.getSummary(generatedAt);
  const underlyings = buildLiveUnderlyings({
    repository,
    stateStore,
    dataQuality: stateSummary.dataQuality,
  });
  const niftyState = findUnderlyingState({
    repository,
    stateStore,
    symbol: LIVE_SELECTED_UNDERLYING,
  });

  if (!niftyState) {
    return undefined;
  }

  const niftyInstrumentToken = niftyState.instrument.instrumentToken;
  const niftySessionCandles = sessionCandlesByToken?.get(niftyInstrumentToken) ?? [];
  const completedIndicatorCandles = liveIndicatorCandles({
    candleBuilder,
    instrumentToken: niftyInstrumentToken,
    sessionCandles: niftySessionCandles,
  });
  const candleConfirmation = buildOneMinuteCandleConfirmation({
    candleBuilder,
    instrumentToken: niftyInstrumentToken,
    sessionCandles: niftySessionCandles,
  });
  const liveOptionUniverses =
    optionUniverses ??
    (optionUniverse
      ? {
          [optionUniverse.selectedUnderlying]: optionUniverse,
        }
      : {});
  const optionChains = buildLiveOptionChainsByUnderlying({
    optionUniverses: liveOptionUniverses,
    stateStore,
  });
  const phase5ByUnderlying = buildLiveOptionContextByUnderlying({
    optionChains,
    optionUniverses: liveOptionUniverses,
    repository,
    stateStore,
  });
  const optionChain = optionChains[LIVE_SELECTED_UNDERLYING] ?? [];
  const phase5 =
    phase5ByUnderlying[LIVE_SELECTED_UNDERLYING] ??
    buildOptionChainContext({
      underlying: LIVE_SELECTED_UNDERLYING,
      underlyingLastPrice: niftyState.state.latestTick.lastPrice,
      expiry: liveOptionUniverses[LIVE_SELECTED_UNDERLYING]?.expiry ?? "",
      rows: optionChain,
    });
  const phase4 = buildIndicatorContext({
    underlying: LIVE_SELECTED_UNDERLYING,
    candles: completedIndicatorCandles,
    warmupCandles: warmupCandlesByToken?.get(niftyInstrumentToken) ?? [],
    previousDay:
      previousDayByToken?.get(niftyInstrumentToken) ??
      previousDayFromTick(niftyState.state.latestTick),
  });
  const phase6 = evaluateVwapBreakoutStrategy({
    indicator: phase4,
    optionContext: phase5,
    marketRegime: underlyings[0]?.regime ?? "SIDEWAYS",
    dataQuality: stateSummary.dataQuality,
  });

  return {
    generatedAt: generatedAt.toISOString(),
    underlyings,
    optionChain,
    optionChains,
    signal: {
      id: phase6.id,
      underlying: phase6.underlying,
      direction: phase6.direction,
      setupName: phase6.name,
      score: phase6.score,
      quality: phase6.quality,
      suggestedOption: phase6.selectedContract?.label,
      entryRange: phase6.entryPlan?.entryTrigger,
      underlyingInvalidation: phase6.entryPlan
        ? Number(phase6.entryPlan.invalidation)
        : undefined,
      optionStopEstimate: phase6.entryPlan ? Number(phase6.entryPlan.invalidation) : undefined,
      targetOne: phase6.entryPlan ? Number(phase6.entryPlan.targetOne) : undefined,
      targetTwo: phase6.entryPlan ? Number(phase6.entryPlan.targetTwo) : undefined,
      riskReward: phase6.entryPlan?.riskReward,
      reasons: phase6.reasons,
      risks: phase6.risks,
      state: phase6.state,
    },
    health: {
      websocket: provider.connected
        ? "CONNECTED"
        : provider.reconnecting
          ? "RECONNECTING"
          : "DISCONNECTED",
      lastTickSecondsAgo: provider.lastTickAt
        ? Math.max(0, Math.floor((generatedAt.getTime() - new Date(provider.lastTickAt).getTime()) / 1000))
        : 0,
      subscriptions: provider.subscriptionCount,
      rejectedSubscriptions: provider.rejectedSubscriptions,
      dataQuality: stateSummary.dataQuality,
      signalEngine: stateSummary.dataQuality === "GOOD" ? "RUNNING" : "PARKED",
      database: process.env.DATABASE_URL ? "CONFIGURED" : "NOT_CONFIGURED",
      mode: "live",
    },
    phase2: {
      instrumentMasterCount,
      selectedUnderlying: LIVE_SELECTED_UNDERLYING,
      selectedExpiry: liveOptionUniverses[LIVE_SELECTED_UNDERLYING]?.expiry ?? "",
      atmStrike: liveOptionUniverses[LIVE_SELECTED_UNDERLYING]?.atmStrike ?? "",
      optionUniverseCount: optionUniverseCount(liveOptionUniverses),
      missingContracts: missingContractCount(liveOptionUniverses),
      subscriptionCount: provider.subscriptionCount,
      rejectedSubscriptions: provider.rejectedSubscriptions,
      trackedInstruments: stateSummary.instrumentsTracked,
      dataQuality: stateSummary.dataQuality,
      activeCandles:
        candleBuilder
          ?.getActiveCandles()
          .filter((candle) => candle.instrumentToken === niftyInstrumentToken) ?? [],
      completedCandleCount: completedIndicatorCandles.length,
      candleConfirmation,
    },
    phase4,
    phase5,
    phase5ByUnderlying,
    phase6,
  };
}

function buildLiveUnderlyings({
  repository,
  stateStore,
  dataQuality,
}: {
  repository: InstrumentRepository;
  stateStore: MarketStateStore;
  dataQuality: DataQualityStatus;
}) {
  return DEFAULT_UNDERLYINGS.map((underlying) => {
    const match = findUnderlyingState({
      repository,
      stateStore,
      symbol: underlying.symbol,
    });

    return liveUnderlyingFromState({
      dataQuality,
      label: underlying.label,
      state: match?.state,
      symbol: underlying.symbol,
    });
  });
}

function findUnderlyingState({
  repository,
  stateStore,
  symbol,
}: {
  repository: InstrumentRepository;
  stateStore: MarketStateStore;
  symbol: UnderlyingSymbol;
}) {
  const instrument = repository
    .getAll()
    .find((candidate) => candidate.kind === "INDEX" && candidate.underlyingSymbol === symbol);

  if (!instrument) return undefined;

  const state = stateStore.getInstrumentState(instrument.instrumentToken);

  if (!state) return undefined;

  return { instrument, state };
}

function liveUnderlyingFromState({
  dataQuality,
  label,
  state,
  symbol,
}: {
  dataQuality: DataQualityStatus;
  label: string;
  state: ReturnType<MarketStateStore["getInstrumentState"]>;
  symbol: UnderlyingSymbol;
}): SimulatedUnderlying {
  const tick = state?.latestTick;
  const previousReference = numberFromDecimal(tick?.close ?? state?.previousTick?.lastPrice);
  const lastPrice = numberFromDecimal(tick?.lastPrice);
  const change =
    lastPrice !== null && previousReference !== null ? round(lastPrice - previousReference) : null;
  const changePercent =
    change !== null && previousReference !== null && previousReference > 0
      ? round((change / previousReference) * 100)
      : null;
  const vwap = numberFromDecimal(tick?.averagePrice);

  return {
    symbol,
    label,
    lastPrice,
    change,
    changePercent,
    vwap,
    vwapDistance: lastPrice !== null && vwap !== null ? round(lastPrice - vwap) : null,
    trend: liveTrend({ change, lastPrice, vwap }),
    volumeRelative: null,
    openInterest: state?.currentOpenInterest ?? null,
    oiChange:
      state?.currentOpenInterest !== undefined && state.previousOpenInterest !== undefined
        ? state.currentOpenInterest - state.previousOpenInterest
        : null,
    regime: liveRegime(changePercent),
    dataQuality,
    support: numberFromDecimal(tick?.low),
    resistance: numberFromDecimal(tick?.high),
  };
}

function liveIndicatorCandles({
  candleBuilder,
  instrumentToken,
  sessionCandles = [],
}: {
  candleBuilder: LiveMarketSnapshotInput["candleBuilder"];
  instrumentToken: number;
  sessionCandles?: IndicatorCandle[];
}): IndicatorCandle[] {
  return liveOneMinuteMarketCandles({
    candleBuilder,
    instrumentToken,
    sessionCandles,
  })
    .map((candle) => ({
      startTime: candle.startTime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      openInterest: candle.openInterest,
    }));
}

function liveOneMinuteMarketCandles({
  candleBuilder,
  instrumentToken,
  sessionCandles = [],
}: {
  candleBuilder: LiveMarketSnapshotInput["candleBuilder"];
  instrumentToken: number;
  sessionCandles?: IndicatorCandle[];
}): MarketCandleData[] {
  const candles = [
    ...sessionCandles.map((candle) => completedMarketCandleFromIndicator(candle, instrumentToken)),
    ...(candleBuilder?.getCompletedCandles() ?? []),
  ];
  const byStartTime = new Map<string, MarketCandleData>();

  for (const candle of candles) {
    if (candle.instrumentToken === instrumentToken && candle.interval === "1m") {
      byStartTime.set(candle.startTime, candle);
    }
  }

  return Array.from(byStartTime.values()).sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );
}

function completedMarketCandleFromIndicator(
  candle: IndicatorCandle,
  instrumentToken: number,
): MarketCandleData {
  return {
    instrumentToken,
    interval: "1m",
    startTime: candle.startTime,
    endTime: oneMinuteEndTime(candle.startTime),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    openInterest: candle.openInterest,
    tickCount: 0,
    isComplete: true,
  };
}

function buildOneMinuteCandleConfirmation({
  candleBuilder,
  instrumentToken,
  sessionCandles = [],
}: {
  candleBuilder: LiveMarketSnapshotInput["candleBuilder"];
  instrumentToken: number;
  sessionCandles?: IndicatorCandle[];
}): OneMinuteCandleConfirmation {
  const completedCandles = liveOneMinuteMarketCandles({
    candleBuilder,
    instrumentToken,
    sessionCandles,
  });
  const currentCandle =
    candleBuilder
      ?.getActiveCandles()
      .find((candle) => candle.instrumentToken === instrumentToken && candle.interval === "1m") ?? null;
  const lastCompletedCandle = completedCandles.at(-1) ?? null;
  const decisionReady = Boolean(lastCompletedCandle);

  if (currentCandle) {
    return {
      status: "BUILDING",
      currentCandleStart: currentCandle.startTime,
      currentCandleEnd: currentCandle.endTime,
      lastCompletedCandleStart: lastCompletedCandle?.startTime ?? null,
      lastCompletedCandleEnd: lastCompletedCandle?.endTime ?? null,
      nextConfirmationTime: currentCandle.endTime,
      decisionReady,
      message: decisionReady
        ? "Use the last closed 1-minute candle; the current candle is still building."
        : "Wait for the first 1-minute candle to close before taking a paper trade.",
    };
  }

  if (lastCompletedCandle) {
    return {
      status: "CONFIRMED",
      currentCandleStart: null,
      currentCandleEnd: null,
      lastCompletedCandleStart: lastCompletedCandle.startTime,
      lastCompletedCandleEnd: lastCompletedCandle.endTime,
      nextConfirmationTime: lastCompletedCandle.endTime,
      decisionReady: true,
      message: "Latest 1-minute candle is closed and ready for the indicator filter.",
    };
  }

  return {
    status: "WAITING_FOR_TICK",
    currentCandleStart: null,
    currentCandleEnd: null,
    lastCompletedCandleStart: null,
    lastCompletedCandleEnd: null,
    nextConfirmationTime: null,
    decisionReady: false,
    message: "Waiting for live ticks to build the first 1-minute candle.",
  };
}

function oneMinuteEndTime(startTime: string) {
  const parsed = new Date(startTime);

  return Number.isNaN(parsed.getTime()) ? startTime : addMinutes(parsed, 1).toISOString();
}

function buildLiveOptionChainsByUnderlying({
  optionUniverses,
  stateStore,
}: {
  optionUniverses: LiveOptionUniversesSnapshot;
  stateStore: MarketStateStore;
}) {
  return DEFAULT_UNDERLYINGS.reduce<Partial<Record<UnderlyingSymbol, SimulatedOptionRow[]>>>(
    (chains, underlying) => {
      chains[underlying.symbol] = buildLiveOptionChainRows({
        optionUniverse: optionUniverses[underlying.symbol],
        stateStore,
      });

      return chains;
    },
    {},
  );
}

function buildLiveOptionContextByUnderlying({
  optionChains,
  optionUniverses,
  repository,
  stateStore,
}: {
  optionChains: Partial<Record<UnderlyingSymbol, SimulatedOptionRow[]>>;
  optionUniverses: LiveOptionUniversesSnapshot;
  repository: InstrumentRepository;
  stateStore: MarketStateStore;
}) {
  return DEFAULT_UNDERLYINGS.reduce<Partial<Record<UnderlyingSymbol, ReturnType<typeof buildOptionChainContext>>>>(
    (contexts, underlying) => {
      const match = findUnderlyingState({
        repository,
        stateStore,
        symbol: underlying.symbol,
      });

      if (!match) return contexts;

      contexts[underlying.symbol] = buildOptionChainContext({
        underlying: underlying.symbol,
        underlyingLastPrice: match.state.latestTick.lastPrice,
        expiry: optionUniverses[underlying.symbol]?.expiry ?? "",
        rows: optionChains[underlying.symbol] ?? [],
      });

      return contexts;
    },
    {},
  );
}

function optionUniverseCount(optionUniverses: LiveOptionUniversesSnapshot) {
  return Object.values(optionUniverses).reduce(
    (count, universe) => count + (universe?.instruments.length ?? 0),
    0,
  );
}

function missingContractCount(optionUniverses: LiveOptionUniversesSnapshot) {
  return Object.values(optionUniverses).reduce(
    (count, universe) => count + (universe?.missingContracts ?? 0),
    0,
  );
}

function previousDayFromTick(tick: MarketTick) {
  const close = tick.close ?? tick.lastPrice;

  return {
    high: tick.close ?? close,
    low: tick.close ?? close,
    close,
  };
}

function buildLiveOptionChainRows({
  optionUniverse,
  stateStore,
}: {
  optionUniverse: LiveOptionUniverseSnapshot | undefined;
  stateStore: MarketStateStore;
}): SimulatedOptionRow[] {
  if (!optionUniverse) return [];

  const grouped = new Map<number, Partial<Record<"CE" | "PE", SimulatedOptionLeg>>>();
  const atmStrike = Number(optionUniverse.atmStrike);

  for (const instrument of optionUniverse.instruments) {
    if (instrument.kind !== "OPTION_CE" && instrument.kind !== "OPTION_PE") continue;

    const strike = Number(instrument.strike);
    const state = stateStore.getInstrumentState(instrument.instrumentToken);
    const leg = state ? liveOptionLegFromState(state, instrument) : undefined;

    if (!Number.isFinite(strike) || !leg) continue;

    const side = instrument.kind === "OPTION_CE" ? "CE" : "PE";
    const current = grouped.get(strike) ?? {};
    current[side] = leg;
    grouped.set(strike, current);
  }

  return Array.from(grouped.entries())
    .filter(([, legs]) => legs.CE && legs.PE)
    .sort(([a], [b]) => a - b)
    .map(([strike, legs]) => ({
      strike,
      isAtm: Number.isFinite(atmStrike) && strike === atmStrike,
      call: legs.CE as SimulatedOptionLeg,
      put: legs.PE as SimulatedOptionLeg,
    }));
}

function liveOptionLegFromState(
  state: NonNullable<ReturnType<MarketStateStore["getInstrumentState"]>>,
  instrument: InstrumentRecord,
): SimulatedOptionLeg {
  const tick = state.latestTick;
  const ltp = numberFromDecimal(tick.lastPrice) ?? 0;
  const bid = numberFromDecimal(state.bid ?? tick.bid) ?? 0;
  const ask = numberFromDecimal(state.ask ?? tick.ask) ?? 0;

  return {
    ltp,
    volume: state.currentVolume ?? tick.volume ?? 0,
    openInterest: state.currentOpenInterest ?? tick.openInterest ?? 0,
    oiChange:
      state.currentOpenInterest !== undefined && state.previousOpenInterest !== undefined
        ? state.currentOpenInterest - state.previousOpenInterest
        : 0,
    bid,
    ask,
    spreadPercent:
      ltp > 0 && bid > 0 && ask > bid ? round(((ask - bid) / ltp) * 100) : 999,
    lotSize: instrument.lotSize,
  };
}

function liveTrend({
  change,
  lastPrice,
  vwap,
}: {
  change: number | null;
  lastPrice: number | null;
  vwap: number | null;
}): SimulatedUnderlying["trend"] {
  if (lastPrice !== null && vwap !== null) {
    if (lastPrice > vwap) return "Bullish";
    if (lastPrice < vwap) return "Bearish";
  }

  if (change !== null) {
    if (change > 0) return "Bullish";
    if (change < 0) return "Bearish";
  }

  return "Flat";
}

function liveRegime(changePercent: number | null): MarketRegime {
  if (changePercent === null) return "SIDEWAYS";
  if (changePercent >= 1) return "STRONG_BULLISH";
  if (changePercent > 0.15) return "BULLISH";
  if (changePercent <= -1) return "STRONG_BEARISH";
  if (changePercent < -0.15) return "BEARISH";

  return "SIDEWAYS";
}

function numberFromDecimal(value: Decimal.Value | undefined) {
  if (value === undefined || value === null || value === "") return null;

  const decimal = new Decimal(value);

  return decimal.isFinite() ? decimal.toNumber() : null;
}

function round(value: number, precision = 2) {
  const scale = 10 ** precision;

  return Math.round(value * scale) / scale;
}
