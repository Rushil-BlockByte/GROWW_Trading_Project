import { NextRequest, NextResponse } from "next/server";
import { InstrumentRepository } from "@/lib/instruments/instrument-repository";
import { runVwapBreakoutBacktest } from "@/lib/backtesting/vwap-breakout-backtest";
import { getServerConfig } from "@/lib/config/env";
import { persistBacktestResult } from "@/lib/persistence/backtest-store";
import { downloadKiteInstruments } from "@/lib/zerodha/instruments-client";
import { fetchKiteHistoricalCandles, isKiteHistoricalInterval } from "@/lib/zerodha/historical-data-client";
import {
  createHistoricalOptionRowsFactory,
  defaultHistoricalOptionStrikeInterval,
  fetchKiteHistoricalOptionUniverse,
} from "@/lib/zerodha/option-historical-service";
import { resolveIndexInstrument } from "@/lib/zerodha/live-universe";
import type { BacktestPreviousDayContext } from "@/types/backtest";
import type { UnderlyingSymbol } from "@/types/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNDERLYINGS: UnderlyingSymbol[] = ["NIFTY", "BANKNIFTY", "FINNIFTY"];

function boolParam(value: string | null) {
  return value === "true" || value === "1" || value === "yes";
}

function currentIstDate() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
    year: "numeric",
  }).format(new Date());
}

function parseUnderlying(value: string | null): UnderlyingSymbol {
  const upper = value?.toUpperCase();

  if (upper && UNDERLYINGS.includes(upper as UnderlyingSymbol)) {
    return upper as UnderlyingSymbol;
  }

  return "NIFTY";
}

function dateWindow(searchParams: URLSearchParams) {
  const date = searchParams.get("date") ?? currentIstDate();
  const from = searchParams.get("from") ?? `${date} 09:15:00`;
  const to = searchParams.get("to") ?? `${date} 15:30:00`;

  return { date, from, to };
}

function dateForExpiryLookup(date: string) {
  return new Date(`${date}T12:00:00.000+05:30`);
}

function previousDayContext(searchParams: URLSearchParams): BacktestPreviousDayContext | null {
  const high = searchParams.get("previousHigh");
  const low = searchParams.get("previousLow");
  const close = searchParams.get("previousClose");

  if (!high || !low || !close) return null;

  return { high, low, close };
}

function parseInstrumentToken(value: string | null) {
  if (!value) return null;

  const token = Number(value);

  return Number.isInteger(token) && token > 0 ? token : null;
}

