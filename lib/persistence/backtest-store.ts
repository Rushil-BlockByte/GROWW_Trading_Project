import Decimal from "decimal.js";
import { BacktestStatus, Prisma, TradeSide, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/data/prisma";
import {
  getOrCreateLocalTrader,
  isDatabasePersistenceConfigured,
} from "@/lib/persistence/local-user";
import type { BacktestResult, BacktestTrade, MultiDayBacktestResult } from "@/types/backtest";

export type PersistableBacktestResult = BacktestResult | MultiDayBacktestResult;

export type BacktestPersistenceRecord = {
  id: string;
  name: string;
  status: string;
  kind: "single_day" | "multi_day";
  underlying: string;
  dataSource: string;
  startedAt: string | null;
  endedAt: string | null;
  trades: number;
  netPnl: string;
  winRate: string;
  maxDrawdown: string;
  savedAt: string;
  liveOrdersEnabled: false;
};

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

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

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

function kindForResult(result: PersistableBacktestResult): BacktestPersistenceRecord["kind"] {
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

export function backtestRecordFromResult(
  result: PersistableBacktestResult,
  savedAt = new Date(),
): BacktestPersistenceRecord {
  return {
    id: result.metadata.id,
    name: result.metadata.name,
    status: "COMPLETED",
    kind: kindForResult(result),
    underlying: result.metadata.underlying,
    dataSource: result.metadata.dataSource,
    startedAt: result.metadata.startedAt || null,
    endedAt: result.metadata.endedAt || null,
    trades: result.summary.trades,
    netPnl: result.summary.netPnl,
    winRate: result.summary.winRate,
    maxDrawdown: result.summary.maxDrawdown,
    savedAt: savedAt.toISOString(),
    liveOrdersEnabled: false,
  };
}

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

export function backtestRecordFromDatabase(
  row: Prisma.BacktestGetPayload<{ include: { _count: { select: { trades: true } } } }>,
): BacktestPersistenceRecord {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    kind: metadataValue(row.metrics, "sessionCount") ? "multi_day" : "single_day",
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

export async function listPersistedBacktests({
  client = prisma,
  limit = 20,
}: {
  client?: PrismaExecutor;
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
    take: Math.min(Math.max(limit, 1), 50),
    include: {
      _count: {
        select: {
          trades: true,
        },
      },
    },
  });
  const backtests = rows.map(backtestRecordFromDatabase);

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

export async function persistBacktestResult({
  client = prisma,
  result,
}: {
  client?: PrismaClient;
  result: PersistableBacktestResult;
}): Promise<BacktestPersistenceResult> {
  const fallbackRecord = backtestRecordFromResult(result);

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
