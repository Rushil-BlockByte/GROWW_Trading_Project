import { describe, expect, it } from "vitest";
import type { Tick } from "kiteconnect";
import { ZerodhaMarketDataProvider } from "../lib/providers/zerodha-market-data-provider";
import type { KiteTickerEventMap, KiteStreamingMode, ZerodhaTickerClient } from "../types/kite";

class FakeTicker implements ZerodhaTickerClient {
  private handlers = new Map<keyof KiteTickerEventMap, Array<(...args: unknown[]) => void>>();

  connectedState = false;
  subscribeCalls: number[][] = [];
  modeCalls: Array<{ mode: KiteStreamingMode; tokens: number[] }> = [];

  connect() {
    this.connectedState = true;
  }

  connected() {
    return this.connectedState;
  }

  disconnect() {
    this.connectedState = false;
  }

  subscribe(tokens: number[]) {
    this.subscribeCalls.push(tokens);
    return tokens;
  }

  unsubscribe(tokens: number[]) {
    return tokens;
  }

  setMode(mode: KiteStreamingMode, tokens: number[]) {
    this.modeCalls.push({ mode, tokens });
    return tokens;
  }

  on<EventName extends keyof KiteTickerEventMap>(
    event: EventName,
    callback: KiteTickerEventMap[EventName],
  ) {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(callback as (...args: unknown[]) => void);
    this.handlers.set(event, handlers);
  }

  emit<EventName extends keyof KiteTickerEventMap>(
    event: EventName,
    ...args: Parameters<KiteTickerEventMap[EventName]>
  ) {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
}

describe("Zerodha market data provider", () => {
  it("re-subscribes the desired universe when the socket connects", async () => {
    const fakeTicker = new FakeTicker();
    const provider = new ZerodhaMarketDataProvider({
      apiKey: "key",
      accessToken: "token",
      reconnectEnabled: false,
      tickerFactory: () => fakeTicker,
    });

    await provider.subscribe([
      { instrumentToken: 256265, mode: "QUOTE" },
      { instrumentToken: 260105, mode: "FULL" },
    ]);
    await provider.connect();
    fakeTicker.emit("connect");

    expect(fakeTicker.subscribeCalls).toEqual([[256265, 260105]]);
    expect(fakeTicker.modeCalls).toEqual([
      { mode: "quote", tokens: [256265] },
      { mode: "full", tokens: [260105] },
    ]);
    expect(provider.getStatus()).toMatchObject({
      connected: true,
      subscriptionCount: 2,
      rejectedSubscriptions: 0,
    });
  });

  it("emits normalized ticks and updates last tick health", async () => {
    const fakeTicker = new FakeTicker();
    const provider = new ZerodhaMarketDataProvider({
      apiKey: "key",
      accessToken: "token",
      reconnectEnabled: false,
      tickerFactory: () => fakeTicker,
    });
    const received: string[] = [];
    const rawTick: Tick = {
      tradable: false,
      mode: "quote",
      instrument_token: 256265,
      last_price: 25180,
      ohlc: {
        open: 25100,
        high: 25200,
        low: 25080,
        close: 25090,
      },
      change: 0.35,
      exchange_timestamp: new Date("2026-09-01T04:00:00.000Z"),
    };

    provider.onTick((tick) => received.push(tick.lastPrice));
    await provider.connect();
    fakeTicker.emit("connect");
    fakeTicker.emit("ticks", [rawTick]);

    expect(received).toEqual(["25180.00"]);
    expect(provider.getStatus().lastTickAt).toBe("2026-09-01T04:00:00.000Z");
  });

  it("marks the stream disconnected without allowing immediate signal generation", async () => {
    const fakeTicker = new FakeTicker();
    const provider = new ZerodhaMarketDataProvider({
      apiKey: "key",
      accessToken: "token",
      reconnectEnabled: false,
      tickerFactory: () => fakeTicker,
    });

    await provider.connect();
    fakeTicker.emit("connect");
    fakeTicker.connectedState = false;
    fakeTicker.emit("disconnect", new Error("connection lost"));

    expect(provider.getStatus()).toMatchObject({
      connected: false,
      reconnecting: false,
      lastError: "connection lost",
    });
  });
});
