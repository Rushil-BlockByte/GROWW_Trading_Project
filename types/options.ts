import type { UnderlyingSymbol } from "@/types/market";

export type OptionSide = "CE" | "PE";

export type OptionLiquidityStatus = "TRADABLE" | "NOT_TRADABLE";

export type OptionLiquidityRules = {
  minVolume: number;
  minOpenInterest: number;
  maxSpreadPercent: string;
  minLtp: string;
  maxLtp: string;
  minVolumeToOpenInterestRatio: string;
};

export type OptionLegMarketData = {
  ltp: number;
  volume: number;
  openInterest: number;
  oiChange: number;
  bid: number;
  ask: number;
  spreadPercent?: number;
};

export type OptionChainSourceRow = {
  strike: number;
  isAtm: boolean;
  call: OptionLegMarketData;
  put: OptionLegMarketData;
};

export type OptionLegLiquidity = OptionLegMarketData & {
  side: OptionSide;
  strike: number;
  spreadPercent: number;
  volumeToOpenInterestRatio: string | null;
  status: OptionLiquidityStatus;
  reasons: string[];
};

export type OptionChainRowContext = {
  strike: number;
  isAtm: boolean;
  distanceFromSpot: string;
  call: OptionLegLiquidity;
  put: OptionLegLiquidity;
};

export type OptionOpenInterestLevel = {
  strike: number;
  side: OptionSide;
  label: string;
  openInterest: number;
  oiChange: number;
  role: "support" | "resistance";
};

export type OptionOpenInterestLeader = {
  strike: number;
  side: OptionSide;
  label: string;
  ltp: string;
  volume: number;
  openInterest: number;
  oiChange: number;
};

export type OptionChainContext = {
  underlying: UnderlyingSymbol;
  underlyingLastPrice: string;
  expiry: string;
  rowCount: number;
  totalCallOpenInterest: number;
  totalPutOpenInterest: number;
  totalCallOiChange: number;
  totalPutOiChange: number;
  totalCallVolume: number;
  totalPutVolume: number;
  putCallOpenInterestRatio: string | null;
  putCallOiChangeRatio: string | null;
  maxCallOpenInterest: OptionOpenInterestLeader | null;
  maxPutOpenInterest: OptionOpenInterestLeader | null;
  maxCallOiChange: OptionOpenInterestLeader | null;
  maxPutOiChange: OptionOpenInterestLeader | null;
  oiSupportLevels: OptionOpenInterestLevel[];
  oiResistanceLevels: OptionOpenInterestLevel[];
  tradableContracts: number;
  notTradableContracts: number;
  liquidityRules: OptionLiquidityRules;
  rows: OptionChainRowContext[];
};
