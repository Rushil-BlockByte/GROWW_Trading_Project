import { MARKET_SESSION } from "@/lib/config/market";
import {
  isInsideKolkataSession,
  type SessionWindow,
} from "@/lib/market/session";
import type { MarketStateSummary } from "@/lib/market/market-state";
import type { MarketDataProviderStatus } from "@/lib/providers/market-data-provider";

export const LIVE_STREAM_STALE_AFTER_SECONDS = 30;

export type LiveStreamSafetyStatus = "pass" | "warn" | "block";

export type LiveStreamSafetyCheck = {
  key: string;
  label: string;
  status: LiveStreamSafetyStatus;
  message: string;
};

export type LiveStreamMarketSession = {
  open: boolean;
  checkedAt: string;
  timezone: "Asia/Kolkata";
  window: SessionWindow;
  message: string;
};

export type LiveStreamFreshness = {
  status: LiveStreamSafetyStatus;
  staleAfterSeconds: number;
  lastTickAgeSeconds: number | null;
  message: string;
};

export type LiveStreamSafetySnapshot = {
  marketSession: LiveStreamMarketSession;
  freshness: LiveStreamFreshness;
  safetyChecks: LiveStreamSafetyCheck[];
  startAllowed: boolean;
  readOnly: true;
  liveOrdersEnabled: false;
};

function secondsSince(value: string | undefined, now: Date) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
}

export function getLiveStreamMarketSession(
  now = new Date(),
  window: SessionWindow = {
    open: MARKET_SESSION.open,
    close: MARKET_SESSION.equityClose,
  },
): LiveStreamMarketSession {
  const open = isInsideKolkataSession(now, window);

  return {
    open,
    checkedAt: now.toISOString(),
    timezone: "Asia/Kolkata",
    window,
    message: open
      ? "Indian equity market session is open."
      : `Indian equity market session is closed. Start is allowed only from ${window.open} to ${window.close} IST.`,
  };
}

export function getLiveStreamFreshness({
  lastTickAt,
  now = new Date(),
  staleAfterSeconds = LIVE_STREAM_STALE_AFTER_SECONDS,
}: {
  lastTickAt?: string;
  now?: Date;
  staleAfterSeconds?: number;
}): LiveStreamFreshness {
  const lastTickAgeSeconds = secondsSince(lastTickAt, now);

  if (lastTickAgeSeconds === null) {
    return {
      status: "warn",
      staleAfterSeconds,
      lastTickAgeSeconds,
      message: "No live tick has been received yet.",
    };
  }

  if (lastTickAgeSeconds > staleAfterSeconds) {
    return {
      status: "block",
      staleAfterSeconds,
      lastTickAgeSeconds,
      message: `Latest tick is ${lastTickAgeSeconds}s old, above the ${staleAfterSeconds}s limit.`,
    };
  }

  return {
    status: "pass",
    staleAfterSeconds,
    lastTickAgeSeconds,
    message: `Latest tick is ${lastTickAgeSeconds}s old.`,
  };
}

export function buildLiveStreamSafetySnapshot({
  configured,
  instrumentMasterCount,
  marketState,
  now = new Date(),
  provider,
  unresolvedUnderlyings,
}: {
  configured: {
    apiKey: boolean;
    accessToken: boolean;
    apiSecret: boolean;
  };
  instrumentMasterCount: number;
  marketState: MarketStateSummary;
  now?: Date;
  provider: MarketDataProviderStatus;
  unresolvedUnderlyings: string[];
}): LiveStreamSafetySnapshot {
  const marketSession = getLiveStreamMarketSession(now);
  const freshness = getLiveStreamFreshness({
    lastTickAt: provider.lastTickAt ?? marketState.lastTickAt,
    now,
  });
  const safetyChecks: LiveStreamSafetyCheck[] = [
    {
      key: "credentials",
      label: "Credentials",
      status: configured.apiKey && configured.accessToken ? "pass" : "block",
      message: configured.apiKey && configured.accessToken
        ? "Kite API key and access token are set."
        : "Kite API key and access token are required before starting live data.",
    },
    {
      key: "market-hours",
      label: "Market Hours",
      status: marketSession.open ? "pass" : "block",
      message: marketSession.message,
    },
    {
      key: "socket",
      label: "WebSocket",
      status: provider.connected ? "pass" : provider.reconnecting ? "warn" : "warn",
      message: provider.connected
        ? "WebSocket is connected."
        : provider.reconnecting
          ? "WebSocket is reconnecting."
          : "WebSocket is not connected.",
    },
    {
      key: "instruments",
      label: "Instrument Master",
      status: instrumentMasterCount > 0 ? "pass" : "warn",
      message: instrumentMasterCount
        ? `${instrumentMasterCount} instruments loaded.`
        : "Instrument master has not been loaded yet.",
    },
    {
      key: "underlyings",
      label: "Underlying Resolution",
      status: unresolvedUnderlyings.length ? "block" : "pass",
      message: unresolvedUnderlyings.length
        ? `Unresolved underlyings: ${unresolvedUnderlyings.join(", ")}.`
        : "All configured underlyings resolved.",
    },
    {
      key: "freshness",
      label: "Tick Freshness",
      status: freshness.status,
      message: freshness.message,
    },
    {
      key: "orders",
      label: "Live Orders",
      status: "pass",
      message: "Live order execution is disabled.",
    },
  ];
  const startAllowed = safetyChecks
    .filter((check) => check.key === "credentials" || check.key === "market-hours")
    .every((check) => check.status === "pass");

  return {
    marketSession,
    freshness,
    safetyChecks,
    startAllowed,
    readOnly: true,
    liveOrdersEnabled: false,
  };
}
