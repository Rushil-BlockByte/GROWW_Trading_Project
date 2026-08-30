import { NextResponse } from "next/server";
import { createPhase4IndicatorContext } from "@/lib/simulation/phase4-context";

export async function GET() {
  return NextResponse.json({
    mode: "simulation",
    liveOrdersEnabled: false,
    indicators: createPhase4IndicatorContext(2),
  });
}
