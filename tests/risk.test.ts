import { describe, expect, it } from "vitest";
import { calculateDailyLossLimit, calculatePositionSize } from "../lib/risk/position-sizing";

describe("risk and position sizing", () => {
  it("rejects a trade when the valid size is below one lot", () => {
    const result = calculatePositionSize({
      tradingCapital: "50000",
      riskPerTradePercent: "1",
      entryPrice: "150",
      stopPrice: "140",
      lotSize: 75,
    });

    expect(result.canTrade).toBe(false);
    expect(result.quantity).toBe(0);
    expect(result.maximumRisk).toBe("500.00");
    expect(result.reason).toBe("Required position size is below minimum lot size.");
  });

  it("rounds down to the nearest valid lot size", () => {
    const result = calculatePositionSize({
      tradingCapital: "100000",
      riskPerTradePercent: "2",
      entryPrice: "120",
      stopPrice: "110",
      lotSize: 75,
    });

    expect(result.canTrade).toBe(true);
    expect(result.quantity).toBe(150);
    expect(result.lots).toBe(2);
    expect(result.estimatedRisk).toBe("1500.00");
  });

  it("calculates daily loss limits with decimal-safe arithmetic", () => {
    expect(calculateDailyLossLimit("50000", "3")).toBe("1500.00");
  });
});
