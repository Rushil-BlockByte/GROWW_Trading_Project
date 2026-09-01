import { NextResponse } from "next/server";
import { explainScannerSnapshot } from "@/lib/explanations/trading-explanations";
import { createInitialMarketSnapshot } from "@/lib/simulation/market-snapshot";

export async function GET() {
  return NextResponse.json({
    mode: "simulation",
    phase: 17,
    liveOrdersEnabled: false,
    explanationLayer: {
      status: "ready",
      dashboardExplanation: explainScannerSnapshot(createInitialMarketSnapshot()),
      note: "Explanations are deterministic and local; no trading data is sent to an external AI service.",
    },
  });
}
