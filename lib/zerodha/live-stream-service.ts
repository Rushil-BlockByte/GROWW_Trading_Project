import { getServerConfig } from "@/lib/config/env";
import { InstrumentRepository } from "@/lib/instruments/instrument-repository";
import { CandleBuilder } from "@/lib/market/candle-builder";
import { MarketStateStore } from "@/lib/market/market-state";
import { ZerodhaMarketDataProvider } from "@/lib/providers/zerodha-market-data-provider";
import { downloadKiteInstruments } from "@/lib/zerodha/instruments-client";
import { resolveInitialLiveUniverse } from "@/lib/zerodha/live-universe";
import type { InstrumentRecord } from "@/types/instruments";

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
  dataQualityGateOpen: boolean;
  signalGenerationAllowed: boolean;
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

    this.instruments = await downloadKiteInstruments({
      apiKey: config.kiteApiKey,
      accessToken: config.kiteAccessToken,
      exchange: "NSE",
    });
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
    this.provider = new ZerodhaMarketDataProvider({
      apiKey: config.kiteApiKey,
      accessToken: config.kiteAccessToken,
      reconnectEnabled: true,
    });
    this.provider.onTick((tick) => {
      this.stateStore?.applyTick(tick);
      this.candleBuilder?.applyTick(tick);
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
    const dataQualityGateOpen =
      providerStatus.connected && stateSummary.dataQuality === "GOOD";

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
      dataQualityGateOpen,
      signalGenerationAllowed: false,
      liveOrdersEnabled: false,
    };
  }
}

const globalForKite = globalThis as unknown as {
  liveKiteStreamService?: LiveKiteStreamService;
};

export function getLiveKiteStreamService() {
  globalForKite.liveKiteStreamService ??= new LiveKiteStreamService();

  return globalForKite.liveKiteStreamService;
}
