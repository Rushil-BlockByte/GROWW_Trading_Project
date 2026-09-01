import { describe, expect, it } from "vitest";
import {
  buildIndicatorContext,
  buildSupportResistanceLevels,
  calculateAtr,
  calculateEma,
  calculateOpeningRange,
  calculateRelativeVolume,
  calculateRsi,
  calculateSessionVwap,
} from "../lib/indicators/core";
import type { IndicatorCandle } from "../types/indicators";

function candle(index: number, overrides: Partial<IndicatorCandle> = {}): IndicatorCandle {
  return {
    startTime: new Date(Date.UTC(2026, 8, 1, 3, 45 + index, 0)).toISOString(),
    open: "100",
    high: "101",
    low: "99",
    close: "100",
    volume: 100,
    ...overrides,
  };
}

describe("indicator core", () => {
  it("calculates session VWAP from typical price and volume", () => {
    const result = calculateSessionVwap([
      candle(0, { high: "10", low: "10", close: "10", volume: 100 }),
      candle(1, { high: "20", low: "20", close: "20", volume: 200 }),
    ]);

    expect(result.map((point) => point.value)).toEqual(["10.00", "16.67"]);
  });

  it("seeds EMA with a simple moving average", () => {
    expect(calculateEma(["10", "11", "12", "13", "14"], 3)).toEqual([
      null,
      null,
      "11.00",
      "12.00",
      "13.00",
    ]);
  });

  it("calculates Wilder ATR", () => {
    const result = calculateAtr(
      [
        candle(0, { high: "10", low: "8", close: "9" }),
        candle(1, { high: "12", low: "9", close: "11" }),
        candle(2, { high: "14", low: "11", close: "13" }),
        candle(3, { high: "18", low: "13", close: "17" }),
      ],
      3,
    );

    expect(result).toEqual([null, null, "2.67", "3.44"]);
  });

  it("calculates RSI with one-sided and flat movement handling", () => {
    const rising = Array.from({ length: 16 }, (_, index) => String(index + 1));
    const flat = Array.from({ length: 16 }, () => "100");

    expect(calculateRsi(rising, 14).at(-1)).toBe("100.00");
    expect(calculateRsi(flat, 14).at(-1)).toBe("50.00");
  });

  it("compares current volume against the previous rolling average", () => {
    const result = calculateRelativeVolume(
      [
        candle(0, { volume: 100 }),
        candle(1, { volume: 200 }),
        candle(2, { volume: 300 }),
        candle(3, { volume: 800 }),
      ],
      3,
    );

    expect(result).toEqual([null, null, null, "4.00"]);
  });

  it("builds a complete opening range from the first session candles", () => {
    const candles = Array.from({ length: 16 }, (_, index) =>
      candle(index, {
        high: String(100 + index),
        low: String(90 - index),
      }),
    );

    expect(calculateOpeningRange(candles, 15)).toMatchObject({
      high: "114.00",
      low: "76.00",
      complete: true,
    });
  });

  it("separates potential support and resistance around the latest close", () => {
    const candles = Array.from({ length: 20 }, (_, index) =>
      candle(index, {
        high: String(101 + index * 0.2),
        low: String(99 + index * 0.2),
        close: String(100 + index * 0.25),
      }),
    );
    const openingRange = calculateOpeningRange(candles, 15);
    const levels = buildSupportResistanceLevels({
      previousDay: { high: "110", low: "90", close: "100" },
      openingRange,
      candles,
      latestClose: "105",
    });

    expect(levels.potentialSupport.map((level) => level.label)).toContain("Previous close");
    expect(levels.potentialResistance.map((level) => level.label)).toContain("Previous day high");
  });

  it("builds a full indicator context without creating a trade signal", () => {
    const candles = Array.from({ length: 60 }, (_, index) =>
      candle(index, {
        high: String(101 + index),
        low: String(99 + index),
        close: String(100 + index),
        volume: 1000 + index * 10,
      }),
    );

    expect(
      buildIndicatorContext({
        underlying: "NIFTY",
        candles,
        previousDay: { high: "170", low: "90", close: "100" },
      }),
    ).toMatchObject({
      underlying: "NIFTY",
      candleCount: 60,
      latestClose: "159.00",
      emaTrend: "Bullish",
    });
  });

  it("uses warm-up candles for early-session EMA, ATR, RSI, and volume context", () => {
    const warmupCandles = Array.from({ length: 60 }, (_, index) =>
      candle(index, {
        high: String(101 + index * 0.3),
        low: String(99 + index * 0.3),
        close: String(100 + index * 0.3),
        volume: 1000 + index * 10,
      }),
    );
    const sessionCandles = Array.from({ length: 4 }, (_, index) =>
      candle(index + 60, {
        high: String(120 + index),
        low: String(118 + index),
        close: String(119 + index),
        volume: 2500 + index * 100,
      }),
    );
    const context = buildIndicatorContext({
      underlying: "NIFTY",
      candles: sessionCandles,
      warmupCandles,
      previousDay: { high: "122", low: "110", close: "118" },
    });

    expect(context.candleCount).toBe(4);
    expect(context.warmupCandleCount).toBe(60);
    expect(context.vwap).not.toBeNull();
    expect(context.ema9).not.toBeNull();
    expect(context.ema20).not.toBeNull();
    expect(context.ema50).not.toBeNull();
    expect(context.atr14).not.toBeNull();
    expect(context.rsi14).not.toBeNull();
    expect(context.volumeAverage20).not.toBeNull();
  });
});
