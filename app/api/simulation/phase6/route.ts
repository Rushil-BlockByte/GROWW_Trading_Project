import { NextResponse } from "next/server";
import { createSimulatedMarketSnapshot } from "@/lib/simulation/market-snapshot";

export async function GET() {
  const snapshot = createSimulatedMarketSnapshot(2);

  return NextResponse.json({
    mode: "simulation",
    liveOrdersEnabled: false,
    strategy: snapshot.phase6,
    signal: snapshot.signal,
  });
}
