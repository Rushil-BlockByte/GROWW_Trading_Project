import { NextRequest, NextResponse } from "next/server";
import {
  isBacktestResult,
  isMultiDayBacktestResult,
  listPersistedBacktests,
  persistBacktestResult,
} from "@/lib/persistence/backtest-store";
import {
  parseBacktestReportFilters,
  parseBacktestReportLimit,
} from "@/lib/backtesting/backtest-report-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const result = await listPersistedBacktests({
      filters: parseBacktestReportFilters(request.nextUrl.searchParams),
      limit: parseBacktestReportLimit(request.nextUrl.searchParams.get("limit")),
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
