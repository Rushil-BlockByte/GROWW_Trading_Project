import Decimal from "decimal.js";
import { buildIndicatorContext } from "@/lib/indicators/core";
import type { IndicatorCandle, IndicatorContext } from "@/types/indicators";

const SIMULATION_INDICATOR_START = new Date("2026-09-01T03:45:00.000Z");
const NIFTY_INDICATOR_BASE = new Decimal(25080);
const PREVIOUS_DAY_CONTEXT = {
  high: "25210",
  low: "24980",
  close: "25060",
};

function toFixed(value: Decimal.Value) {
  return new Decimal(value).toFixed(2);
}

export function createSimulatedIndicatorCandles(step = 0): IndicatorCandle[] {
  return Array.from({ length: 60 }, (_, index) => {
    const drift = Math.sin((index + step) / 6) * 8 + Math.cos(index / 9) * 4;
    const open = NIFTY_INDICATOR_BASE.plus(index * 1.6).plus(drift);
    const close = open.plus(Math.sin((index + step) / 4) * 5);
    const high = Decimal.max(open, close).plus(3.5 + Math.abs(Math.cos(index / 7)) * 1.6);
    const low = Decimal.min(open, close).minus(3.25 + Math.abs(Math.sin(index / 8)) * 1.4);
    const volume =
      85_000 +
      index * 900 +
      Math.round(Math.abs(Math.sin((index + step) / 5)) * 18_000);
    const openInterest = 1_800_000 + index * 2_750 + Math.round(Math.cos(index / 10) * 9_000);

    return {
      startTime: new Date(SIMULATION_INDICATOR_START.getTime() + index * 60_000).toISOString(),
      open: toFixed(open),
      high: toFixed(high),
      low: toFixed(low),
      close: toFixed(close),
      volume,
      openInterest,
    };
  });
}

export function createPhase4IndicatorContext(step = 0): IndicatorContext {
  return buildIndicatorContext({
    underlying: "NIFTY",
    candles: createSimulatedIndicatorCandles(step),
    previousDay: PREVIOUS_DAY_CONTEXT,
  });
}
