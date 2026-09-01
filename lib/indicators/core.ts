import Decimal from "decimal.js";
import type {
  IndicatorCandle,
  IndicatorContext,
  IndicatorPoint,
  OpeningRange,
  PriceLevel,
} from "@/types/indicators";

function toDecimal(value: Decimal.Value) {
  return new Decimal(value);
}

function toFixed(value: Decimal.Value, places = 2) {
  return toDecimal(value).toFixed(places);
}

function typicalPrice(candle: IndicatorCandle) {
  return toDecimal(candle.high).plus(candle.low).plus(candle.close).div(3);
}

function sortCandles(candles: IndicatorCandle[]) {
  return [...candles].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );
}

function dedupeSortedCandles(candles: IndicatorCandle[]) {
  const byStartTime = new Map<string, IndicatorCandle>();

  for (const candle of candles) {
    byStartTime.set(candle.startTime, candle);
  }

  return sortCandles(Array.from(byStartTime.values()));
}

export function calculateSessionVwap(candles: IndicatorCandle[]): IndicatorPoint[] {
  const sorted = sortCandles(candles);
  let cumulativePriceVolume = new Decimal(0);
  let cumulativeVolume = new Decimal(0);

  return sorted.map((candle) => {
    const volume = new Decimal(candle.volume);

    if (volume.gt(0)) {
      cumulativePriceVolume = cumulativePriceVolume.plus(typicalPrice(candle).mul(volume));
      cumulativeVolume = cumulativeVolume.plus(volume);
    }

    return {
      timestamp: candle.startTime,
      value: cumulativeVolume.gt(0) ? cumulativePriceVolume.div(cumulativeVolume).toFixed(2) : null,
    };
  });
}

export function calculateEma(values: Decimal.Value[], period: number): Array<string | null> {
  if (period <= 0) {
    throw new Error("EMA period must be positive.");
  }

  const result = Array<string | null>(values.length).fill(null);

  if (values.length < period) {
    return result;
  }

  const decimals = values.map(toDecimal);
  const seed = decimals.slice(0, period).reduce((sum, value) => sum.plus(value), new Decimal(0)).div(period);
  const multiplier = new Decimal(2).div(period + 1);
  let previousEma = seed;

  result[period - 1] = previousEma.toFixed(2);

  for (let index = period; index < decimals.length; index += 1) {
    previousEma = decimals[index].minus(previousEma).mul(multiplier).plus(previousEma);
    result[index] = previousEma.toFixed(2);
  }

  return result;
}

export function calculateAtr(candles: IndicatorCandle[], period: number): Array<string | null> {
  if (period <= 0) {
    throw new Error("ATR period must be positive.");
  }

  const sorted = sortCandles(candles);
  const result = Array<string | null>(sorted.length).fill(null);

  if (sorted.length < period) {
    return result;
  }

  const trueRanges = sorted.map((candle, index) => {
    const high = toDecimal(candle.high);
    const low = toDecimal(candle.low);

    if (index === 0) {
      return high.minus(low);
    }

    const previousClose = toDecimal(sorted[index - 1].close);

    return Decimal.max(high.minus(low), high.minus(previousClose).abs(), low.minus(previousClose).abs());
  });

  let atr = trueRanges
    .slice(0, period)
    .reduce((sum, value) => sum.plus(value), new Decimal(0))
    .div(period);

  result[period - 1] = atr.toFixed(2);

  for (let index = period; index < trueRanges.length; index += 1) {
    atr = atr.mul(period - 1).plus(trueRanges[index]).div(period);
    result[index] = atr.toFixed(2);
  }

  return result;
}

export function calculateRsi(closes: Decimal.Value[], period: number): Array<string | null> {
  if (period <= 0) {
    throw new Error("RSI period must be positive.");
  }

  const result = Array<string | null>(closes.length).fill(null);

  if (closes.length <= period) {
    return result;
  }

  const values = closes.map(toDecimal);
  let averageGain = new Decimal(0);
  let averageLoss = new Decimal(0);

  for (let index = 1; index <= period; index += 1) {
    const change = values[index].minus(values[index - 1]);

    if (change.gt(0)) {
      averageGain = averageGain.plus(change);
    } else {
      averageLoss = averageLoss.plus(change.abs());
    }
  }

  averageGain = averageGain.div(period);
  averageLoss = averageLoss.div(period);
  result[period] = calculateRsiValue(averageGain, averageLoss);

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index].minus(values[index - 1]);
    const gain = change.gt(0) ? change : new Decimal(0);
    const loss = change.lt(0) ? change.abs() : new Decimal(0);

    averageGain = averageGain.mul(period - 1).plus(gain).div(period);
    averageLoss = averageLoss.mul(period - 1).plus(loss).div(period);
    result[index] = calculateRsiValue(averageGain, averageLoss);
  }

  return result;
}

