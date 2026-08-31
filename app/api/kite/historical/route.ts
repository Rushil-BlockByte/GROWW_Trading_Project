import { NextRequest, NextResponse } from "next/server";
import { InstrumentRepository } from "@/lib/instruments/instrument-repository";
import {
  runVwapBreakoutBacktest,
  sampleBacktestOptionRowsForPrice,
} from "@/lib/backtesting/vwap-breakout-backtest";
import { getServerConfig } from "@/lib/config/env";
import { downloadKiteInstruments } from "@/lib/zerodha/instruments-client";
import { fetchKiteHistoricalCandles, isKiteHistoricalInterval } from "@/lib/zerodha/historical-data-client";
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

export async function GET(request: NextRequest) {
  const config = getServerConfig();
  const { searchParams } = request.nextUrl;
  const interval = searchParams.get("interval") ?? "minute";

  if (!config.kiteApiKey || !config.kiteAccessToken) {
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
    let instrumentToken = parseInstrumentToken(searchParams.get("instrumentToken"));
    let tradingsymbol = searchParams.get("tradingsymbol") ?? null;
    let exchange = searchParams.get("exchange") ?? "NSE";

    if (!instrumentToken) {
      const instruments = await downloadKiteInstruments({
        apiKey: config.kiteApiKey,
        accessToken: config.kiteAccessToken,
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
      apiKey: config.kiteApiKey,
      accessToken: config.kiteAccessToken,
      instrumentToken,
      interval,
      from,
      to,
      continuous: boolParam(searchParams.get("continuous")),
      includeOpenInterest: boolParam(searchParams.get("oi")),
    });
    const previousDay = previousDayContext(searchParams);
    const backtest =
      previousDay && boolParam(searchParams.get("backtest")) && historical.candles.length
        ? runVwapBreakoutBacktest({
            id: `KITE-${underlying}-${date}`,
            name: `Kite historical underlying replay ${date}`,
            underlying,
            expiry: searchParams.get("expiry") ?? date,
            candles: historical.candles,
            previousDay,
            dataSource: "USER_SUPPLIED",
            optionRowsForPrice: sampleBacktestOptionRowsForPrice,
          })
        : null;

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
      backtest,
      backtestAssumption: backtest
        ? "Underlying candles came from Kite; option quotes are modeled until option historical ingestion is connected."
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
