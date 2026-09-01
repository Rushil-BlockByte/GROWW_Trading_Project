export type TradingExplanation = {
  headline: string;
  verdict: "no_trade" | "watch" | "positive" | "caution";
  summary: string;
  strengths: string[];
  cautions: string[];
  nextSteps: string[];
  changed: string[];
  liveOrdersEnabled: false;
};
