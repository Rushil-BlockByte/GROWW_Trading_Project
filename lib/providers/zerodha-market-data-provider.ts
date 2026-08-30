import type {
  InstrumentSubscription,
  MarketDataProvider,
  MarketDataProviderStatus,
} from "@/lib/providers/market-data-provider";
import { normalizeKiteTick } from "@/lib/zerodha/kite-tick-normalizer";
import { createOfficialKiteTickerClient } from "@/lib/zerodha/kite-ticker-client";
import { SubscriptionManager } from "@/lib/zerodha/subscription-manager";
import type { ZerodhaTickerClient, ZerodhaTickerFactory } from "@/types/kite";
import type { MarketTick } from "@/types/market";

export type ZerodhaMarketDataProviderOptions = {
  apiKey: string;
  accessToken: string;
  maxSubscriptions?: number;
  reconnectEnabled?: boolean;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  tickerFactory?: ZerodhaTickerFactory;
};

export class ZerodhaMarketDataProvider implements MarketDataProvider {
  private readonly handlers = new Set<(tick: MarketTick) => void>();
  private readonly subscriptionManager: SubscriptionManager;
  private readonly tickerFactory: ZerodhaTickerFactory;
  private ticker?: ZerodhaTickerClient;
  private connectedAt?: Date;
  private lastTickAt?: Date;
  private reconnecting = false;
  private reconnectCount = 0;
  private lastError?: string;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: ZerodhaMarketDataProviderOptions) {
    this.subscriptionManager = new SubscriptionManager(options.maxSubscriptions);
    this.tickerFactory = options.tickerFactory ?? createOfficialKiteTickerClient;
  }

  async connect(): Promise<void> {
    if (this.ticker?.connected()) {
      return;
    }

    this.clearReconnectTimer();
    this.ticker = this.tickerFactory({
      apiKey: this.options.apiKey,
      accessToken: this.options.accessToken,
    });
    this.attachHandlers(this.ticker);
    this.ticker.connect();
  }

  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.reconnecting = false;

    if (this.ticker?.connected()) {
      this.ticker.disconnect();
    }

    this.connectedAt = undefined;
  }

  async subscribe(subscriptions: InstrumentSubscription[]): Promise<void> {
    this.subscriptionManager.upsert(subscriptions);

    if (this.ticker?.connected()) {
      this.subscriptionManager.sync(this.ticker);
    }
  }

  async unsubscribe(instrumentTokens: number[]): Promise<void> {
    this.subscriptionManager.remove(instrumentTokens);

    if (this.ticker?.connected()) {
      this.subscriptionManager.sync(this.ticker);
    }
  }

  onTick(handler: (tick: MarketTick) => void): () => void {
    this.handlers.add(handler);

    return () => {
      this.handlers.delete(handler);
    };
  }

  getStatus(): MarketDataProviderStatus {
    const connected = this.ticker?.connected() ?? false;

    return {
      connected,
      reconnecting: this.reconnecting,
      lastTickAt: this.lastTickAt?.toISOString(),
      lastError: this.lastError,
      subscriptionCount: this.subscriptionManager.getDesiredCount(),
      rejectedSubscriptions: this.subscriptionManager.getRejectedCount(),
      reconnectCount: this.reconnectCount,
      uptimeSeconds:
        connected && this.connectedAt
          ? Math.floor((Date.now() - this.connectedAt.getTime()) / 1000)
          : 0,
    };
  }

  getDesiredSubscriptions() {
    return this.subscriptionManager.getDesiredSubscriptions();
  }

  private attachHandlers(ticker: ZerodhaTickerClient) {
    ticker.on("connect", () => {
      this.connectedAt = new Date();
      this.reconnecting = false;
      this.lastError = undefined;
      this.subscriptionManager.resetApplied();
      this.subscriptionManager.sync(ticker);
    });

    ticker.on("ticks", (rawTicks) => {
      const receivedAt = new Date();

      for (const rawTick of rawTicks) {
        const tick = normalizeKiteTick(rawTick, receivedAt);
        this.lastTickAt = new Date(tick.exchangeTimestamp ?? tick.timestamp);

        for (const handler of this.handlers) {
          handler(tick);
        }
      }
    });

    ticker.on("disconnect", (error) => {
      this.handleDisconnect(error);
    });

    ticker.on("close", (reason) => {
      this.handleDisconnect(reason);
    });

    ticker.on("error", (error) => {
      this.handleDisconnect(error);
    });

    ticker.on("noreconnect", () => {
      this.lastError = "KiteTicker reported no reconnect.";
      this.reconnecting = false;
    });
  }

  private handleDisconnect(error: unknown) {
    this.connectedAt = undefined;
    this.lastError = formatError(error);

    if (this.options.reconnectEnabled === false) {
      this.reconnecting = false;
      return;
    }

    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnecting = true;
    const baseDelay = this.options.reconnectBaseDelayMs ?? 1_000;
    const maxDelay = this.options.reconnectMaxDelayMs ?? 30_000;
    const delay = Math.min(maxDelay, baseDelay * 2 ** this.reconnectCount);
    const setTimer = this.options.setTimeoutFn ?? setTimeout;

    this.reconnectTimer = setTimer(() => {
      this.reconnectTimer = undefined;
      this.reconnectCount += 1;
      void this.connect();
    }, delay);
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;

    const clearTimer = this.options.clearTimeoutFn ?? clearTimeout;
    clearTimer(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
}

function formatError(error: unknown) {
  if (!error) return undefined;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  return "Kite WebSocket connection changed state.";
}
