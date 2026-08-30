export type RiskConfiguration = {
  tradingCapital: string;
  riskPerTradePercent: string;
  maximumDailyLossPercent: string;
  maximumTradesPerDay: number;
  maximumOpenPositions: number;
  maximumDeployableCapitalPercent: string;
  minimumRiskReward: string;
};

export const DEFAULT_RISK_CONFIGURATION: RiskConfiguration = {
  tradingCapital: "50000",
  riskPerTradePercent: "1",
  maximumDailyLossPercent: "3",
  maximumTradesPerDay: 3,
  maximumOpenPositions: 1,
  maximumDeployableCapitalPercent: "35",
  minimumRiskReward: "2",
};
