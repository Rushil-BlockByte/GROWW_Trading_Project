import { DEFAULT_UNDERLYINGS } from "@/lib/config/market";
import { buildOptionChainContext } from "@/lib/options/chain-context";
import { createPhase2PipelineSnapshot } from "@/lib/simulation/phase2-pipeline";
import { createPhase4IndicatorContext } from "@/lib/simulation/phase4-context";
import { evaluateSrFlipSignal } from "@/lib/strategy/sr-flip";
import { srFlipSignalSummary } from "@/lib/strategy/sr-flip-signal";
import type { LevelCandle, SrLevel } from "@/types/sr-flip";
import type {
  SimulatedMarketSnapshot,
  SimulatedOptionRow,
  SimulatedUnderlying,
} from "@/types/simulation";

const NIFTY_BASE = 25180;

function round(value: number, precision = 2) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function buildOptionChain(offset = 0): SimulatedOptionRow[] {
  const strikes = [24950, 25000, 25050, 25100, 25150, 25200, 25250, 25300, 25350];

  return strikes.map((strike) => {
    const distance = Math.abs(strike - 25200);
    const premiumBase = Math.max(32, 184 - distance * 0.9);
    const callLtp = round(premiumBase + offset * 0.12 + (strike <= 25200 ? 18 : -4));
    const putLtp = round(Math.max(28, premiumBase - offset * 0.1 + (strike >= 25200 ? 15 : -8)));
    const callBid = round(callLtp - 0.75);
    const callAsk = round(callLtp + 0.85);
    const putBid = round(putLtp - 0.7);
    const putAsk = round(putLtp + 0.9);

    return {
      strike,
      isAtm: strike === 25200,
      call: {
        ltp: callLtp,
        volume: 120000 - distance * 90,
        openInterest: 850000 + (strike - 24950) * 700,
        oiChange: strike <= 25200 ? 18500 - distance * 12 : 8200 - distance * 8,
        bid: callBid,
        ask: callAsk,
        spreadPercent: round(((callAsk - callBid) / callLtp) * 100),
      },
      put: {
        ltp: putLtp,
        volume: 108000 - distance * 72,
        openInterest: 910000 - (strike - 24950) * 540,
        oiChange: strike >= 25200 ? 15200 - distance * 9 : 6600 - distance * 7,
        bid: putBid,
        ask: putAsk,
        spreadPercent: round(((putAsk - putBid) / putLtp) * 100),
      },
    };
  });
}

export function createInitialMarketSnapshot(): SimulatedMarketSnapshot {
  return createSimulatedMarketSnapshot(0);
}

export function createSimulatedMarketSnapshot(step: number): SimulatedMarketSnapshot {
  const phase4 = createPhase4IndicatorContext(step);
  const niftyLast = round(Number(phase4.latestClose));
  const drift = niftyLast - NIFTY_BASE;

  const underlyings = DEFAULT_UNDERLYINGS.map((underlying, index) => {
    const isNifty = index === 0;
    const base = index === 0 ? niftyLast : index === 1 ? 53840 + drift * 2.4 : 24170 + drift * 0.8;
    const vwap = isNifty ? Number(phase4.vwap ?? 0) : index === 1 ? 53760 : 24135;
    const change = isNifty ? base - 25060 : index === 1 ? 128 + drift * 1.4 : 41 + drift * 0.7;
    const resistance = isNifty
      ? Number(phase4.potentialResistance[0]?.value ?? phase4.openingRange15?.high ?? 25195)
      : index === 1
        ? 53950
        : 24220;
    const support = isNifty
      ? Number(phase4.potentialSupport[0]?.value ?? phase4.openingRange15?.low ?? 25110)
      : index === 1
        ? 53680
        : 24090;
    const trend: SimulatedUnderlying["trend"] = isNifty
      ? phase4.emaTrend === "Bullish"
        ? "Bullish"
        : phase4.emaTrend === "Bearish"
          ? "Bearish"
          : "Flat"
      : base > vwap
        ? "Bullish"
        : "Flat";
    const regime: SimulatedUnderlying["regime"] =
      index === 0 ? "BULLISH" : index === 1 ? "SIDEWAYS" : "LOW_VOLATILITY";
    const dataQuality: SimulatedUnderlying["dataQuality"] = "GOOD";

    return {
      symbol: underlying.symbol,
      label: underlying.label,
      lastPrice: round(base),
      change: round(change),
      changePercent: round((change / (base - change)) * 100),
      vwap,
      vwapDistance: round(base - vwap),
      trend,
      volumeRelative: isNifty
        ? round(Number(phase4.relativeVolume20 ?? 1))
        : round(1.05 + index * 0.18 + Math.abs(Math.sin(step / 6)) * 0.35),
      openInterest: 1850000 + index * 420000,
      oiChange: 28400 - index * 4200,
      regime,
      dataQuality,
      support,
      resistance,
    };
  });

  const phase2 = createPhase2PipelineSnapshot(step, String(niftyLast));
  const optionChain = buildOptionChain(drift);
  const phase5 = buildOptionChainContext({
    underlying: "NIFTY",
    underlyingLastPrice: String(niftyLast),
    expiry: phase2.selectedExpiry,
    rows: optionChain,
  });
  const srLevels: SrLevel[] = [
    { price: Math.round(niftyLast - 90), touches: 7, firstIndex: 0, lastIndex: 0 },
    { price: Math.round(niftyLast - 45), touches: 9, firstIndex: 0, lastIndex: 0 },
    { price: Math.round(niftyLast + 45), touches: 8, firstIndex: 0, lastIndex: 0 },
    { price: Math.round(niftyLast + 90), touches: 6, firstIndex: 0, lastIndex: 0 },
  ];
  const nowIso = new Date().toISOString();
  const srSessionBars: LevelCandle[] = [
    { startTime: nowIso, high: niftyLast + 5, low: niftyLast - 6, close: niftyLast - 2 },
    { startTime: nowIso, high: niftyLast + 6, low: niftyLast - 4, close: niftyLast },
  ];
  const phase6 = evaluateSrFlipSignal({
    underlying: "NIFTY",
    levels: srLevels,
    sessionBars: srSessionBars,
    referencePrice: niftyLast,
    vix: 12.5,
  });

  return {
    generatedAt: new Date().toISOString(),
    underlyings,
    optionChain,
    signal: srFlipSignalSummary(phase6),
    health: {
      websocket: "NOT_CONNECTED",
      lastTickSecondsAgo: 1,
      subscriptions: phase2.subscriptionCount,
      rejectedSubscriptions: phase2.rejectedSubscriptions,
      dataQuality: phase2.dataQuality,
      signalEngine: "RUNNING",
      database: process.env.DATABASE_URL ? "CONFIGURED" : "NOT_CONFIGURED",
      mode: "simulation",
    },
    phase2,
    phase4,
    phase5,
    phase6,
  };
}
