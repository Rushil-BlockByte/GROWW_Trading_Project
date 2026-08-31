import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/data/prisma";

export const LOCAL_TRADER_EMAIL =
  process.env.DATABASE_PERSISTENCE_USER_EMAIL ?? "local-trader@groww-options.local";

type UserPersistenceClient = Pick<PrismaClient, "user"> | Pick<Prisma.TransactionClient, "user">;

export function isDatabasePersistenceConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export async function getOrCreateLocalTrader(client: UserPersistenceClient = prisma) {
  return client.user.upsert({
    where: {
      email: LOCAL_TRADER_EMAIL,
    },
    create: {
      email: LOCAL_TRADER_EMAIL,
      name: "Local Trader",
    },
    update: {},
  });
}