function parseIntegerParam(value: string | null, name: string) {
  if (value === null) return null;

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be a whole number.`);
  }

  return parsed;
}

function includeOptionsParam(searchParams: URLSearchParams) {
  return boolParam(searchParams.get("includeOptions")) || boolParam(searchParams.get("options"));
}

function optionOpenInterestParam(searchParams: URLSearchParams) {
  const optionOnly = searchParams.get("optionOi") ?? searchParams.get("optionOI");

  if (optionOnly !== null) return boolParam(optionOnly);

  const shared = searchParams.get("oi");

  return shared === null ? true : boolParam(shared);
}

export async function GET(request: NextRequest) {
  const config = getServerConfig();
  const { searchParams } = request.nextUrl;
  const interval = searchParams.get("interval") ?? "minute";
  const kiteApiKey = config.kiteApiKey;
  const kiteAccessToken = config.kiteAccessToken;

  if (!kiteApiKey || !kiteAccessToken) {
    return NextResponse.json(
      {
        ok: false,
        message: "Kite historical data needs KITE_API_KEY and KITE_ACCESS_TOKEN.",
        liveOrdersEnabled: false,
      },
      { status: 400 },
    );
  }

  if (!isKiteHistoricalInterval(interval)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Unsupported historical candle interval.",
        liveOrdersEnabled: false,
      },
      { status: 400 },
    );
  }

  try {
    const { date, from, to } = dateWindow(searchParams);
    const underlying = parseUnderlying(searchParams.get("underlying"));
    const includeOptions = includeOptionsParam(searchParams);
    let instrumentToken = parseInstrumentToken(searchParams.get("instrumentToken"));
    let tradingsymbol = searchParams.get("tradingsymbol") ?? null;
    let exchange = searchParams.get("exchange") ?? "NSE";

    if (!instrumentToken) {
      const instruments = await downloadKiteInstruments({
        apiKey: kiteApiKey,
        accessToken: kiteAccessToken,
        exchange: "NSE",
      });
      const repository = new InstrumentRepository(instruments);
      const instrument = resolveIndexInstrument(repository, underlying);

      if (!instrument) {
        return NextResponse.json(
          {
            ok: false,
            message: `Could not resolve ${underlying} in the Kite NSE instrument master.`,
            liveOrdersEnabled: false,
          },
          { status: 404 },
        );
      }

      instrumentToken = instrument.instrumentToken;
      tradingsymbol = instrument.tradingsymbol;
      exchange = instrument.exchange;
    }

    const historical = await fetchKiteHistoricalCandles({
      apiKey: kiteApiKey,
      accessToken: kiteAccessToken,
      instrumentToken,
      interval,
      from,
      to,
      continuous: boolParam(searchParams.get("continuous")),
      includeOpenInterest: boolParam(searchParams.get("oi")),
    });
    const optionHistorical = includeOptions
      ? await (async () => {
          const optionInstruments = await downloadKiteInstruments({
            apiKey: kiteApiKey,
            accessToken: kiteAccessToken,
            exchange: "NFO",
          });
          const optionRepository = new InstrumentRepository(optionInstruments);
          const expiry =
            searchParams.get("expiry") ??
            optionRepository.getNearestExpiry(underlying, dateForExpiryLookup(date));

          if (!expiry) {
            throw new Error(`Could not resolve a ${underlying} option expiry in the Kite NFO instrument master.`);
          }

          return fetchKiteHistoricalOptionUniverse({
            apiKey: kiteApiKey,
            accessToken: kiteAccessToken,
            repository: optionRepository,
            underlying,
            underlyingLastPrice:
              searchParams.get("underlyingLastPrice") ?? historical.candles[0]?.close ?? "0",
            expiry,
            strikeInterval:
              parseIntegerParam(searchParams.get("strikeInterval"), "strikeInterval") ??
              defaultHistoricalOptionStrikeInterval(underlying),
            strikeWindow: parseIntegerParam(searchParams.get("strikeWindow"), "strikeWindow"),
            interval,
            from,
            to,
            includeOpenInterest: optionOpenInterestParam(searchParams),
            spreadAssumptionPercent:
              searchParams.get("spreadAssumptionPercent") ??
              searchParams.get("optionSpreadPercent"),
          });
        })()
      : null;
    const previousDay = previousDayContext(searchParams);
    const backtest =
      previousDay && boolParam(searchParams.get("backtest")) && historical.candles.length
        ? runVwapBreakoutBacktest({
            id: `KITE-${underlying}-${date}`,
            name: `Kite historical underlying replay ${date}`,
            underlying,
            expiry: optionHistorical?.request.expiry ?? searchParams.get("expiry") ?? date,
            candles: historical.candles,
            previousDay,
            dataSource: "USER_SUPPLIED",
            optionRowsForPrice: optionHistorical
              ? createHistoricalOptionRowsFactory(optionHistorical)
              : undefined,
          })
        : null;
    let persistedBacktest = null;
    let persistenceWarning: string | null = null;

    if (backtest && boolParam(searchParams.get("persist"))) {
      try {
        persistedBacktest = await persistBacktestResult({
          result: backtest,
        });
      } catch (error) {
        persistenceWarning = error instanceof Error ? error.message : "Backtest persistence failed.";
      }
    }

    return NextResponse.json({
      ok: true,
      mode: "kite_historical",
      liveOrdersEnabled: false,
      instrument: {
        exchange,
        tradingsymbol,
        instrumentToken,
        underlying,
      },
      historical,
      optionHistorical,
      backtest,
      persistedBacktest,
      persistenceWarning,
      backtestAssumption: backtest
        ? optionHistorical
          ? "Underlying and option candles came from Kite; option bid/ask spread is estimated from the configured spread assumption."
          : "Underlying candles came from Kite; option quotes are modeled by the replay engine."
        : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Kite historical fetch failed.",
        liveOrdersEnabled: false,
      },
      { status: 500 },
    );
  }
}
