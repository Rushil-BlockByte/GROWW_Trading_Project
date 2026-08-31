import Decimal from "decimal.js";
import { InstrumentRepository } from "@/lib/instruments/instrument-repository";
import {
  DEFAULT_HISTORICAL_OPTION_SPREAD_PERCENT,
  DEFAULT_HISTORICAL_OPTION_STRIKE_WINDOW,
  MAX_HISTORICAL_OPTION_STRIKE_WINDOW,
} from "@/lib/zerodha/option-historical-config";
import {
  createKiteHistoricalDataClient,
  fetchKiteHistoricalCandles,
  type KiteHistoricalDataClient,
} from "@/lib/zerodha/historical-data-client";
import type { BacktestOptionRowsFactory, BacktestOptionRowsInput } from "@/types/backtest";
import type {
  HistoricalCandle,
  HistoricalCandleInterval,
  HistoricalOptionSeries,
  HistoricalOptionUniverseResult,
} from "@/types/historical";
import type { InstrumentRecord } from "@/types/instruments";
import type { UnderlyingSymbol } from "@/types/market";
import type { OptionChainSourceRow, OptionLegMarketData, OptionSide } from "@/types/options";

export type KiteHistoricalOptionUniverseInput = {
  apiKey: string;
  accessToken: string;
  repository: InstrumentRepository;
  underlying: UnderlyingSymbol;
  underlyingLastPrice: string;
  expiry: string;
  strikeInterval: number;
  strikeWindow?: number | null;
  interval: HistoricalCandleInterval;
  from: string;
  to: string;
  includeOpenInterest?: boolean;
  spreadAssumptionPercent?: string | null;
  client?: KiteHistoricalDataClient;
};

type IndexedHistoricalOptionSeries = HistoricalOptionSeries & {
  optionSide: OptionSide;
  strike: Decimal;
  strikeNumber: number;
  candlesByTime: Map<string, { candle: HistoricalCandle; index: number }>;
  candleTimes: number[];
};

function toDecimal(value: Decimal.Value) {
  return new Decimal(value);
}

function toFixed(value: Decimal.Value, places = 2) {
  return toDecimal(value).toFixed(places);
}

function round(value: Decimal.Value, places = 2) {
  return toDecimal(value).toDecimalPlaces(places).toNumber();
}

function decimalEquals(a: Decimal.Value, b: Decimal.Value) {
  return toDecimal(a).eq(b);
}

function optionSideForInstrument(instrument: InstrumentRecord): OptionSide | null {
  if (instrument.instrumentType === "CE" || instrument.kind === "OPTION_CE") return "CE";
  if (instrument.instrumentType === "PE" || instrument.kind === "OPTION_PE") return "PE";

  return null;
}

function historicalSeriesInstrument(instrument: InstrumentRecord) {
  const optionSide = optionSideForInstrument(instrument);

  if (!optionSide) {
    throw new Error(`${instrument.tradingsymbol} is not an option contract.`);
  }

  return {
    exchange: instrument.exchange,
    tradingsymbol: instrument.tradingsymbol,
    instrumentToken: instrument.instrumentToken,
    expiry: instrument.expiry,
    strike: instrument.strike,
    instrumentType: instrument.instrumentType,
    lotSize: instrument.lotSize,
    tickSize: instrument.tickSize,
    optionSide,
  };
}

export function defaultHistoricalOptionStrikeInterval(underlying: UnderlyingSymbol) {
  return underlying === "BANKNIFTY" ? 100 : 50;
}

export function normalizeHistoricalOptionStrikeWindow(
  value: number | null | undefined,
) {
  const strikeWindow = value ?? DEFAULT_HISTORICAL_OPTION_STRIKE_WINDOW;

  if (!Number.isInteger(strikeWindow) || strikeWindow < 0) {
    throw new Error("Option historical strikeWindow must be a whole number from 0 to 3.");
  }

  if (strikeWindow > MAX_HISTORICAL_OPTION_STRIKE_WINDOW) {
    throw new Error(
      `Option historical strikeWindow cannot exceed ${MAX_HISTORICAL_OPTION_STRIKE_WINDOW}.`,
    );
  }

  return strikeWindow;
}

