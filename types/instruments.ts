import type { UnderlyingSymbol } from "@/types/market";

export type InstrumentKind =
  | "INDEX"
  | "FUTURE"
  | "OPTION_CE"
  | "OPTION_PE"
  | "EQUITY"
  | "VOLATILITY_INDEX";

export type InstrumentRecord = {
  exchange: string;
  tradingsymbol: string;
  instrumentToken: number;
  name?: string;
  expiry?: string;
  strike?: string;
  instrumentType: string;
  segment: string;
  lotSize: number;
  tickSize: string;
  kind: InstrumentKind;
  underlyingSymbol?: UnderlyingSymbol | "INDIA_VIX";
};

export type InstrumentSearchCriteria = {
  exchange?: string;
  tradingsymbol?: string;
  instrumentToken?: number;
  expiry?: string;
  strike?: string;
  instrumentType?: string;
  underlyingSymbol?: UnderlyingSymbol | "INDIA_VIX";
};

export type OptionUniverseRequest = {
  underlyingSymbol: UnderlyingSymbol;
  underlyingLastPrice: string;
  expiry: string;
  strikeInterval: number;
  strikeWindow: number;
  includeTypes?: Array<"CE" | "PE">;
};

export type OptionUniverseResult = {
  atmStrike: string;
  expiry: string;
  instruments: InstrumentRecord[];
  missingContracts: Array<{
    strike: string;
    instrumentType: "CE" | "PE";
  }>;
};
