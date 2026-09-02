import { getServerConfig } from "@/lib/config/env";
import { DEFAULT_UNDERLYINGS } from "@/lib/config/market";
import { InstrumentRepository } from "@/lib/instruments/instrument-repository";
import { CandleBuilder } from "@/lib/market/candle-builder";
import { MarketStateStore } from "@/lib/market/market-state";
import { ZerodhaMarketDataProvider } from "@/lib/providers/zerodha-market-data-provider";
import { fetchKiteHistoricalCandles } from "@/lib/zerodha/historical-data-client";
import { downloadKiteInstruments } from "@/lib/zerodha/instruments-client";
import {
  buildLiveMarketSnapshot,
  type LiveIndicatorPreviousDay,
  type LiveOptionUniversesSnapshot,
} from "@/lib/zerodha/live-market-snapshot";
import {
  buildLiveStreamSafetySnapshot,
  getLiveStreamMarketSession,
  type LiveStreamFreshness,
  type LiveStreamMarketSession,
  type LiveStreamSafetyCheck,
} from "@/lib/zerodha/live-stream-safety";
import { resolveInitialLiveUniverse } from "@/lib/zerodha/live-universe";
import type { IndicatorCandle } from "@/types/indicators";
import type { InstrumentRecord } from "@/types/instruments";
import type { MarketTick, UnderlyingSymbol } from "@/types/market";
import type { SimulatedMarketSnapshot } from "@/types/simulation";

const LIVE_OPTION_STRIKE_WINDOW = 5;
const INDICATOR_WARMUP_DAYS = 7;

export type LiveKiteStreamSnapshot = {
  configured: {
    apiKey: boolean;
    accessToken: boolean;
    apiSecret: boolean;
  };
  running: boolean;
  startedAt?: string;
  lastError?: string;
  instrumentMasterCount: number;
  subscribedInstruments: Array<{
    instrumentToken: number;
    tradingsymbol: string;
    exchange: string;
    mode: string;
  }>;
  unresolvedUnderlyings: string[];
  provider: ReturnType<ZerodhaMarketDataProvider["getStatus"]>;
  marketState: ReturnType<MarketStateStore["getSummary"]>;
  activeCandleCount: number;
  completedCandleCount: number;
  marketSession: LiveStreamMarketSession;
  freshness: LiveStreamFreshness;
  safetyChecks: LiveStreamSafetyCheck[];
  streamStartAllowed: boolean;
  dataQualityGateOpen: boolean;
  signalGenerationAllowed: boolean;
  marketSnapshot?: SimulatedMarketSnapshot;
  marketSnapshotSource: "live" | "waiting";
  liveOrdersEnabled: false;
};

export class LiveKiteStreamService {
  private repository?: InstrumentRepository;
  private provider?: ZerodhaMarketDataProvider;
  private stateStore?: MarketStateStore;
  private candleBuilder?: CandleBuilder;
  private instruments: InstrumentRecord[] = [];
  private subscribedInstruments: InstrumentRecord[] = [];
  private unresolvedUnderlyings: string[] = [];
  private liveOptionUniverses: LiveOptionUniversesSnapshot = {};
  private optionSubscriptionPending = new Set<UnderlyingSymbol>();
  private sessionCandlesByToken = new Map<number, IndicatorCandle[]>();
  private warmupCandlesByToken = new Map<number, IndicatorCandle[]>();
  private previousDayByToken = new Map<number, LiveIndicatorPreviousDay>();
  private startedAt?: Date;
  private lastError?: string;