function calculateRsiValue(averageGain: Decimal, averageLoss: Decimal) {
  if (averageGain.eq(0) && averageLoss.eq(0)) return "50.00";
  if (averageLoss.eq(0)) return "100.00";

  const relativeStrength = averageGain.div(averageLoss);

  return new Decimal(100).minus(new Decimal(100).div(relativeStrength.plus(1))).toFixed(2);
}

export function calculateRollingVolumeAverage(
  candles: IndicatorCandle[],
  period: number,
): Array<string | null> {
  if (period <= 0) {
    throw new Error("Volume average period must be positive.");
  }

  const sorted = sortCandles(candles);
  const result = Array<string | null>(sorted.length).fill(null);

  for (let index = period - 1; index < sorted.length; index += 1) {
    const window = sorted.slice(index - period + 1, index + 1);
    const average = window
      .reduce((sum, candle) => sum.plus(candle.volume), new Decimal(0))
      .div(period);
    result[index] = average.toFixed(2);
  }

  return result;
}

export function calculateRelativeVolume(
  candles: IndicatorCandle[],
  period: number,
): Array<string | null> {
  if (period <= 0) {
    throw new Error("Relative volume period must be positive.");
  }

  const sorted = sortCandles(candles);
  const result = Array<string | null>(sorted.length).fill(null);

  for (let index = period; index < sorted.length; index += 1) {
    const previousWindow = sorted.slice(index - period, index);
    const average = previousWindow
      .reduce((sum, candle) => sum.plus(candle.volume), new Decimal(0))
      .div(period);

    result[index] = average.gt(0) ? new Decimal(sorted[index].volume).div(average).toFixed(2) : null;
  }

  return result;
}

export function calculateOpeningRange(
  candles: IndicatorCandle[],
  minutes: number,
): OpeningRange | null {
  if (minutes <= 0) {
    throw new Error("Opening range minutes must be positive.");
  }

  const sorted = sortCandles(candles);

  if (sorted.length === 0) {
    return null;
  }

  const startTime = new Date(sorted[0].startTime);
  const endTime = new Date(startTime.getTime() + minutes * 60_000);
  const rangeCandles = sorted.filter((candle) => {
    const candleTime = new Date(candle.startTime);

    return candleTime >= startTime && candleTime < endTime;
  });

  if (rangeCandles.length === 0) {
    return null;
  }

  const high = Decimal.max(...rangeCandles.map((candle) => toDecimal(candle.high)));
  const low = Decimal.min(...rangeCandles.map((candle) => toDecimal(candle.low)));
  const lastRangeCandleTime = new Date(rangeCandles.at(-1)?.startTime ?? startTime);
  const complete = lastRangeCandleTime.getTime() >= endTime.getTime() - 60_000;

  return {
    minutes,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    high: high.toFixed(2),
    low: low.toFixed(2),
    complete,
  };
}

export function findSwingLevels(
  candles: IndicatorCandle[],
  lookback = 2,
): { swingHighs: PriceLevel[]; swingLows: PriceLevel[] } {
  const sorted = sortCandles(candles);
  const swingHighs: PriceLevel[] = [];
  const swingLows: PriceLevel[] = [];

  for (let index = lookback; index < sorted.length - lookback; index += 1) {
    const current = sorted[index];
    const neighbors = [
      ...sorted.slice(index - lookback, index),
      ...sorted.slice(index + 1, index + lookback + 1),
    ];
    const high = toDecimal(current.high);
    const low = toDecimal(current.low);
    const isSwingHigh = neighbors.every((candle) => high.gt(candle.high));
    const isSwingLow = neighbors.every((candle) => low.lt(candle.low));

    if (isSwingHigh) {
      swingHighs.push({
        label: "Swing high",
        value: high.toFixed(2),
        source: "swing",
      });
    }

    if (isSwingLow) {
      swingLows.push({
        label: "Swing low",
        value: low.toFixed(2),
        source: "swing",
      });
    }
  }

  return {
    swingHighs,
    swingLows,
  };
}

