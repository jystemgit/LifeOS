# Production deployment

This repository ships a reproducible **single-instance** deployment for a Linux
server with Docker Compose: Caddy terminates HTTPS, Next.js runs as a non-root
user on a private network, and PostgreSQL 17 persists in a named volume.
Neither PostgreSQL nor the application port is published to the internet.
The application owns its database but has no PostgreSQL superuser, role-creation
or database-creation privileges. The separate bootstrap admin secret is passed
only to PostgreSQL, not the application or operations service. This initialization
runs only for a new empty volume; it does not rewrite existing roles.
Only ports 80/443 are published by Caddy. No production domain, server, secrets,
owner records or database dumps are included in GitHub or the image.

The included GitHub Actions workflow runs the PostgreSQL integration suite,
schema-drift check, types, lint, production-dependency audit, production build, both images
and an isolated production-container smoke test.

## Prerequisites

### Dependency audit scope

The verified runtime dependency audit reports zero known vulnerabilities.
The full development audit currently reports 16 moderate findings in ESLint's
transitive `minimatch` chain
([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)).
Compatible 3.x/10.x patches are not published. Do not apply the proposed forced
ESLint downgrade or override the legacy callable API with minimatch 11.
CI gates `npm audit --omit=dev --audit-level=moderate`; maintainers must also
review the full `npm audit` and upgrade tooling when compatible fixes arrive.
The public standalone runner does not ship the development toolchain. The
private operations image includes it for Prisma/TypeScript commands; do not
expose that image or run it against untrusted source/glob input.

### Server requirements

- Linux host with Docker Engine and Compose v2+, sufficient RAM/disk for the
  Next.js build and database, and a DNS name pointing to the host.
- Firewall allowing public TCP 80/443 only; restrict SSH administratively.
  Avoid publishing Docker ports other than Caddy: Docker's own firewall rules
  can bypass host UFW rules.
- A private runtime secret store or restricted `.env.production`, and an
  encrypted offsite backup destination with a real retention policy.
- One application replica. Authentication rate-limit memory and Next.js
  cache/revalidation are process-local; do not scale horizontally without
  shared storage/rate limiting and cache coordination.

## Initial install

```bash
git clone https://github.com/jystemgit/LifeOS.git
cd LifeOS
cp .env.production.example .env.production
chmod 600 .env.production
```

Set the real `LIFEOS_DOMAIN`, `OWNER_EMAIL`, and generated secrets. Use
`openssl rand -hex 32` separately for both PostgreSQL passwords (URL-safe) and
`openssl rand -base64 48` for `BETTER_AUTH_SECRET`. Keep these outside source
control. **Preserve the auth secret across releases**: it protects sessions,
TOTP material and optional integration tokens. Changing the environment's
PostgreSQL password does not rotate an existing database user's password.

Compose derives the internal `DATABASE_URL` and canonical HTTPS auth origin.
If deploying outside Compose, supply `DATABASE_URL`, `BETTER_AUTH_URL`,
`BETTER_AUTH_SECRET` and `OWNER_EMAIL` yourself. Run `npm run check:production`
with those runtime variables; placeholders, HTTP origins and partial OAuth/push
configuration are rejected. No production secrets are needed during the build.

Use the same Compose command and project directory for every operation:

```bash
docker compose --env-file .env.production -f compose.production.yml --profile tools build
docker compose --env-file .env.production -f compose.production.yml up -d postgres
docker compose --env-file .env.production -f compose.production.yml run --rm operations node scripts/validate-production-env.mjs
docker compose --env-file .env.production -f compose.production.yml run --rm operations npm run db:deploy
docker compose --env-file .env.production -f compose.production.yml run --rm operations npm run db:seed
docker compose --env-file .env.production -f compose.production.yml up -d app caddy
```

Owner setup needs an interactive terminal and prompts for a hidden password.
It refuses multiple owners or a mismatched existing account; it never resets
an existing password. Public sign-up is disabled. Sign in at the configured
HTTPS domain, enroll TOTP and store recovery codes securely off-device.
Do not open the production database to create a disposable test owner.

Caddy obtains and renews the certificate after DNS and ports are correct.
It redirects HTTP to HTTPS and adds HSTS for this host only. It preserves
streaming and enforces an 8 MB request limit (Next.js actions retain their
6 MB limit). The app has anti-framing, MIME-sniffing, referrer/privacy and
no-index headers. Private routes retain owner/TOTP checks and private caching;
the minimal service worker does not cache private pages. The CSP sets framing,
base and object restrictions; it is **not** a nonce-based script CSP.

## Health and acceptance

