import Decimal from "decimal.js";
import { addMinutes, floorToKolkataIntervalStart } from "@/lib/market/session";
import type { CandleBuilderResult, CandleInterval, MarketCandleData } from "@/types/candles";
import type { MarketTick } from "@/types/market";

const INTERVAL_MINUTES: Record<CandleInterval, number> = {
  "1m": 1,
  "3m": 3,
  "5m": 5,
  "15m": 15,
};

export class CandleBuilder {
  private readonly activeCandles = new Map<string, MarketCandleData>();
  private readonly completedCandles: MarketCandleData[] = [];
  private readonly previousVolumeByToken = new Map<number, number>();

  constructor(private readonly intervals: CandleInterval[] = ["1m", "5m", "15m"]) {}

  applyTick(tick: MarketTick): CandleBuilderResult {
    const tickTime = new Date(tick.exchangeTimestamp ?? tick.timestamp);

    if (Number.isNaN(tickTime.getTime())) {
      return { updated: [], completed: [], ignoredReason: "Invalid timestamp." };
    }

    const volumeContribution = this.getVolumeContribution(tick);
    const updated: MarketCandleData[] = [];
    const completed: MarketCandleData[] = [];

    for (const interval of this.intervals) {
      const minutes = INTERVAL_MINUTES[interval];
      const start = floorToKolkataIntervalStart(tickTime, minutes);

      if (!start) {
        return { updated: [], completed: [], ignoredReason: "Outside market session." };
      }

      const key = this.key(tick.instrumentToken, interval, start);
      const active = this.findActiveCandle(tick.instrumentToken, interval);

      if (active && active.startTime !== start.toISOString()) {
        const finished = { ...active, isComplete: true };
        this.activeCandles.delete(this.key(tick.instrumentToken, interval, new Date(active.startTime)));
        this.completedCandles.push(finished);
        completed.push(finished);
      }

      const current = this.activeCandles.get(key);
      const next = current
        ? updateCandle(current, tick, volumeContribution)
        : createCandle(tick, interval, start, minutes, volumeContribution);

      this.activeCandles.set(key, next);
      updated.push(next);
    }

    return { updated, completed };
  }

  getActiveCandles() {
    return Array.from(this.activeCandles.values());
  }

  getCompletedCandles() {
    return [...this.completedCandles];
  }

  private getVolumeContribution(tick: MarketTick) {
    if (tick.lastQuantity !== undefined) {
      this.previousVolumeByToken.set(tick.instrumentToken, tick.volume ?? 0);
      return tick.lastQuantity;
    }

    if (tick.volume === undefined) {
      return 0;
    }

    const previousVolume = this.previousVolumeByToken.get(tick.instrumentToken);
    this.previousVolumeByToken.set(tick.instrumentToken, tick.volume);

    if (previousVolume === undefined) {
      return 0;
    }

    return Math.max(0, tick.volume - previousVolume);
  }

  private findActiveCandle(instrumentToken: number, interval: CandleInterval) {
    return this.getActiveCandles().find(
      (candle) => candle.instrumentToken === instrumentToken && candle.interval === interval,
    );
  }

  private key(instrumentToken: number, interval: CandleInterval, start: Date) {
    return `${instrumentToken}:${interval}:${start.toISOString()}`;
  }
}

function createCandle(
  tick: MarketTick,
  interval: CandleInterval,
  start: Date,
  minutes: number,
  volumeContribution: number,
): MarketCandleData {
  return {
    instrumentToken: tick.instrumentToken,
    interval,
    startTime: start.toISOString(),
    endTime: addMinutes(start, minutes).toISOString(),
    open: tick.lastPrice,
    high: tick.lastPrice,
    low: tick.lastPrice,
    close: tick.lastPrice,
    volume: volumeContribution,
    openInterest: tick.openInterest,
    tickCount: 1,
    isComplete: false,
  };
}

function updateCandle(
  candle: MarketCandleData,
  tick: MarketTick,
  volumeContribution: number,
): MarketCandleData {
  const lastPrice = new Decimal(tick.lastPrice);
  const high = Decimal.max(candle.high, lastPrice);
  const low = Decimal.min(candle.low, lastPrice);

  return {
    ...candle,
    high: high.toFixed(2),
    low: low.toFixed(2),
    close: lastPrice.toFixed(2),
    volume: candle.volume + volumeContribution,
    openInterest: tick.openInterest ?? candle.openInterest,
    tickCount: candle.tickCount + 1,
  };
}
