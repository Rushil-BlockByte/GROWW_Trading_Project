import { describe, expect, it } from "vitest";
import {
  buildLiveStreamSafetySnapshot,
  getLiveStreamFreshness,
  getLiveStreamMarketSession,
} from "../lib/zerodha/live-stream-safety";

const CONNECTED_PROVIDER = {
  connected: true,
  reconnecting: false,
  subscriptionCount: 3,
  rejectedSubscriptions: 0,
  reconnectCount: 0,
  uptimeSeconds: 60,
};

describe("live stream safety gates", () => {
  it("blocks live stream startup outside Indian market hours", () => {
    const status = getLiveStreamMarketSession(new Date("2026-09-01T02:00:00.000Z"));

    expect(status.open).toBe(false);
    expect(status.message).toContain("Start is allowed");
  });

  it("marks stale ticks as blocking freshness", () => {
    const freshness = getLiveStreamFreshness({
      lastTickAt: "2026-09-01T04:00:00.000Z",
      now: new Date("2026-09-01T04:01:00.000Z"),
    });

    expect(freshness.status).toBe("block");
    expect(freshness.lastTickAgeSeconds).toBe(60);
  });

  it("keeps live orders disabled even when stream checks pass", () => {
    const safety = buildLiveStreamSafetySnapshot({
      configured: {
        apiKey: true,
        accessToken: true,
        apiSecret: true,
      },
      instrumentMasterCount: 3,
      marketState: {
        instrumentsTracked: 3,
        lastTickAt: "2026-09-01T04:00:00.000Z",
        dataQuality: "GOOD",
        rejectedTicks: 0,
        rejectionReasons: [],
      },
      now: new Date("2026-09-01T04:00:05.000Z"),
      provider: {
        ...CONNECTED_PROVIDER,
        lastTickAt: "2026-09-01T04:00:00.000Z",
      },
      unresolvedUnderlyings: [],
    });

    expect(safety.startAllowed).toBe(true);
    expect(safety.readOnly).toBe(true);
    expect(safety.liveOrdersEnabled).toBe(false);
    expect(safety.safetyChecks.find((check) => check.key === "orders")?.status).toBe("pass");
  });
});
