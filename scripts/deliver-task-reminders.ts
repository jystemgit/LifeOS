import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { deliverTaskPushReminders } from "../src/lib/task-push";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, options: "-c timezone=UTC" }) });
  try {
    const result = await deliverTaskPushReminders(db);
    console.log("Task push worker", result);
    if (result.failed) process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
void main().catch(() => { console.error("Task push worker failed Check configuration and TaskPushWorkerState No credentials or endpoints logged"); process.exitCode = 1; });
