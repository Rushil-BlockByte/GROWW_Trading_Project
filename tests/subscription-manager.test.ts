import { describe, expect, it } from "vitest";
import { SubscriptionManager } from "../lib/zerodha/subscription-manager";
import type { KiteStreamingMode, ZerodhaTickerClient } from "../types/kite";

class RecordingTicker implements ZerodhaTickerClient {
  subscribeCalls: number[][] = [];
  unsubscribeCalls: number[][] = [];
  modeCalls: Array<{ mode: KiteStreamingMode; tokens: number[] }> = [];

  connect() {}
  connected() {
    return true;
  }
  disconnect() {}
  subscribe(tokens: number[]) {
    this.subscribeCalls.push(tokens);
    return tokens;
  }
  unsubscribe(tokens: number[]) {
    this.unsubscribeCalls.push(tokens);
    return tokens;
  }
  setMode(mode: KiteStreamingMode, tokens: number[]) {
    this.modeCalls.push({ mode, tokens });
    return tokens;
  }
  on() {}
}

describe("subscription manager", () => {
  it("syncs only new or changed subscriptions", () => {
    const manager = new SubscriptionManager();
    const ticker = new RecordingTicker();

    manager.upsert([
      { instrumentToken: 256265, mode: "QUOTE" },
      { instrumentToken: 260105, mode: "FULL" },
    ]);

    expect(manager.sync(ticker)).toMatchObject({
      subscribedTokens: [256265, 260105],
      unsubscribedTokens: [],
      modeGroups: {
        quote: [256265],
        full: [260105],
        ltp: [],
      },
    });

    manager.sync(ticker);
    manager.upsert([{ instrumentToken: 256265, mode: "FULL" }]);

    expect(manager.sync(ticker).modeGroups.full).toEqual([256265]);
    expect(ticker.subscribeCalls).toEqual([[256265, 260105]]);
  });

  it("rejects invalid tokens and respects the connection subscription limit", () => {
    const manager = new SubscriptionManager(1);
    const result = manager.upsert([
      { instrumentToken: 256265, mode: "QUOTE" },
      { instrumentToken: -1, mode: "QUOTE" },
      { instrumentToken: 260105, mode: "QUOTE" },
    ]);

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(2);
    expect(manager.getRejectedCount()).toBe(2);
  });
});
