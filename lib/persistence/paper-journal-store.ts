import {
  PaperTradeStatus,
  Prisma,
  TradeSide,
  type PrismaClient,
} from "@prisma/client";
import { calculatePaperJournalSummary, MAX_PAPER_JOURNAL_ENTRIES } from "@/lib/paper-trading/journal";
import {
  getOrCreateLocalTrader,
  isDatabasePersistenceConfigured,
} from "@/lib/persistence/local-user";
import { prisma } from "@/lib/data/prisma";
import type { PaperJournalEntry } from "@/types/paper-trading";

export type PaperJournalPersistenceStatus = {
  configured: boolean;
  status: "database" | "local_only" | "error";
  message: string;
};

export type PaperJournalPersistenceResult = {
  persistence: PaperJournalPersistenceStatus;
  entries: PaperJournalEntry[];
  summary: ReturnType<typeof calculatePaperJournalSummary>;
  savedCount: number;
  liveOrdersEnabled: false;
};

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

function disabledPersistence(entries: PaperJournalEntry[] = []): PaperJournalPersistenceResult {
  return {
    persistence: {
      configured: false,
      status: "local_only",
      message: "Database is not configured. The journal is saved in this browser only.",
    },
    entries,
    summary: calculatePaperJournalSummary(entries),
    savedCount: 0,
    liveOrdersEnabled: false,
  };
}

function jsonClone(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === "string");
}

