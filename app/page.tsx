import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { createInitialMarketSnapshot } from "@/lib/simulation/market-snapshot";

export default function Home() {
  return <DashboardShell initialSnapshot={createInitialMarketSnapshot()} />;
}
