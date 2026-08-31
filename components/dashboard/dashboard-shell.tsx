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
  Database,
  Filter,
  Gauge,
  History,
  Layers,
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
import { getMarketDataModeLabel } from "@/lib/config/market";
import {
  calculatePaperJournalSummary,
  canCreatePaperTrade,
  createJournalNoteFromSnapshot,
  createPaperTradeFromSnapshot,
  isPaperJournalEntry,
  MAX_PAPER_JOURNAL_ENTRIES,
  PAPER_JOURNAL_STORAGE_KEY,
  parsePaperJournalEntries,
  serializePaperJournalEntries,
} from "@/lib/paper-trading/journal";
import { DEFAULT_RISK_CONFIGURATION } from "@/lib/risk/defaults";
import { calculateDailyLossLimit, calculatePositionSize } from "@/lib/risk/position-sizing";
import { createSimulatedMarketSnapshot } from "@/lib/simulation/market-snapshot";
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
import type { PriceLevel } from "@/types/indicators";
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
  initialSnapshot: SimulatedMarketSnapshot;
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
  savedCount?: number;
  liveOrdersEnabled?: false;
  message?: string;
};

type BacktestSaveState = PersistenceUiState & {
  busy: boolean;
};

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

export function DashboardShell({
  initialBacktestResult,
  initialMultiDayBacktestResult,
  initialSnapshot,
}: DashboardShellProps) {
  const [step, setStep] = useState(0);
  const [selectedUnderlying, setSelectedUnderlying] = useState<SimulatedUnderlying["symbol"]>("NIFTY");

  useEffect(() => {
    const interval = window.setInterval(() => {
      setStep((currentStep) => currentStep + 1);
    }, 2000);

    return () => window.clearInterval(interval);
  }, []);

  const snapshot = useMemo(
    () => (step === 0 ? initialSnapshot : createSimulatedMarketSnapshot(step)),
    [initialSnapshot, step],
  );

  const mode = getMarketDataModeLabel(snapshot.health.mode);
  const risk = DEFAULT_RISK_CONFIGURATION;
  const positionSize = useMemo(
    () =>
      calculatePositionSize({
        tradingCapital: risk.tradingCapital,
        riskPerTradePercent: risk.riskPerTradePercent,
        entryPrice: "150",
        stopPrice: "140",
        lotSize: 75,
      }),
    [risk.riskPerTradePercent, risk.tradingCapital],
  );
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
          </div>
        </header>

        <section className="grid gap-3 lg:grid-cols-3">
          {snapshot.underlyings.map((underlying) => (
            <MarketCard key={underlying.symbol} underlying={underlying} />
          ))}
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <IndicatorContextPanel snapshot={snapshot} />
          <OpportunityScanner snapshot={snapshot} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
          <OptionChainContextPanel context={snapshot.phase5} />
          <OptionChain
            snapshot={snapshot}
            selectedUnderlying={selectedUnderlying}
            onSelectUnderlying={setSelectedUnderlying}
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <BacktestSummaryPanel result={initialBacktestResult} />
          <MultiDayBacktestPanel result={initialMultiDayBacktestResult} />
        </section>

        <section className="grid gap-4 xl:grid-cols-5">
          <RiskDashboard
            dailyLossLimit={dailyLossLimit}
            positionSize={positionSize}
            risk={risk}
          />
          <Phase2Pipeline snapshot={snapshot} />
          <LiveConnectionPanel />
          <HistoricalOptionIngestionPanel />
          <SystemHealth snapshot={snapshot} />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <PaperTradeJournal snapshot={snapshot} />

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
                  <p className="font-semibold">No confirmed signal</p>
                  <p className="text-sm text-muted-foreground">
                    Current state: {snapshot.signal.state}. Paper entry remains disabled.
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
          <div className="rounded-md border bg-yellow-50 p-3 text-sm font-medium text-yellow-950">
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
          <div className="rounded-md border bg-yellow-50 p-3 text-sm font-medium text-yellow-950">
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
        <p className="text-xs text-emerald-700">{formatSigned(leader.oiChange)}</p>
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
                <p className="text-xs text-emerald-700">{formatSigned(level.oiChange)}</p>
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

function LiveConnectionPanel() {
  const [status, setStatus] = useState<LiveKiteStreamSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/kite/stream", { cache: "no-store" });
    const data = (await response.json()) as LiveKiteStreamSnapshot;
    setStatus(data);
  }, []);

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
        setStatus(data.snapshot ?? null);
        setMessage(data.message ?? "Kite stream action failed.");
        return;
      }

      setStatus(data);
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

  const canStart = Boolean(status?.configured.apiKey && status.configured.accessToken);
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
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="Token" value={status?.configured.accessToken ? "Set" : "Missing"} />
          <Metric label="Subscribed" value={String(status?.provider.subscriptionCount ?? 0)} />
          <Metric label="Tracked" value={String(status?.marketState.instrumentsTracked ?? 0)} />
          <Metric label="Rejected" value={String(status?.provider.rejectedSubscriptions ?? 0)} />
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

        {message || status?.lastError ? (
          <p className="rounded-md border bg-yellow-50 p-2 text-xs font-medium text-yellow-950">
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
          {snapshot.phase2.selectedUnderlying} {snapshot.phase2.selectedExpiry}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="Instruments" value={formatNumber(snapshot.phase2.instrumentMasterCount)} />
          <Metric label="ATM strike" value={formatNumber(Number(snapshot.phase2.atmStrike))} />
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

function MarketCard({ underlying }: { underlying: SimulatedUnderlying }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{underlying.label}</CardTitle>
            <CardDescription>{underlying.symbol}</CardDescription>
          </div>
          <Badge variant={regimeVariant(underlying.regime)}>{underlying.regime.replace("_", " ")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">LTP</p>
            <p className="text-2xl font-semibold tabular-nums">{formatNumber(underlying.lastPrice)}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold text-emerald-700">
              {formatSigned(underlying.change)}
            </p>
            <p className="text-muted-foreground">
              {formatSigned(underlying.changePercent, "%")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="VWAP" value={formatNumber(underlying.vwap)} />
          <Metric label="VWAP distance" value={formatSigned(underlying.vwapDistance)} />
          <Metric label="Trend" value={underlying.trend} />
          <Metric label="Rel volume" value={`${underlying.volumeRelative}x`} />
          <Metric label="OI" value={formatNumber(underlying.openInterest)} />
          <Metric label="OI change" value={formatSigned(underlying.oiChange)} />
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="Support" value={formatNumber(underlying.support)} />
          <Metric label="Resistance" value={formatNumber(underlying.resistance)} />
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
            <CardDescription>Nearest expiry simulation</CardDescription>
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
            {snapshot.optionChain.map((row) => {
              const contextRow = liquidityByStrike.get(row.strike);
              const callStatus = contextRow?.call.status ?? "NOT_TRADABLE";
              const putStatus = contextRow?.put.status ?? "NOT_TRADABLE";

              return (
                <TableRow key={row.strike} className={row.isAtm ? "bg-secondary/20" : undefined}>
                  <TableCell className="font-semibold tabular-nums">{formatInr(row.call.ltp)}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatNumber(row.call.openInterest)}
                    <span className="ml-1 text-xs text-emerald-700">
                      {formatSigned(row.call.oiChange)}
                    </span>
                  </TableCell>
                  <TableCell className="font-semibold tabular-nums">
                    {formatNumber(row.strike)}
                    {row.isAtm ? <Badge className="ml-2" variant="secondary">ATM</Badge> : null}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatNumber(row.put.openInterest)}
                    <span className="ml-1 text-xs text-emerald-700">
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
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RiskDashboard({
  dailyLossLimit,
  positionSize,
  risk,
}: {
  dailyLossLimit: string;
  positionSize: ReturnType<typeof calculatePositionSize>;
  risk: typeof DEFAULT_RISK_CONFIGURATION;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-destructive" />
          Risk Dashboard
        </CardTitle>
        <CardDescription>Daily lock and position sizing</CardDescription>
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
              <p className="font-semibold">Position size check</p>
              <p className="text-sm text-muted-foreground">Entry 150, stop 140, lot size 75</p>
            </div>
            <Badge variant={positionSize.canTrade ? "success" : "muted"}>
              {positionSize.canTrade ? "TRADE ALLOWED" : "NO TRADE"}
            </Badge>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <Metric label="Maximum risk" value={formatInr(positionSize.maximumRisk)} />
            <Metric label="Quantity" value={String(positionSize.quantity)} />
          </div>
          {positionSize.reason ? (
            <p className="mt-3 text-sm font-medium text-muted-foreground">{positionSize.reason}</p>
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
            <CardDescription>Kite F&O candles for replay</CardDescription>
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
            <p className="font-semibold">Real option candles ready</p>
            <p className="text-muted-foreground">Bid/ask remains an explicit replay assumption.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SystemHealth({ snapshot }: { snapshot: SimulatedMarketSnapshot }) {
  const rows = [
    ["WebSocket", snapshot.health.websocket],
    ["Last tick", `${snapshot.health.lastTickSecondsAgo}s ago`],
    ["Subscriptions", String(snapshot.health.subscriptions)],
    ["Rejected", String(snapshot.health.rejectedSubscriptions)],
    ["Data quality", snapshot.health.dataQuality],
    ["Signal engine", snapshot.health.signalEngine],
    ["Database", snapshot.health.database],
    ["Mode", snapshot.health.mode.toUpperCase()],
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
            <div key={label} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-semibold tabular-nums">{value.replace("_", " ")}</span>
            </div>
          ))}
        </div>
        <div className="flex items-start gap-3 rounded-md border bg-yellow-50 p-3 text-sm text-yellow-950">
          <WifiOff className="mt-0.5 h-5 w-5" />
          <div>
            <p className="font-semibold">Live stream disconnected</p>
            <p>Market-data pipeline is not connected.</p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-md border bg-red-50 p-3 text-sm text-red-950">
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
