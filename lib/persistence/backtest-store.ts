import Decimal from "decimal.js";
import { BacktestStatus, Prisma, TradeSide, type PrismaClient } from "@prisma/client";
import {
  backtestReportRecordFromResult,
  filterBacktestReportRecords,
  type PersistableBacktestResult,
} from "@/lib/backtesting/backtest-reporting";
import { prisma } from "@/lib/data/prisma";
import {
  getOrCreateLocalTrader,
  isDatabasePersistenceConfigured,
} from "@/lib/persistence/local-user";
import type {
  BacktestEquityPoint,
  BacktestResult,
  BacktestSummary,
  BacktestTrade,
  MultiDayBacktestResult,
} from "@/types/backtest";
import type {
  BacktestReportAssumptions,
  BacktestReportDetail,
  BacktestReportDetailSession,
  BacktestReportDetailTrade,
  BacktestReportFilters,
  BacktestReportKind,
  BacktestReportRecord,
} from "@/types/backtest-report";

export type BacktestPersistenceRecord = BacktestReportRecord;

export type BacktestPersistenceResult = {
  persistence: {
    configured: boolean;
    status: "database" | "local_only" | "error";
    message: string;
  };
  backtest: BacktestPersistenceRecord | null;
  backtests: BacktestPersistenceRecord[];
  savedCount: number;
  liveOrdersEnabled: false;
};

export type BacktestDetailPersistenceResult = {
  persistence: BacktestPersistenceResult["persistence"];
  report: BacktestReportDetail | null;
  liveOrdersEnabled: false;
};

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;
type BacktestRowWithCount = Prisma.BacktestGetPayload<{
  include: { _count: { select: { trades: true } } };
}>;
type BacktestDetailRow = Prisma.BacktestGetPayload<{
  include: {
    _count: { select: { trades: true } };
    trades: true;
  };
}>;

