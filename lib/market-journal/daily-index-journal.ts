import type { IndicatorContext } from "@/types/indicators";
import {
  OPTION_TARGET_MAX_POINTS,
  OPTION_TARGET_MIN_POINTS,
} from "@/lib/trading/option-targets";
import type { SimulatedMarketSnapshot, SimulatedUnderlying } from "@/types/simulation";

export const DAILY_INDEX_JOURNAL_STORAGE_KEY = "groww-daily-index-journal-v1";
export { OPTION_TARGET_MAX_POINTS, OPTION_TARGET_MIN_POINTS };

export type DailyIndexJournalIndexSummary = {
  symbol: SimulatedUnderlying["symbol"];
  label: string;
  line: string;
  lastPrice: string;
  move: string;
  vwapRead: string;
  trendRead: string;
  levelRead: string;
};

export type DailyIndexJournal = {
  tradeDate: string;
  generatedAt: string;
  title: string;
  marketTone: "Bullish" | "Bearish" | "Mixed" | "Waiting";
  headline: string;
  indexSummaries: DailyIndexJournalIndexSummary[];
  whatHappened: string[];
  nextDayPrep: string[];
  executionFocus: string[];
  markdown: string;
};

function numberText(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "pending";

  return `${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value)}${suffix}`;
}

function signedText(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "pending";

  const sign = value > 0 ? "+" : "";
  return `${sign}${numberText(value, suffix)}`;
}

function tradeDateFromGeneratedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  }

  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function generatedTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "pending";

  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function vwapRead(underlying: SimulatedUnderlying) {
  if (underlying.vwapDistance === null) return "VWAP pending";
  if (underlying.vwapDistance > 0) return `above VWAP by ${numberText(underlying.vwapDistance)}`;
  if (underlying.vwapDistance < 0) return `below VWAP by ${numberText(Math.abs(underlying.vwapDistance))}`;

  return "near VWAP";
}

function levelRead(underlying: SimulatedUnderlying) {
  const support = numberText(underlying.support);
  const resistance = numberText(underlying.resistance);

  if (support === "pending" && resistance === "pending") return "levels pending";

  return `support ${support}, resistance ${resistance}`;
}

function trendRead(underlying: SimulatedUnderlying) {
  return `${underlying.trend.toLowerCase()} trend, ${underlying.regime.replaceAll("_", " ").toLowerCase()} regime`;
}

function buildIndexSummary(underlying: SimulatedUnderlying): DailyIndexJournalIndexSummary {
  const lastPrice = numberText(underlying.lastPrice);
  const move = `${signedText(underlying.change)} / ${signedText(underlying.changePercent, "%")}`;
  const vwap = vwapRead(underlying);
  const trend = trendRead(underlying);
  const levels = levelRead(underlying);

  return {
    symbol: underlying.symbol,
    label: underlying.label,
    lastPrice,
    move,
    vwapRead: vwap,
    trendRead: trend,
    levelRead: levels,
    line: `${underlying.label}: last read ${lastPrice}, move ${move}, ${vwap}, ${trend}, ${levels}.`,
  };
}

function marketTone(underlyings: SimulatedUnderlying[]): DailyIndexJournal["marketTone"] {
  const withPrice = underlyings.filter((underlying) => underlying.lastPrice !== null);
  if (!withPrice.length) return "Waiting";

  const bullish = withPrice.filter(
    (underlying) =>
      underlying.trend === "Bullish" ||
      underlying.regime.includes("BULLISH") ||
      (underlying.vwapDistance ?? 0) > 0,
  ).length;
  const bearish = withPrice.filter(
    (underlying) =>
      underlying.trend === "Bearish" ||
      underlying.regime.includes("BEARISH") ||
      (underlying.vwapDistance ?? 0) < 0,
  ).length;

  if (bullish >= 2 && bullish > bearish) return "Bullish";
  if (bearish >= 2 && bearish > bullish) return "Bearish";
  return "Mixed";
}

function strongestIndex(underlyings: SimulatedUnderlying[]) {
  return underlyings
    .filter((underlying) => underlying.changePercent !== null)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))[0];
}