  async start() {
    if (this.provider?.getStatus().connected || this.provider?.getStatus().reconnecting) {
      return this.getSnapshot();
    }

    const config = getServerConfig();

    if (!config.kiteApiKey || !config.kiteAccessToken) {
      this.lastError = "Missing KITE_API_KEY or KITE_ACCESS_TOKEN.";
      throw new Error(this.lastError);
    }

    const marketSession = getLiveStreamMarketSession();

    if (!marketSession.open) {
      this.lastError = marketSession.message;
      throw new Error(this.lastError);
    }

    const [nseInstruments, nfoInstruments] = await Promise.all([
      downloadKiteInstruments({
        apiKey: config.kiteApiKey,
        accessToken: config.kiteAccessToken,
        exchange: "NSE",
      }),
      downloadKiteInstruments({
        apiKey: config.kiteApiKey,
        accessToken: config.kiteAccessToken,
        exchange: "NFO",
      }),
    ]);
    this.instruments = dedupeInstruments([...nseInstruments, ...nfoInstruments]);
    this.repository = new InstrumentRepository(this.instruments);

    const liveUniverse = resolveInitialLiveUniverse(this.repository);
    this.subscribedInstruments = liveUniverse.instruments;
    this.unresolvedUnderlyings = liveUniverse.unresolved;
    this.liveOptionUniverses = {};
    this.optionSubscriptionPending = new Set();
    this.sessionCandlesByToken = new Map();
    this.warmupCandlesByToken = new Map();
    this.previousDayByToken = new Map();

    if (liveUniverse.subscriptions.length === 0) {
      this.lastError = "No index instruments resolved from Zerodha instrument master.";
      throw new Error(this.lastError);
    }

    await this.warmIndicatorHistory({
      apiKey: config.kiteApiKey,
      accessToken: config.kiteAccessToken,
      instruments: liveUniverse.instruments,
    });

    this.stateStore = new MarketStateStore(this.repository);
    this.candleBuilder = new CandleBuilder(["1m", "5m", "15m"]);
    this.provider = new ZerodhaMarketDataProvider({
      apiKey: config.kiteApiKey,
      accessToken: config.kiteAccessToken,
      reconnectEnabled: true,
    });
    this.provider.onTick((tick) => {
      const result = this.stateStore?.applyTick(tick);
      this.candleBuilder?.applyTick(tick);

      if (result?.accepted) {
        void this.maybeSubscribeOptionUniverse(tick);
      }
    });

    await this.provider.subscribe(liveUniverse.subscriptions);
    await this.provider.connect();
    this.startedAt = new Date();
    this.lastError = undefined;

    return this.getSnapshot();
  }

  async stop() {
    await this.provider?.disconnect();
    this.startedAt = undefined;

    return this.getSnapshot();
  }

  private async warmIndicatorHistory({
    apiKey,
    accessToken,
    instruments,
  }: {
    apiKey: string;
    accessToken: string;
    instruments: InstrumentRecord[];
  }) {
    const now = new Date();
    const sessionDate = kolkataDate(now);
    const fromDate = kolkataDate(addDays(now, -INDICATOR_WARMUP_DAYS));
    const sessionStart = kolkataSessionStartTime(sessionDate);
    const from = `${fromDate} 09:15:00`;
    const to = kiteDateTime(now);

    await Promise.all(
      instruments.map(async (instrument) => {
        try {
          const historical = await fetchKiteHistoricalCandles({
            apiKey,
            accessToken,
            instrumentToken: instrument.instrumentToken,
            interval: "minute",
            from,
            to,
            continuous: false,
            includeOpenInterest: false,
          });
          const candles = historical.candles.map(indicatorCandleFromHistorical);
          const sessionCandles = candles.filter(
            (candle) => new Date(candle.startTime).getTime() >= sessionStart,
          );
          const warmupCandles = candles
            .filter((candle) => new Date(candle.startTime).getTime() < sessionStart)
            .slice(-120);
          const previousDay = previousDayFromCandles(warmupCandles, sessionDate);

          this.sessionCandlesByToken.set(instrument.instrumentToken, sessionCandles);
          this.warmupCandlesByToken.set(instrument.instrumentToken, warmupCandles);

          if (previousDay) {
            this.previousDayByToken.set(instrument.instrumentToken, previousDay);
          }
        } catch {
          this.sessionCandlesByToken.set(instrument.instrumentToken, []);
          this.warmupCandlesByToken.set(instrument.instrumentToken, []);
        }
      }),
    );
  }

