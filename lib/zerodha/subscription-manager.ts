import { KITE_WEBSOCKET_LIMITS } from "@/lib/config/market";
import type { InstrumentSubscription } from "@/lib/providers/market-data-provider";
import type { KiteStreamingMode, ZerodhaTickerClient } from "@/types/kite";
import { toKiteStreamingMode } from "@/types/kite";

export type SubscriptionUpdateResult = {
  accepted: InstrumentSubscription[];
  rejected: InstrumentSubscription[];
};

export type SubscriptionSyncResult = {
  subscribedTokens: number[];
  unsubscribedTokens: number[];
  modeGroups: Record<KiteStreamingMode, number[]>;
};

export class SubscriptionManager {
  private readonly desired = new Map<number, InstrumentSubscription>();
  private readonly applied = new Map<number, InstrumentSubscription>();
  private rejectedCount = 0;

  constructor(
    private readonly maxSubscriptions: number = KITE_WEBSOCKET_LIMITS.maxInstrumentsPerConnection,
  ) {}

  upsert(subscriptions: InstrumentSubscription[]): SubscriptionUpdateResult {
    const accepted: InstrumentSubscription[] = [];
    const rejected: InstrumentSubscription[] = [];

    for (const subscription of subscriptions) {
      if (!Number.isInteger(subscription.instrumentToken) || subscription.instrumentToken <= 0) {
        rejected.push(subscription);
        this.rejectedCount += 1;
        continue;
      }

      const isNew = !this.desired.has(subscription.instrumentToken);

      if (isNew && this.desired.size >= this.maxSubscriptions) {
        rejected.push(subscription);
        this.rejectedCount += 1;
        continue;
      }

      this.desired.set(subscription.instrumentToken, subscription);
      accepted.push(subscription);
    }

    return { accepted, rejected };
  }

  remove(instrumentTokens: number[]) {
    for (const token of instrumentTokens) {
      this.desired.delete(token);
    }
  }

  resetApplied() {
    this.applied.clear();
  }

  sync(client: ZerodhaTickerClient): SubscriptionSyncResult {
    const desiredTokens = new Set(this.desired.keys());
    const appliedTokens = new Set(this.applied.keys());
    const subscribedTokens = Array.from(desiredTokens).filter((token) => !appliedTokens.has(token));
    const unsubscribedTokens = Array.from(appliedTokens).filter((token) => !desiredTokens.has(token));
    const modeGroups: Record<KiteStreamingMode, number[]> = {
      ltp: [],
      quote: [],
      full: [],
    };

    for (const [token, subscription] of this.desired) {
      const applied = this.applied.get(token);

      if (!applied || applied.mode !== subscription.mode) {
        modeGroups[toKiteStreamingMode(subscription.mode)].push(token);
      }
    }

    if (unsubscribedTokens.length > 0) {
      client.unsubscribe(unsubscribedTokens);
    }

    if (subscribedTokens.length > 0) {
      client.subscribe(subscribedTokens);
    }

    for (const [mode, tokens] of Object.entries(modeGroups) as Array<[KiteStreamingMode, number[]]>) {
      if (tokens.length > 0) {
        client.setMode(mode, tokens);
      }
    }

    this.applied.clear();

    for (const [token, subscription] of this.desired) {
      this.applied.set(token, subscription);
    }

    return { subscribedTokens, unsubscribedTokens, modeGroups };
  }

  getDesiredSubscriptions() {
    return Array.from(this.desired.values());
  }

  getDesiredCount() {
    return this.desired.size;
  }

  getRejectedCount() {
    return this.rejectedCount;
  }
}
