import { NextResponse } from "next/server";
import { runSampleMultiDayVwapBreakoutBacktest } from "@/lib/backtesting/vwap-breakout-backtest";

export async function GET() {
  return NextResponse.json({
    mode: "simulation",
    liveOrdersEnabled: false,
    multiDayBacktest: runSampleMultiDayVwapBreakoutBacktest(),
  });
}
