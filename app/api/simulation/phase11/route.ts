import { NextResponse } from "next/server";
import { isDatabasePersistenceConfigured } from "@/lib/persistence/local-user";

export async function GET() {
  return NextResponse.json({
    mode: "simulation",
    phase: 11,
    liveOrdersEnabled: false,
    databasePersistence: {
      configured: isDatabasePersistenceConfigured(),
      journalEndpoint: "/api/paper-journal",
      backtestEndpoint: "/api/backtests",
      status: "ready",
      note: "Paper journal entries and backtest runs can persist to PostgreSQL when DATABASE_URL is configured.",
    },
  });
}
