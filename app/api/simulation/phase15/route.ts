import { NextResponse } from "next/server";
import { isDatabasePersistenceConfigured } from "@/lib/persistence/local-user";

export async function GET() {
  return NextResponse.json({
    mode: "simulation",
    phase: 15,
    liveOrdersEnabled: false,
    scheduledReportReviews: {
      configured: isDatabasePersistenceConfigured(),
      reviewRoute: "/reviews",
      reviewApiRoute: "/api/report-reviews",
      cadences: ["daily", "weekly"],
      status: "ready",
      note: "Daily and weekly report reviews can be saved with comparison snapshots.",
    },
  });
}
