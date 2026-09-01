import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getOptionalAppUser } from "@/lib/auth/session";
import {
  runSampleMultiDayVwapBreakoutBacktest,
  runSampleVwapBreakoutBacktest,
} from "@/lib/backtesting/vwap-breakout-backtest";

export default async function Home() {
  const user = await getOptionalAppUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <DashboardShell
      initialBacktestResult={runSampleVwapBreakoutBacktest()}
      initialMultiDayBacktestResult={runSampleMultiDayVwapBreakoutBacktest()}
    />
  );
}
