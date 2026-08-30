import Decimal from "decimal.js";
import type {
  InstrumentSubscription,
  MarketDataProvider,
  MarketDataProviderStatus,
} from "@/lib/providers/market-data-provider";
import { normalizeSimulatedTick } from "@/lib/market/tick-normalization";
import type { MarketTick } from "@/types/market";

export type SimulatedPriceSeed = {
  instrumentToken: number;
  basePrice: Decimal.Value;
  volumeBase?: number;
  openInterestBase?: number;
};

export class SimulatedMarketDataProvider implements MarketDataProvider {
  private readonly handlers = new Set<(tick: MarketTick) => void>();
  private readonly subscriptions = new Map<number, InstrumentSubscription>();
  private readonly seeds = new Map<number, SimulatedPriceSeed>();
  private connectedAt?: Date;
  private lastTickAt?: Date;
  private sequence = 0;
  private rejectedSubscriptions = 0;

  constructor(seeds: SimulatedPriceSeed[]) {
    for (const seed of seeds) {
      this.seeds.set(seed.instrumentToken, seed);
    }
  }

  async connect(): Promise<void> {
    this.connectedAt = new Date();
  }

  async disconnect(): Promise<void> {
    this.connectedAt = undefined;
  }

  async subscribe(subscriptions: InstrumentSubscription[]): Promise<void> {
    for (const subscription of subscriptions) {
      if (this.seeds.has(subscription.instrumentToken)) {
        this.subscriptions.set(subscription.instrumentToken, subscription);
      } else {
        this.rejectedSubscriptions += 1;
      }
    }
  }

  async unsubscribe(instrumentTokens: number[]): Promise<void> {
    for (const token of instrumentTokens) {
      this.subscriptions.delete(token);
    }
  }

  onTick(handler: (tick: MarketTick) => void): () => void {
    this.handlers.add(handler);

    return () => {
      this.handlers.delete(handler);
    };
  }

  emitNextTick(at = new Date()) {
    if (!this.connectedAt) {
      throw new Error("Simulated market data provider is not connected.");
    }

    const ticks = Array.from(this.subscriptions.keys()).map((instrumentToken, index) => {
      const seed = this.seeds.get(instrumentToken);

      if (!seed) {
        throw new Error(`Missing price seed for ${instrumentToken}.`);
      }

      const movement = Math.sin((this.sequence + index) / 5) * 8;
      const lastPrice = new Decimal(seed.basePrice).plus(movement);
      const tick = normalizeSimulatedTick({
        instrumentToken,
        timestamp: at,
        lastPrice,
        lastQuantity: 75,
        volume: (seed.volumeBase ?? 10_000) + this.sequence * 100 + index * 10,
        openInterest: (seed.openInterestBase ?? 100_000) + this.sequence * 20 + index,
        bid: lastPrice.minus(0.75),
        ask: lastPrice.plus(0.85),
        sequence: this.sequence,
      });

      return tick;
    });

    this.sequence += 1;
    this.lastTickAt = at;

    for (const tick of ticks) {
      for (const handler of this.handlers) {
        handler(tick);
      }
    }

    return ticks;
  }

  getStatus(): MarketDataProviderStatus {
    const now = Date.now();
    const connected = Boolean(this.connectedAt);

    return {
      connected,
      reconnecting: false,
      lastTickAt: this.lastTickAt?.toISOString(),
      subscriptionCount: this.subscriptions.size,
      rejectedSubscriptions: this.rejectedSubscriptions,
      reconnectCount: 0,
      uptimeSeconds: this.connectedAt ? Math.floor((now - this.connectedAt.getTime()) / 1000) : 0,
    };
  }
}