function weakestIndex(underlyings: SimulatedUnderlying[]) {
  return underlyings
    .filter((underlying) => underlying.changePercent !== null)
    .sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0))[0];
}

function indicatorRead(indicator: IndicatorContext) {
  const vwap = indicator.vwapDistance
    ? `${Number(indicator.vwapDistance) >= 0 ? "above" : "below"} VWAP by ${numberText(
        Math.abs(Number(indicator.vwapDistance)),
      )}`
    : "VWAP pending";
  const rsi = indicator.rsi14 ? `RSI ${numberText(Number(indicator.rsi14))}` : "RSI pending";
  const openingRange = indicator.openingRange15?.complete ? "opening range complete" : "opening range still building";

  return `${indicator.underlying} indicator read: ${indicator.emaTrend} EMA trend, ${vwap}, ${rsi}, ${openingRange}.`;
}

export function buildDailyIndexJournal(snapshot: SimulatedMarketSnapshot): DailyIndexJournal {
  const tone = marketTone(snapshot.underlyings);
  const tradeDate = tradeDateFromGeneratedAt(snapshot.generatedAt);
  const indexSummaries = snapshot.underlyings.map(buildIndexSummary);
  const strongest = strongestIndex(snapshot.underlyings);
  const weakest = weakestIndex(snapshot.underlyings);
  const targetText = `${OPTION_TARGET_MIN_POINTS}-${OPTION_TARGET_MAX_POINTS} option points`;
  const headline =
    tone === "Waiting"
      ? "Live index data is still waiting."
      : `${tone} index read from the latest live snapshot.`;
  const whatHappened = [
    strongest
      ? `${strongest.label} led the group at ${signedText(strongest.changePercent, "%")}.`
      : "Index leadership is pending until live prices arrive.",
    weakest && weakest.symbol !== strongest?.symbol
      ? `${weakest.label} was the weakest at ${signedText(weakest.changePercent, "%")}.`
      : "No clear weak index separated from the group.",
    indicatorRead(snapshot.phase4),
    `Scanner state: ${snapshot.phase6.state}, direction ${snapshot.phase6.direction} (${snapshot.phase6.quality}).`,
    `Option chain read: ${snapshot.phase5.tradableContracts} tradable contracts, PCR OI ${snapshot.phase5.putCallOpenInterestRatio ?? "pending"}.`,
  ];
  const nextDayPrep = [
    `Start with the strongest/weakest index relationship from today; avoid treating all indices as the same market.`,
    `Mark today's support and resistance zones, then check tomorrow whether price accepts above VWAP or rejects from it.`,
    `Wait for a closed 1-minute candle before trusting the indicator filter.`,
    `Before any paper trade, check whether the selected option has room for a clean ${targetText} move after spread and liquidity.`,
    "If the scanner still says NO TRADE, keep the day as observation and do not force an entry.",
  ];
  const executionFocus = [
    `Primary winning-trade objective: capture ${targetText}, then journal whether the move came cleanly.`,
    "Use option LTP for target planning; index levels only define direction and invalidation.",
    "Paper-only execution stays on; live order execution remains disabled.",
  ];
  const markdown = [
    `# Daily Index Journal - ${tradeDate}`,
    `Generated: ${generatedTime(snapshot.generatedAt)} IST`,
    "",
    `Market read: ${headline}`,
    "",
    "## What happened today",
    ...whatHappened.map((item) => `- ${item}`),
    "",
    "## Indices",
    ...indexSummaries.map((item) => `- ${item.line}`),
    "",
    "## Next-day prep",
    ...nextDayPrep.map((item) => `- ${item}`),
    "",
    "## Execution focus",
    ...executionFocus.map((item) => `- ${item}`),
  ].join("\n");

  return {
    tradeDate,
    generatedAt: snapshot.generatedAt,
    title: `Daily Index Journal - ${tradeDate}`,
    marketTone: tone,
    headline,
    indexSummaries,
    whatHappened,
    nextDayPrep,
    executionFocus,
    markdown,
  };
}