function toDate(value: string | null) {
  if (!value) return null;

  const date = new Date(value.includes("T") ? value : `${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}

function toRequiredDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Journal entry date is invalid.");
  }

  return date;
}

function decimalString(value: Prisma.Decimal | null, places = 2) {
  return value ? value.toFixed(places) : null;
}

function paperTradeStatus(status: PaperJournalEntry["status"]) {
  if (status === "CLOSED") return PaperTradeStatus.CLOSED;
  if (status === "CANCELLED") return PaperTradeStatus.CANCELLED;

  return PaperTradeStatus.OPEN;
}

function paperTradeSide(side: PaperJournalEntry["tradeSide"]) {
  if (side === "LONG_CALL") return TradeSide.LONG_CALL;
  if (side === "LONG_PUT") return TradeSide.LONG_PUT;

  return null;
}

function paperTradePayload(entry: PaperJournalEntry) {
  return {
    text: entry.notes,
    sourceJournalEntryId: entry.id,
    sourceSignalId: entry.signalId,
    signalState: entry.signalState,
    quality: entry.quality,
    ruleViolations: entry.ruleViolations,
  };
}

export function canPersistStructuredPaperTrade(entry: PaperJournalEntry) {
  return Boolean(
    entry.type === "PAPER_TRADE" &&
      entry.optionSymbol &&
      entry.tradeSide &&
      entry.strike !== null &&
      entry.expiry &&
      entry.entryPrice &&
      entry.stopPrice,
  );
}

function structuredPaperTradeData(entry: PaperJournalEntry, userId: string) {
  const side = paperTradeSide(entry.tradeSide);
  const expiry = toDate(entry.expiry);

  if (!side || entry.strike === null || !expiry || !entry.optionSymbol || !entry.entryPrice || !entry.stopPrice) {
    throw new Error("Paper trade entry is missing required trade fields.");
  }

  return {
    userId,
    signalId: null,
    tradingSessionId: null,
    underlying: entry.underlying,
    optionSymbol: entry.optionSymbol,
    strike: String(entry.strike),
    expiry,
    side,
    entryPrice: entry.entryPrice,
    stopPrice: entry.stopPrice,
    targetOne: entry.targetOne,
    targetTwo: entry.targetTwo,
    quantity: entry.quantity,
    lots: entry.lots,
    status: paperTradeStatus(entry.status),
    score: entry.score,
    marketRegime: entry.marketRegime,
    reasons: jsonClone(entry.reasons),
    notes: jsonClone(paperTradePayload(entry)),
    realizedPnl: entry.realizedPnl,
    unrealizedPnl: entry.unrealizedPnl,
    openedAt: toRequiredDate(entry.createdAt),
    closedAt: entry.status === "CLOSED" ? toRequiredDate(entry.updatedAt) : null,
  };
}

export function paperJournalEntryPersistenceData({
  entry,
  paperTradeId,
  userId,
}: {
  entry: PaperJournalEntry;
  paperTradeId: string | null;
  userId: string;
}) {
  return {
    id: entry.id,
    userId,
    paperTradeId,
    type: entry.type,
    status: entry.status,
    signalId: entry.signalId,
    strategyName: entry.strategyName,
    strategyVersion: entry.strategyVersion,
    underlying: entry.underlying,
    signalState: entry.signalState,
    bias: entry.bias,
    quality: entry.quality,
    score: entry.score,
    marketRegime: entry.marketRegime,
    optionSymbol: entry.optionSymbol,
    optionSide: entry.optionSide,
    tradeSide: entry.tradeSide,
    strike: entry.strike === null ? null : String(entry.strike),
    expiry: toDate(entry.expiry),
    entryPrice: entry.entryPrice,
    stopPrice: entry.stopPrice,
    targetOne: entry.targetOne,
    targetTwo: entry.targetTwo,
    quantity: entry.quantity,
    lots: entry.lots,
    notes: entry.notes,
    reasons: jsonClone(entry.reasons),
    risks: jsonClone(entry.risks),
    ruleViolations: jsonClone(entry.ruleViolations),
    realizedPnl: entry.realizedPnl,
    unrealizedPnl: entry.unrealizedPnl,
    snapshot: jsonClone(entry),
    createdAt: toRequiredDate(entry.createdAt),
    updatedAt: toRequiredDate(entry.updatedAt),
    syncedAt: new Date(),
  };
}

async function saveJournalEntry({
  client,
  entry,
  userId,
}: {
  client: Prisma.TransactionClient;
  entry: PaperJournalEntry;
  userId: string;
}) {
  const existing = await client.paperJournalEntry.findUnique({
    where: {
      id: entry.id,
    },
  });
  let paperTradeId = existing?.paperTradeId ?? null;

  if (canPersistStructuredPaperTrade(entry)) {
    const data = structuredPaperTradeData(entry, userId);

    if (paperTradeId) {
      await client.paperTrade.update({
        where: {
          id: paperTradeId,
        },
        data,
      });
    } else {
      const paperTrade = await client.paperTrade.create({
        data,
      });
      paperTradeId = paperTrade.id;
    }
  }

  const data = paperJournalEntryPersistenceData({
    entry,
    paperTradeId,
    userId,
  });

  await client.paperJournalEntry.upsert({
    where: {
      id: entry.id,
    },
    create: data,
    update: data,
  });
}

export function paperJournalEntryFromDatabase(
  row: Prisma.PaperJournalEntryGetPayload<object>,
): PaperJournalEntry {
  return {
    id: row.id,
    type: row.type === "PAPER_TRADE" ? "PAPER_TRADE" : "NOTE",
    status:
      row.status === "OPEN" || row.status === "CLOSED" || row.status === "CANCELLED"
        ? row.status
        : "NOTE",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    signalId: row.signalId,
    strategyName: row.strategyName,
    strategyVersion: row.strategyVersion,
    underlying: row.underlying as PaperJournalEntry["underlying"],
    signalState: row.signalState as PaperJournalEntry["signalState"],
    bias: row.bias as PaperJournalEntry["bias"],
    quality: row.quality as PaperJournalEntry["quality"],
    score: row.score,
    marketRegime: row.marketRegime,
    optionSymbol: row.optionSymbol,
    optionSide:
      row.optionSide === "CE" || row.optionSide === "PE"
        ? row.optionSide
        : null,
    tradeSide:
      row.tradeSide === "LONG_CALL" || row.tradeSide === "LONG_PUT"
        ? row.tradeSide
        : null,
    strike: row.strike ? row.strike.toNumber() : null,
    expiry: row.expiry ? row.expiry.toISOString().slice(0, 10) : null,
    entryPrice: decimalString(row.entryPrice),
    stopPrice: decimalString(row.stopPrice),
    targetOne: decimalString(row.targetOne),
    targetTwo: decimalString(row.targetTwo),
    quantity: row.quantity,
    lots: row.lots,
    notes: row.notes,
    reasons: jsonStringArray(row.reasons),
    risks: jsonStringArray(row.risks),
    ruleViolations: jsonStringArray(row.ruleViolations),
    realizedPnl: row.realizedPnl.toFixed(2),
    unrealizedPnl: row.unrealizedPnl.toFixed(2),
  };
}

export async function listPaperJournalEntries({
  client = prisma,
  limit = MAX_PAPER_JOURNAL_ENTRIES,
}: {
  client?: PrismaExecutor;
  limit?: number;
} = {}): Promise<PaperJournalPersistenceResult> {
  if (!isDatabasePersistenceConfigured()) {
    return disabledPersistence();
  }

  const user = await getOrCreateLocalTrader(client);
  const rows = await client.paperJournalEntry.findMany({
    where: {
      userId: user.id,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: Math.min(Math.max(limit, 1), MAX_PAPER_JOURNAL_ENTRIES),
  });
  const entries = rows.map(paperJournalEntryFromDatabase);

  return {
    persistence: {
      configured: true,
      status: "database",
      message: "Journal entries are saved to PostgreSQL.",
    },
    entries,
    summary: calculatePaperJournalSummary(entries),
    savedCount: entries.length,
    liveOrdersEnabled: false,
  };
}

export async function persistPaperJournalEntries({
  entries,
  client = prisma,
}: {
  entries: PaperJournalEntry[];
  client?: PrismaClient;
}): Promise<PaperJournalPersistenceResult> {
  const limitedEntries = entries.slice(0, MAX_PAPER_JOURNAL_ENTRIES);

  if (!isDatabasePersistenceConfigured()) {
    return disabledPersistence(limitedEntries);
  }

  await client.$transaction(async (transaction) => {
    const user = await getOrCreateLocalTrader(transaction);

    for (const entry of limitedEntries) {
      await saveJournalEntry({
        client: transaction,
        entry,
        userId: user.id,
      });
    }
  });

  return listPaperJournalEntries({
    client,
  });
}
