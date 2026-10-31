import { backupDatabase, restoreDatabase } from "../src/lib/database-backup";

async function main() {
  const [operation, file] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url || !file || !["backup", "restore"].includes(operation))
    throw new Error("Usage: DATABASE_URL configured npm run db:backup -- backup|restore /absolute/path/to/archive.dump");
  if (operation === "backup") await backupDatabase(url, file);
  else await restoreDatabase(url, file);
  console.log(operation === "backup" ? "Database backup saved" : "Database restored into clean target");
}
void main().catch((error: unknown) => {
  let message = error instanceof Error ? error.message : "Unknown backup error";
  const url = process.env.DATABASE_URL;
  if (url) {
    message = message.replaceAll(url, "[redacted connection]");
    try {
      const password = decodeURIComponent(new URL(url).password);
      if (password) message = message.replaceAll(password, "[redacted]");
    } catch { message = "Invalid PostgreSQL connection URL"; }
  }
  console.error(`Database backup operation failed: ${message}`);
  process.exitCode = 1;
});
