import { describe, expect, it } from "vitest";
import { SimulatedMarketDataProvider } from "../lib/providers/simulated-market-data-provider";

describe("simulated market data provider", () => {
  it("emits normalized ticks only for accepted subscriptions", async () => {
    const provider = new SimulatedMarketDataProvider([
      {
        instrumentToken: 256265,
        basePrice: "25180",
        volumeBase: 1000,
        openInterestBase: 0,
      },
    ]);
    const received: number[] = [];

    provider.onTick((tick) => received.push(tick.instrumentToken));

    await provider.connect();
    await provider.subscribe([
      { instrumentToken: 256265, mode: "QUOTE" },
      { instrumentToken: 999999, mode: "QUOTE" },
    ]);

    const ticks = provider.emitNextTick(new Date("2026-09-01T03:45:00.000Z"));
    const status = provider.getStatus();

    expect(ticks).toHaveLength(1);
    expect(received).toEqual([256265]);
    expect(status.subscriptionCount).toBe(1);
    expect(status.rejectedSubscriptions).toBe(1);
  });
});
