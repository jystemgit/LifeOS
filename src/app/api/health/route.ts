import { connection } from "next/server";
import { Client } from "pg";

export async function GET() {
  await connection();
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
    query_timeout: 3000,
    statement_timeout: 3000,
  });
  try {
    if (!process.env.DATABASE_URL) throw new Error("Missing database configuration");
    await client.connect();
    await client.query('SELECT id FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL LIMIT 1');
    await client.query('SELECT 1 FROM "Task", "DailyPlan", "user" LIMIT 0');
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("Readiness check failed: database unavailable or migrations missing");
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  } finally {
    await client.end();
  }
}
