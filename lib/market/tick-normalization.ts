import Decimal from "decimal.js";
import type { InstrumentRepository } from "@/lib/instruments/instrument-repository";
import type { MarketTick } from "@/types/market";

export type RawSimulatedTick = {
  instrumentToken: number;
  timestamp: Date;
  lastPrice: Decimal.Value;
  lastQuantity?: number;
  volume?: number;
  openInterest?: number;
  bid?: Decimal.Value;
  ask?: Decimal.Value;
  sequence?: number;
};

export type TickValidationResult = {
  valid: boolean;
  reason?: string;
};

export function normalizeSimulatedTick(raw: RawSimulatedTick): MarketTick {
  return {
    instrumentToken: raw.instrumentToken,
    timestamp: raw.timestamp.toISOString(),
    exchangeTimestamp: raw.timestamp.toISOString(),
    lastPrice: new Decimal(raw.lastPrice).toFixed(2),
    lastQuantity: raw.lastQuantity,
    volume: raw.volume,
    openInterest: raw.openInterest,
    bid: raw.bid === undefined ? undefined : new Decimal(raw.bid).toFixed(2),
    ask: raw.ask === undefined ? undefined : new Decimal(raw.ask).toFixed(2),
    sequence: raw.sequence,
  };
}

export function validateTick(
  tick: MarketTick,
  instruments: InstrumentRepository,
  now = new Date(),
): TickValidationResult {
  const instrument = instruments.findByToken(tick.instrumentToken);

  if (!instrument) {
    return { valid: false, reason: "Invalid instrument." };
  }

  const tickTime = new Date(tick.timestamp);

  if (Number.isNaN(tickTime.getTime())) {
    return { valid: false, reason: "Invalid timestamp." };
  }

  const ageMs = now.getTime() - tickTime.getTime();

  if (ageMs > 30_000) {
    return { valid: false, reason: "Stale tick." };
  }

  if (new Decimal(tick.lastPrice).lte(0)) {
    return { valid: false, reason: "Invalid price." };
  }

  if (tick.volume !== undefined && tick.volume < 0) {
    return { valid: false, reason: "Invalid volume." };
  }

  if (tick.openInterest !== undefined && tick.openInterest < 0) {
    return { valid: false, reason: "Invalid open interest." };
  }

  if (instrument.expiry && instrument.expiry < now.toISOString().slice(0, 10)) {
    return { valid: false, reason: "Expired contract." };
  }

  return { valid: true };
}
