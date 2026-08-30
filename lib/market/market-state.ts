import type { InstrumentRepository } from "@/lib/instruments/instrument-repository";
import { validateTick } from "@/lib/market/tick-normalization";
import type { DataQualityStatus, MarketTick } from "@/types/market";

export type InstrumentMarketState = {
  latestTick: MarketTick;
  previousTick?: MarketTick;
  currentVolume?: number;
  currentOpenInterest?: number;
  previousOpenInterest?: number;
  bid?: string;
  ask?: string;
  lastUpdateTime: string;
};

export type MarketStateSummary = {
  instrumentsTracked: number;
  lastTickAt?: string;
  dataQuality: DataQualityStatus;
  rejectedTicks: number;
  rejectionReasons: string[];
};

export class MarketStateStore {
  private readonly stateByToken = new Map<number, InstrumentMarketState>();
  private rejectedTicks = 0;
  private readonly rejectionReasons: string[] = [];
  private lastTickAt?: string;

  constructor(private readonly instruments: InstrumentRepository) {}

  applyTick(tick: MarketTick, now = new Date()) {
    const validation = validateTick(tick, this.instruments, now);

    if (!validation.valid) {
      this.rejectedTicks += 1;

      if (validation.reason) {
        this.rejectionReasons.push(validation.reason);
      }

      return {
        accepted: false,
        reason: validation.reason ?? "Invalid tick.",
      };
    }

    const previousState = this.stateByToken.get(tick.instrumentToken);
    const latestTick = previousState?.latestTick;

    if (latestTick && isDuplicateTick(latestTick, tick)) {
      return {
        accepted: false,
        reason: "Duplicate tick.",
      };
    }

    const nextState: InstrumentMarketState = {
      latestTick: tick,
      previousTick: latestTick,
      currentVolume: tick.volume ?? previousState?.currentVolume,
      currentOpenInterest: tick.openInterest ?? previousState?.currentOpenInterest,
      previousOpenInterest: previousState?.currentOpenInterest,
      bid: tick.bid ?? previousState?.bid,
      ask: tick.ask ?? previousState?.ask,
      lastUpdateTime: now.toISOString(),
    };

    this.stateByToken.set(tick.instrumentToken, nextState);
    this.lastTickAt = tick.timestamp;

    return {
      accepted: true,
      state: nextState,
    };
  }

  getInstrumentState(instrumentToken: number) {
    return this.stateByToken.get(instrumentToken);
  }

  getSummary(now = new Date()): MarketStateSummary {
    const lastTickTime = this.lastTickAt ? new Date(this.lastTickAt) : undefined;
    const isStale = lastTickTime ? now.getTime() - lastTickTime.getTime() > 30_000 : false;
    const dataQuality: DataQualityStatus = !lastTickTime
      ? "INSUFFICIENT_DATA"
      : isStale
        ? "STALE"
        : "GOOD";

    return {
      instrumentsTracked: this.stateByToken.size,
      lastTickAt: this.lastTickAt,
      dataQuality,
      rejectedTicks: this.rejectedTicks,
      rejectionReasons: [...this.rejectionReasons],
    };
  }
}

function isDuplicateTick(previous: MarketTick, next: MarketTick) {
  if (previous.sequence !== undefined && next.sequence !== undefined) {
    return previous.sequence === next.sequence;
  }

  return (
    previous.timestamp === next.timestamp &&
    previous.lastPrice === next.lastPrice &&
    previous.lastQuantity === next.lastQuantity &&
    previous.volume === next.volume &&
    previous.openInterest === next.openInterest
  );
}
