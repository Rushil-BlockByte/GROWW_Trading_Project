import { getServerConfig } from "@/lib/config/env";
import { DEFAULT_UNDERLYINGS } from "@/lib/config/market";
import { InstrumentRepository } from "@/lib/instruments/instrument-repository";
import { CandleBuilder } from "@/lib/market/candle-builder";
import { MarketStateStore } from "@/lib/market/market-state";
import { ZerodhaMarketDataProvider } from "@/lib/providers/zerodha-market-data-provider";
import { downloadKiteInstruments } from "@/lib/zerodha/instruments-client";
import {
  buildLiveMarketSnapshot,
  type LiveOptionUniverseSnapshot,
} from "@/lib/zerodha/live-market-snapshot";
import {
  buildLiveStreamSafetySnapshot,
  getLiveStreamMarketSession,
  type LiveStreamFreshness,
  type LiveStreamMarketSession,
  type LiveStreamSafetyCheck,
} from "@/lib/zerodha/live-stream-safety";
import { resolveInitialLiveUniverse } from "@/lib/zerodha/live-universe";
import type { InstrumentRecord } from "@/types/instruments";
import type { MarketTick, UnderlyingSymbol } from "@/types/market";
import type { SimulatedMarketSnapshot } from "@/types/simulation";
import { DEFAULT_HISTORICAL_OPTION_STRIKE_WINDOW } from "@/lib/zerodha/option-historical-config";

const LIVE_OPTION_UNDERLYING: UnderlyingSymbol = "NIFTY";

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
  private liveOptionUniverse?: LiveOptionUniverseSnapshot;
  private optionSubscriptionPending = false;
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

    if (liveUniverse.subscriptions.length === 0) {
      this.lastError = "No index instruments resolved from Zerodha instrument master.";
      throw new Error(this.lastError);
    }

    this.stateStore = new MarketStateStore(this.repository);
    this.candleBuilder = new CandleBuilder(["1m", "5m", "15m"]);
    this.liveOptionUniverse = undefined;
    this.optionSubscriptionPending = false;
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
      provider: providerStatus,
      instrumentMasterCount: this.instruments.length,
      optionUniverse: this.liveOptionUniverse,
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
    if (
      !this.repository ||
      !this.provider ||
      this.liveOptionUniverse ||
      this.optionSubscriptionPending
    ) {
      return;
    }

    const instrument = this.repository.findByToken(tick.instrumentToken);

    if (
      instrument?.kind !== "INDEX" ||
      instrument.underlyingSymbol !== LIVE_OPTION_UNDERLYING
    ) {
      return;
    }

    const config = DEFAULT_UNDERLYINGS.find(
      (underlying) => underlying.symbol === LIVE_OPTION_UNDERLYING,
    );
    const expiry = this.repository.getNearestExpiry(LIVE_OPTION_UNDERLYING, new Date(tick.timestamp));

    if (!config || !expiry) {
      this.liveOptionUniverse = {
        selectedUnderlying: LIVE_OPTION_UNDERLYING,
        expiry: expiry ?? "",
        atmStrike: "",
        instruments: [],
        missingContracts: 0,
      };
      return;
    }

    this.optionSubscriptionPending = true;

    try {
      const universe = this.repository.buildAtmOptionUniverse({
        underlyingSymbol: LIVE_OPTION_UNDERLYING,
        underlyingLastPrice: tick.lastPrice,
        expiry,
        strikeInterval: config.strikeInterval,
        strikeWindow: DEFAULT_HISTORICAL_OPTION_STRIKE_WINDOW,
      });

      this.liveOptionUniverse = {
        selectedUnderlying: LIVE_OPTION_UNDERLYING,
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
      this.optionSubscriptionPending = false;
    }
  }
}

function dedupeInstruments(instruments: InstrumentRecord[]) {
  return Array.from(
    new Map(instruments.map((instrument) => [instrument.instrumentToken, instrument])).values(),
  );
}

const globalForKite = globalThis as unknown as {
  liveKiteStreamService?: LiveKiteStreamService;
};

export function getLiveKiteStreamService() {
  globalForKite.liveKiteStreamService ??= new LiveKiteStreamService();

  return globalForKite.liveKiteStreamService;
}
