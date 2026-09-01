import { NextResponse } from "next/server";
import { getLiveKiteStreamService } from "@/lib/zerodha/live-stream-service";

export async function GET() {
  const snapshot = getLiveKiteStreamService().getSnapshot();

  return NextResponse.json({
    mode: "simulation",
    phase: 18,
    liveOrdersEnabled: false,
    liveModeHardening: {
      status: "ready",
      streamStartAllowed: snapshot.streamStartAllowed,
      marketSession: snapshot.marketSession,
      freshness: snapshot.freshness,
      safetyChecks: snapshot.safetyChecks,
      note: "Live stream startup is gated by credentials and market hours, and signal readiness is gated by fresh data.",
    },
  });
}
