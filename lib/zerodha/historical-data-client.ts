import { KiteConnect, type HistoricalData } from "kiteconnect";
import type {
  HistoricalCandle,
  HistoricalCandleFetchResult,
  HistoricalCandleInterval,
} from "@/types/historical";

export const KITE_HISTORICAL_INTERVALS: HistoricalCandleInterval[] = [
  "minute",
  "3minute",
  "5minute",
  "10minute",
  "15minute",
  "30minute",
  "60minute",
  "day",
];

export type KiteHistoricalDataClient = {
  getHistoricalData: (
    instrumentToken: number | string,
    interval: HistoricalCandleInterval,
    fromDate: string | Date,
    toDate: string | Date,
    continuous?: boolean,
    includeOpenInterest?: boolean,
  ) => Promise<HistoricalData[]>;
};

export type KiteHistoricalClientConfig = {
  apiKey: string;
  accessToken: string;
};

export type KiteHistoricalFetchInput = {
  apiKey: string;
  accessToken: string;
  instrumentToken: number;
  interval: HistoricalCandleInterval;
  from: string;
  to: string;
  continuous?: boolean;
  includeOpenInterest?: boolean;
  client?: KiteHistoricalDataClient;
};

function toFixed(value: number) {
  return value.toFixed(2);
}

function parseHistoricalDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Kite historical candle contains an invalid timestamp.");
  }

  return date.toISOString();
}

export function isKiteHistoricalInterval(
  value: string | null | undefined,
): value is HistoricalCandleInterval {
  return Boolean(value && KITE_HISTORICAL_INTERVALS.includes(value as HistoricalCandleInterval));
}

export function createKiteHistoricalDataClient({
  apiKey,
  accessToken,
}: KiteHistoricalClientConfig): KiteHistoricalDataClient {
  return new KiteConnect({
    api_key: apiKey,
    access_token: accessToken,
  });
}

export function normalizeKiteHistoricalCandles({
  instrumentToken,
  candles,
}: {
  instrumentToken: number;
  candles: HistoricalData[];
}): HistoricalCandle[] {
  return candles.map((candle) => ({
    instrumentToken,
    source: "KITE",
    startTime: parseHistoricalDate(candle.date),
    open: toFixed(candle.open),
    high: toFixed(candle.high),
    low: toFixed(candle.low),
    close: toFixed(candle.close),
    volume: candle.volume,
    openInterest: candle.oi,
  }));
}

export function assertValidHistoricalWindow({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const fromTime = new Date(from).getTime();
  const toTime = new Date(to).getTime();

  if (Number.isNaN(fromTime) || Number.isNaN(toTime)) {
    throw new Error("Historical date window must use valid dates.");
  }

  if (fromTime >= toTime) {
    throw new Error("Historical date window must end after it starts.");
  }
}

export async function fetchKiteHistoricalCandles(
  input: KiteHistoricalFetchInput,
): Promise<HistoricalCandleFetchResult> {
  assertValidHistoricalWindow({ from: input.from, to: input.to });

  const client = input.client ?? createKiteHistoricalDataClient(input);
  const rawCandles = await client.getHistoricalData(
    input.instrumentToken,
    input.interval,
    input.from,
    input.to,
    input.continuous ?? false,
    input.includeOpenInterest ?? false,
  );
  const candles = normalizeKiteHistoricalCandles({
    instrumentToken: input.instrumentToken,
    candles: rawCandles,
  });
  const warnings = candles.length
    ? []
    : ["Kite returned no candles for the requested historical window."];

  return {
    source: "KITE",
    request: {
      instrumentToken: input.instrumentToken,
      interval: input.interval,
      from: input.from,
      to: input.to,
      continuous: input.continuous ?? false,
      includeOpenInterest: input.includeOpenInterest ?? false,
    },
    candleCount: candles.length,
    candles,
    warnings,
    liveOrdersEnabled: false,
  };
}
