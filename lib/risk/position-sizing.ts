import Decimal from "decimal.js";

export type PositionSizingInput = {
  tradingCapital: Decimal.Value;
  riskPerTradePercent: Decimal.Value;
  entryPrice: Decimal.Value;
  stopPrice: Decimal.Value;
  lotSize: number;
};

export type PositionSizingResult = {
  canTrade: boolean;
  quantity: number;
  lots: number;
  maximumRisk: string;
  estimatedRisk: string;
  riskPerUnit: string;
  reason?: string;
};

export function calculatePositionSize(input: PositionSizingInput): PositionSizingResult {
  const tradingCapital = new Decimal(input.tradingCapital);
  const riskPerTradePercent = new Decimal(input.riskPerTradePercent);
  const entryPrice = new Decimal(input.entryPrice);
  const stopPrice = new Decimal(input.stopPrice);
  const lotSize = input.lotSize;

  if (lotSize <= 0 || !Number.isInteger(lotSize)) {
    throw new Error("Lot size must be a positive integer.");
  }

  const riskPerUnit = entryPrice.minus(stopPrice).abs();
  const maximumRisk = tradingCapital.mul(riskPerTradePercent).div(100);

  if (riskPerUnit.lte(0)) {
    return {
      canTrade: false,
      quantity: 0,
      lots: 0,
      maximumRisk: maximumRisk.toFixed(2),
      estimatedRisk: "0.00",
      riskPerUnit: riskPerUnit.toFixed(2),
      reason: "Stop distance is zero.",
    };
  }

  const maximumUnits = maximumRisk.div(riskPerUnit).floor();
  const lots = maximumUnits.div(lotSize).floor().toNumber();
  const quantity = lots * lotSize;
  const estimatedRisk = riskPerUnit.mul(quantity);

  if (lots < 1) {
    return {
      canTrade: false,
      quantity: 0,
      lots: 0,
      maximumRisk: maximumRisk.toFixed(2),
      estimatedRisk: estimatedRisk.toFixed(2),
      riskPerUnit: riskPerUnit.toFixed(2),
      reason: "Required position size is below minimum lot size.",
    };
  }

  return {
    canTrade: true,
    quantity,
    lots,
    maximumRisk: maximumRisk.toFixed(2),
    estimatedRisk: estimatedRisk.toFixed(2),
    riskPerUnit: riskPerUnit.toFixed(2),
  };
}

export function calculateDailyLossLimit(
  tradingCapital: Decimal.Value,
  maximumDailyLossPercent: Decimal.Value,
) {
  return new Decimal(tradingCapital).mul(maximumDailyLossPercent).div(100).toFixed(2);
}
