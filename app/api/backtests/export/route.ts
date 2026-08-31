import { NextRequest, NextResponse } from "next/server";
import {
  backtestReportCsvFilename,
  backtestReportRecordsToCsv,
} from "@/lib/backtesting/backtest-report-export";
import {
  parseBacktestReportFilters,
  parseBacktestReportLimit,
} from "@/lib/backtesting/backtest-report-query";
import { listPersistedBacktests } from "@/lib/persistence/backtest-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const result = await listPersistedBacktests({
      filters: parseBacktestReportFilters(request.nextUrl.searchParams),
      limit: parseBacktestReportLimit(request.nextUrl.searchParams.get("limit")) ?? 50,
    });
    const csv = backtestReportRecordsToCsv(result.backtests);

    return new NextResponse(csv, {
      headers: {
        "Content-Disposition": `attachment; filename="${backtestReportCsvFilename()}"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-GROWW-Live-Orders-Enabled": "false",
        "X-GROWW-Persistence-Status": result.persistence.status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backtest report export failed.";

    return NextResponse.json(
      {
        ok: false,
        persistence: {
          configured: true,
          status: "error",
          message,
        },
        liveOrdersEnabled: false,
      },
      { status: 503 },
    );
  }
}
