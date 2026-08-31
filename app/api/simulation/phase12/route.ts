import { NextResponse } from "next/server";
import { isDatabasePersistenceConfigured } from "@/lib/persistence/local-user";

export async function GET() {
  return NextResponse.json({
    mode: "simulation",
    phase: 12,
    liveOrdersEnabled: false,
    backtestReporting: {
      configured: isDatabasePersistenceConfigured(),
      backtestEndpoint: "/api/backtests",
      filters: ["underlying", "kind", "result"],
      dashboardPanel: "Backtest Reports",
      status: "ready",
      note: "Saved replay runs can be reviewed in a read-only dashboard report with local sample fallback.",
    },
  });
}
