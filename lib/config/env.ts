import { normalizeMarketDataMode } from "@/lib/config/market";

const CLIENT_SAFE_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_MARKET_DATA_MODE",
] as const;

export type ClientSafeConfig = {
  appUrl: string;
  marketDataMode: "simulation" | "live";
};

export type ServerConfig = ClientSafeConfig & {
  kiteApiKey?: string;
  kiteApiSecret?: string;
  kiteAccessToken?: string;
  databaseUrl?: string;
  redisUrl?: string;
  appAuthSecret?: string;
};

type EnvironmentRecord = Record<string, string | undefined>;

export function getClientSafeConfig(env: EnvironmentRecord = process.env): ClientSafeConfig {
  return {
    appUrl: env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    marketDataMode: normalizeMarketDataMode(env.NEXT_PUBLIC_MARKET_DATA_MODE),
  };
}

export function getServerConfig(env: EnvironmentRecord = process.env): ServerConfig {
  return {
    ...getClientSafeConfig(env),
    kiteApiKey: env.KITE_API_KEY,
    kiteApiSecret: env.KITE_API_SECRET,
    kiteAccessToken: env.KITE_ACCESS_TOKEN,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    appAuthSecret: env.APP_AUTH_SECRET,
  };
}

export function getClientSafeEnvKeys() {
  return CLIENT_SAFE_KEYS;
}
