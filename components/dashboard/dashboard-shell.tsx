"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpenText,
  CalendarDays,
  CandlestickChart,
  CircleDollarSign,
  ClipboardCheck,
  Copy,
  Database,
  Download,
  ExternalLink,
  Filter,
  Gauge,
  History,
  Layers,
  MessageSquareText,
  PauseCircle,
  Power,
  Radio,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  backtestReportCsvFilename,
  backtestReportRecordsToCsv,
} from "@/lib/backtesting/backtest-report-export";
import {
  backtestReportRecordFromResult,
  filterBacktestReportRecords,
  isBacktestReportRecord,
  summarizeBacktestReportRecords,
} from "@/lib/backtesting/backtest-reporting";
import { backtestReportQueryString } from "@/lib/backtesting/backtest-report-query";
import { backtestReportSharePath } from "@/lib/backtesting/backtest-report-share";
import { getMarketDataModeLabel } from "@/lib/config/market";
import { explainScannerSnapshot } from "@/lib/explanations/trading-explanations";
import {
  calculatePaperJournalSummary,
  canCreatePaperTrade,
  createJournalNoteFromSnapshot,
  createPaperTradeFromSnapshot,
  isPaperJournalEntry,
  MAX_PAPER_JOURNAL_ENTRIES,
  PAPER_JOURNAL_STORAGE_KEY,
  PAPER_OPTION_STOP_PERCENT,
  parsePaperJournalEntries,
  serializePaperJournalEntries,
} from "@/lib/paper-trading/journal";
import { DEFAULT_RISK_CONFIGURATION } from "@/lib/risk/defaults";
import { calculateDailyLossLimit, calculatePositionSize } from "@/lib/risk/position-sizing";
import {
  DEFAULT_HISTORICAL_OPTION_SPREAD_PERCENT,
  DEFAULT_HISTORICAL_OPTION_STRIKE_WINDOW,
  MAX_HISTORICAL_OPTION_STRIKE_WINDOW,
} from "@/lib/zerodha/option-historical-config";
import type {
  BacktestResult,
  BacktestTrade,
  BacktestTradeOutcome,
  MultiDayBacktestResult,
} from "@/types/backtest";
import type {
  BacktestReportFilters,
  BacktestReportRecord,
} from "@/types/backtest-report";
import type { PriceLevel } from "@/types/indicators";
import type { MarketDataMode } from "@/types/market";
import type {
  OptionChainContext,
  OptionLiquidityStatus,
  OptionOpenInterestLevel,
} from "@/types/options";
import type {
  PaperJournalEntry,
  PaperJournalSummary,
  PaperTradeJournalStatus,
} from "@/types/paper-trading";
import type { LiveKiteStreamSnapshot } from "@/lib/zerodha/live-stream-service";
import type { SimulatedMarketSnapshot, SimulatedUnderlying } from "@/types/simulation";
import type { StrategyComponentScore, StrategyComponentStatus } from "@/types/strategy";

type DashboardShellProps = {
  initialBacktestResult: BacktestResult;
  initialMultiDayBacktestResult: MultiDayBacktestResult;
};

type PersistenceBadgeVariant = "success" | "warning" | "destructive" | "muted";

type PersistenceUiState = {
  label: string;
  message: string;
  variant: PersistenceBadgeVariant;
};

type JournalApiResponse = {
  ok?: boolean;
  persistence?: {
    configured: boolean;
    status: "database" | "local_only" | "error";
    message: string;
  };
  entries?: unknown[];
  summary?: PaperJournalSummary;
  savedCount?: number;
  liveOrdersEnabled?: false;
  message?: string;
};

type BacktestApiResponse = {
  ok?: boolean;
  persistence?: {
    configured: boolean;
    status: "database" | "local_only" | "error";
    message: string;
  };
  backtest?: unknown;
  backtests?: unknown[];
  savedCount?: number;
  liveOrdersEnabled?: false;
  message?: string;
};

type BacktestSaveState = PersistenceUiState & {
  busy: boolean;
};

type LiveRiskPlan = {
  contractLabel: string;
  contractStatus: "TRADABLE" | "NOT_TRADABLE";
  contractReason: string;
  entryPrice: string;
  stopPrice: string;
  lotSize: number;
  positionSize: ReturnType<typeof calculatePositionSize>;
};

const BACKTEST_REPORTS_UPDATED_EVENT = "groww-backtests-updated";

const reportUnderlyingOptions: Array<{
  label: string;
  value: NonNullable<BacktestReportFilters["underlying"]>;
}> = [
  { label: "All", value: "ALL" },
  { label: "NIFTY", value: "NIFTY" },
  { label: "BANKNIFTY", value: "BANKNIFTY" },
  { label: "FINNIFTY", value: "FINNIFTY" },
];

const reportKindOptions: Array<{
  label: string;
  value: NonNullable<BacktestReportFilters["kind"]>;
}> = [
  { label: "All", value: "all" },
  { label: "Single", value: "single_day" },
  { label: "Multi", value: "multi_day" },
];

const reportResultOptions: Array<{
  label: string;
  value: NonNullable<BacktestReportFilters["result"]>;
}> = [
  { label: "All", value: "all" },
  { label: "Profit", value: "profitable" },
  { label: "Loss", value: "losing" },
  { label: "Flat", value: "flat" },
];

const numberFormat = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const inrFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function formatNumber(value: number) {
  return numberFormat.format(value);
}

function formatInr(value: number | string) {
  return inrFormat.format(Number(value));
}

