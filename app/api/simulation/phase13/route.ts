import { NextResponse } from "next/server";
import { isDatabasePersistenceConfigured } from "@/lib/persistence/local-user";

export async function GET() {
  return NextResponse.json({
    mode: "simulation",
    phase: 13,
    liveOrdersEnabled: false,
    backtestReportExport: {
      configured: isDatabasePersistenceConfigured(),
      exportEndpoint: "/api/backtests/export",
      format: "csv",
      status: "ready",
      note: "Filtered backtest reports can be exported as CSV for read-only review.",
    },
  });
}
