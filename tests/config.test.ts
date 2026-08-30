import { describe, expect, it } from "vitest";
import { getClientSafeConfig, getClientSafeEnvKeys, getServerConfig } from "../lib/config/env";
import { getMarketDataModeLabel, normalizeMarketDataMode } from "../lib/config/market";

describe("configuration boundaries", () => {
  it("defaults to simulation mode unless live mode is explicit", () => {
    expect(normalizeMarketDataMode(undefined)).toBe("simulation");
    expect(normalizeMarketDataMode("paper")).toBe("simulation");
    expect(normalizeMarketDataMode("live")).toBe("live");
  });

  it("labels simulation data clearly", () => {
    const label = getMarketDataModeLabel("simulation");

    expect(label.label).toBe("SIMULATION MODE");
    expect(label.description).toBe("Paper trading only");
  });

  it("does not expose Kite secrets in client-safe config", () => {
    const clientConfig = getClientSafeConfig({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_MARKET_DATA_MODE: "simulation",
      KITE_API_SECRET: "server-secret",
    });
    const serverConfig = getServerConfig({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      KITE_API_SECRET: "server-secret",
    });

    expect(clientConfig).not.toHaveProperty("kiteApiSecret");
    expect(serverConfig.kiteApiSecret).toBe("server-secret");
    expect(getClientSafeEnvKeys()).toEqual([
      "NEXT_PUBLIC_APP_URL",
      "NEXT_PUBLIC_MARKET_DATA_MODE",
    ]);
  });
});
