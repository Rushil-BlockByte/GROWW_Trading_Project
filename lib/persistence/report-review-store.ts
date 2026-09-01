import { Prisma, type PrismaClient } from "@prisma/client";
import { summarizeBacktestReportRecords } from "@/lib/backtesting/backtest-reporting";
import { prisma } from "@/lib/data/prisma";
import {
  backtestRecordFromDatabase,
  type BacktestPersistenceRecord,
} from "@/lib/persistence/backtest-store";
import {
  getOrCreateLocalTrader,
  isDatabasePersistenceConfigured,
} from "@/lib/persistence/local-user";
import type {
  ReportReviewCadence,
  ReportReviewComparison,
  ReportReviewInput,
  ReportReviewPersistenceResult,
  ReportReviewRecord,
} from "@/types/report-review";

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;
type ReportReviewRow = Prisma.ReportReviewGetPayload<Record<string, never>>;
type BacktestRowWithCount = Prisma.BacktestGetPayload<{
  include: { _count: { select: { trades: true } } };
}>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function jsonClone(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function stringArrayField(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseReviewCadence(value: unknown): ReportReviewCadence | null {
  return value === "daily" || value === "weekly" ? value : null;
}

function dateFromInput(value: string) {
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Review period date is invalid.");
  }

  return date;
}

function normalizeReviewInput(input: ReportReviewInput) {
  const cadence = parseReviewCadence(input.cadence);
  const title = input.title.trim();
  const notes = input.notes.trim();
  const periodStart = dateFromInput(input.periodStart);
  const periodEnd = dateFromInput(input.periodEnd);
  const reportIds = Array.from(new Set(input.reportIds.filter(Boolean))).slice(0, 20);

  if (!cadence) {
    throw new Error("Review cadence must be daily or weekly.");
  }

  if (!title) {
    throw new Error("Review title is required.");
  }

  if (!notes) {
    throw new Error("Review notes are required.");
  }

  if (periodEnd.getTime() < periodStart.getTime()) {
    throw new Error("Review period end cannot be before start.");
  }

  return {
    cadence,
    periodStart,
    periodEnd,
    title,
    notes,
    reportIds,
  };
}

function emptyComparison(changedSincePrevious: string[] = []): ReportReviewComparison {
  return {
    reportCount: 0,
    trades: 0,
    winningRuns: 0,
    losingRuns: 0,
    flatRuns: 0,
    netPnl: "0.00",
    averageWinRate: "0.00",
    maxDrawdown: "0.00",
    bestRun: null,
    worstRun: null,
    changedSincePrevious,
    liveOrdersEnabled: false,
  };
}

export function buildReportReviewComparison({
  previous,
  reports,
}: {
  previous?: ReportReviewRecord | null;
  reports: BacktestPersistenceRecord[];
}): ReportReviewComparison {
  if (!reports.length) {
    return emptyComparison(["No saved reports were selected for this review."]);
  }

  const summary = summarizeBacktestReportRecords(reports);
  const changedSincePrevious = previous
    ? [
        `Net P&L moved from ${previous.comparison.netPnl} to ${summary.netPnl}.`,
        `Average win rate moved from ${previous.comparison.averageWinRate}% to ${summary.averageWinRate}%.`,
        `Report count moved from ${previous.comparison.reportCount} to ${summary.runCount}.`,
      ]
    : ["First saved review for this cadence."];

  return {
    reportCount: summary.runCount,
    trades: summary.trades,
    winningRuns: summary.winningRuns,
    losingRuns: summary.losingRuns,
    flatRuns: summary.flatRuns,
    netPnl: summary.netPnl,
    averageWinRate: summary.averageWinRate,
    maxDrawdown: summary.maxDrawdown,
    bestRun: summary.bestRun,
    worstRun: summary.worstRun,
    changedSincePrevious,
    liveOrdersEnabled: false,
  };
}

function comparisonFromJson(value: Prisma.JsonValue): ReportReviewComparison {
  if (!isObject(value)) return emptyComparison();

  return {
    ...emptyComparison(stringArrayField(value.changedSincePrevious)),
    reportCount: typeof value.reportCount === "number" ? value.reportCount : 0,
    trades: typeof value.trades === "number" ? value.trades : 0,
    winningRuns: typeof value.winningRuns === "number" ? value.winningRuns : 0,
    losingRuns: typeof value.losingRuns === "number" ? value.losingRuns : 0,
    flatRuns: typeof value.flatRuns === "number" ? value.flatRuns : 0,
    netPnl: typeof value.netPnl === "string" ? value.netPnl : "0.00",
    averageWinRate:
      typeof value.averageWinRate === "string" ? value.averageWinRate : "0.00",
    maxDrawdown: typeof value.maxDrawdown === "string" ? value.maxDrawdown : "0.00",
    bestRun: isObject(value.bestRun)
      ? (value.bestRun as unknown as BacktestPersistenceRecord)
      : null,
    worstRun: isObject(value.worstRun)
      ? (value.worstRun as unknown as BacktestPersistenceRecord)
      : null,
    liveOrdersEnabled: false,
  };
}

function reviewRecordFromDatabase(row: ReportReviewRow): ReportReviewRecord {
  const cadence = parseReviewCadence(row.cadence) ?? "daily";

  return {
    id: row.id,
    cadence,
    periodStart: row.periodStart.toISOString().slice(0, 10),
    periodEnd: row.periodEnd.toISOString().slice(0, 10),
    title: row.title,
    notes: row.notes,
    reportIds: stringArrayField(row.selectedReportIds),
    comparison: comparisonFromJson(row.comparison),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    liveOrdersEnabled: false,
  };
}

function disabledPersistence(): ReportReviewPersistenceResult {
  return {
    persistence: {
      configured: false,
      status: "local_only",
      message: "Database is not configured. Reviews can be drafted but not saved.",
    },
    review: null,
    reviews: [],
    savedCount: 0,
    liveOrdersEnabled: false,
  };
}

export function isReportReviewInput(value: unknown): value is ReportReviewInput {
  if (!isObject(value)) return false;

  return (
    parseReviewCadence(value.cadence) !== null &&
    typeof value.periodStart === "string" &&
    typeof value.periodEnd === "string" &&
    typeof value.title === "string" &&
    typeof value.notes === "string" &&
    Array.isArray(value.reportIds)
  );
}

async function reportsForIds({
  client,
  reportIds,
  userId,
}: {
  client: PrismaExecutor;
  reportIds: string[];
  userId: string;
}) {
  if (!reportIds.length) return [];

  const rows = await client.backtest.findMany({
    where: {
      id: {
        in: reportIds,
      },
      userId,
    },
    include: {
      _count: {
        select: {
          trades: true,
        },
      },
    },
  });
  const byId = new Map<string, BacktestRowWithCount>(
    rows.map((row) => [row.id, row]),
  );

  return reportIds.flatMap((id) => {
    const row = byId.get(id);

    return row ? [backtestRecordFromDatabase(row)] : [];
  });
}

export async function listReportReviews({
  client = prisma,
  limit = 10,
}: {
  client?: PrismaExecutor;
  limit?: number;
} = {}): Promise<ReportReviewPersistenceResult> {
  if (!isDatabasePersistenceConfigured()) {
    return disabledPersistence();
  }

  const user = await getOrCreateLocalTrader(client);
  const reviews = await client.reportReview.findMany({
    where: {
      userId: user.id,
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: Math.min(Math.max(limit, 1), 50),
  });
  const records = reviews.map(reviewRecordFromDatabase);

  return {
    persistence: {
      configured: true,
      status: "database",
      message: "Report reviews are saved to PostgreSQL.",
    },
    review: records[0] ?? null,
    reviews: records,
    savedCount: records.length,
    liveOrdersEnabled: false,
  };
}

export async function persistReportReview({
  client = prisma,
  input,
}: {
  client?: PrismaClient;
  input: ReportReviewInput;
}): Promise<ReportReviewPersistenceResult> {
  if (!isDatabasePersistenceConfigured()) {
    return disabledPersistence();
  }

  const normalized = normalizeReviewInput(input);
  let savedReview: ReportReviewRecord | null = null;

  await client.$transaction(async (transaction) => {
    const user = await getOrCreateLocalTrader(transaction);
    const previous = await transaction.reportReview.findFirst({
      where: {
        userId: user.id,
        cadence: normalized.cadence,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });
    const reports = await reportsForIds({
      client: transaction,
      reportIds: normalized.reportIds,
      userId: user.id,
    });
    const comparison = buildReportReviewComparison({
      previous: previous ? reviewRecordFromDatabase(previous) : null,
      reports,
    });
    const saved = await transaction.reportReview.create({
      data: {
        userId: user.id,
        cadence: normalized.cadence,
        periodStart: normalized.periodStart,
        periodEnd: normalized.periodEnd,
        title: normalized.title,
        notes: normalized.notes,
        selectedReportIds: jsonClone(normalized.reportIds),
        comparison: jsonClone(comparison),
      },
    });

    savedReview = reviewRecordFromDatabase(saved);
  });

  const list = await listReportReviews({
    client,
  });

  return {
    ...list,
    review: savedReview,
    savedCount: 1,
  };
}