  getSnapshot(): LiveKiteStreamSnapshot {
    const config = getServerConfig();
    const providerStatus =
      this.provider?.getStatus() ??
      {
        connected: false,
        reconnecting: false,
        subscriptionCount: 0,
        rejectedSubscriptions: 0,
        reconnectCount: 0,
        uptimeSeconds: 0,
      };
    const stateSummary =
      this.stateStore?.getSummary() ??
      {
        instrumentsTracked: 0,
        dataQuality: "INSUFFICIENT_DATA" as const,
        rejectedTicks: 0,
        rejectionReasons: [],
      };
    const providerSubscriptions = new Map(
      this.provider
        ?.getDesiredSubscriptions()
        .map((subscription) => [subscription.instrumentToken, subscription.mode]) ?? [],
    );
    const safety = buildLiveStreamSafetySnapshot({
      configured: {
        apiKey: Boolean(config.kiteApiKey),
        accessToken: Boolean(config.kiteAccessToken),
        apiSecret: Boolean(config.kiteApiSecret),
      },
      instrumentMasterCount: this.instruments.length,
      marketState: stateSummary,
      provider: providerStatus,
      unresolvedUnderlyings: this.unresolvedUnderlyings,
    });
    const dataQualityGateOpen =
      providerStatus.connected &&
      stateSummary.dataQuality === "GOOD" &&
      safety.marketSession.open &&
      safety.freshness.status === "pass";
    const marketSnapshot = buildLiveMarketSnapshot({
      repository: this.repository,
      stateStore: this.stateStore,
      candleBuilder: this.candleBuilder,
      sessionCandlesByToken: this.sessionCandlesByToken,
      warmupCandlesByToken: this.warmupCandlesByToken,
      previousDayByToken: this.previousDayByToken,
      provider: providerStatus,
      instrumentMasterCount: this.instruments.length,
      optionUniverses: this.liveOptionUniverses,
    });

    return {
      configured: {
        apiKey: Boolean(config.kiteApiKey),
        accessToken: Boolean(config.kiteAccessToken),
        apiSecret: Boolean(config.kiteApiSecret),
      },
      running: providerStatus.connected || providerStatus.reconnecting,
      startedAt: this.startedAt?.toISOString(),
      lastError: this.lastError ?? providerStatus.lastError,
      instrumentMasterCount: this.instruments.length,
      subscribedInstruments: this.subscribedInstruments.map((instrument) => ({
        instrumentToken: instrument.instrumentToken,
        tradingsymbol: instrument.tradingsymbol,
        exchange: instrument.exchange,
        mode: providerSubscriptions.get(instrument.instrumentToken) ?? "QUOTE",
      })),
      unresolvedUnderlyings: this.unresolvedUnderlyings,
      provider: providerStatus,
      marketState: stateSummary,
      activeCandleCount: this.candleBuilder?.getActiveCandles().length ?? 0,
      completedCandleCount: this.candleBuilder?.getCompletedCandles().length ?? 0,
      marketSession: safety.marketSession,
      freshness: safety.freshness,
      safetyChecks: safety.safetyChecks,
      streamStartAllowed: safety.startAllowed,
      dataQualityGateOpen,
      signalGenerationAllowed: false,
      marketSnapshot,
      marketSnapshotSource: marketSnapshot ? "live" : "waiting",
      liveOrdersEnabled: false,
    };
  }