export function normalizeHistoricalOptionSpreadPercent(value: string | null | undefined) {
  const spread = toDecimal(value ?? DEFAULT_HISTORICAL_OPTION_SPREAD_PERCENT);

  if (!spread.isFinite() || spread.lte(0) || spread.gt(10)) {
    throw new Error("Option historical spread assumption must be greater than 0% and no more than 10%.");
  }

  return spread.toFixed(2);
}

function countCompleteRows(series: HistoricalOptionSeries[]) {
  const byStrike = new Map<string, Set<OptionSide>>();

  for (const item of series) {
    if (!item.instrument.strike) continue;

    const sides = byStrike.get(item.instrument.strike) ?? new Set<OptionSide>();
    sides.add(item.instrument.optionSide);
    byStrike.set(item.instrument.strike, sides);
  }

  return Array.from(byStrike.values()).filter((sides) => sides.has("CE") && sides.has("PE")).length;
}

function instrumentWarning(instrument: InstrumentRecord, warning: string) {
  return `${instrument.tradingsymbol}: ${warning}`;
}

export async function fetchKiteHistoricalOptionUniverse(
  input: KiteHistoricalOptionUniverseInput,
): Promise<HistoricalOptionUniverseResult> {
  const strikeWindow = normalizeHistoricalOptionStrikeWindow(input.strikeWindow);
  const spreadAssumptionPercent = normalizeHistoricalOptionSpreadPercent(
    input.spreadAssumptionPercent,
  );
  const universe = input.repository.buildAtmOptionUniverse({
    underlyingSymbol: input.underlying,
    underlyingLastPrice: input.underlyingLastPrice,
    expiry: input.expiry,
    strikeInterval: input.strikeInterval,
    strikeWindow,
  });
  const client =
    input.client ??
    createKiteHistoricalDataClient({
      apiKey: input.apiKey,
      accessToken: input.accessToken,
    });
  const series: HistoricalOptionSeries[] = [];
  const warnings = universe.missingContracts.map(
    (contract) => `Missing ${input.underlying} ${input.expiry} ${contract.strike} ${contract.instrumentType}.`,
  );

  for (const instrument of universe.instruments) {
    const optionSide = optionSideForInstrument(instrument);

    if (!optionSide) {
      warnings.push(`${instrument.tradingsymbol} is not a CE/PE option contract.`);
      continue;
    }

    try {
      const historical = await fetchKiteHistoricalCandles({
        apiKey: input.apiKey,
        accessToken: input.accessToken,
        instrumentToken: instrument.instrumentToken,
        interval: input.interval,
        from: input.from,
        to: input.to,
        continuous: false,
        includeOpenInterest: input.includeOpenInterest ?? true,
        client,
      });

      series.push({
        source: "KITE",
        instrument: historicalSeriesInstrument(instrument),
        candleCount: historical.candleCount,
        candles: historical.candles,
        warnings: historical.warnings,
      });
      warnings.push(...historical.warnings.map((warning) => instrumentWarning(instrument, warning)));
    } catch (error) {
      warnings.push(
        instrumentWarning(
          instrument,
          error instanceof Error ? error.message : "Kite option historical fetch failed.",
        ),
      );
    }
  }

  return {
    source: "KITE",
    request: {
      underlying: input.underlying,
      underlyingLastPrice: toFixed(input.underlyingLastPrice),
      expiry: input.expiry,
      strikeInterval: input.strikeInterval,
      strikeWindow,
      interval: input.interval,
      from: input.from,
      to: input.to,
      includeOpenInterest: input.includeOpenInterest ?? true,
      spreadAssumptionPercent,
    },
    atmStrike: universe.atmStrike,
    instrumentCount: series.length,
    rowCount: countCompleteRows(series),
    series,
    missingContracts: universe.missingContracts,
    warnings,
    quoteAssumptions: {
      bidAskSpreadPercent: spreadAssumptionPercent,
      reason: "Kite historical candles provide traded OHLC, volume, and optional OI; bid/ask is estimated around close.",
    },
    liveOrdersEnabled: false,
  };
}