```bash
docker compose --env-file .env.production -f compose.production.yml ps
curl --fail https://YOUR_REAL_DOMAIN/api/health
curl -I https://YOUR_REAL_DOMAIN/sign-in
docker compose --env-file .env.production -f compose.production.yml logs --tail=100 app caddy
```

Readiness performs bounded database/migration/table checks and returns only
`{"status":"ok"}` or HTTP 503 with `{"status":"unavailable"}`. It exposes no
records, versions or credentials. Monitor availability, disk, PostgreSQL,
certificate renewal and backup freshness from outside the host. Docker marks
an unhealthy container but does not automatically restart a still-running
unhealthy process; alert and investigate rather than assuming remediation.

Before calling a live deployment accepted, verify normal login/TOTP/logout,
24 hourly rows/publication/replacement, task create/edit/complete/reopen,
light/dark and all four languages on the real HTTPS origin. Confirm private
pages do not enter a CDN cache. Provider OAuth/push require separate real-account
and real-device acceptance if enabled.

## Backups and recovery

Create a restricted backup mount writable by operations UID 1001:

```bash
sudo install -d -m 700 -o 1001 -g 1001 backups
docker compose --env-file .env.production -f compose.production.yml run --rm operations npm run db:backup -- backup /backups/pre-upgrade.dump
```

The operation refuses to overwrite an existing archive and writes mode 0600.
Use unique dated names in a daily cron/systemd timer, check its exit status,
encrypt the resulting archive before copying it offsite, and alert if no
successful backup arrives. Retention and encryption keys are operator-owned,
not silently chosen by the app. A local Docker volume is not an offsite backup.
The operations image includes PostgreSQL 17 `pg_dump`/`pg_restore`.

Regularly restore to a **new empty isolated database**, never the live one.
Override `DATABASE_URL` for the operations command to that database and run:

```bash
docker compose --env-file .env.production -f compose.production.yml run --rm \
  -e DATABASE_URL=postgresql://RESTORE_USER:RESTORE_PASSWORD@RESTORE_HOST/EMPTY_DATABASE \
  operations npm run db:backup -- restore /backups/dated-backup.dump
```

Prefer injecting that URL through a secret/environment file rather than shell
history. Compare record counts and ordered row digests, including authentication,
attachments, tasks and hourly plans. Recover the matching runtime secrets
separately. Restoration refuses nonempty databases and runs transactionally.

## Upgrades and rollback

1. Pick a verified commit; set `LIFEOS_IMAGE_TAG` to its identifier so previous
   images remain available. Build **both** runtime and operations images from
   the same commit.
2. Stop writes (`stop caddy app`), take a verified restorable backup, and inspect
   pending migration SQL before deploying it.
3. Run `operations npm run db:deploy` once, then start `app caddy` and verify
   readiness plus authenticated acceptance. Do not run `prisma migrate dev` or
   `db push` against production.
4. An application-only rollback can reuse a previous runtime image only if its
   schema is compatible. Destructive migrations are not automatically reversible:
   restoring the verified backup into a clean database is the rollback path.
   Never assume changing the image restores deleted data.

The historical removal migrations delete retired modules. Fresh installations
apply all 22 migrations; upgrades must follow the backup protocol even if those
modules appear empty. Do not delete migration history.

## Optional services

Native tasks and in-app reminders require neither OAuth nor push. Leave their
settings empty/false unless needed. OAuth callback URLs must exactly match
`https://YOUR_REAL_DOMAIN/api/integrations/{microsoft|google}/callback`.

For Web Push, generate matching keys once (`operations npm run reminders:keys`),
configure the subject and keys privately, set `TASK_PUSH_ENABLED=true`, rebuild
no image (runtime configuration only), and schedule
`operations npm run reminders:deliver` every minute. Monitor worker/outbox health.
The worker is an explicit scheduled operation, not a browser timer or an
automatically installed host cron job. OS delivery is not proof of receipt.

## Local release verification

Node.js 24 and PostgreSQL 17 tools are required for host-side checks:

```bash
npm ci
npm run db:generate
# Apply migrations to a dedicated disposable test database first.
TASK_MANAGEMENT_TEST_DATABASE_URL='postgresql://.../lifeos_test' \
DAILY_PLANNING_TEST_DATABASE_URL='postgresql://.../lifeos_test' npm test
npm run typecheck
npm run lint
npm audit --audit-level=moderate
npm run build
docker build --target runner -t lifeos:ci .
docker build --target operations -t lifeos-operations:ci .
npm run test:production
```

The smoke test creates uniquely named Docker resources and disposable synthetic
records only, checks production auth/TOTP/protected routes, persisted tasks/
plans, 24-hour sheet, headers, removed routes, non-root runtime and readiness
failure/recovery, then removes only its resources. It never uses the owner's
preview database.
