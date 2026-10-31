import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  prismaUtc?: PrismaClient;
};

export function getPrisma(): PrismaClient {
  const existingClient = globalForPrisma.prismaUtc;
  if (existingClient && !("goal" in existingClient) && "taskPushSubscription" in existingClient && "eisenhowerClassified" in existingClient.task.fields) {
    return existingClient;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required before accessing the database.");
  }

  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: "-c timezone=UTC" }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prismaUtc = client;
  }

  return client;
}
