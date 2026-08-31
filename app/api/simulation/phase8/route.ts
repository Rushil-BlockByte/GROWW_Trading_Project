import { NextResponse } from "next/server";
import { runSampleVwapBreakoutBacktest } from "@/lib/backtesting/vwap-breakout-backtest";

export async function GET() {
  return NextResponse.json({
    mode: "simulation",
    liveOrdersEnabled: false,
    backtest: runSampleVwapBreakoutBacktest(),
  });
}
