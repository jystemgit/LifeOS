# Architecture decisions

## Product and application boundaries

LIFE OS is a private single-owner productivity application, not a business CRM,
ERP or AI product. Its only primary modules are Command Center, Plan My Day and
Tasks. The existing modular Next.js App Router application is retained.

- TypeScript/React, Tailwind 4 and shared monochromatic semantic CSS tokens.
- PostgreSQL with Prisma 7 and the official PostgreSQL adapter.
- Better Auth credentials, disabled public registration, interactive owner
  bootstrap, mandatory TOTP/recovery codes, persisted sessions and owner-scoped
  data access. Security mechanisms are unchanged by scope reduction.
- Spanish, English, Italian and French use bundled interface translations and
  localized dates/numbers. A one-year HttpOnly SameSite=Lax locale cookie is
  resolved server-side including `html.lang`. Personal records are never sent
  for translation. Default locale is Spanish.
- System theme is the default; explicit light/dark preferences persist locally
  and are applied before page content paints.
- Date-only inputs use validated `YYYY-MM-DD`; owner-local dates use
  `America/Argentina/Buenos_Aires`, with adapter sessions in UTC.

## Daily Planning

DailyPlan is unique by owner/date and stores only the latest 24-string
publication plus identity/timestamps. Transactional upsert replaces the entire
publication. Unpublished edits exist only in React state. Command Center reads
only today's nonempty published hours; no other module writes them.
There are no execution records, planning history, templates or archives.
See [daily planning](./daily-planning.md).

## Native tasks and retained infrastructure

Tasks are independent records with optional list, deadline, description/notes
and Eisenhower classification. `eisenhowerClassified=false` distinguishes an
unclassified task from explicit Q4 (both importance and urgency false).
No deadline-derived urgency or task-to-goal/project/area/habit relationship
exists. Existing classifications are preserved during upgrade.

Existing unrelated capabilities remain secondary: folders, steps, saved views,
daily selections, recurrence, private database-stored attachments, history,
Trash, reminders and optional provider sync. Historical task selections retain
title/status snapshots protected by database constraints/triggers; they are
not DailyPlan versions. Historical quadrant analysis uses completion-time
snapshots; explicit unclassified snapshots stay unclassified.

Microsoft/Google connectors retain isolated encrypted tokens, owner/account
bindings, concurrency/conflict protection, persistent mapping identities and
retry recovery. They do not populate DailyPlan. Recurrence has one authority;
explicit transactional native takeover prevents duplicate generation.
See [task management](./task-management.md) for mappings and limitations.

Foreground reminders need an authenticated online visible page; persistent
acknowledgement survives navigation. Optional Web Push uses device subscriptions,
task/instant/device outbox uniqueness, worker leases, explicit expiry/retry and
health. Push delivery is not proof of OS display or owner acknowledgement.
The minimal service worker does not cache private pages or implement a full PWA.
Native PostgreSQL custom-format backup/clean restore includes attachment bytes
and task history; runtime encryption/auth/push secrets must be recovered separately.

## Goals and period planning removed

The subsequent explicit removal authorization is implemented in migration
`20261031010000_remove_goals_and_periods`. It drops Goal, GoalRelationship,
Milestone, PlanningPeriod and PlanningPeriodGoal and their five exclusive enums
in a single transaction without CASCADE. Goal/period pages, actions, forms,
domain calculations, exclusive tests and secondary Security links are removed.
Period snapshots are deleted with their parent records; no archive remains.
The hourly DailyPlan and all task/authentication infrastructure are untouched.

## Controlled module removal

Migration: `20261031000000_remove_unused_modules`.

The following **21 exclusive tables** are dropped together without CASCADE:

- Relationships: Contact, Interaction.
- Routines: Routine, RoutineActivity, RoutineLog, RoutineActivityLog.
- Journal: JournalEntry, JournalTag, JournalEntryTag, JournalRevision.
- Timeline: PersonalEvent.
- Habits: Habit, HabitLog.
- Daily Log: DailyLog, DailyLogGoal, DailyLogTask.
- Projects: Project, ProjectGoal.
- Life Areas: LifeArea.
- Obsolete complex planning: DailyActivity, DailyPlanTemplate.

The migration also removes eight exclusively obsolete enums
(DailyActivityStatus, DailyPlanStatus, HabitTrackingType, InteractionType,
PersonalEventCategory, ProjectStatus, RelationshipCategory, RelationshipStatus),
the `preserve_daily_execution()` function, four Task relation columns, Goal's
LifeArea column, Milestone's project column and DailyPlan notes/status/version.
It deletes project-only milestones and only DailyPlans without an hourly
publication. The replacement milestone check requires a goal parent.
Task history is preserved with obsolete relationship keys stripped from
object payloads; scalar payloads remain unchanged. Saved views lose obsolete
filters and replace the old unlinked view with all tasks.

### Upgrade safety

1. Stop concurrent personal-data writes during controlled deployment.
2. Create a restricted-permission custom-format dump using
   `npm run db:backup -- backup /absolute/pre-removal.dump`.
3. Restore it into a clean isolated database using
   `npm run db:backup -- restore /absolute/pre-removal.dump` with that database's
   `DATABASE_URL`; compare every table by count and ordered row digest.
4. Inventory all 21 source table counts, project-only milestones and
   unpublished legacy plans. Compare retained tasks/auth/settings/publications
   against projected pre-migration snapshots.
5. Apply the migration to the restored copy first; verify retained rows and
   schema drift before `npm run db:deploy` against the active database.
6. Verify active deletion, referential integrity and retained-data identity.
   Remove the temporary safety copy only after acceptance. It is not a permanent
   archive or a hidden retained module.

The SQL is a single explicit transaction. Unexpected dependencies cause a
failure instead of cascading into shared data. Automated migration acceptance
populates every removed family, injects a mid-migration failure, verifies
rollback and then verifies successful removal/preservation.
Old migration SQL remains immutable so clean installs and upgrades both work.

## Production limitations

OAuth credentials/consent, real-device push acceptance, offsite backup operations,
runtime secret recovery and production deployment hardening remain explicit
operator responsibilities; mocked-provider acceptance does not establish them.
