import { spawn } from "node:child_process";
import { open, rm, stat } from "node:fs/promises";
import { Client } from "pg";

async function postgresTool(command: string, args: string[], databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (!["postgresql:", "postgres:"].includes(url.protocol)) throw new Error("A PostgreSQL connection URL is required");
  const env: NodeJS.ProcessEnv = { ...process.env, PGHOST: url.searchParams.get("host") ?? url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)) };
  const options: Record<string, string> = { sslmode: "PGSSLMODE", sslcert: "PGSSLCERT", sslkey: "PGSSLKEY",
    sslrootcert: "PGSSLROOTCERT", options: "PGOPTIONS", connect_timeout: "PGCONNECT_TIMEOUT", application_name: "PGAPPNAME" };
  for (const [key, value] of url.searchParams) {
    if (key === "host") continue;
    if (!options[key]) throw new Error(`Unsupported PostgreSQL backup connection option: ${key}`);
    env[options[key]] = value;
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "ignore", "pipe"] });
    let failed = false;
    child.stderr.on("data", () => { failed = true; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed (${code})${failed ? " Check PostgreSQL connectivity, privileges and tool version" : ""}`)));
  });
}

export async function backupDatabase(databaseUrl: string, output: string) {
  const file = await open(output, "wx", 0o600);
  await file.close();
  try {
    await postgresTool("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", output], databaseUrl);
    if (!(await stat(output)).size) throw new Error("Database backup is empty");
  } catch (error) { await rm(output); throw error; }
}

export async function restoreDatabase(databaseUrl: string, input: string) {
  if (!(await stat(input)).size) throw new Error("Database backup is empty");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const existing = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
        AND c.relkind IN ('r','p','v','m','S','f')`);
    if (existing.rows[0].count) throw new Error("Restore requires a clean database Refusing to replace existing data");
  } finally { await client.end(); }
  await postgresTool("pg_restore", ["--dbname", "", "--single-transaction", "--exit-on-error", "--no-owner", "--no-privileges", input], databaseUrl);
}
