import type { InstrumentRecord } from "@/types/instruments";
import type { UnderlyingSymbol } from "@/types/market";

const EXPIRY = "2026-09-03";

const UNDERLYING_TOKENS: Record<UnderlyingSymbol, number> = {
  NIFTY: 256265,
  BANKNIFTY: 260105,
  FINNIFTY: 257801,
};

const FUTURE_TOKENS: Record<UnderlyingSymbol, number> = {
  NIFTY: 500001,
  BANKNIFTY: 500002,
  FINNIFTY: 500003,
};

const UNDERLYING_LABELS: Record<UnderlyingSymbol, string> = {
  NIFTY: "NIFTY 50",
  BANKNIFTY: "BANKNIFTY",
  FINNIFTY: "FINNIFTY",
};

const OPTION_BASE_TOKENS: Record<UnderlyingSymbol, number> = {
  NIFTY: 1100000,
  BANKNIFTY: 2100000,
  FINNIFTY: 3100000,
};

const STRIKE_GRID_CONFIG: Record<UnderlyingSymbol, { center: number; interval: number }> = {
  NIFTY: { center: 25200, interval: 50 },
  BANKNIFTY: { center: 53800, interval: 100 },
  FINNIFTY: { center: 24200, interval: 50 },
};

function optionSymbol(symbol: UnderlyingSymbol, strike: number, type: "CE" | "PE") {
  return `${symbol}26SEP${strike}${type}`;
}

function futureSymbol(symbol: UnderlyingSymbol) {
  return `${symbol}26SEPFUT`;
}

export function createSimulatedInstrumentMaster(): InstrumentRecord[] {
  const underlyings = Object.entries(UNDERLYING_TOKENS).map(([symbol, token]) => {
    const underlyingSymbol = symbol as UnderlyingSymbol;

    return {
      exchange: "NSE",
      tradingsymbol: symbol,
      instrumentToken: token,
      name: UNDERLYING_LABELS[underlyingSymbol],
      instrumentType: "EQ",
      segment: "NSE-INDICES",
      lotSize: 0,
      tickSize: "0.05",
      kind: "INDEX" as const,
      underlyingSymbol,
    };
  });

  const futures = Object.entries(FUTURE_TOKENS).map(([symbol, token]) => {
    const underlyingSymbol = symbol as UnderlyingSymbol;

    return {
      exchange: "NFO",
      tradingsymbol: futureSymbol(underlyingSymbol),
      instrumentToken: token,
      name: underlyingSymbol,
      expiry: EXPIRY,
      instrumentType: "FUT",
      segment: "NFO-FUT",
      lotSize: underlyingSymbol === "BANKNIFTY" ? 35 : 75,
      tickSize: "0.05",
      kind: "FUTURE" as const,
      underlyingSymbol,
    };
  });

  const options = Object.entries(STRIKE_GRID_CONFIG).flatMap(([symbol, grid]) => {
    const underlyingSymbol = symbol as UnderlyingSymbol;
    const baseToken = OPTION_BASE_TOKENS[underlyingSymbol];
    const strikes = Array.from(
      { length: 21 },
      (_, index) => grid.center + (index - 10) * grid.interval,
    );

    return strikes.flatMap((strike, strikeIndex) =>
      (["CE", "PE"] as const).map((type, typeIndex) => ({
        exchange: "NFO",
        tradingsymbol: optionSymbol(underlyingSymbol, strike, type),
        instrumentToken: baseToken + strikeIndex * 10 + typeIndex,
        name: underlyingSymbol,
        expiry: EXPIRY,
        strike: String(strike),
        instrumentType: type,
        segment: "NFO-OPT",
        lotSize: underlyingSymbol === "BANKNIFTY" ? 35 : 75,
        tickSize: "0.05",
        kind: type === "CE" ? ("OPTION_CE" as const) : ("OPTION_PE" as const),
        underlyingSymbol,
      })),
    );
  });

  return [...underlyings, ...futures, ...options];
}

export function getSimulatedExpiry() {
  return EXPIRY;
}
