import { NextResponse } from "next/server";
import { isDatabasePersistenceConfigured } from "@/lib/persistence/local-user";

export async function GET() {
  return NextResponse.json({
    mode: "simulation",
    phase: 14,
    liveOrdersEnabled: false,
    backtestReportLinks: {
      configured: isDatabasePersistenceConfigured(),
      reportRoute: "/backtests/[id]",
      reportApiRoute: "/api/backtests/[id]",
      status: "ready",
      note: "Saved backtest runs can be opened as read-only report links.",
    },
  });
}