function formatSigned(value: number, suffix = "") {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}${suffix}`;
}

function formatIndicator(value: string | null, suffix = "") {
  return value ? `${formatNumber(Number(value))}${suffix}` : "Pending";
}

function formatOptionalNumber(value: number | null | undefined) {
  return value === null || value === undefined ? "Pending" : formatNumber(value);
}

function formatOptionalSigned(value: number | null | undefined, suffix = "") {
  return value === null || value === undefined ? "Pending" : formatSigned(value, suffix);
}

function formatOptionalRatio(value: number | null | undefined) {
  return value === null || value === undefined ? "Pending" : `${formatNumber(value)}x`;
}

function formatNumericString(value: string | null | undefined) {
  return value ? formatNumber(Number(value)) : "Pending";
}

function formatSignedIndicator(value: string | null, suffix = "") {
  if (!value) return "Pending";

  return formatSigned(Number(value), suffix);
}

function regimeVariant(regime: SimulatedUnderlying["regime"]) {
  if (regime.includes("BULLISH")) return "success" as const;
  if (regime.includes("BEARISH")) return "destructive" as const;
  if (regime.includes("VOLATILITY")) return "warning" as const;
  return "muted" as const;
}

function dataQualityVariant(status: SimulatedUnderlying["dataQuality"]) {
  if (status === "GOOD") return "success" as const;
  if (status === "STALE" || status === "INSUFFICIENT_DATA") return "warning" as const;
  return "muted" as const;
}

function emaTrendVariant(trend: SimulatedMarketSnapshot["phase4"]["emaTrend"]) {
  if (trend === "Bullish") return "success" as const;
  if (trend === "Bearish") return "destructive" as const;
  if (trend === "Mixed") return "warning" as const;
  return "muted" as const;
}

function liquidityVariant(status: OptionLiquidityStatus) {
  return status === "TRADABLE" ? "success" as const : "destructive" as const;
}

function formatLiquidityStatus(status: OptionLiquidityStatus) {
  return status === "TRADABLE" ? "Tradable" : "Not tradable";
}

function qualityVariant(quality: SimulatedMarketSnapshot["signal"]["quality"]) {
  if (quality === "HIGH QUALITY" || quality === "STRONG") return "success" as const;
  if (quality === "WATCH" || quality === "WEAK") return "warning" as const;
  return "muted" as const;
}

function strategyStateVariant(state: SimulatedMarketSnapshot["signal"]["state"]) {
  if (state === "CONFIRMED" || state === "ACTIVE") return "success" as const;
  if (state === "FORMING") return "warning" as const;
  if (state === "INVALIDATED" || state === "STOPPED") return "destructive" as const;
  return "muted" as const;
}

function componentStatusVariant(status: StrategyComponentStatus) {
  if (status === "PASS") return "success" as const;
  if (status === "PARTIAL" || status === "PENDING") return "warning" as const;
  return "destructive" as const;
}

function paperStatusVariant(status: PaperTradeJournalStatus) {
  if (status === "OPEN") return "success" as const;
  if (status === "NOTE") return "secondary" as const;
  if (status === "CLOSED") return "muted" as const;
  return "destructive" as const;
}

function tradeOutcomeVariant(outcome: BacktestTradeOutcome) {
  if (outcome === "WIN") return "success" as const;
  if (outcome === "LOSS") return "destructive" as const;

  return "muted" as const;
}

function createJournalId() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `journal-${Date.now()}`;
}

function formatJournalTime(value: string) {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function formatBacktestWindow(startedAt: string, endedAt: string) {
  const start = new Date(startedAt).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
  const end = new Date(endedAt).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });

  return `${start} - ${end}`;
}

function persistenceUiState(
  persistence: JournalApiResponse["persistence"] | BacktestApiResponse["persistence"] | undefined,
): PersistenceUiState {
  if (!persistence) {
    return {
      label: "Local only",
      message: "Saved in this browser.",
      variant: "muted",
    };
  }

  if (persistence.status === "database") {
    return {
      label: "Database synced",
      message: persistence.message,
      variant: "success",
    };
  }

  if (persistence.status === "error") {
    return {
      label: "Sync issue",
      message: persistence.message,
      variant: "destructive",
    };
  }

  return {
    label: "Local only",
    message: persistence.message,
    variant: "warning",
  };
}

function mergeJournalEntries(...groups: PaperJournalEntry[][]) {
  const byId = new Map<string, PaperJournalEntry>();

  for (const entry of groups.flat()) {
    const current = byId.get(entry.id);

    if (!current || new Date(entry.updatedAt).getTime() >= new Date(current.updatedAt).getTime()) {
      byId.set(entry.id, entry);
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_PAPER_JOURNAL_ENTRIES);
}

function parseJournalResponseEntries(data: JournalApiResponse) {
  return Array.isArray(data.entries) ? data.entries.filter(isPaperJournalEntry) : [];
}

function parseBacktestReportResponseRecords(data: BacktestApiResponse) {
  const records = Array.isArray(data.backtests)
    ? data.backtests
    : data.backtest
      ? [data.backtest]
      : [];

  return records.filter(isBacktestReportRecord);
}

function reportSavedAtFromResult(result: BacktestResult | MultiDayBacktestResult) {
  const candidate = result.metadata.endedAt || result.metadata.startedAt;
  const date = candidate ? new Date(candidate) : new Date("1970-01-01T00:00:00.000Z");

  return Number.isNaN(date.getTime()) ? new Date("1970-01-01T00:00:00.000Z") : date;
}

function formatReportKind(kind: BacktestReportRecord["kind"]) {
  return kind === "multi_day" ? "Multi-day" : "Single-day";
}

function formatReportDateTime(value: string | null) {
  if (!value) return "Pending";

  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function pnlVariant(value: string) {
  const pnl = Number(value);

  if (pnl > 0) return "success" as const;
  if (pnl < 0) return "destructive" as const;

  return "muted" as const;
}

function downloadBacktestReportsCsv(records: BacktestReportRecord[]) {
  const csv = backtestReportRecordsToCsv(records);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = backtestReportCsvFilename();
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function backtestReportShareUrl(record: BacktestReportRecord) {
  const path = backtestReportSharePath(record.id);

  if (typeof window === "undefined") return path;

  return new URL(path, window.location.origin).toString();
}

function fallbackCopyText(value: string) {
  const textarea = document.createElement("textarea");

  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  const copied = document.execCommand("copy");

  textarea.remove();

  return copied;
}

async function copyBacktestReportLink(record: BacktestReportRecord) {
  const url = backtestReportShareUrl(record);

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }

    return fallbackCopyText(url);
  } catch {
    return fallbackCopyText(url);
  }
}

function buildLiveRiskPlan(
  snapshot: SimulatedMarketSnapshot | undefined,
  risk: typeof DEFAULT_RISK_CONFIGURATION,
): LiveRiskPlan | null {
  const selectedContract = snapshot?.phase6.selectedContract;

  if (!snapshot || !selectedContract) return null;

  const optionRow = snapshot.optionChain.find((row) => row.strike === selectedContract.strike);
  const selectedLeg = selectedContract.side === "CE" ? optionRow?.call : optionRow?.put;
  const lotSize = selectedLeg?.lotSize;
  const entryPrice = Number(selectedContract.ltp);
  const stopPercent = Number(PAPER_OPTION_STOP_PERCENT);
  const stopPrice = entryPrice - (entryPrice * stopPercent) / 100;

  if (
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    !Number.isFinite(stopPrice) ||
    stopPrice <= 0 ||
    typeof lotSize !== "number" ||
    !Number.isInteger(lotSize) ||
    lotSize <= 0
  ) {
    return null;
  }

  return {
    contractLabel: selectedContract.label,
    contractStatus: selectedContract.status,
    contractReason: selectedContract.reason,
    entryPrice: entryPrice.toFixed(2),
    stopPrice: stopPrice.toFixed(2),
    lotSize,
    positionSize: calculatePositionSize({
      tradingCapital: risk.tradingCapital,
      riskPerTradePercent: risk.riskPerTradePercent,
      entryPrice,
      stopPrice,
      lotSize,
    }),
  };
}

export function DashboardShell({
  initialBacktestResult,
  initialMultiDayBacktestResult,
}: DashboardShellProps) {
  const [selectedUnderlying, setSelectedUnderlying] = useState<SimulatedUnderlying["symbol"]>("NIFTY");
  const [liveStatus, setLiveStatus] = useState<LiveKiteStreamSnapshot | null>(null);
  const liveSnapshot = liveStatus?.marketSnapshot;
  const mode = liveSnapshot
    ? getMarketDataModeLabel(liveSnapshot.health.mode)
    : {
        label: "LIVE DATA WAITING",
        description: "Connect Zerodha stream",
        tone: "warning" as const,
      };
  const risk = DEFAULT_RISK_CONFIGURATION;
  const liveRiskPlan = useMemo(() => buildLiveRiskPlan(liveSnapshot, risk), [liveSnapshot, risk]);
  const dailyLossLimit = calculateDailyLossLimit(
    risk.tradingCapital,
    risk.maximumDailyLossPercent,
  );

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
          <div>
            <p className="text-sm font-semibold text-primary">GROWW Trading Project</p>
            <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">
              Indian Options Opportunity Scanner
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={mode.tone}>
              <Radio className="h-3.5 w-3.5" />
              {mode.label}
            </Badge>
            <Badge variant="outline">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Read-only
            </Badge>
            <Button asChild variant="outline">
              <Link href="/daily-plan">
                <CalendarDays className="h-4 w-4" />
                Daily Plan
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/reviews">
                <ClipboardCheck className="h-4 w-4" />
                Reviews
              </Link>
            </Button>
          </div>
        </header>

        {liveSnapshot ? (
          <>
            <section className="grid gap-3 lg:grid-cols-3">
              {liveSnapshot.underlyings.map((underlying) => (
                <MarketCard
                  key={underlying.symbol}
                  dataMode={liveSnapshot.health.mode}
                  underlying={underlying}
                />
              ))}
            </section>

            <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <IndicatorContextPanel snapshot={liveSnapshot} />
              <OpportunityScanner snapshot={liveSnapshot} />
            </section>

            <ScannerExplanationPanel snapshot={liveSnapshot} />

            <section className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
              <OptionChainContextPanel context={liveSnapshot.phase5} />
              <OptionChain
                snapshot={liveSnapshot}
                selectedUnderlying={selectedUnderlying}
                onSelectUnderlying={setSelectedUnderlying}
              />
            </section>
          </>
        ) : (
          <LiveDataWaitingPanel status={liveStatus} />
        )}

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <BacktestSummaryPanel result={initialBacktestResult} />
          <MultiDayBacktestPanel result={initialMultiDayBacktestResult} />
        </section>

        <BacktestReportsPanel
          initialBacktestResult={initialBacktestResult}
          initialMultiDayBacktestResult={initialMultiDayBacktestResult}
        />

        <section className="grid gap-4 xl:grid-cols-5">
          <RiskDashboard
            dailyLossLimit={dailyLossLimit}
            riskPlan={liveRiskPlan}
            risk={risk}
          />
          {liveSnapshot ? <Phase2Pipeline snapshot={liveSnapshot} /> : null}
          <LiveConnectionPanel onStatusChange={setLiveStatus} />
          <HistoricalOptionIngestionPanel />
          {liveSnapshot ? <SystemHealth snapshot={liveSnapshot} /> : null}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {liveSnapshot ? (
            <PaperTradeJournal snapshot={liveSnapshot} />
          ) : (
            <LivePaperJournalWaitingPanel status={liveStatus} />
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-secondary" />
                Signal History
              </CardTitle>
              <CardDescription>Alerts appear only on signal state transitions</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3">
                <PauseCircle className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-semibold">
                  {liveSnapshot ? "No confirmed signal" : "Waiting for live data"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {liveSnapshot
                    ? `Current state: ${liveSnapshot.signal.state}. Paper entry remains disabled.`
                    : "Signal history starts only after live Kite ticks are available."}
                </p>
              </div>
            </div>
              <Button disabled variant="secondary">
                <CircleDollarSign className="h-4 w-4" />
                Take Paper Trade
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

function useBacktestPersistence(result: BacktestResult | MultiDayBacktestResult) {
  const [state, setState] = useState<BacktestSaveState>({
    busy: false,
    label: "Not saved",
    message: "This replay can be saved when the database is ready.",
    variant: "muted",
  });

  const save = useCallback(async () => {
    setState((current) => ({
      ...current,
      busy: true,
      label: "Saving",
      message: "Saving replay.",
      variant: "warning",
    }));

    try {
      const response = await fetch("/api/backtests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result }),
      });
      const data = (await response.json()) as BacktestApiResponse;

      if (!response.ok || data.ok === false) {
        throw new Error(data.message ?? data.persistence?.message ?? "Backtest save failed.");
      }

      setState({
        ...persistenceUiState(data.persistence),
        busy: false,
      });

      window.dispatchEvent(new Event(BACKTEST_REPORTS_UPDATED_EVENT));
    } catch (error) {
      setState({
        busy: false,
        label: "Sync issue",
        message: error instanceof Error ? error.message : "Backtest save failed.",
        variant: "destructive",
      });
    }
  }, [result]);

  return { save, state };
}

function explanationVariant(verdict: ReturnType<typeof explainScannerSnapshot>["verdict"]) {
  if (verdict === "positive") return "success" as const;
  if (verdict === "caution") return "destructive" as const;
  if (verdict === "watch") return "warning" as const;

  return "muted" as const;
}

function ScannerExplanationPanel({ snapshot }: { snapshot: SimulatedMarketSnapshot }) {
  const explanation = useMemo(() => explainScannerSnapshot(snapshot), [snapshot]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-accent" />
              Scanner Explanation
            </CardTitle>
            <CardDescription>{explanation.headline}</CardDescription>
          </div>
          <Badge variant={explanationVariant(explanation.verdict)}>
            {explanation.verdict.replace("_", " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <div className="grid gap-2 rounded-md border bg-muted/35 p-3 text-sm">
          <p className="font-semibold">Summary</p>
          <p className="text-muted-foreground">{explanation.summary}</p>
        </div>
        <ExplanationList label="Working" items={explanation.strengths} />
        <ExplanationList label="Needs Patience" items={explanation.cautions} />
      </CardContent>
    </Card>
  );
}

function ExplanationList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="grid gap-2 rounded-md border bg-muted/35 p-3 text-sm">
      <p className="font-semibold">{label}</p>
      <ul className="grid gap-1 text-muted-foreground">
        {items.slice(0, 4).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function LiveDataWaitingPanel({ status }: { status: LiveKiteStreamSnapshot | null }) {
  const connected = Boolean(status?.provider.connected);
  const marketOpen = Boolean(status?.marketSession.open);
  const tickMessage = status?.freshness.message ?? "No live tick has reached the dashboard yet.";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-primary" />
              Live Market Data
            </CardTitle>
            <CardDescription>{tickMessage}</CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant={marketOpen ? "success" : "warning"}>
              {marketOpen ? "Market open" : "Market closed"}
            </Badge>
            <Badge variant={connected ? "success" : "warning"}>
              {connected ? "Stream connected" : "Stream waiting"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <Metric label="Instruments" value={formatNumber(status?.instrumentMasterCount ?? 0)} />
        <Metric label="Subscribed" value={formatNumber(status?.provider.subscriptionCount ?? 0)} />
        <Metric label="Tracked" value={formatNumber(status?.marketState.instrumentsTracked ?? 0)} />
      </CardContent>
    </Card>
  );
}

function LivePaperJournalWaitingPanel({ status }: { status: LiveKiteStreamSnapshot | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpenText className="h-5 w-5 text-accent" />
          Paper Trade Journal
        </CardTitle>
        <CardDescription>
          {status?.freshness.message ?? "Waiting for fresh live ticks."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border bg-muted/35 px-3 py-3 text-sm text-muted-foreground">
          Paper entries are paused until the live market snapshot is ready.
        </div>
      </CardContent>
    </Card>
  );
}

function BacktestReportsPanel({
  initialBacktestResult,
  initialMultiDayBacktestResult,
}: Pick<DashboardShellProps, "initialBacktestResult" | "initialMultiDayBacktestResult">) {
  const fallbackRecords = useMemo(
    () => [
      backtestReportRecordFromResult(
        initialBacktestResult,
        reportSavedAtFromResult(initialBacktestResult),
      ),
      backtestReportRecordFromResult(
        initialMultiDayBacktestResult,
        reportSavedAtFromResult(initialMultiDayBacktestResult),
      ),
    ],
    [initialBacktestResult, initialMultiDayBacktestResult],
  );
  const [records, setRecords] = useState<BacktestReportRecord[]>(() => fallbackRecords);
  const [filters, setFilters] = useState<Required<BacktestReportFilters>>({
    underlying: "ALL",
    kind: "all",
    result: "all",
  });
  const [loading, setLoading] = useState(false);
  const [reportLinksEnabled, setReportLinksEnabled] = useState(false);
  const [copiedReportId, setCopiedReportId] = useState<string | null>(null);
  const [persistence, setPersistence] = useState<PersistenceUiState>({
    label: "Local sample",
    message: "Showing current replay samples until saved database runs are available.",
    variant: "muted",
  });

  const loadReports = useCallback(async () => {
    setLoading(true);

    try {
      const queryString = backtestReportQueryString({ limit: 20 });
      const response = await fetch(`/api/backtests?${queryString}`, { cache: "no-store" });
      const data = (await response.json()) as BacktestApiResponse;

      if (!response.ok || data.ok === false) {
        throw new Error(data.message ?? data.persistence?.message ?? "Backtest reports failed.");
      }

      const apiRecords = parseBacktestReportResponseRecords(data);

      if (data.persistence?.status === "database" && apiRecords.length) {
        setRecords(apiRecords);
        setReportLinksEnabled(true);
        setPersistence(persistenceUiState(data.persistence));
        return;
      }

      setRecords(fallbackRecords);
      setReportLinksEnabled(false);

      if (data.persistence?.status === "error") {
        setPersistence({
          label: "Local sample",
          message: "Database is unavailable. Showing current replay samples.",
          variant: "warning",
        });
        return;
      }

      if (data.persistence?.status === "database") {
        setPersistence({
          label: "Sample fallback",
          message: "No saved database runs yet. Showing current replay samples.",
          variant: "warning",
        });
        return;
      }

      setPersistence(persistenceUiState(data.persistence));
    } catch (error) {
      setRecords(fallbackRecords);
      setReportLinksEnabled(false);
      setPersistence({
        label: "Local sample",
        message:
          error instanceof Error
            ? `Report sync failed. ${error.message}`
            : "Showing current replay samples.",
        variant: "warning",
      });
    } finally {
      setLoading(false);
    }
  }, [fallbackRecords]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadReports();
    }, 0);

    const refreshReports = () => void loadReports();

    window.addEventListener(BACKTEST_REPORTS_UPDATED_EVENT, refreshReports);

    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener(BACKTEST_REPORTS_UPDATED_EVENT, refreshReports);
    };
  }, [loadReports]);

  const filteredRecords = useMemo(
    () => filterBacktestReportRecords(records, filters),
    [filters, records],
  );
  const summary = useMemo(
    () => summarizeBacktestReportRecords(filteredRecords),
    [filteredRecords],
  );
  const copyReportLink = useCallback(async (record: BacktestReportRecord) => {
    const copied = await copyBacktestReportLink(record);

    if (!copied) return;

    setCopiedReportId(record.id);
    window.setTimeout(() => {
      setCopiedReportId((current) => (current === record.id ? null : current));
    }, 1500);
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Backtest Reports
            </CardTitle>
            <CardDescription>
              {summary.runCount} runs in view from {records.length} loaded reports
            </CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant={persistence.variant}>{persistence.label}</Badge>
            <Badge variant="success">No live orders</Badge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!filteredRecords.length}
              onClick={() => downloadBacktestReportsCsv(filteredRecords)}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => void loadReports()}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="grid gap-2">
            <p className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              Underlying
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {reportUnderlyingOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={filters.underlying === option.value ? "default" : "outline"}
                  onClick={() =>
                    setFilters((current) => ({ ...current, underlying: option.value }))
                  }
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">Run Type</p>
            <div className="grid grid-cols-3 gap-2">
              {reportKindOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={filters.kind === option.value ? "default" : "outline"}
                  onClick={() => setFilters((current) => ({ ...current, kind: option.value }))}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">Result</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {reportResultOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={filters.result === option.value ? "default" : "outline"}
                  onClick={() => setFilters((current) => ({ ...current, result: option.value }))}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 xl:grid-cols-6">
          <Metric label="Runs" value={String(summary.runCount)} />
          <Metric label="Net P&L" value={formatInr(summary.netPnl)} />
          <Metric label="Trades" value={String(summary.trades)} />
          <Metric label="Avg win rate" value={`${summary.averageWinRate}%`} />
          <Metric label="Max drawdown" value={formatInr(summary.maxDrawdown)} />
          <Metric label="Winners" value={String(summary.winningRuns)} />
        </div>

        <div className="grid gap-2 lg:grid-cols-2">
          <BacktestReportHighlight label="Best run" record={summary.bestRun} />
          <BacktestReportHighlight label="Worst run" record={summary.worstRun} />
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Win</TableHead>
                <TableHead className="text-right">Drawdown</TableHead>
                <TableHead>Saved</TableHead>
                <TableHead className="text-right">Link</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.length ? (
                filteredRecords.map((record) => (
                  <BacktestReportRow
                    key={record.id}
                    copied={copiedReportId === record.id}
                    record={record}
                    shareable={reportLinksEnabled}
                    onCopy={copyReportLink}
                  />
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-20 text-center text-sm text-muted-foreground"
                  >
                    No reports match these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">{persistence.message}</p>
      </CardContent>
    </Card>
  );
}

function BacktestReportHighlight({
  label,
  record,
}: {
  label: string;
  record: BacktestReportRecord | null;
}) {
  return (
    <div className="grid gap-2 rounded-md border bg-muted/35 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
        {record ? (
          <Badge variant={pnlVariant(record.netPnl)}>{formatInr(record.netPnl)}</Badge>
        ) : (
          <Badge variant="muted">No run</Badge>
        )}
      </div>
      {record ? (
        <div className="min-w-0">
          <p className="truncate font-semibold">{record.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatReportKind(record.kind)} | {record.trades} trades | {record.winRate}% wins
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No run available in this view.</p>
      )}
    </div>
  );
}

function BacktestReportRow({
  copied,
  onCopy,
  record,
  shareable,
}: {
  copied: boolean;
  onCopy: (record: BacktestReportRecord) => void;
  record: BacktestReportRecord;
  shareable: boolean;
}) {
  const sharePath = backtestReportSharePath(record.id);

  return (
    <TableRow>
      <TableCell className="min-w-56">
        <div className="min-w-0">
          <p className="truncate font-semibold">{record.name}</p>
          <p className="text-xs text-muted-foreground">
            {record.underlying} | {record.dataSource.replaceAll("_", " ")}
          </p>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <Badge variant={record.kind === "multi_day" ? "success" : "outline"}>
          {formatReportKind(record.kind)}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
        <span className={Number(record.netPnl) >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}>
          {formatInr(record.netPnl)}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {record.winRate}%
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {formatInr(record.maxDrawdown)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {formatReportDateTime(record.savedAt)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right">
        {shareable ? (
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={`Copy ${record.name} report link`}
              title={copied ? "Copied" : "Copy link"}
              onClick={() => onCopy(record)}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button asChild size="icon" variant="ghost" className="h-8 w-8">
              <Link
                href={sharePath}
                aria-label={`Open ${record.name} report`}
                title="Open report"
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        ) : (
          <Badge variant="muted">Sample</Badge>
        )}
      </TableCell>
    </TableRow>
  );
}

function MultiDayBacktestPanel({ result }: { result: MultiDayBacktestResult }) {
  const { metadata, summary } = result;
  const persistence = useBacktestPersistence(result);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-accent" />
              Multi-Day Replay
            </CardTitle>
            <CardDescription>
              {metadata.sessionCount} sessions, {summary.evaluatedSignals} candles evaluated
            </CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant={persistence.state.variant}>{persistence.state.label}</Badge>
            <Badge variant="success">Read-only</Badge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={persistence.state.busy}
              onClick={() => void persistence.save()}
            >
              <Save className="h-4 w-4" />
              Save Replay
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="Net P&L" value={formatInr(summary.netPnl)} />
          <Metric label="Win rate" value={`${summary.winRate}%`} />
          <Metric label="Trades" value={String(summary.trades)} />
          <Metric label="Skipped" value={String(summary.skippedSignals)} />
          <Metric label="Expectancy" value={formatInr(summary.expectancy)} />
          <Metric label="Max drawdown" value={formatInr(summary.maxDrawdown)} />
        </div>

        <div className="grid gap-2">
          {result.sessions.map((session) => (
            <div
              key={session.id}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md border bg-muted/35 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold">{session.label}</p>
                <p className="text-xs text-muted-foreground">
                  {session.summary.confirmedSignals} confirmed, {session.summary.trades} trades
                </p>
              </div>
              <Badge variant={session.summary.trades ? "success" : "muted"}>
                {session.summary.trades ? "Traded" : "No trade"}
              </Badge>
              <span className="text-right text-sm font-semibold tabular-nums">
                {formatInr(session.summary.netPnl)}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{persistence.state.message}</p>
      </CardContent>
    </Card>
  );
}

function BacktestSummaryPanel({ result }: { result: BacktestResult }) {
  const { metadata, summary } = result;
  const latestTrades = result.trades.slice(0, 3);
  const persistence = useBacktestPersistence(result);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              Backtest Replay
            </CardTitle>
            <CardDescription>
              {metadata.underlying} {formatBacktestWindow(metadata.startedAt, metadata.endedAt)}
            </CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant={persistence.state.variant}>{persistence.state.label}</Badge>
            <Badge variant="outline">{metadata.dataSource.replaceAll("_", " ")}</Badge>
            <Badge variant="success">Paper only</Badge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={persistence.state.busy}
              onClick={() => void persistence.save()}
            >
              <Save className="h-4 w-4" />
              Save Replay
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-6">
          <Metric label="Net P&L" value={formatInr(summary.netPnl)} />
          <Metric label="Win rate" value={`${summary.winRate}%`} />
          <Metric label="Trades" value={String(summary.trades)} />
          <Metric label="Profit factor" value={summary.profitFactor ?? "Open"} />
          <Metric label="Max drawdown" value={formatInr(summary.maxDrawdown)} />
          <Metric label="Costs" value={formatInr(summary.costs)} />
        </div>

        <div className="grid gap-2 lg:grid-cols-3">
          {latestTrades.length ? (
            latestTrades.map((trade) => <BacktestTradeRow key={trade.id} trade={trade} />)
          ) : (
            <div className="rounded-md border bg-muted/35 px-3 py-3 text-sm text-muted-foreground lg:col-span-3">
              No historical trades fired in this replay.
            </div>
          )}
        </div>

        {result.warnings.length ? (
          <div className="rounded-md border bg-yellow-50 p-3 text-sm font-medium text-yellow-950 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
            {result.warnings[0]}
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">{persistence.state.message}</p>
      </CardContent>
    </Card>
  );
}

function BacktestTradeRow({ trade }: { trade: BacktestTrade }) {
  return (
    <div className="grid gap-2 rounded-md border bg-muted/35 px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{trade.optionSymbol}</p>
          <p className="text-xs text-muted-foreground">
            {trade.exitReason.replace("_", " ")} at {formatJournalTime(trade.exitTime)}
          </p>
        </div>
        <Badge variant={tradeOutcomeVariant(trade.outcome)}>{trade.outcome}</Badge>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Metric label="Entry" value={formatInr(trade.entryPrice)} />
        <Metric label="Exit" value={formatInr(trade.exitPrice)} />
        <Metric label="Net" value={formatInr(trade.netPnl)} />
      </div>
    </div>
  );
}

function PaperTradeJournal({ snapshot }: { snapshot: SimulatedMarketSnapshot }) {
  const [entries, setEntries] = useState<PaperJournalEntry[]>([]);
  const [notes, setNotes] = useState("");
  const [journalReady, setJournalReady] = useState(false);
  const [syncingJournal, setSyncingJournal] = useState(false);
  const [persistence, setPersistence] = useState<PersistenceUiState>({
    label: "Checking",
    message: "Checking database storage.",
    variant: "muted",
  });
  const paperTradeGuard = useMemo(() => canCreatePaperTrade(snapshot), [snapshot]);
  const summary = useMemo(() => calculatePaperJournalSummary(entries), [entries]);
  const latestEntries = entries.slice(0, 5);

  const persistJournalEntries = useCallback(
    async (entriesToSave: PaperJournalEntry[], localEntries: PaperJournalEntry[]) => {
      setSyncingJournal(true);

      try {
        const response = await fetch("/api/paper-journal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: entriesToSave }),
        });
        const data = (await response.json()) as JournalApiResponse;

        if (!response.ok || data.ok === false) {
          throw new Error(data.message ?? data.persistence?.message ?? "Journal sync failed.");
        }

        setPersistence(persistenceUiState(data.persistence));

        if (data.persistence?.status === "database") {
          setEntries(mergeJournalEntries(localEntries, parseJournalResponseEntries(data)));
        }
      } catch (error) {
        setPersistence({
          label: "Sync issue",
          message: error instanceof Error ? error.message : "Journal sync failed.",
          variant: "destructive",
        });
      } finally {
        setSyncingJournal(false);
      }
    },
    [],
  );

  useEffect(() => {
    const loadJournal = window.setTimeout(() => {
      const stored = window.localStorage.getItem(PAPER_JOURNAL_STORAGE_KEY);
      const localEntries = parsePaperJournalEntries(stored);
      setEntries(localEntries);
      setJournalReady(true);

      void (async () => {
        try {
          const response = await fetch("/api/paper-journal", { cache: "no-store" });
          const data = (await response.json()) as JournalApiResponse;

          if (!response.ok || data.ok === false) {
            throw new Error(data.message ?? data.persistence?.message ?? "Journal load failed.");
          }

          setPersistence(persistenceUiState(data.persistence));

          if (data.persistence?.status === "database") {
            setEntries(mergeJournalEntries(localEntries, parseJournalResponseEntries(data)));
          }
        } catch (error) {
          setPersistence({
            label: "Local only",
            message: error instanceof Error ? error.message : "Saved in this browser.",
            variant: "warning",
          });
        }
      })();
    }, 0);

    return () => window.clearTimeout(loadJournal);
  }, []);

  useEffect(() => {
    if (!journalReady) return;

    window.localStorage.setItem(PAPER_JOURNAL_STORAGE_KEY, serializePaperJournalEntries(entries));
  }, [entries, journalReady]);

  function saveNote() {
    if (!notes.trim()) return;

    const entry = createJournalNoteFromSnapshot({
      id: createJournalId(),
      now: new Date().toISOString(),
      notes,
      snapshot,
    });
    const nextEntries = mergeJournalEntries([entry], entries);

    setEntries(nextEntries);
    setNotes("");
    void persistJournalEntries([entry], nextEntries);
  }

  function capturePaperTrade() {
    if (!paperTradeGuard.allowed) return;

    const entry = createPaperTradeFromSnapshot({
      id: createJournalId(),
      now: new Date().toISOString(),
      notes,
      snapshot,
      risk: DEFAULT_RISK_CONFIGURATION,
    });
    const nextEntries = mergeJournalEntries([entry], entries);

    setEntries(nextEntries);
    setNotes("");
    void persistJournalEntries([entry], nextEntries);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BookOpenText className="h-5 w-5 text-accent" />
              Paper Trade Journal
            </CardTitle>
            <CardDescription>
              {summary.openTrades} open, {summary.totalEntries} saved
            </CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant={persistence.variant}>{persistence.label}</Badge>
            <Badge variant={paperTradeGuard.allowed ? "success" : "warning"}>
              {paperTradeGuard.allowed ? "Paper ready" : "Paper gated"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="Unrealized P&L" value={formatInr(summary.unrealizedPnl)} />
          <Metric label="Realized P&L" value={formatInr(summary.realizedPnl)} />
          <Metric label="Notes" value={String(summary.notes)} />
          <Metric label="Rule violations" value={String(summary.ruleViolations)} />
        </div>
        <p className="text-xs text-muted-foreground">{persistence.message}</p>

        <Textarea
          className="min-h-28"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="What did I see? Did I follow the plan? Emotional state. Lesson."
        />

        <div className="grid gap-2 sm:grid-cols-3">
          <Button type="button" variant="outline" disabled={!notes.trim()} onClick={saveNote}>
            <Save className="h-4 w-4" />
            Save Note
          </Button>
          <Button
            type="button"
            disabled={!paperTradeGuard.allowed}
            onClick={capturePaperTrade}
          >
            <CircleDollarSign className="h-4 w-4" />
            Capture Paper Trade
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!entries.length || syncingJournal}
            onClick={() => void persistJournalEntries(entries, entries)}
          >
            <Database className="h-4 w-4" />
            Sync Journal
          </Button>
        </div>

        {!paperTradeGuard.allowed ? (
          <div className="rounded-md border bg-yellow-50 p-3 text-sm font-medium text-yellow-950 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
            {paperTradeGuard.reason}
          </div>
        ) : null}

        <div className="grid gap-2">
          {latestEntries.length ? (
            latestEntries.map((entry) => <PaperJournalEntryRow key={entry.id} entry={entry} />)
          ) : (
            <div className="rounded-md border bg-muted/35 px-3 py-3 text-sm text-muted-foreground">
              No journal entries saved.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PaperJournalEntryRow({ entry }: { entry: PaperJournalEntry }) {
  const title = entry.optionSymbol ?? `${entry.underlying} ${entry.bias}`;
  const detail =
    entry.type === "PAPER_TRADE"
      ? `Entry ${formatInr(entry.entryPrice ?? 0)} | Qty ${entry.quantity}`
      : `Score ${entry.score}/100 | ${entry.quality}`;

  return (
    <div className="grid gap-2 rounded-md border bg-muted/35 px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={paperStatusVariant(entry.status)}>{entry.status}</Badge>
          <span className="text-xs text-muted-foreground">{formatJournalTime(entry.createdAt)}</span>
        </div>
      </div>
      {entry.notes ? (
        <p className="line-clamp-2 text-sm text-muted-foreground">{entry.notes}</p>
      ) : null}
    </div>
  );
}

function IndicatorContextPanel({ snapshot }: { snapshot: SimulatedMarketSnapshot }) {
  const indicator = snapshot.phase4;
  const openingRange = indicator.openingRange15;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Indicator Context
            </CardTitle>
            <CardDescription>
              {indicator.underlying} with {indicator.candleCount} one-minute candles
            </CardDescription>
          </div>
          <Badge variant={emaTrendVariant(indicator.emaTrend)}>{indicator.emaTrend}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <Metric label="Close" value={formatIndicator(indicator.latestClose)} />
          <Metric label="VWAP" value={formatIndicator(indicator.vwap)} />
          <Metric label="VWAP dist" value={formatSignedIndicator(indicator.vwapDistance)} />
          <Metric label="EMA 9" value={formatIndicator(indicator.ema9)} />
          <Metric label="EMA 20" value={formatIndicator(indicator.ema20)} />
          <Metric label="EMA 50" value={formatIndicator(indicator.ema50)} />
          <Metric label="ATR 14" value={formatIndicator(indicator.atr14)} />
          <Metric label="RSI 14" value={formatIndicator(indicator.rsi14)} />
          <Metric label="Rel volume" value={formatIndicator(indicator.relativeVolume20, "x")} />
        </div>

        <div className="rounded-md border bg-muted/40 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Opening Range 15</p>
            <Badge variant={openingRange?.complete ? "success" : "warning"}>
              {openingRange?.complete ? "Complete" : "Building"}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Metric label="High" value={formatIndicator(openingRange?.high ?? null)} />
            <Metric label="Low" value={formatIndicator(openingRange?.low ?? null)} />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <LevelList title="Potential Support" levels={indicator.potentialSupport} />
          <LevelList title="Potential Resistance" levels={indicator.potentialResistance} />
        </div>
      </CardContent>
    </Card>
  );
}

function LevelList({ title, levels }: { title: string; levels: PriceLevel[] }) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <div className="grid gap-2">
        {levels.length ? (
          levels.map((level) => (
            <div
              key={`${level.source}-${level.label}-${level.value}`}
              className="flex items-center justify-between gap-3 rounded-md border bg-muted/35 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate text-muted-foreground">{level.label}</span>
              <span className="font-semibold tabular-nums">{formatIndicator(level.value)}</span>
            </div>
          ))
        ) : (
          <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
            Pending
          </div>
        )}
      </div>
    </div>
  );
}

function OptionChainContextPanel({ context }: { context: OptionChainContext }) {
  const totalContracts = context.rowCount * 2;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-primary" />
              Option Context
            </CardTitle>
            <CardDescription>
              {context.underlying} {context.expiry}
            </CardDescription>
          </div>
          <Badge variant={context.tradableContracts > 0 ? "success" : "warning"}>
            {context.tradableContracts}/{totalContracts} liquid
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="CE OI" value={formatNumber(context.totalCallOpenInterest)} />
          <Metric label="PE OI" value={formatNumber(context.totalPutOpenInterest)} />
          <Metric label="OI ratio" value={formatIndicator(context.putCallOpenInterestRatio)} />
          <Metric label="OI chg ratio" value={formatIndicator(context.putCallOiChangeRatio)} />
          <Metric label="CE volume" value={formatNumber(context.totalCallVolume)} />
          <Metric label="PE volume" value={formatNumber(context.totalPutVolume)} />
        </div>

        <div className="grid gap-2">
          <OptionLeaderRow leader={context.maxCallOpenInterest} />
          <OptionLeaderRow leader={context.maxPutOpenInterest} />
          <OptionLeaderRow leader={context.maxCallOiChange} />
          <OptionLeaderRow leader={context.maxPutOiChange} />
        </div>

        <div className="grid gap-3">
          <OiLevelList title="OI Support" levels={context.oiSupportLevels} />
          <OiLevelList title="OI Resistance" levels={context.oiResistanceLevels} />
        </div>
      </CardContent>
    </Card>
  );
}

function OptionLeaderRow({
  leader,
}: {
  leader: OptionChainContext["maxCallOpenInterest"];
}) {
  if (!leader) {
    return (
      <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
        Pending
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border bg-muted/35 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{leader.label}</p>
        <p className="text-xs text-muted-foreground">
          {leader.side} {formatNumber(leader.strike)}
        </p>
      </div>
      <div className="text-right tabular-nums">
        <p className="font-semibold">{formatNumber(leader.openInterest)}</p>
        <p className="text-xs text-emerald-700 dark:text-emerald-300">{formatSigned(leader.oiChange)}</p>
      </div>
    </div>
  );
}

function OiLevelList({ title, levels }: { title: string; levels: OptionOpenInterestLevel[] }) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <div className="grid gap-2">
        {levels.length ? (
          levels.map((level) => (
            <div
              key={`${level.role}-${level.side}-${level.strike}`}
              className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border bg-muted/35 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{formatNumber(level.strike)}</p>
                <p className="text-xs text-muted-foreground">{level.label}</p>
              </div>
              <div className="text-right tabular-nums">
                <p className="font-semibold">{formatNumber(level.openInterest)}</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-300">{formatSigned(level.oiChange)}</p>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
            Pending
          </div>
        )}
      </div>
    </div>
  );
}

function streamSafetyVariant(status: LiveKiteStreamSnapshot["safetyChecks"][number]["status"]) {
  if (status === "pass") return "success" as const;
  if (status === "block") return "destructive" as const;

  return "warning" as const;
}

function LiveConnectionPanel({
  onStatusChange,
}: {
  onStatusChange?: (status: LiveKiteStreamSnapshot) => void;
}) {
  const [status, setStatus] = useState<LiveKiteStreamSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const applyStatus = useCallback(
    (nextStatus: LiveKiteStreamSnapshot) => {
      setStatus(nextStatus);
      onStatusChange?.(nextStatus);
    },
    [onStatusChange],
  );

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/kite/stream", { cache: "no-store" });
    const data = (await response.json()) as LiveKiteStreamSnapshot;
    applyStatus(data);
  }, [applyStatus]);

  async function runAction(action: "start" | "stop") {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/kite/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as LiveKiteStreamSnapshot & {
        message?: string;
        snapshot?: LiveKiteStreamSnapshot;
      };

      if (!response.ok) {
        if (data.snapshot) {
          applyStatus(data.snapshot);
        }
        setMessage(data.message ?? "Kite stream action failed.");
        return;
      }

      applyStatus(data);
    } catch {
      setMessage("Could not reach the local Kite stream service.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void loadStatus();
    }, 0);
    const interval = window.setInterval(() => {
      void loadStatus();
    }, 5000);

    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [loadStatus]);

  const canStart = Boolean(status?.streamStartAllowed);
  const connected = Boolean(status?.provider.connected);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Power className="h-5 w-5 text-primary" />
          Zerodha Stream
        </CardTitle>
        <CardDescription>Read-only Kite WebSocket</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={connected ? "success" : status?.provider.reconnecting ? "warning" : "muted"}>
            {connected ? "LIVE" : status?.provider.reconnecting ? "RECONNECTING" : "DISCONNECTED"}
          </Badge>
          <Badge variant={status?.dataQualityGateOpen ? "success" : "warning"}>
            {status?.dataQualityGateOpen ? "Data gate open" : "Data gated"}
          </Badge>
          <Badge variant={status?.marketSession.open ? "success" : "destructive"}>
            {status?.marketSession.open ? "Market open" : "Market closed"}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="Token" value={status?.configured.accessToken ? "Set" : "Missing"} />
          <Metric label="Subscribed" value={String(status?.provider.subscriptionCount ?? 0)} />
          <Metric label="Tracked" value={String(status?.marketState.instrumentsTracked ?? 0)} />
          <Metric label="Rejected" value={String(status?.provider.rejectedSubscriptions ?? 0)} />
          <Metric
            label="Tick age"
            value={
              status?.freshness.lastTickAgeSeconds === null ||
              status?.freshness.lastTickAgeSeconds === undefined
                ? "Pending"
                : `${status.freshness.lastTickAgeSeconds}s`
            }
          />
          <Metric label="Start gate" value={canStart ? "Ready" : "Blocked"} />
        </div>

        <div className="grid gap-2">
          <Button
            type="button"
            disabled={!canStart || busy || connected}
            onClick={() => void runAction("start")}
          >
            <Power className="h-4 w-4" />
            Start Stream
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !status?.running}
            onClick={() => void runAction("stop")}
          >
            <WifiOff className="h-4 w-4" />
            Stop Stream
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void loadStatus()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {status?.subscribedInstruments.length ? (
          <div className="grid gap-1 text-xs text-muted-foreground">
            {status.subscribedInstruments.map((instrument) => (
              <div key={instrument.instrumentToken} className="flex justify-between gap-2">
                <span>{instrument.tradingsymbol}</span>
                <span>{instrument.mode}</span>
              </div>
            ))}
          </div>
        ) : null}

        {status?.safetyChecks.length ? (
          <div className="grid gap-2">
            {status.safetyChecks.map((check) => (
              <div
                key={check.key}
                className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border bg-muted/35 px-3 py-2 text-xs"
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{check.label}</span>
                  <span className="block text-muted-foreground">{check.message}</span>
                </span>
                <Badge variant={streamSafetyVariant(check.status)}>{check.status}</Badge>
              </div>
            ))}
          </div>
        ) : null}

        {message || status?.lastError ? (
          <p className="rounded-md border bg-yellow-50 p-2 text-xs font-medium text-yellow-950 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
            {message ?? status?.lastError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Phase2Pipeline({ snapshot }: { snapshot: SimulatedMarketSnapshot }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          Data Pipeline
        </CardTitle>
        <CardDescription>
          {snapshot.phase2.selectedUnderlying} {snapshot.phase2.selectedExpiry || "live expiry pending"}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="Instruments" value={formatNumber(snapshot.phase2.instrumentMasterCount)} />
          <Metric label="ATM strike" value={formatNumericString(snapshot.phase2.atmStrike)} />
          <Metric label="Option universe" value={formatNumber(snapshot.phase2.optionUniverseCount)} />
          <Metric label="State tracked" value={formatNumber(snapshot.phase2.trackedInstruments)} />
        </div>

        <div className="rounded-md border bg-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <CandlestickChart className="h-4 w-4 text-accent" />
              Active candles
            </p>
            <Badge variant={dataQualityVariant(snapshot.phase2.dataQuality)}>
              {snapshot.phase2.dataQuality.replace("_", " ")}
            </Badge>
          </div>
          <div className="grid gap-2">
            {snapshot.phase2.activeCandles.map((candle) => (
              <div
                key={`${candle.instrumentToken}-${candle.interval}`}
                className="grid grid-cols-[44px_1fr_auto] items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs"
              >
                <span className="font-semibold">{candle.interval}</span>
                <span className="text-muted-foreground">
                  O {candle.open} H {candle.high} L {candle.low} C {candle.close}
                </span>
                <span className="tabular-nums">{candle.tickCount} ticks</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-2 text-sm">
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <span className="text-muted-foreground">Missing contracts</span>
            <span className="font-semibold">{snapshot.phase2.missingContracts}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <span className="text-muted-foreground">Completed candles</span>
            <span className="font-semibold">{snapshot.phase2.completedCandleCount}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MarketCard({
  dataMode,
  underlying,
}: {
  dataMode: MarketDataMode;
  underlying: SimulatedUnderlying;
}) {
  const isLive = dataMode === "live";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{underlying.label}</CardTitle>
            <CardDescription>{underlying.symbol}</CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant={isLive ? "success" : "warning"}>
              {isLive ? "Live" : "Waiting"}
            </Badge>
            <Badge variant={regimeVariant(underlying.regime)}>{underlying.regime.replace("_", " ")}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              LTP
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatOptionalNumber(underlying.lastPrice)}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold text-emerald-700 dark:text-emerald-300">
              {formatOptionalSigned(underlying.change)}
            </p>
            <p className="text-muted-foreground">
              {formatOptionalSigned(underlying.changePercent, "%")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="VWAP" value={formatOptionalNumber(underlying.vwap)} />
          <Metric label="VWAP distance" value={formatOptionalSigned(underlying.vwapDistance)} />
          <Metric label="Trend" value={underlying.trend} />
          <Metric label="Rel volume" value={formatOptionalRatio(underlying.volumeRelative)} />
          <Metric label="OI" value={formatOptionalNumber(underlying.openInterest)} />
          <Metric label="OI change" value={formatOptionalSigned(underlying.oiChange)} />
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric
            label={isLive ? "Day low" : "Support"}
            value={formatOptionalNumber(underlying.support)}
          />
          <Metric
            label={isLive ? "Day high" : "Resistance"}
            value={formatOptionalNumber(underlying.resistance)}
          />
        </div>

        <Badge variant={dataQualityVariant(underlying.dataQuality)} className="w-fit">
          <Activity className="h-3.5 w-3.5" />
          Data quality: {underlying.dataQuality.replace("_", " ")}
        </Badge>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/35 px-3 py-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function OpportunityScanner({ snapshot }: { snapshot: SimulatedMarketSnapshot }) {
  const strategy = snapshot.phase6;
  const watchedOption = strategy.selectedContract?.label ?? "None";
  const watchedLevel = strategy.watchedLevel
    ? `${strategy.watchedLevel.label} ${formatIndicator(strategy.watchedLevel.value)}`
    : "None";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-accent" />
              Opportunity Scanner
            </CardTitle>
            <CardDescription>{snapshot.signal.setupName}</CardDescription>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant={strategyStateVariant(snapshot.signal.state)}>
              {snapshot.signal.direction}
            </Badge>
            <Badge variant={qualityVariant(strategy.quality)}>{strategy.quality}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Setup score</span>
            <span className="text-lg font-semibold tabular-nums">{strategy.score}/100</span>
          </div>
          <Progress value={strategy.score} />
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Metric label="Bias" value={strategy.bias} />
            <Metric label="State" value={strategy.state.replace("_", " ")} />
            <Metric label="Confirmed" value={strategy.direction === "NO TRADE" ? "No" : "Yes"} />
            <Metric label="Version" value={strategy.version} />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-semibold">Reasons</p>
            <ul className="grid gap-2 text-sm text-muted-foreground">
              {snapshot.signal.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-semibold">Risks</p>
            <ul className="grid gap-2 text-sm text-muted-foreground">
              {snapshot.signal.risks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          </div>
        </div>

        <StrategyComponentBreakdown components={strategy.components} />

        <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Watched level</span>
            <span className="text-right text-muted-foreground">{watchedLevel}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Watched option</span>
            <span className="text-right text-muted-foreground">{watchedOption}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Entry</span>
            <span className="text-right text-muted-foreground">
              {strategy.entryPlan ? strategy.entryPlan.entryTrigger : "Waiting for confirmed setup"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Risk/reward</span>
            <span className="text-right text-muted-foreground">
              {strategy.entryPlan ? strategy.entryPlan.riskReward : "Not valid"}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StrategyComponentBreakdown({ components }: { components: StrategyComponentScore[] }) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Score Components</p>
        <Badge variant="outline">
          {components.reduce((sum, item) => sum + item.points, 0)}/100
        </Badge>
      </div>
      <div className="grid gap-2">
        {components.map((item) => (
          <div
            key={item.key}
            className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border bg-muted/35 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{item.label}</p>
              <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={componentStatusVariant(item.status)}>{item.status}</Badge>
              <span className="w-12 text-right font-semibold tabular-nums">
                {item.points}/{item.maxPoints}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OptionChain({
  snapshot,
  selectedUnderlying,
  onSelectUnderlying,
}: {
  snapshot: SimulatedMarketSnapshot;
  selectedUnderlying: SimulatedUnderlying["symbol"];
  onSelectUnderlying: (symbol: SimulatedUnderlying["symbol"]) => void;
}) {
  const liquidityByStrike = useMemo(
    () => new Map(snapshot.phase5.rows.map((row) => [row.strike, row])),
    [snapshot.phase5.rows],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Option Chain
            </CardTitle>
            <CardDescription>
              {snapshot.health.mode === "live" ? "Nearest live expiry from Kite" : "Waiting for live expiry"}
            </CardDescription>
          </div>
          <div className="flex rounded-md border bg-muted/35 p-1">
            {snapshot.underlyings.map((underlying) => (
              <Button
                key={underlying.symbol}
                type="button"
                size="sm"
                variant={selectedUnderlying === underlying.symbol ? "default" : "ghost"}
                onClick={() => onSelectUnderlying(underlying.symbol)}
              >
                {underlying.symbol}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>CE LTP</TableHead>
              <TableHead>CE OI</TableHead>
              <TableHead>Strike</TableHead>
              <TableHead>PE OI</TableHead>
              <TableHead>PE LTP</TableHead>
              <TableHead>Liquidity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshot.optionChain.length ? (
              snapshot.optionChain.map((row) => {
              const contextRow = liquidityByStrike.get(row.strike);
              const callStatus = contextRow?.call.status ?? "NOT_TRADABLE";
              const putStatus = contextRow?.put.status ?? "NOT_TRADABLE";

              return (
                <TableRow key={row.strike} className={row.isAtm ? "bg-secondary/20" : undefined}>
                  <TableCell className="font-semibold tabular-nums">{formatInr(row.call.ltp)}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatNumber(row.call.openInterest)}
                    <span className="ml-1 text-xs text-emerald-700 dark:text-emerald-300">
                      {formatSigned(row.call.oiChange)}
                    </span>
                  </TableCell>
                  <TableCell className="font-semibold tabular-nums">
                    {formatNumber(row.strike)}
                    {row.isAtm ? <Badge className="ml-2" variant="secondary">ATM</Badge> : null}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatNumber(row.put.openInterest)}
                    <span className="ml-1 text-xs text-emerald-700 dark:text-emerald-300">
                      {formatSigned(row.put.oiChange)}
                    </span>
                  </TableCell>
                  <TableCell className="font-semibold tabular-nums">{formatInr(row.put.ltp)}</TableCell>
                  <TableCell>
                    <div className="flex min-w-[9rem] flex-col gap-1">
                      <Badge variant={liquidityVariant(callStatus)}>
                        CE {formatLiquidityStatus(callStatus)}
                      </Badge>
                      <Badge variant={liquidityVariant(putStatus)}>
                        PE {formatLiquidityStatus(putStatus)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        CE {row.call.spreadPercent}% / PE {row.put.spreadPercent}%
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Waiting for live option ticks.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RiskDashboard({
  dailyLossLimit,
  riskPlan,
  risk,
}: {
  dailyLossLimit: string;
  riskPlan: LiveRiskPlan | null;
  risk: typeof DEFAULT_RISK_CONFIGURATION;
}) {
  const perTradeRisk = (Number(risk.tradingCapital) * Number(risk.riskPerTradePercent)) / 100;
  const sizeAllowed = Boolean(riskPlan?.positionSize.canTrade && riskPlan.contractStatus === "TRADABLE");
  const positionMessage =
    riskPlan?.contractStatus === "NOT_TRADABLE"
      ? riskPlan.contractReason
      : riskPlan?.positionSize.reason;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-destructive" />
          Risk Dashboard
        </CardTitle>
        <CardDescription>Daily lock and live option sizing</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="Trading capital" value={formatInr(risk.tradingCapital)} />
          <Metric label="Risk per trade" value={`${risk.riskPerTradePercent}%`} />
          <Metric label="Daily loss limit" value={formatInr(dailyLossLimit)} />
          <Metric label="Max trades" value={String(risk.maximumTradesPerDay)} />
        </div>

        <div className="rounded-md border bg-muted/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">Live position size</p>
              <p className="break-words text-sm text-muted-foreground">
                {riskPlan ? riskPlan.contractLabel : "Waiting for a live selected option."}
              </p>
            </div>
            <Badge variant={sizeAllowed ? "success" : "muted"}>
              {riskPlan ? (sizeAllowed ? "SIZE OK" : "NO TRADE") : "WAITING"}
            </Badge>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {riskPlan ? (
              <>
                <Metric label="Entry" value={formatInr(riskPlan.entryPrice)} />
                <Metric label="Stop" value={formatInr(riskPlan.stopPrice)} />
                <Metric label="Lot size" value={String(riskPlan.lotSize)} />
              </>
            ) : null}
            <Metric
              label="Maximum risk"
              value={formatInr(riskPlan?.positionSize.maximumRisk ?? perTradeRisk)}
            />
            <Metric label="Quantity" value={riskPlan ? String(riskPlan.positionSize.quantity) : "Pending"} />
          </div>
          {positionMessage ? (
            <p className="mt-3 text-sm font-medium text-muted-foreground">{positionMessage}</p>
          ) : null}
          {!riskPlan ? (
            <p className="mt-3 text-sm font-medium text-muted-foreground">
              Live option LTP and lot size are required before sizing is shown.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function HistoricalOptionIngestionPanel() {
  const defaultStrikes = DEFAULT_HISTORICAL_OPTION_STRIKE_WINDOW * 2 + 1;
  const maximumContracts = (MAX_HISTORICAL_OPTION_STRIKE_WINDOW * 2 + 1) * 2;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CandlestickChart className="h-5 w-5 text-primary" />
              Option History
            </CardTitle>
            <CardDescription>Kite F&O candles for review runs</CardDescription>
          </div>
          <Badge variant="success">Phase 10</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="Default band" value={`${defaultStrikes} strikes`} />
          <Metric label="Max contracts" value={String(maximumContracts)} />
          <Metric label="Spread" value={`${DEFAULT_HISTORICAL_OPTION_SPREAD_PERCENT}%`} />
          <Metric label="Orders" value="Off" />
        </div>

        <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3 text-sm">
          <History className="mt-0.5 h-5 w-5 text-accent" />
          <div>
            <p className="font-semibold">Historical option candles ready</p>
            <p className="text-muted-foreground">Kept separate from live stream prices.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SystemHealth({ snapshot }: { snapshot: SimulatedMarketSnapshot }) {
  const rows = [
    ["WebSocket", formatHealthValue(snapshot.health.websocket)],
    ["Last tick", `${snapshot.health.lastTickSecondsAgo}s ago`],
    ["Subscriptions", String(snapshot.health.subscriptions)],
    ["Rejected", String(snapshot.health.rejectedSubscriptions)],
    ["Data quality", formatHealthValue(snapshot.health.dataQuality)],
    ["Signal engine", formatHealthValue(snapshot.health.signalEngine)],
    ["Database", formatHealthValue(snapshot.health.database)],
    ["Mode", formatHealthValue(snapshot.health.mode)],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5 text-accent" />
          System Health
        </CardTitle>
        <CardDescription>
          Generated {new Date(snapshot.generatedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="min-h-[72px] rounded-md border bg-muted/35 px-3 py-2.5 text-sm"
            >
              <p className="text-xs font-medium uppercase leading-snug text-muted-foreground">
                {label}
              </p>
              <p className="mt-1 break-words text-sm font-semibold leading-snug tabular-nums">
                {value}
              </p>
            </div>
          ))}
        </div>
        <div className="flex items-start gap-3 rounded-md border bg-yellow-50 p-3 text-sm text-yellow-950 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
          <WifiOff className="mt-0.5 h-5 w-5" />
          <div>
            <p className="font-semibold">Live stream disconnected</p>
            <p>Market-data pipeline is not connected.</p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-md border bg-red-50 p-3 text-sm text-red-950 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-100">
          <AlertTriangle className="mt-0.5 h-5 w-5" />
          <div>
            <p className="font-semibold">Live order execution disabled</p>
            <p>Read-only signals and paper trades only.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatHealthValue(value: string) {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
