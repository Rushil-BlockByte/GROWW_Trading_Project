import { describe, expect, it } from "vitest";
import { DisabledOrderExecutionProvider } from "../lib/providers/broker-provider";

describe("order execution boundary", () => {
  it("blocks all live order operations in V1", async () => {
    const provider = new DisabledOrderExecutionProvider();

    await expect(
      provider.placeOrder({
        signalId: "signal-1",
        optionSymbol: "NIFTY 25200 CE",
        quantity: 75,
        entryPrice: "150",
      }),
    ).rejects.toThrow("Live order execution disabled in V1.");
    await expect(provider.modifyOrder("order-1")).rejects.toThrow(
      "Live order execution disabled in V1.",
    );
    await expect(provider.cancelOrder("order-1")).rejects.toThrow(
      "Live order execution disabled in V1.",
    );
  });
});