export function buildSupportResistanceLevels({
  previousDay,
  openingRange,
  candles,
  latestClose,
}: {
  previousDay: { high: Decimal.Value; low: Decimal.Value; close: Decimal.Value };
  openingRange: OpeningRange | null;
  candles: IndicatorCandle[];
  latestClose: Decimal.Value;
}) {
  const latest = toDecimal(latestClose);
  const levels: PriceLevel[] = [
    {
      label: "Previous day high",
      value: toFixed(previousDay.high),
      source: "previous_day",
    },
    {
      label: "Previous day low",
      value: toFixed(previousDay.low),
      source: "previous_day",
    },
    {
      label: "Previous close",
      value: toFixed(previousDay.close),
      source: "previous_day",
    },
  ];

  if (openingRange) {
    levels.push(
      {
        label: "Opening range high",
        value: openingRange.high,
        source: "opening_range",
      },
      {
        label: "Opening range low",
        value: openingRange.low,
        source: "opening_range",
      },
    );
  }

  const swings = findSwingLevels(candles);
  levels.push(...swings.swingHighs.slice(-3), ...swings.swingLows.slice(-3));

  const deduped = dedupeLevels(levels);

  return {
    potentialSupport: deduped
      .filter((level) => toDecimal(level.value).lte(latest))
      .sort((a, b) => toDecimal(b.value).minus(a.value).toNumber())
      .slice(0, 4),
    potentialResistance: deduped
      .filter((level) => toDecimal(level.value).gte(latest))
      .sort((a, b) => toDecimal(a.value).minus(b.value).toNumber())
      .slice(0, 4),
  };
}

export function classifyEmaTrend(ema9: string | null, ema20: string | null, ema50: string | null) {
  if (!ema9 || !ema20 || !ema50) {
    return "Insufficient data" as const;
  }

  const fast = toDecimal(ema9);
  const mid = toDecimal(ema20);
  const slow = toDecimal(ema50);

  if (fast.gt(mid) && mid.gt(slow)) return "Bullish" as const;
  if (fast.lt(mid) && mid.lt(slow)) return "Bearish" as const;

  return "Mixed" as const;
}

export function buildIndicatorContext({
  underlying,
  candles,
  warmupCandles = [],
  previousDay,
}: {
  underlying: IndicatorContext["underlying"];
  candles: IndicatorCandle[];
  warmupCandles?: IndicatorCandle[];
  previousDay: { high: Decimal.Value; low: Decimal.Value; close: Decimal.Value };
}): IndicatorContext {
  const sorted = dedupeSortedCandles(candles);
  const calculationCandles = dedupeSortedCandles([...warmupCandles, ...sorted]);
  const latest = sorted.at(-1) ?? calculationCandles.at(-1);

  if (!latest) {
    return {
      underlying,
      candleCount: 0,
      warmupCandleCount: 0,
      latestClose: "0.00",
      vwap: null,
      vwapDistance: null,
      ema9: null,
      ema20: null,
      ema50: null,
      emaTrend: "Insufficient data",
      atr14: null,
      rsi14: null,
      volumeAverage20: null,
      relativeVolume20: null,
      openingRange15: null,
      potentialSupport: [],
      potentialResistance: [],
    };
  }

  const closes = calculationCandles.map((candle) => candle.close);
  const vwapSeries = calculateSessionVwap(sorted);
  const ema9Series = calculateEma(closes, 9);
  const ema20Series = calculateEma(closes, 20);
  const ema50Series = calculateEma(closes, 50);
  const atr14Series = calculateAtr(calculationCandles, 14);
  const rsi14Series = calculateRsi(closes, 14);
  const volumeAverage20Series = calculateRollingVolumeAverage(calculationCandles, 20);
  const relativeVolume20Series = calculateRelativeVolume(calculationCandles, 20);
  const openingRange15 = calculateOpeningRange(sorted, 15);
  const vwap = vwapSeries.at(-1)?.value ?? null;
  const latestClose = toFixed(latest.close);
  const ema9 = ema9Series.at(-1) ?? null;
  const ema20 = ema20Series.at(-1) ?? null;
  const ema50 = ema50Series.at(-1) ?? null;
  const levels = buildSupportResistanceLevels({
    previousDay,
    openingRange: openingRange15,
    candles: sorted,
    latestClose,
  });

  return {
    underlying,
    candleCount: sorted.length,
    warmupCandleCount: Math.max(0, calculationCandles.length - sorted.length),
    latestClose,
    vwap,
    vwapDistance: vwap ? toDecimal(latestClose).minus(vwap).toFixed(2) : null,
    ema9,
    ema20,
    ema50,
    emaTrend: classifyEmaTrend(ema9, ema20, ema50),
    atr14: atr14Series.at(-1) ?? null,
    rsi14: rsi14Series.at(-1) ?? null,
    volumeAverage20: volumeAverage20Series.at(-1) ?? null,
    relativeVolume20: relativeVolume20Series.at(-1) ?? null,
    openingRange15,
    potentialSupport: levels.potentialSupport,
    potentialResistance: levels.potentialResistance,
  };
}

function dedupeLevels(levels: PriceLevel[]) {
  const seen = new Set<string>();
  const deduped: PriceLevel[] = [];

  for (const level of levels) {
    const key = toFixed(level.value);

    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push({ ...level, value: key });
  }

  return deduped;
}
