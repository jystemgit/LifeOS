import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { backupDatabase, restoreDatabase } from "./database-backup";

const testUrl = process.env.TASK_MANAGEMENT_TEST_DATABASE_URL;
describe.skipIf(!testUrl)("PostgreSQL backup and clean restoration acceptance", () => {
  it("restores IDs, byte attachments, recurrence, mappings, history and relationships without overwriting existing targets", async () => {
    const admin = new Client({ connectionString: testUrl! });
    await admin.connect();
    const suffix = randomUUID().replaceAll("-", ""), sourceName = `lifeos_backup_${suffix}`, targetName = `lifeos_restore_${suffix}`;
    const sourceUrl = new URL(testUrl!), targetUrl = new URL(testUrl!);
    sourceUrl.pathname = `/${sourceName}`; targetUrl.pathname = `/${targetName}`;
    const directory = await mkdtemp(join(tmpdir(), "lifeos-backup-test-"));
    const file = join(directory, "database.dump");
    const damaged = join(directory, "damaged.dump");
    let sourceCreated = false, targetCreated = false;
    let source: Client | undefined, target: Client | undefined;
    try {
      await admin.query(`CREATE DATABASE "${sourceName}"`); sourceCreated = true;
      await admin.query(`CREATE DATABASE "${targetName}"`); targetCreated = true;
      await promisify(execFile)("node", ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: sourceUrl.href }, timeout: 30000,
      });
      source = new Client({ connectionString: sourceUrl.href }); await source.connect();
      await source.query(`INSERT INTO "user" (id,name,email,"updatedAt") VALUES ('backup-owner','Backup fixture','backup-fixture@example.invalid',now())`);
      await source.query(`INSERT INTO "TaskList" (id,"userId",name,"updatedAt") VALUES ('backup-list','backup-owner','Backup list',now())`);
      await source.query(`INSERT INTO "Task" (id,"userId",title,"listId",recurrence,"externalIds","archivedAt","updatedAt")
        VALUES ('backup-task','backup-owner','Task fixture','backup-list',$1,$2,now(),now())`,
        [JSON.stringify({ frequency: "DAILY", interval: 1, startDate: "2026-10-30", endDate: null, weekdays: [] }), JSON.stringify({ microsoftRecurrenceTakenOver: true })]);
      await source.query(`INSERT INTO "Task" (id,"userId",title,"parentTaskId","updatedAt") VALUES ('backup-step','backup-owner','Step fixture','backup-task',now())`);
      await source.query(`INSERT INTO "TaskActivityHistory" (id,"userId","taskId",type,"after") VALUES ('backup-history','backup-owner','backup-task','RECURRENCE_TAKEN_OVER','{"authority":"LIFE_OS"}')`);
      const bytes = Buffer.from([0, 255, 1, 128, 65, 0, 23]);
      await source.query(`INSERT INTO "TaskAttachment" (id,"userId","taskId",name,"mimeType",size,content)
        VALUES ('backup-file','backup-owner','backup-task','private.bin','application/octet-stream',$1,$2)`, [bytes.length, bytes]);
      await source.query(`INSERT INTO "TaskDailyAssignment" (id,"userId","taskId",date,"titleSnapshot","statusSnapshot")
        VALUES ('backup-assignment','backup-owner','backup-task','2026-10-29','Original title','TODO')`);
      await source.query(`INSERT INTO "TaskSynchronizationRecord" (id,"userId","taskId","externalId","externalListId",baseline)
        VALUES ('backup-mapping','backup-owner','backup-task','provider-task','provider-list','{}')`);
      await source.query(`INSERT INTO "TaskPushSubscription" (id,"userId",endpoint,p256dh,auth,"vapidPublicKey","updatedAt")
        VALUES ('backup-push','backup-owner','https://fcm.googleapis.com/backup-fixture','fixture-public','fixture-auth','fixture-vapid',now())`);
      await source.query(`INSERT INTO "TaskPushDelivery" (id,"userId","taskId","subscriptionId","reminderAt",status,"acceptedAt","updatedAt")
        VALUES ('backup-delivery','backup-owner','backup-task','backup-push',now(),'ACCEPTED',now(),now())`);
      await source.query(`INSERT INTO "TaskPushWorkerState" (id,"lastSuccessAt") VALUES ('task-reminders',now())`);
      const hours = Array.from({ length: 24 }, (_, hour) => hour === 9 ? "Published schedule" : "");
      await source.query(`INSERT INTO "DailyPlan" (id,"userId",date,"publishedHours","updatedAt")
        VALUES ('backup-hourly','backup-owner','2026-10-30',$1,now())`, [JSON.stringify(hours)]);
      await backupDatabase(sourceUrl.href, file);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      await expect(backupDatabase(sourceUrl.href, file)).rejects.toThrow();
      const archive = await readFile(file);
      await writeFile(damaged, archive.subarray(0, Math.floor(archive.length / 2)), { mode: 0o600 });
      await expect(restoreDatabase(targetUrl.href, damaged)).rejects.toThrow();
      target = new Client({ connectionString: targetUrl.href }); await target.connect();
      expect((await target.query(`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'`)).rows[0].count).toBe(0);
      await target.end(); target = undefined;
      await restoreDatabase(targetUrl.href, file);
      target = new Client({ connectionString: targetUrl.href }); await target.connect();
      const tables = await source.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
      for (const { tablename } of tables.rows) {
        const identifier = `"${tablename.replaceAll('"', '""')}"`;
        const sql = `SELECT row_to_json(t) AS value FROM ${identifier} t ORDER BY row_to_json(t)::text`;
        expect((await target.query(sql)).rows, tablename).toEqual((await source.query(sql)).rows);
      }
      expect((await target.query(`SELECT content FROM "TaskAttachment" WHERE id='backup-file'`)).rows[0].content).toEqual(bytes);
      await expect(target.query(`UPDATE "TaskDailyAssignment" SET "titleSnapshot"='Corrupted' WHERE id='backup-assignment'`)).rejects.toThrow();
      await expect(restoreDatabase(targetUrl.href, file)).rejects.toThrow("clean database");
      expect((await target.query(`SELECT count(*)::int AS count FROM "Task"`)).rows[0].count).toBe(2);
    } finally {
      await source?.end(); await target?.end();
      if (sourceCreated) await admin.query(`DROP DATABASE "${sourceName}"`);
      if (targetCreated) await admin.query(`DROP DATABASE "${targetName}"`);
      await admin.end(); await rm(file, { force: true }); await rm(damaged, { force: true }); await rmdir(directory);
    }
  }, 60000);
});
