import Decimal from "decimal.js";
import { DEFAULT_UNDERLYINGS } from "@/lib/config/market";
import { buildIndicatorContext } from "@/lib/indicators/core";
import type { InstrumentRepository } from "@/lib/instruments/instrument-repository";
import type { MarketStateStore } from "@/lib/market/market-state";
import { addMinutes } from "@/lib/market/session";
import type { MarketDataProviderStatus } from "@/lib/providers/market-data-provider";
import { buildOptionChainContext } from "@/lib/options/chain-context";
import { evaluateSrFlipSignal } from "@/lib/strategy/sr-flip";
import { srFlipSignalSummary } from "@/lib/strategy/sr-flip-signal";
import type { LevelCandle, SrLevel } from "@/types/sr-flip";
import type { MarketCandleData } from "@/types/candles";
import type { IndicatorCandle, IndicatorContext } from "@/types/indicators";
import type { InstrumentRecord } from "@/types/instruments";
import type { DataQualityStatus, MarketRegime, MarketTick, UnderlyingSymbol } from "@/types/market";
import type {
  IndicatorSourceInstrument,
  CandleConfirmation,
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
  indicatorInstruments?: Partial<Record<UnderlyingSymbol, InstrumentRecord>>;
  srLevelsByUnderlying?: Partial<Record<UnderlyingSymbol, SrLevel[]>>;
  indiaVix?: number | null;
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
  indicatorInstruments,
  srLevelsByUnderlying,
  indiaVix,
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

  const indicatorSources = buildLiveIndicatorSourcesByUnderlying({
    asOf: generatedAt,
    indicatorInstruments,
    repository,
    stateStore,
  });
  const selectedIndicatorSource =
    indicatorSources[LIVE_SELECTED_UNDERLYING] ?? {
      instrument: niftyState.instrument,
      state: niftyState.state,
    };
  const selectedIndicatorToken = selectedIndicatorSource.instrument.instrumentToken;
  const selectedSessionCandles = sessionCandlesByToken?.get(selectedIndicatorToken) ?? [];
  const completedIndicatorCandles = liveIndicatorCandles({
    candleBuilder,
    instrumentToken: selectedIndicatorToken,
    sessionCandles: selectedSessionCandles,
  });
  const candleConfirmation = buildCandleConfirmation({
    candleBuilder,
    instrumentToken: selectedIndicatorToken,
    sessionCandles: selectedSessionCandles,
  });
  const phase4ByUnderlying = buildLiveIndicatorContextByUnderlying({
    candleBuilder,
    indicatorSources,
    previousDayByToken,
    sessionCandlesByToken,
    warmupCandlesByToken,
  });
  const indicatorSourceMetadata = indicatorSourceFromInstrument(
    selectedIndicatorSource.instrument,
  );
  const indicatorSourceMetadataByUnderlying =
    indicatorSourcesFromInstrumentMap(indicatorSources);
  const candleConfirmations = buildLiveCandleConfirmationsByUnderlying({
    candleBuilder,
    indicatorSources,
    sessionCandlesByToken,
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
  const phase4 =
    phase4ByUnderlying[LIVE_SELECTED_UNDERLYING] ??
    buildIndicatorContext({
      underlying: LIVE_SELECTED_UNDERLYING,
      candles: completedIndicatorCandles,
      warmupCandles: warmupCandlesByToken?.get(selectedIndicatorToken) ?? [],
      previousDay:
        previousDayByToken?.get(selectedIndicatorToken) ??
        previousDayFromTick(selectedIndicatorSource.state?.latestTick ?? niftyState.state.latestTick),
    });
  const srReferencePrice =
    numberFromDecimal(niftyState.state.latestTick.lastPrice) ?? 0;
  const srSessionBars = fiveMinuteBars(
    liveOneMinuteMarketCandles({
      candleBuilder,
      instrumentToken: niftyState.instrument.instrumentToken,
      sessionCandles: sessionCandlesByToken?.get(niftyState.instrument.instrumentToken) ?? [],
    }),
  );
  const phase6 = evaluateSrFlipSignal({
    underlying: LIVE_SELECTED_UNDERLYING,
    levels: srLevelsByUnderlying?.[LIVE_SELECTED_UNDERLYING] ?? [],
    sessionBars: srSessionBars,
    referencePrice: srReferencePrice,
    vix: indiaVix ?? null,
  });

  return {
    generatedAt: generatedAt.toISOString(),
    underlyings,
    optionChain,
    optionChains,
    signal: srFlipSignalSummary(phase6),
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
          .filter((candle) => candle.instrumentToken === selectedIndicatorToken) ?? [],
      completedCandleCount: completedIndicatorCandles.length,
      indicatorSource: indicatorSourceMetadata,
      indicatorSources: indicatorSourceMetadataByUnderlying,
      candleConfirmation,
      candleConfirmations,
    },
    phase4,
    phase4ByUnderlying,
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

type LiveIndicatorSourceState = {
  instrument: InstrumentRecord;
  state?: ReturnType<MarketStateStore["getInstrumentState"]>;
};

function buildLiveIndicatorSourcesByUnderlying({
  asOf,
  indicatorInstruments,
  repository,
  stateStore,
}: {
  asOf: Date;
  indicatorInstruments: LiveMarketSnapshotInput["indicatorInstruments"];
  repository: InstrumentRepository;
  stateStore: MarketStateStore;
}) {
  return DEFAULT_UNDERLYINGS.reduce<Partial<Record<UnderlyingSymbol, LiveIndicatorSourceState>>>(
    (sources, underlying) => {
      const symbol = underlying.symbol;
      const preferred = indicatorInstruments?.[symbol];
      const future =
        preferred?.kind === "FUTURE" ? preferred : repository.getNearestFuture(symbol, asOf);
      const fallback = future ?? preferred ?? findUnderlyingState({ repository, stateStore, symbol })?.instrument;

      if (!fallback) return sources;

      sources[symbol] = {
        instrument: fallback,
        state: stateStore.getInstrumentState(fallback.instrumentToken),
      };

      return sources;
    },
    {},
  );
}

function buildLiveIndicatorContextByUnderlying({
  candleBuilder,
  indicatorSources,
  previousDayByToken,
  sessionCandlesByToken,
  warmupCandlesByToken,
}: {
  candleBuilder: LiveMarketSnapshotInput["candleBuilder"];
  indicatorSources: Partial<Record<UnderlyingSymbol, LiveIndicatorSourceState>>;
  previousDayByToken: LiveMarketSnapshotInput["previousDayByToken"];
  sessionCandlesByToken: LiveMarketSnapshotInput["sessionCandlesByToken"];
  warmupCandlesByToken: LiveMarketSnapshotInput["warmupCandlesByToken"];
}) {
  return DEFAULT_UNDERLYINGS.reduce<Partial<Record<UnderlyingSymbol, IndicatorContext>>>(
    (contexts, underlying) => {
      const source = indicatorSources[underlying.symbol];

      if (!source) return contexts;

      const token = source.instrument.instrumentToken;
      const sessionCandles = sessionCandlesByToken?.get(token) ?? [];
      const warmupCandles = warmupCandlesByToken?.get(token) ?? [];
      const completedCandles = liveIndicatorCandles({
        candleBuilder,
        instrumentToken: token,
        sessionCandles,
      });
      const previousDay =
        previousDayByToken?.get(token) ??
        (source.state ? previousDayFromTick(source.state.latestTick) : previousDayFromCandlesForFallback([
          ...warmupCandles,
          ...completedCandles,
        ]));

      if (!previousDay) return contexts;

      contexts[underlying.symbol] = buildIndicatorContext({
        underlying: underlying.symbol,
        candles: completedCandles,
        warmupCandles,
        previousDay,
      });

      return contexts;
    },
    {},
  );
}

function buildLiveCandleConfirmationsByUnderlying({
  candleBuilder,
  indicatorSources,
  sessionCandlesByToken,
}: {
  candleBuilder: LiveMarketSnapshotInput["candleBuilder"];
  indicatorSources: Partial<Record<UnderlyingSymbol, LiveIndicatorSourceState>>;
  sessionCandlesByToken: LiveMarketSnapshotInput["sessionCandlesByToken"];
}) {
  return DEFAULT_UNDERLYINGS.reduce<
    Partial<Record<UnderlyingSymbol, CandleConfirmation>>
  >((confirmations, underlying) => {
    const source = indicatorSources[underlying.symbol];

    if (!source) return confirmations;

    const token = source.instrument.instrumentToken;

    confirmations[underlying.symbol] = buildCandleConfirmation({
      candleBuilder,
      instrumentToken: token,
      sessionCandles: sessionCandlesByToken?.get(token) ?? [],
    });

    return confirmations;
  }, {});
}

function indicatorSourceFromInstrument(
  instrument: InstrumentRecord,
): IndicatorSourceInstrument | undefined {
  if (
    !instrument.underlyingSymbol ||
    instrument.underlyingSymbol === "INDIA_VIX" ||
    (instrument.kind !== "FUTURE" && instrument.kind !== "INDEX")
  ) {
    return undefined;
  }

  return {
    underlying: instrument.underlyingSymbol,
    exchange: instrument.exchange,
    tradingsymbol: instrument.tradingsymbol,
    instrumentToken: instrument.instrumentToken,
    kind: instrument.kind,
    expiry: instrument.expiry,
  };
}

function indicatorsSourcesEntries(
  indicatorSources: Partial<Record<UnderlyingSymbol, LiveIndicatorSourceState>>,
) {
  return Object.entries(indicatorSources).flatMap(([symbol, source]) => {
    const value = source ? indicatorSourceFromInstrument(source.instrument) : undefined;

    return value ? [[symbol as UnderlyingSymbol, value] as const] : [];
  });
}

function indicatorSourcesFromInstrumentMap(
  indicatorSources: Partial<Record<UnderlyingSymbol, LiveIndicatorSourceState>>,
) {
  return Object.fromEntries(indicatorsSourcesEntries(indicatorSources)) as Partial<
    Record<UnderlyingSymbol, IndicatorSourceInstrument>
  >;
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

/**
 * Aggregate 1-minute candles into CLOSED 5-minute candles. Only complete groups
 * of five are emitted, so the forming (not-yet-closed) 5-minute candle is
 * dropped — levels and pattern detection wait for the 5-minute candle to close.
 */
function fiveMinuteBars(oneMinute: MarketCandleData[]): LevelCandle[] {
  const sorted = [...oneMinute].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );
  const bars: LevelCandle[] = [];

  for (let index = 0; index + 5 <= sorted.length; index += 5) {
    const group = sorted.slice(index, index + 5);

    bars.push({
      startTime: group[0].startTime,
      high: Math.max(...group.map((candle) => Number(candle.high))),
      low: Math.min(...group.map((candle) => Number(candle.low))),
      close: Number(group[group.length - 1].close),
    });
  }

  return bars;
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

function buildCandleConfirmation({
  candleBuilder,
  instrumentToken,
  sessionCandles = [],
}: {
  candleBuilder: LiveMarketSnapshotInput["candleBuilder"];
  instrumentToken: number;
  sessionCandles?: IndicatorCandle[];
}): CandleConfirmation {
  // Closed 5-minute bars from the same 1-minute stream the flip strategy uses,
  // so the gate matches the timeframe levels and the break/retest run on.
  const fiveMinBars = fiveMinuteBars(
    liveOneMinuteMarketCandles({ candleBuilder, instrumentToken, sessionCandles }),
  );
  const lastClosed = fiveMinBars.at(-1) ?? null;
  const lastClosedStart = lastClosed?.startTime ?? null;
  const lastClosedEnd = lastClosed ? fiveMinuteEndTime(lastClosed.startTime) : null;
  const decisionReady = Boolean(lastClosed);

  // The forming (not-yet-closed) 5-minute candle from the live builder.
  const currentCandle =
    candleBuilder
      ?.getActiveCandles()
      .find((candle) => candle.instrumentToken === instrumentToken && candle.interval === "5m") ?? null;

  if (currentCandle) {
    return {
      status: "BUILDING",
      currentCandleStart: currentCandle.startTime,
      currentCandleEnd: currentCandle.endTime,
      lastCompletedCandleStart: lastClosedStart,
      lastCompletedCandleEnd: lastClosedEnd,
      nextConfirmationTime: currentCandle.endTime,
      decisionReady,
      message: decisionReady
        ? "Use the last closed 5-minute candle; the current 5-minute candle is still building."
        : "Wait for the first 5-minute candle to close before taking a paper trade.",
    };
  }

  if (lastClosed) {
    return {
      status: "CONFIRMED",
      currentCandleStart: null,
      currentCandleEnd: null,
      lastCompletedCandleStart: lastClosedStart,
      lastCompletedCandleEnd: lastClosedEnd,
      nextConfirmationTime: lastClosedEnd,
      decisionReady: true,
      message: "Latest 5-minute candle is closed — levels and the break/retest pattern are updated.",
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
    message: "Waiting for live ticks to build the first 5-minute candle.",
  };
}

function oneMinuteEndTime(startTime: string) {
  const parsed = new Date(startTime);

  return Number.isNaN(parsed.getTime()) ? startTime : addMinutes(parsed, 1).toISOString();
}

function fiveMinuteEndTime(startTime: string) {
  const parsed = new Date(startTime);

  return Number.isNaN(parsed.getTime()) ? startTime : addMinutes(parsed, 5).toISOString();
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

function previousDayFromCandlesForFallback(candles: IndicatorCandle[]) {
  const latest = candles.at(-1);

  if (!latest) return null;

  return {
    high: latest.close,
    low: latest.close,
    close: latest.close,
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