function jsonClone(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function dateFromString(value: string | null | undefined) {
  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function expiryDate(value: string | null | undefined) {
  if (!value) return new Date("1970-01-01T00:00:00.000Z");

  const date = new Date(value.includes("T") ? value : `${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? new Date("1970-01-01T00:00:00.000Z") : date;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringField(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberField(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringOrNumberField(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "0.00";
}

function stringArrayField(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function decimalString(value: Prisma.Decimal | null, places = 2) {
  return value ? value.toFixed(places) : null;
}

function summaryValue(metrics: Prisma.JsonValue | null, key: string) {
  if (!isObject(metrics)) return "0.00";

  const summary = metrics.summary;

  if (!isObject(summary)) return "0.00";

  const value = summary[key];

  return typeof value === "string" || typeof value === "number" ? String(value) : "0.00";
}

function metadataValue(metrics: Prisma.JsonValue | null, key: string) {
  if (!isObject(metrics)) return null;

  const metadata = metrics.metadata;

  if (!isObject(metadata)) return null;

  return stringField(metadata[key]);
}

function backtestKindFromDatabase(
  row: Pick<BacktestRowWithCount, "assumptions" | "metrics">,
): BacktestReportKind {
  const assumptions = isObject(row.assumptions) ? row.assumptions : {};
  const assumptionKind = stringField(assumptions.kind);

  if (assumptionKind === "multi_day" || assumptionKind === "single_day") {
    return assumptionKind;
  }

  const metadata = isObject(row.metrics) && isObject(row.metrics.metadata) ? row.metrics.metadata : {};

  return metadata.sessionCount ? "multi_day" : "single_day";
}

function summaryObject(metrics: Prisma.JsonValue | null): BacktestSummary {
  const summary = isObject(metrics) && isObject(metrics.summary) ? metrics.summary : {};

  return {
    evaluatedSignals: numberField(summary.evaluatedSignals),
    confirmedSignals: numberField(summary.confirmedSignals),
    skippedSignals: numberField(summary.skippedSignals),
    trades: numberField(summary.trades),
    wins: numberField(summary.wins),
    losses: numberField(summary.losses),
    flats: numberField(summary.flats),
    winRate: stringOrNumberField(summary.winRate),
    grossPnl: stringOrNumberField(summary.grossPnl),
    costs: stringOrNumberField(summary.costs),
    netPnl: stringOrNumberField(summary.netPnl),
    averageWin: stringOrNumberField(summary.averageWin),
    averageLoss: stringOrNumberField(summary.averageLoss),
    largestWin: stringOrNumberField(summary.largestWin),
    largestLoss: stringOrNumberField(summary.largestLoss),
    expectancy: stringOrNumberField(summary.expectancy),
    profitFactor:
      typeof summary.profitFactor === "string" || typeof summary.profitFactor === "number"
        ? String(summary.profitFactor)
        : null,
    maxDrawdown: stringOrNumberField(summary.maxDrawdown),
    liveOrdersEnabled: false,
  };
}

function equityCurveFromMetrics(metrics: Prisma.JsonValue | null): BacktestEquityPoint[] {
  const equityCurve = isObject(metrics) ? metrics.equityCurve : null;

  if (!Array.isArray(equityCurve)) return [];

  return equityCurve.flatMap((point) => {
    if (!isObject(point)) return [];

    const timestamp = stringField(point.timestamp);
    const tradeId = stringField(point.tradeId);
    const equity = stringField(point.equity);
    const drawdown = stringField(point.drawdown);

    if (!timestamp || !tradeId || !equity || !drawdown) return [];

    return [{ timestamp, tradeId, equity, drawdown }];
  });
}

function sessionsFromMetrics(metrics: Prisma.JsonValue | null): BacktestReportDetailSession[] {
  const sessions = isObject(metrics) ? metrics.sessions : null;

  if (!Array.isArray(sessions)) return [];

  return sessions.flatMap((session) => {
    if (!isObject(session)) return [];

    const summary = isObject(session.summary) ? session.summary : {};
    const id = stringField(session.id);
    const date = stringField(session.date);
    const label = stringField(session.label);

    if (!id || !date || !label) return [];

    return [
      {
        id,
        date,
        label,
        trades: numberField(summary.trades),
        netPnl: stringOrNumberField(summary.netPnl),
        winRate: stringOrNumberField(summary.winRate),
        maxDrawdown: stringOrNumberField(summary.maxDrawdown),
        warnings: stringArrayField(session.warnings),
        liveOrdersEnabled: false,
      },
    ];
  });
}

function assumptionsObject(
  row: Pick<BacktestDetailRow, "assumptions" | "metrics">,
): BacktestReportAssumptions {
  const assumptions = isObject(row.assumptions) ? row.assumptions : {};
  const metadata = isObject(row.metrics) && isObject(row.metrics.metadata) ? row.metrics.metadata : {};
  const kindValue = stringField(assumptions.kind);
  const kind: BacktestReportKind = kindValue === "multi_day" ? "multi_day" : "single_day";

  return {
    kind,
    dataSource:
      stringField(assumptions.dataSource) ?? stringField(metadata.dataSource) ?? "USER_SUPPLIED",
    slippagePercent: stringField(assumptions.slippagePercent),
    brokeragePerOrder: stringField(assumptions.brokeragePerOrder),
    warnings: stringArrayField(assumptions.warnings),
    liveOrdersEnabled: false,
  };
}

function kindForResult(result: PersistableBacktestResult): BacktestReportKind {
  return "sessions" in result ? "multi_day" : "single_day";
}

function hasBacktestSessions(result: PersistableBacktestResult): result is MultiDayBacktestResult {
  return "sessions" in result;
}

function tradeSide(side: BacktestTrade["optionSide"]) {
  return side === "CE" ? TradeSide.LONG_CALL : TradeSide.LONG_PUT;
}

function rMultiple(returnOnRisk: string | null) {
  return returnOnRisk ? new Decimal(returnOnRisk).div(100).toFixed(4) : null;
}

function expiryForTrade(result: PersistableBacktestResult, trade: BacktestTrade) {
  if (!hasBacktestSessions(result)) {
    return result.metadata.expiry;
  }

  const signalTime = dateFromString(trade.signalTime)?.getTime();
  const session = result.sessions.find((item) => {
    const startedAt = dateFromString(item.metadata.startedAt)?.getTime();
    const endedAt = dateFromString(item.metadata.endedAt)?.getTime();

    return (
      signalTime !== undefined &&
      startedAt !== undefined &&
      endedAt !== undefined &&
      signalTime >= startedAt &&
      signalTime <= endedAt
    );
  });

  return session?.metadata.expiry ?? result.sessions[0]?.metadata.expiry ?? null;
}

export const backtestRecordFromResult = backtestReportRecordFromResult;

function disabledPersistence(backtest: BacktestPersistenceRecord | null = null): BacktestPersistenceResult {
  return {
    persistence: {
      configured: false,
      status: "local_only",
      message: "Database is not configured. Backtests remain visible in the current app session only.",
    },
    backtest,
    backtests: backtest ? [backtest] : [],
    savedCount: 0,
    liveOrdersEnabled: false,
  };
}

function backtestTradeData(result: PersistableBacktestResult, trade: BacktestTrade) {
  return {
    id: `${result.metadata.id}-${trade.id}`,
    signalTimestamp: dateFromString(trade.signalTime) ?? new Date("1970-01-01T00:00:00.000Z"),
    entryTimestamp: dateFromString(trade.entryTime) ?? new Date("1970-01-01T00:00:00.000Z"),
    exitTimestamp: dateFromString(trade.exitTime),
    underlying: trade.underlying,
    optionSymbol: trade.optionSymbol,
    strike: String(trade.strike),
    expiry: expiryDate(expiryForTrade(result, trade)),
    side: tradeSide(trade.optionSide),
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    stopPrice: trade.stopPrice,
    targetOne: trade.targetOne,
    targetTwo: trade.targetTwo,
    quantity: trade.quantity,
    slippage: !hasBacktestSessions(result) ? result.metadata.slippagePercent : null,
    transactionCost: trade.costs,
    realizedPnl: trade.netPnl,
    rMultiple: rMultiple(trade.returnOnRisk),
    marketRegime: "BACKTEST_REPLAY",
    score: trade.score,
    outcome: trade.outcome,
    snapshot: jsonClone(trade),
  };
}

async function getOrCreateBacktestStrategy({
  client,
  result,
}: {
  client: Prisma.TransactionClient;
  result: PersistableBacktestResult;
}) {
  const strategy = await client.strategy.upsert({
    where: {
      name_version: {
        name: result.metadata.strategyName,
        version: result.metadata.strategyVersion,
      },
    },
    create: {
      name: result.metadata.strategyName,
      version: result.metadata.strategyVersion,
      description: "Persisted read-only backtest strategy.",
      active: true,
    },
    update: {
      active: true,
    },
  });
  const configVersion = `${result.metadata.strategyVersion}-phase-11`;
  const configuration = await client.strategyConfiguration.upsert({
    where: {
      strategyId_version: {
        strategyId: strategy.id,
        version: configVersion,
      },
    },
    create: {
      strategyId: strategy.id,
      version: configVersion,
      config: jsonClone({
        source: "persisted_backtest",
        dataSource: result.metadata.dataSource,
        liveOrdersEnabled: false,
      }),
    },
    update: {
      config: jsonClone({
        source: "persisted_backtest",
        dataSource: result.metadata.dataSource,
        liveOrdersEnabled: false,
      }),
    },
  });

  return { strategy, configuration };
}

export function isBacktestResult(value: unknown): value is BacktestResult {
  if (!isObject(value)) return false;
  const metadata = value.metadata;
  const summary = value.summary;

  return (
    isObject(metadata) &&
    isObject(summary) &&
    typeof metadata.id === "string" &&
    typeof metadata.name === "string" &&
    typeof metadata.strategyName === "string" &&
    typeof metadata.strategyVersion === "string" &&
    Array.isArray(value.trades) &&
    Array.isArray(value.equityCurve) &&
    Array.isArray(value.warnings) &&
    !Array.isArray(value.sessions)
  );
}

export function isMultiDayBacktestResult(value: unknown): value is MultiDayBacktestResult {
  if (!isObject(value)) return false;
  const metadata = value.metadata;
  const summary = value.summary;

  return (
    isObject(metadata) &&
    isObject(summary) &&
    typeof metadata.id === "string" &&
    typeof metadata.name === "string" &&
    typeof metadata.strategyName === "string" &&
    typeof metadata.strategyVersion === "string" &&
    Array.isArray(value.sessions) &&
    Array.isArray(value.trades) &&
    Array.isArray(value.equityCurve) &&
    Array.isArray(value.warnings)
  );
}

export function backtestRecordFromDatabase(row: BacktestRowWithCount): BacktestPersistenceRecord {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    kind: backtestKindFromDatabase(row),
    underlying: metadataValue(row.metrics, "underlying") ?? "NIFTY",
    dataSource: metadataValue(row.metrics, "dataSource") ?? "USER_SUPPLIED",
    startedAt: row.trainingStart?.toISOString() ?? null,
    endedAt: row.trainingEnd?.toISOString() ?? null,
    trades: row._count.trades,
    netPnl: summaryValue(row.metrics, "netPnl"),
    winRate: summaryValue(row.metrics, "winRate"),
    maxDrawdown: summaryValue(row.metrics, "maxDrawdown"),
    savedAt: row.updatedAt.toISOString(),
    liveOrdersEnabled: false,
  };
}

export function backtestReportDetailFromDatabase(row: BacktestDetailRow): BacktestReportDetail {
  return {
    record: backtestRecordFromDatabase(row),
    summary: summaryObject(row.metrics),
    assumptions: assumptionsObject(row),
    sessions: sessionsFromMetrics(row.metrics),
    trades: row.trades.map((trade): BacktestReportDetailTrade => ({
      id: trade.id,
      signalTime: trade.signalTimestamp.toISOString(),
      entryTime: trade.entryTimestamp.toISOString(),
      exitTime: trade.exitTimestamp?.toISOString() ?? null,
      underlying: trade.underlying,
      optionSymbol: trade.optionSymbol,
      side: trade.side,
      strike: trade.strike.toFixed(2),
      expiry: trade.expiry.toISOString(),
      quantity: trade.quantity,
      entryPrice: trade.entryPrice.toFixed(2),
      exitPrice: decimalString(trade.exitPrice),
      stopPrice: trade.stopPrice.toFixed(2),
      targetOne: decimalString(trade.targetOne),
      targetTwo: decimalString(trade.targetTwo),
      transactionCost: decimalString(trade.transactionCost),
      realizedPnl: decimalString(trade.realizedPnl),
      rMultiple: decimalString(trade.rMultiple, 4),
      score: trade.score,
      outcome: trade.outcome,
      liveOrdersEnabled: false,
    })),
    equityCurve: equityCurveFromMetrics(row.metrics),
    liveOrdersEnabled: false,
  };
}

export async function listPersistedBacktests({
  client = prisma,
  filters,
  limit = 20,
}: {
  client?: PrismaExecutor;
  filters?: BacktestReportFilters;
  limit?: number;
} = {}): Promise<BacktestPersistenceResult> {
  if (!isDatabasePersistenceConfigured()) {
    return disabledPersistence();
  }

  const user = await getOrCreateLocalTrader(client);
  const rows = await client.backtest.findMany({
    where: {
      userId: user.id,
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 50,
    include: {
      _count: {
        select: {
          trades: true,
        },
      },
    },
  });
  const filteredBacktests = filterBacktestReportRecords(rows.map(backtestRecordFromDatabase), filters);
  const backtests = filteredBacktests.slice(0, Math.min(Math.max(limit, 1), 50));

  return {
    persistence: {
      configured: true,
      status: "database",
      message: "Backtest runs are saved to PostgreSQL.",
    },
    backtest: backtests[0] ?? null,
    backtests,
    savedCount: backtests.length,
    liveOrdersEnabled: false,
  };
}

export async function getPersistedBacktestDetail({
  client = prisma,
  id,
}: {
  client?: PrismaExecutor;
  id: string;
}): Promise<BacktestDetailPersistenceResult> {
  if (!isDatabasePersistenceConfigured()) {
    return {
      persistence: {
        configured: false,
        status: "local_only",
        message: "Database is not configured. Saved report links are unavailable.",
      },
      report: null,
      liveOrdersEnabled: false,
    };
  }

  const user = await getOrCreateLocalTrader(client);
  const row = await client.backtest.findFirst({
    where: {
      id,
      userId: user.id,
    },
    include: {
      _count: {
        select: {
          trades: true,
        },
      },
      trades: {
        orderBy: {
          entryTimestamp: "asc",
        },
      },
    },
  });

  return {
    persistence: {
      configured: true,
      status: "database",
      message: row
        ? "Backtest report loaded from PostgreSQL."
        : "No saved backtest report was found for this link.",
    },
    report: row ? backtestReportDetailFromDatabase(row) : null,
    liveOrdersEnabled: false,
  };
}

export async function persistBacktestResult({
  client = prisma,
  result,
}: {
  client?: PrismaClient;
  result: PersistableBacktestResult;
}): Promise<BacktestPersistenceResult> {
  const fallbackRecord = backtestReportRecordFromResult(result);

  if (!isDatabasePersistenceConfigured()) {
    return disabledPersistence(fallbackRecord);
  }

  let savedRecord: BacktestPersistenceRecord | null = null;

  await client.$transaction(async (transaction) => {
    const user = await getOrCreateLocalTrader(transaction);
    const { strategy, configuration } = await getOrCreateBacktestStrategy({
      client: transaction,
      result,
    });
    const saved = await transaction.backtest.upsert({
      where: {
        id: result.metadata.id,
      },
      create: {
        id: result.metadata.id,
        userId: user.id,
        strategyId: strategy.id,
        strategyConfigurationId: configuration.id,
        name: result.metadata.name,
        status: BacktestStatus.COMPLETED,
        trainingStart: dateFromString(result.metadata.startedAt),
        trainingEnd: dateFromString(result.metadata.endedAt),
        assumptions: jsonClone({
          kind: kindForResult(result),
          dataSource: result.metadata.dataSource,
          slippagePercent: "slippagePercent" in result.metadata ? result.metadata.slippagePercent : null,
          brokeragePerOrder: "brokeragePerOrder" in result.metadata ? result.metadata.brokeragePerOrder : null,
          warnings: result.warnings,
          liveOrdersEnabled: false,
        }),
        metrics: jsonClone({
          metadata: result.metadata,
          summary: result.summary,
          equityCurve: result.equityCurve,
          sessions: "sessions" in result ? result.sessions : [],
        }),
      },
      update: {
        userId: user.id,
        strategyId: strategy.id,
        strategyConfigurationId: configuration.id,
        name: result.metadata.name,
        status: BacktestStatus.COMPLETED,
        trainingStart: dateFromString(result.metadata.startedAt),
        trainingEnd: dateFromString(result.metadata.endedAt),
        assumptions: jsonClone({
          kind: kindForResult(result),
          dataSource: result.metadata.dataSource,
          slippagePercent: "slippagePercent" in result.metadata ? result.metadata.slippagePercent : null,
          brokeragePerOrder: "brokeragePerOrder" in result.metadata ? result.metadata.brokeragePerOrder : null,
          warnings: result.warnings,
          liveOrdersEnabled: false,
        }),
        metrics: jsonClone({
          metadata: result.metadata,
          summary: result.summary,
          equityCurve: result.equityCurve,
          sessions: "sessions" in result ? result.sessions : [],
        }),
      },
      include: {
        _count: {
          select: {
            trades: true,
          },
        },
      },
    });

    await transaction.backtestTrade.deleteMany({
      where: {
        backtestId: saved.id,
      },
    });

    if (result.trades.length) {
      await transaction.backtestTrade.createMany({
        data: result.trades.map((trade) => ({
          ...backtestTradeData(result, trade),
          backtestId: saved.id,
        })),
      });
    }

    savedRecord = {
      ...backtestRecordFromDatabase(saved),
      trades: result.trades.length,
      savedAt: new Date().toISOString(),
    };
  });

  const list = await listPersistedBacktests({
    client,
  });

  return {
    ...list,
    backtest: savedRecord,
    savedCount: 1,
  };
}
