import type { Tick } from "kiteconnect";
import type { SubscriptionMode } from "@/types/market";

export type KiteStreamingMode = "ltp" | "quote" | "full";

export type KiteTickerEventMap = {
  connect: () => void;
  ticks: (ticks: Tick[]) => void;
  disconnect: (error?: unknown) => void;
  error: (error?: unknown) => void;
  close: (reason?: unknown) => void;
  reconnect: (reconnectCount: number, reconnectInterval: number) => void;
  noreconnect: () => void;
};

export type ZerodhaTickerClient = {
  connect(): void;
  connected(): boolean;
  disconnect(): void;
  subscribe(tokens: number[]): number[];
  unsubscribe(tokens: number[]): number[];
  setMode(mode: KiteStreamingMode, tokens: number[]): number[];
  on<EventName extends keyof KiteTickerEventMap>(
    event: EventName,
    callback: KiteTickerEventMap[EventName],
  ): void;
};

export type ZerodhaCredentials = {
  apiKey: string;
  accessToken: string;
};

export type ZerodhaTickerFactory = (credentials: ZerodhaCredentials) => ZerodhaTickerClient;

export function toKiteStreamingMode(mode: SubscriptionMode): KiteStreamingMode {
  if (mode === "LTP") return "ltp";
  if (mode === "FULL") return "full";
  return "quote";
}
