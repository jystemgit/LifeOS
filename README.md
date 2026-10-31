# LIFE OS

A private, single-owner productivity application for Augusto Valmont, using
the monochromatic identity of [augustovalmont.com](https://augustovalmont.com).

## Current scope

The primary navigation contains only:

- **Command Center:** today's published hourly plan and a small active-task overview.
- **Plan My Day:** a date, exactly 24 editable hourly rows, and one publishing button.
  Publication completely replaces that date's plan. No history, archives,
  execution states or automatic task/calendar insertion.
- **Tasks:** independent native tasks with create/edit/delete, complete/reopen,
  search/filter, lists, optional notes/deadlines and optional Q1–Q4 Eisenhower labels.
  Deadlines never infer urgency. No external provider is required.

Relationships, Routines, Journal, Timeline, Habits, Daily Log, Projects and
Life Areas have been removed, including their routes, exclusive tables and
data. Goals and period planning have also been completely removed, including
their secondary Security links, milestones, relationships, snapshots and tables.
Only the daily hourly planner remains; tasks have no dependencies on removed systems.

Authentication, mandatory TOTP, recovery codes, owner authorization, account
settings, system/light/dark themes and Spanish/English/Italian/French language
selection remain. Existing task attachments/history/Trash, recurrence,
reminders, optional provider connectors and PostgreSQL backup/restore remain.
Advanced task controls are secondary/collapsed rather than removed without
authorization.

See [implementation status](./docs/implementation-status.md),
[daily planning](./docs/daily-planning.md), [task management](./docs/task-management.md)
and [architecture](./docs/architecture.md).

## Development

Requirements: Node.js 24, npm and PostgreSQL (Docker Compose is
provided). Copy `.env.example` to `.env`; configure the PostgreSQL password,
matching `DATABASE_URL`, `OWNER_EMAIL`, and a strong `BETTER_AUTH_SECRET`
(`openssl rand -base64 32`). Keep `.env` out of version control.
`BETTER_AUTH_URL` defaults locally to `http://localhost:3000`; use the
canonical HTTPS origin `https://lifeos.augustovalmont.com` in production.

```bash
docker compose up -d postgres
npm run db:setup
npm run dev
```

The first setup applies migrations and interactively requests the owner name
and a hidden password (14–128 characters). It creates only the owner credential
account, not sample personal data. Repeat runs do not change existing
credentials. Public sign-up is disabled. Complete TOTP enrollment and store
recovery codes outside the application.

Use `npm run db:migrate` for schema development and `npm run db:deploy` to
apply committed migrations. **The module-removal migration is destructive.**
Before upgrading an existing database, create and verify a restorable backup;
see [migration safety](./docs/architecture.md#controlled-module-removal).
`docker compose down` retains the database volume; adding `-v` deletes it.

## Verification

Create a dedicated disposable database and apply all migrations, then run:

```bash
TASK_MANAGEMENT_TEST_DATABASE_URL='postgresql://.../lifeos_test' \
DAILY_PLANNING_TEST_DATABASE_URL='postgresql://.../lifeos_test' npm test
npx tsc --noEmit
npm run lint
npm run build
```

Both database environment variables are necessary for the complete integration
suite; without them PostgreSQL tests are skipped. Backup and removal suites
create uniquely named databases and require database-creation privileges.

## Deployment limitations

For the production Docker/HTTPS stack, startup checks, CI, backup/recovery and
release procedure, follow the [production deployment guide](./docs/production.md).
The repository is deployable; a live installation still requires its real domain,
server, private runtime secrets and owner setup.

Optional Microsoft/Google sync needs owner-configured OAuth credentials and
consent. Web Push is off by default and requires VAPID keys, HTTPS, browser
permission and a scheduled delivery worker. Live-provider acceptance and actual
OS push receipt are not established by mocked-provider tests. The minimal
reminder service worker is preserved, but a full offline PWA is not implemented.
Operational offsite backups and production hardening remain deployment work;
do not treat this local build as an approved production service for sensitive data.
