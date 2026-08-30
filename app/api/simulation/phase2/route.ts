import { NextResponse } from "next/server";
import { createPhase2PipelineSnapshot } from "@/lib/simulation/phase2-pipeline";

export async function GET() {
  return NextResponse.json({
    mode: "simulation",
    liveOrdersEnabled: false,
    pipeline: createPhase2PipelineSnapshot(2, "25180"),
  });
}