  private async maybeSubscribeOptionUniverse(tick: MarketTick) {
    if (!this.repository || !this.provider) {
      return;
    }

    const instrument = this.repository.findByToken(tick.instrumentToken);
    const underlying = instrument?.underlyingSymbol;

    if (
      instrument?.kind !== "INDEX" ||
      !underlying ||
      underlying === "INDIA_VIX" ||
      this.liveOptionUniverses[underlying] ||
      this.optionSubscriptionPending.has(underlying)
    ) {
      return;
    }

    const config = DEFAULT_UNDERLYINGS.find(
      (candidate) => candidate.symbol === underlying,
    );
    const expiry = this.repository.getNearestExpiry(underlying, new Date(tick.timestamp));

    if (!config || !expiry) {
      this.liveOptionUniverses[underlying] = {
        selectedUnderlying: underlying,
        expiry: expiry ?? "",
        atmStrike: "",
        instruments: [],
        missingContracts: 0,
      };
      return;
    }

    this.optionSubscriptionPending.add(underlying);

    try {
      const universe = this.repository.buildAtmOptionUniverse({
        underlyingSymbol: underlying,
        underlyingLastPrice: tick.lastPrice,
        expiry,
        strikeInterval: config.strikeInterval,
        strikeWindow: LIVE_OPTION_STRIKE_WINDOW,
      });

      this.liveOptionUniverses[underlying] = {
        selectedUnderlying: underlying,
        expiry: universe.expiry,
        atmStrike: universe.atmStrike,
        instruments: universe.instruments,
        missingContracts: universe.missingContracts.length,
      };

      if (universe.instruments.length) {
        await this.provider.subscribe(
          universe.instruments.map((option) => ({
            instrumentToken: option.instrumentToken,
            mode: "FULL",
          })),
        );
        this.subscribedInstruments = dedupeInstruments([
          ...this.subscribedInstruments,
          ...universe.instruments,
        ]);
      }
    } finally {
      this.optionSubscriptionPending.delete(underlying);
    }
  }
}

function indicatorCandleFromHistorical(candle: IndicatorCandle): IndicatorCandle {
  return {
    startTime: candle.startTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    openInterest: candle.openInterest,
  };
}

function previousDayFromCandles(
  candles: IndicatorCandle[],
  sessionDate: string,
): LiveIndicatorPreviousDay | null {
  const candlesByDate = new Map<string, IndicatorCandle[]>();

  for (const candle of candles) {
    const date = kolkataDate(new Date(candle.startTime));

    if (date >= sessionDate) continue;

    const group = candlesByDate.get(date) ?? [];
    group.push(candle);
    candlesByDate.set(date, group);
  }

  const previousDate = Array.from(candlesByDate.keys()).sort().at(-1);

  if (!previousDate) return null;

  const previousCandles = [...(candlesByDate.get(previousDate) ?? [])].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );
  const last = previousCandles.at(-1);

  if (!last) return null;

  return {
    high: Math.max(...previousCandles.map((candle) => Number(candle.high))).toFixed(2),
    low: Math.min(...previousCandles.map((candle) => Number(candle.low))).toFixed(2),
    close: Number(last.close).toFixed(2),
  };
}

function kolkataDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
    year: "numeric",
  }).format(date);
}

function kiteDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Kolkata",
    year: "numeric",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value.padStart(2, "0") ?? "00";

  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value(
    "minute",
  )}:${value("second")}`;
}

function kolkataSessionStartTime(date: string) {
  return new Date(`${date}T09:15:00.000+05:30`).getTime();
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}

function dedupeInstruments(instruments: InstrumentRecord[]) {
  return Array.from(
    new Map(instruments.map((instrument) => [instrument.instrumentToken, instrument])).values(),
  );
}

const globalForKite = globalThis as unknown as {
  liveKiteStreamService?: LiveKiteStreamService;
  liveKiteStreamServiceVersion?: string;
};
const LIVE_KITE_STREAM_SERVICE_VERSION = "2026-09-02-index-volume-reason";

export function getLiveKiteStreamService() {
  if (
    globalForKite.liveKiteStreamService &&
    globalForKite.liveKiteStreamServiceVersion !== LIVE_KITE_STREAM_SERVICE_VERSION
  ) {
    void globalForKite.liveKiteStreamService.stop().catch(() => undefined);
    globalForKite.liveKiteStreamService = undefined;
  }

  globalForKite.liveKiteStreamService ??= new LiveKiteStreamService();
  globalForKite.liveKiteStreamServiceVersion = LIVE_KITE_STREAM_SERVICE_VERSION;

  return globalForKite.liveKiteStreamService;
}
