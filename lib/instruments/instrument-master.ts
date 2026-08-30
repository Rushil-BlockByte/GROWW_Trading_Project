import Decimal from "decimal.js";
import { parse } from "csv-parse/sync";
import type {
  InstrumentKind,
  InstrumentRecord,
} from "@/types/instruments";
export { InstrumentRepository } from "@/lib/instruments/instrument-repository";

type ZerodhaInstrumentRow = {
  instrument_token: string;
  exchange_token?: string;
  tradingsymbol: string;
  name?: string;
  last_price?: string;
  expiry?: string;
  strike?: string;
  tick_size?: string;
  lot_size?: string;
  instrument_type: string;
  segment: string;
  exchange: string;
};

function toOptionalIsoDate(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function normalizeDecimalString(value: string | undefined, fallback = "0") {
  if (!value || !value.trim()) return fallback;
  return new Decimal(value).toString();
}

function normalizeUnderlyingSymbol(row: Pick<ZerodhaInstrumentRow, "name" | "tradingsymbol">) {
  const source = `${row.name ?? ""} ${row.tradingsymbol}`.toUpperCase();

  if (source.includes("BANKNIFTY") || source.includes("NIFTY BANK")) return "BANKNIFTY";
  if (
    source.includes("FINNIFTY") ||
    source.includes("NIFTY FIN") ||
    source.includes("FIN SERVICE")
  ) {
    return "FINNIFTY";
  }
  if (source.includes("INDIA VIX") || source.includes("INDIAVIX")) return "INDIA_VIX";
  if (source.includes("NIFTY")) return "NIFTY";

  return undefined;
}

function classifyInstrumentKind(row: ZerodhaInstrumentRow): InstrumentKind {
  const type = row.instrument_type.toUpperCase();
  const segment = row.segment.toUpperCase();
  const symbol = `${row.name ?? ""} ${row.tradingsymbol}`.toUpperCase();

  if (symbol.includes("INDIA VIX") || symbol.includes("INDIAVIX")) return "VOLATILITY_INDEX";
  if (type === "CE") return "OPTION_CE";
  if (type === "PE") return "OPTION_PE";
  if (type === "FUT") return "FUTURE";
  if (segment.includes("INDICES")) return "INDEX";

  return "EQUITY";
}

export function normalizeInstrumentRow(row: ZerodhaInstrumentRow): InstrumentRecord {
  const instrumentToken = Number(row.instrument_token);
  const lotSize = Number(row.lot_size ?? 0);

  if (!Number.isInteger(instrumentToken) || instrumentToken <= 0) {
    throw new Error(`Invalid instrument token for ${row.tradingsymbol}.`);
  }

  if (!Number.isInteger(lotSize) || lotSize < 0) {
    throw new Error(`Invalid lot size for ${row.tradingsymbol}.`);
  }

  return {
    exchange: row.exchange.trim(),
    tradingsymbol: row.tradingsymbol.trim(),
    instrumentToken,
    name: row.name?.trim() || undefined,
    expiry: toOptionalIsoDate(row.expiry),
    strike: row.strike ? normalizeDecimalString(row.strike) : undefined,
    instrumentType: row.instrument_type.trim(),
    segment: row.segment.trim(),
    lotSize,
    tickSize: normalizeDecimalString(row.tick_size, "0.05"),
    kind: classifyInstrumentKind(row),
    underlyingSymbol: normalizeUnderlyingSymbol(row),
  };
}

export function parseZerodhaInstrumentDump(csv: string): InstrumentRecord[] {
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as ZerodhaInstrumentRow[];

  return rows.map(normalizeInstrumentRow);
}
