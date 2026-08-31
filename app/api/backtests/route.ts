import { NextRequest, NextResponse } from "next/server";
import {
  isBacktestResult,
  isMultiDayBacktestResult,
  listPersistedBacktests,
  persistBacktestResult,
} from "@/lib/persistence/backtest-store";
import type {
  BacktestReportFilters,
  BacktestReportKind,
  BacktestReportResultFilter,
} from "@/types/backtest-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseLimit(value: string | null) {
  if (!value) return undefined;

  const limit = Number(value);

  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

function parseUnderlying(value: string | null): BacktestReportFilters["underlying"] {
  if (value === "NIFTY" || value === "BANKNIFTY" || value === "FINNIFTY") {
    return value;
  }

  return value === "ALL" ? "ALL" : undefined;
}

function parseKind(value: string | null): BacktestReportKind | "all" | undefined {
  if (value === "single_day" || value === "multi_day" || value === "all") {
    return value;
  }

  return undefined;
}

function parseResult(value: string | null): BacktestReportResultFilter | undefined {
  if (
    value === "all" ||
    value === "profitable" ||
    value === "losing" ||
    value === "flat"
  ) {
    return value;
  }

  return undefined;
}

function parseFilters(searchParams: URLSearchParams): BacktestReportFilters {
  return {
    underlying: parseUnderlying(searchParams.get("underlying")),
    kind: parseKind(searchParams.get("kind")),
    result: parseResult(searchParams.get("result")),
  };
}

export async function GET(request: NextRequest) {
  try {
    const result = await listPersistedBacktests({
      filters: parseFilters(request.nextUrl.searchParams),
      limit: parseLimit(request.nextUrl.searchParams.get("limit")),
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      persistence: {
        configured: true,
        status: "error",
        message: error instanceof Error ? error.message : "Backtest load failed.",
      },
      backtest: null,
      backtests: [],
      savedCount: 0,
      liveOrdersEnabled: false,
    });
  }
}

export async function POST(request: NextRequest) {
  let result: unknown = null;

  try {
    const payload = (await request.json()) as { result?: unknown };
    result = payload.result;

    if (!isBacktestResult(result) && !isMultiDayBacktestResult(result)) {
      return NextResponse.json(
        {
          ok: false,
          message: "No valid backtest result was provided.",
          liveOrdersEnabled: false,
        },
        { status: 400 },
      );
    }

    const saved = await persistBacktestResult({
      result,
    });

    return NextResponse.json({
      ok: true,
      ...saved,
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      persistence: {
        configured: true,
        status: "error",
        message: error instanceof Error ? error.message : "Backtest save failed.",
      },
      backtest: null,
      backtests: [],
      savedCount: 0,
      liveOrdersEnabled: false,
    });
  }
}