function indexSeries(series: HistoricalOptionSeries[]): IndexedHistoricalOptionSeries[] {
  return series.flatMap((item) => {
    if (!item.instrument.strike) return [];

    const strike = toDecimal(item.instrument.strike);
    const candlesByTime = new Map<string, { candle: HistoricalCandle; index: number }>();
    const candleTimes: number[] = [];

    item.candles.forEach((candle, index) => {
      candlesByTime.set(candle.startTime, { candle, index });
      candleTimes.push(new Date(candle.startTime).getTime());
    });

    return [
      {
        ...item,
        optionSide: item.instrument.optionSide,
        strike,
        strikeNumber: strike.toNumber(),
        candlesByTime,
        candleTimes,
      },
    ];
  });
}

function groupIndexedSeries(series: IndexedHistoricalOptionSeries[]) {
  const byStrike = new Map<number, Partial<Record<OptionSide, IndexedHistoricalOptionSeries>>>();

  for (const item of series) {
    const grouped = byStrike.get(item.strikeNumber) ?? {};
    grouped[item.optionSide] = item;
    byStrike.set(item.strikeNumber, grouped);
  }

  return byStrike;
}

function quoteCandleAtOrBefore({
  series,
  input,
}: {
  series: IndexedHistoricalOptionSeries;
  input: BacktestOptionRowsInput;
}) {
  const exact = series.candlesByTime.get(input.candle.startTime);

  if (exact) return exact;

  const targetTime = new Date(input.candle.startTime).getTime();

  if (Number.isNaN(targetTime)) return null;

  const startingIndex = Math.min(input.candleIndex, series.candles.length - 1);

  for (let index = startingIndex; index >= 0; index -= 1) {
    if (series.candleTimes[index] <= targetTime) {
      return { candle: series.candles[index], index };
    }
  }

  return null;
}

function estimateBidAsk(ltp: Decimal, spreadAssumptionPercent: Decimal) {
  if (ltp.lte(0)) {
    return {
      bid: 0,
      ask: 0,
      spreadPercent: spreadAssumptionPercent.toNumber(),
    };
  }

  const minimumSpread = new Decimal("0.05");
  const spread = Decimal.max(minimumSpread, ltp.mul(spreadAssumptionPercent).div(100));
  const bid = Decimal.max(minimumSpread, ltp.minus(spread.div(2)));
  const ask = Decimal.max(bid.plus(minimumSpread), ltp.plus(spread.div(2)));

  return {
    bid: round(bid),
    ask: round(ask),
    spreadPercent: spreadAssumptionPercent.toNumber(),
  };
}

function optionLegFromSeries({
  series,
  input,
  spreadAssumptionPercent,
}: {
  series: IndexedHistoricalOptionSeries;
  input: BacktestOptionRowsInput;
  spreadAssumptionPercent: Decimal;
}): OptionLegMarketData | null {
  const selected = quoteCandleAtOrBefore({ series, input });

  if (!selected) return null;

  const { candle, index } = selected;
  const previous = index > 0 ? series.candles[index - 1] : null;
  const openInterest = candle.openInterest ?? 0;
  const previousOpenInterest = previous?.openInterest;
  const ltp = toDecimal(candle.close);
  const bidAsk = estimateBidAsk(ltp, spreadAssumptionPercent);

  return {
    ltp: round(ltp),
    volume: candle.volume,
    openInterest,
    oiChange:
      openInterest > 0 && previousOpenInterest !== undefined
        ? openInterest - previousOpenInterest
        : 0,
    ...bidAsk,
  };
}

export function createHistoricalOptionRowsFactory(
  result: HistoricalOptionUniverseResult,
): BacktestOptionRowsFactory {
  const spreadAssumptionPercent = toDecimal(result.quoteAssumptions.bidAskSpreadPercent);
  const groupedSeries = groupIndexedSeries(indexSeries(result.series));

  return (input) =>
    Array.from(groupedSeries.entries())
      .sort(([strikeA], [strikeB]) => strikeA - strikeB)
      .flatMap(([strike, sides]): OptionChainSourceRow[] => {
        const call = sides.CE
          ? optionLegFromSeries({
              series: sides.CE,
              input,
              spreadAssumptionPercent,
            })
          : null;
        const put = sides.PE
          ? optionLegFromSeries({
              series: sides.PE,
              input,
              spreadAssumptionPercent,
            })
          : null;

        if (!call || !put) return [];

        return [
          {
            strike,
            isAtm: decimalEquals(strike, result.atmStrike),
            call,
            put,
          },
        ];
      });
}
