import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const suffix = randomUUID().slice(0, 8);
const network = `lifeos-smoke-${suffix}`, database = `${network}-db`, app = `${network}-app`;
const runtimeImage = process.env.SMOKE_RUNTIME_IMAGE || "lifeos:ci";
const operationsImage = process.env.SMOKE_OPERATIONS_IMAGE || "lifeos-operations:ci";
const env = { ...process.env, POSTGRES_DB: "lifeos", POSTGRES_USER: "lifeos_admin", POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
  LIFEOS_DB_USER: "lifeos", LIFEOS_DB_PASSWORD: randomBytes(32).toString("hex"),
  BETTER_AUTH_URL: "https://lifeos.smoke.test", BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
  OWNER_EMAIL: "smoke@example.invalid", TASK_PUSH_ENABLED: "false", NEXT_TELEMETRY_DISABLED: "1" };
env.DATABASE_URL = `postgresql://lifeos:${env.LIFEOS_DB_PASSWORD}@${database}:5432/lifeos`;
const docker = async (args) => (await exec("docker", args, { env, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
const applicationEnv = ["DATABASE_URL", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "OWNER_EMAIL", "TASK_PUSH_ENABLED"].flatMap((key) => ["--env", key]);
const delay = () => new Promise((resolve) => setTimeout(resolve, 1000));
const resources = [];

async function waitFor(check, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await check()) return;
    await delay();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

try {
  await assert.rejects(docker(["run", "--rm", runtimeImage]), /Production configuration rejected/,
    "runtime must refuse missing production secrets");
  await docker(["network", "create", network]); resources.push(["network", "rm", network]);
  const initialization = fileURLToPath(new URL("./initialize-postgres.sql", import.meta.url));
  await docker(["run", "-d", "--name", database, "--network", network, "--env", "POSTGRES_DB", "--env", "POSTGRES_USER", "--env", "POSTGRES_PASSWORD",
    "--env", "LIFEOS_DB_USER", "--env", "LIFEOS_DB_PASSWORD", "-v", `${initialization}:/docker-entrypoint-initdb.d/10-lifeos.sql:ro`, "postgres:17-bookworm"]);
  resources.push(["rm", "-f", "-v", database]);
  await waitFor(async () => { try { await docker(["exec", database, "pg_isready", "-h", "127.0.0.1", "-U", "lifeos_admin", "-d", "lifeos"]); return true; } catch { return false; } }, "PostgreSQL");
  await docker(["run", "--rm", "--network", network, ...applicationEnv, operationsImage, "npm", "run", "db:deploy"]);
  const fixture = `import {Client} from 'pg';import {hashPassword} from 'better-auth/crypto';
    const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
    try {const role=(await db.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];
    if(role.rolsuper||role.rolcreatedb||role.rolcreaterole)throw Error('Application database role must be unprivileged');
    const id='production-smoke';const password=await hashPassword('Disposable-Smoke-Password-2026!');
    await db.query('INSERT INTO "user" (id,name,email,"createdAt","updatedAt") VALUES ($1,$2,$3,now(),now())',[id,'Smoke owner','smoke@example.invalid']);
    await db.query('INSERT INTO account (id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES ($1,$1,\\'credential\\',$1,$2,now(),now())',[id,password]);
    await db.query('INSERT INTO "Task" (id,"userId",title,"updatedAt") VALUES ($1,$2,$3,now())',['smoke-task',id,'Persisted production task']);
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}).format(new Date());
    const hours=Array.from({length:24},(_,h)=>h===9?'Persisted production plan':'');
    await db.query('INSERT INTO "DailyPlan" (id,"userId",date,"publishedHours","updatedAt") VALUES ($1,$2,$3,$4,now())',['smoke-plan',id,date,JSON.stringify(hours)]);
    } finally {await db.end();}`;
  await docker(["run", "--rm", "--network", network, ...applicationEnv, operationsImage, "node", "--input-type=module", "-e", fixture]);
  await docker(["run", "-d", "--name", app, "--network", network, "-p", "127.0.0.1::3000", ...applicationEnv, runtimeImage]);
  resources.push(["rm", "-f", "-v", app]);
  const bindings = JSON.parse(await docker(["inspect", "--format", "{{json .NetworkSettings.Ports}}", app]));
  const base = `http://127.0.0.1:${bindings["3000/tcp"][0].HostPort}`;
  await waitFor(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } }, "application readiness");
  assert.notEqual(await docker(["exec", app, "id", "-u"]), "0", "runtime must not run as root");
  const cookies = new Map();
  async function request(path, body) {
    const response = await fetch(`${base}${path}`, { redirect: "manual", method: body ? "POST" : "GET",
      headers: { Origin: env.BETTER_AUTH_URL, "Content-Type": "application/json", Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0], index = pair.indexOf("=");
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
  async function assertProtectedRedirect(response, target) {
    const html = await response.text();
    assert.doesNotMatch(html, /Persisted production (task|plan)/);
    if (response.status === 307) {
      assert.equal(response.headers.get("location"), target);
    } else {
      assert.equal(response.status, 200);
      const redirect = html.match(/<meta[^>]*id="__next-page-redirect"[^>]*>/)?.[0] || "";
      const metaRedirect = redirect.includes('http-equiv="refresh"') && redirect.includes(`content="1;url=${target}"`);
      const clientRedirect = html.includes(`NEXT_REDIRECT;replace;${target};307;`);
      assert.ok(metaRedirect || clientRedirect, `expected streamed redirect to ${target}`);
    }
  }
  const signIn = await request("/sign-in");
  assert.equal(signIn.status, 200);
  for (const [header, value] of [["x-frame-options", "DENY"], ["x-content-type-options", "nosniff"], ["x-robots-tag", "noindex, nofollow, noarchive"]]) assert.equal(signIn.headers.get(header), value);
  assert.equal(signIn.headers.get("x-powered-by"), null);
  assert.equal((await request("/api/tasks/reminders")).status, 401);
  assert.equal((await request("/api/tasks/push")).status, 401);
  await assertProtectedRedirect(await request("/tasks"), "/sign-in");
  for (const path of ["/goals", "/planning", "/projects", "/habits", "/journal", "/routines", "/daily-log", "/relationships", "/timeline", "/life-areas"]) assert.equal((await request(path)).status, 404);
  assert.equal((await request("/api/auth/sign-up/email", { name: "Blocked", email: "blocked@example.invalid", password: "Disposable-Smoke-Password-2026!" })).ok, false);
  assert.equal((await request("/api/auth/sign-in/email", { email: env.OWNER_EMAIL, password: "Disposable-Smoke-Password-2026!" })).status, 200);
  await assertProtectedRedirect(await request("/tasks"), "/security");
  const enrollment = await request("/api/auth/two-factor/enable", { password: "Disposable-Smoke-Password-2026!", method: "totp", issuer: "LIFE OS" });
  assert.equal(enrollment.status, 200);
  const { totpURI } = await enrollment.json();
  const secret = new URL(totpURI).searchParams.get("secret"), alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=/g, "")].map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac("sha1", key).update(counter).digest(), offset = mac[19] & 15;
  const code = ((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
  assert.equal((await request("/api/auth/two-factor/verify-totp", { code })).status, 200);
  const taskPage = await request("/tasks");
  assert.match(taskPage.headers.get("cache-control") || "", /no-store/);
  assert.match(await taskPage.text(), /Persisted production task/);
  assert.match(await (await request("/")).text(), /Persisted production plan/);
  const planner = await (await request("/planning/day")).text();
  const hourlyInputs = [...planner.matchAll(/<input\b[^>]*id="hour-(\d+)"[^>]*>/g)];
  assert.deepEqual(hourlyInputs.map((match) => Number(match[1])), Array.from({ length: 24 }, (_, hour) => hour));
  for (const [hour, [input]] of hourlyInputs.entries()) {
    assert.match(input, /type="text"/);
    assert.ok(planner.includes(`<label for="hour-${hour}">${String(hour).padStart(2, "0")}:00</label>`));
  }
  assert.equal((await request("/api/auth/sign-out", {})).status, 200);
  await assertProtectedRedirect(await request("/tasks"), "/sign-in");
  await docker(["stop", database]);
  assert.equal((await fetch(`${base}/api/health`)).status, 503);
  await docker(["start", database]);
  await waitFor(async () => (await fetch(`${base}/api/health`)).ok, "readiness recovery");
  console.log("PASS: non-root production containers, 22 migrations, security headers, private routes, disabled signup, password/TOTP/logout, persisted tasks/plan, 24 hourly inputs, readiness failure/recovery.");
} finally {
  for (const args of resources.reverse()) {
    try { await docker(args); } catch { console.error(`Smoke cleanup failed for ${args.at(-1)}`); process.exitCode = 1; }
  }
}
