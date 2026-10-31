# Task management

For native product independence, requirement classifications and the prioritized
completion roadmap, see the [native task management audit](./task-management-audit.md).
External provider acceptance is separate from native readiness.

**Daily Planning simplification supersedes the earlier linked-block workflow:**
Plan My Day is now an independent 24-hour text sheet with explicit whole-date
publication and no execution/history/template workflow. Task timing and
provider event imports never write that sheet. The independent task section
of Command Center remains. See [Daily planning](./daily-planning.md).

## Native independence: Phase 1

The native database remains authoritative without Microsoft or Google
credentials. This increment adds individual duplication, archive/restore,
explicit recurrence takeover, persistent reminder acknowledgement, optional
server-scheduled Web Push and PostgreSQL backup/clean-restore tooling. It does **not** make the entire
Task Management product complete.

| Phase 1 requirement | Status | Acceptance and limits |
|---|---|---|
| Explicit recurrence takeover | Complete and verified at service/database level | Confirmed, owner/version-checked transaction retains IDs, history and known source/future relations; completed takeover resumes native generation; sync lease prevents overlap with Microsoft reconciliation; failures roll back authority and lease |
| Reconnection duplicate prevention | Complete and verified with mocked provider / real PostgreSQL | Taken-over mappings and source-linked successors are ignored; unlinked provider recurrence is quarantined with an explicit sync error, never guessed by title |
| Duplicate individual task | Complete and verified at service/database level | Fresh ID and TODO state, optional steps, selectable deadline/date/time/reminder, retained local metadata/list/links; no provider IDs/mappings, recurrence, files, execution or old history; scheduling conflicts roll back |
| Individual archive and archived lists | Complete and verified at shared-filter/service level | Archived Tasks view and list inspection/restoration; archive state separate from Trash; active views, pickers, reminders and execution exclude task/list archives while historical review retains them |
| Foreground reminders | Complete and verified for supported foreground states | Oldest-first due batches, durable per-reminder acknowledgement, owner isolation, retries on focus/visibility/online and every 30 seconds; stale fetch suppression and single-flight reads/clicks; browser acknowledgement/reload and injected-503 recovery checked |
| Background push implementation | Complete and verified at service/database/worker level | Explicit per-device opt-in, VAPID, persistent outbox, lease/retry/expiry/deduplication, generic lock-screen copy and service worker; native reminders remain independent |
| Live background push acceptance | Blocked by deployment/browser configuration | Disabled by default; needs HTTPS, stable VAPID keys, scheduled worker and browser consent; actual OS receipt is not verified in the permission-denied integrated browser |
| Date integrity | Complete and verified | Owner-local Recently Completed, midnight boundaries, reads do not write dates, no unfinished-task carry-forward, only explicit planning mutations move selections |
| Database recovery | Complete and verified against disposable PostgreSQL | All migrated tables compared after real dump/clean restore, including file bytes, IDs, mappings, recurrence, history and historical-protection trigger; damaged restore rolls back; nonempty targets rejected |
| Fresh interactive UI acceptance | Complete and verified for targeted Phase 1 flows | Disposable account with ordinary sign-in/TOTP; confirmed takeover, duplication with steps, individual/list archive/inspection/restore, reminder acknowledgement/reload and foreground failure/retry; 1280px/375px checks without overflow |

### Recurrence takeover contract

Use **Manage recurrence in LIFE OS** in the existing task editor. Save pending
edits first. Confirmation explicitly states that the occurrence leaves
Microsoft synchronization, its history survives, and the remote series is
not modified. Known occurrences linked by `recurrenceSourceId` transfer in
the same transaction. Unknown imported siblings are not inferred from titles.
Generated local occurrences carry the takeover guard but no provider IDs.

The database transaction is the recovery boundary: failure leaves the
original authority/history/version and sync lease unchanged, so the owner can
retry. There is deliberately no one-click reverse transfer: re-enabling a
remote generator without reconciliation can produce duplicates.

When disconnected, LIFE OS cannot stop Microsoft's remote generator. The
owner must separately stop or retire that remote series if continuing to use
Microsoft. Reconnecting does not merge or delete those unknown occurrences.
For safety, while takeover records exist, newly encountered **unmapped remote
recurring tasks**, including potentially unrelated series, require manual
reconciliation before import. Ordinary mapped/nonrecurring sync continues.
This conservative restriction has no effect on native task use.

Archive pauses optional Microsoft/Google task synchronization without
deleting remote tasks/events. Restoring resumes normal conflict detection.
Native recurrence does not generate from individually archived tasks or
tasks in archived lists. Existing task selections and task history are retained;
the simplified hourly planner is independent and has no execution blocks.

### Reminder delivery contract and optional Web Push

In-app delivery supports an authenticated, visible, online LIFE OS page.
Overdue unacknowledged reminders remain in PostgreSQL and are fetched when
that page becomes usable again. Acknowledgement is shared across reloads
and devices; changing the reminder instant creates a new due notification.
Repeated acknowledgement does not create repeated history. Network/server
errors are visible and retried; an acknowledgement is not hidden on failure.
Tabs may each show the same still-unacknowledged reminder until their next
refresh; this is not an exactly-once multi-device notification guarantee.

In-app reminders do not request Notification permission, so browser denial
does not disable native reminders. The optional **Push notifications**
section on Tasks separately reports unsupported browser/insecure context,
default/granted/denied permission, server configuration errors, stale worker,
expired/key-rotated subscription and failed deliveries. Permission is requested
only by the explicit activation button, never on page load. Denied permission
does not count as successful activation. On a subsequent status refresh,
revoked browser permission also revokes the stored device subscription.

The shipped push path consists of:

- A minimal service worker for push/display/click, with no fetch handler,
  private page cache, offline-data claim or implicit PWA installation
- Owner/2FA-authenticated, same-origin subscription writes; validated HTTPS
  endpoints limited to supported Chrome/Firefox/Apple/Windows push services,
  valid P-256 subscription keys, owner-scoped revoke and explicit failed-send retry
- `TaskPushSubscription` for per-device keys/expiry/locale, `TaskPushDelivery`
  for durable attempts/results, and `TaskPushWorkerState` for lease/health
- A bounded CLI worker that atomically seeds one outbox row per
  task/reminder-instant/device, leases the run and delivery, and processes
  up to 100 due deliveries per invocation; overlapping runs do not send twice
- HTTP 404/410 revocation, subscription expiry and VAPID-rotation detection;
  429/5xx/network/timeout retry with exponential backoff and Retry-After,
  up to five attempts; authentication/nonretryable errors become visible failures
- Retries start at 30 seconds; Retry-After can defer up to 24 hours.
  Correct the configuration before using **Retry failed push deliveries**.
  Accepted deliveries are not reset by that action
- A stable Web Push topic and notification tag with `renotify: false`,
  retaining identity through interrupted-write recovery. Transport ambiguity
  can still cause at-least-once delivery; this is **not** exactly-once OS display
- Generic localized lock-screen text with no task title/notes, and a native
  task deep link; push payloads are encrypted by the maintained Web Push library
- Revalidation immediately before a send: acknowledged, completed, deleted,
  archived, archived-list, rescheduled or unsubscribed reminders are cancelled
  rather than delivered from a stale queue snapshot

`ACCEPTED` means the browser push service accepted the request. It does not
mean that the OS displayed it or that the owner read/acknowledged it. Push
acceptance never acknowledges the native reminder. Messages already accepted
by the push service cannot be recalled after a task change; they have a one-hour
TTL. Subscription records, retry history and accepted identities survive
database backup/restore. Do not expose endpoints/keys in logs or source control.

#### Server and browser setup

Push is **off by default** and needs no Microsoft/Google OAuth account:

1. On the deployment host, run `npm run reminders:keys` once. Store the generated
   private key in the deployment secret store, not source control or chat.
2. Set `TASK_PUSH_ENABLED=true`, `TASK_PUSH_VAPID_PUBLIC_KEY`,
   `TASK_PUSH_VAPID_PRIVATE_KEY`, and `TASK_PUSH_VAPID_SUBJECT`
   (a valid operator `mailto:` or HTTPS contact) in both app and worker environments.
   The key pair is validated; changing it requires device resubscription.
3. Configure the server scheduler to run `npm run reminders:deliver` every minute
   from the application directory, with `DATABASE_URL` and those variables
   securely injected. The CLI intentionally does not auto-load environment files.
   No public cron endpoint or request-driven background loop is introduced.
4. Run the command once and check its summary/exit status. An empty queue
   is valid. The UI requires a successful worker heartbeat within three minutes
   before allowing activation and shows stored worker errors/failures.
   Monitor worker exit status and backlog; a 100-send batch may need a higher
   invocation frequency if personal usage exceeds that bound.
5. Serve through HTTPS (localhost is development-only). In a compatible browser,
   open Tasks → optional push, activate deliberately, grant permission and
   validate a disposable reminder on that actual device. For platforms requiring
   installed web apps, complete platform-specific installation/acceptance first.
   LIFE OS does not yet ship a complete installable-PWA workflow.
6. To stop sends, deactivate the device, revoke browser permission, or turn off
   `TASK_PUSH_ENABLED` in the worker and stop its schedule. Revocation cancels
   queued sends; expired endpoints are deactivated automatically.

Do not advertise guaranteed delivery when the worker is stopped, permission
is denied, the browser cannot activate its service worker, or the OS suspends
push. Activation is bounded and fails explicitly instead of hanging.
Supported configured push can work without an open app, subject to browser/OS
delivery policies; actual device receipt remains an operational acceptance
check, not something unit tests can certify.

The real PostgreSQL/CLI and encrypted request-construction tests pass.
The integrated browser reports denied permission and did not produce an active
service worker; its unconfigured/denial UI was checked without claiming actual
notification receipt. A simulated permission-denial response was also exercised
without sending any task data to an external push service. See
[MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API),
[notification permission guidance](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API)
and [Web Push/VAPID protocol](https://web.dev/articles/push-notifications-web-push-protocol).
Browser push services are required only for this opt-in channel, never for native
tasks or foreground reminders.

### Backup and clean recovery

No previous database backup implementation existed in this application.
The new CLI uses standard PostgreSQL `pg_dump` custom archives and
single-transaction `pg_restore`, not a second application storage format.
Install PostgreSQL client tools compatible with the database server and put
them on PATH. Set `DATABASE_URL` securely in the process environment:

```bash
# Source database; destination file must not already exist
npm run db:backup -- backup /private/backup/location/lifeos.dump

# Change DATABASE_URL to a separately created EMPTY recovery database first
npm run db:backup -- restore /private/backup/location/lifeos.dump
```

The CLI does not load environment files itself. Connection credentials are
passed to PostgreSQL tools through environment variables, not process
arguments. PostgreSQL URL options supported are `host`, `sslmode`, `sslcert`,
`sslkey`, `sslrootcert`, `options`, `connect_timeout` and `application_name`;
other options fail explicitly rather than silently changing the connection.
Archives are created exclusively with mode 0600; failed dumps remove only
their own output. Restore refuses existing tables/views/sequences, does not
drop an existing database, and rolls back on a restore error. Stop writes
and reserve the clean target exclusively during recovery.

All current attachment bytes live in PostgreSQL and are included with all
other application tables. Roles/cluster configuration, application files,
TLS certificates and runtime secrets are **not** in the archive. Keep
`BETTER_AUTH_SECRET`, VAPID keys and provider configuration in a separate secure recovery
store: encrypted auth/integration data cannot be recovered with a new secret.
After restoring, verify migration status, file downloads, owner sign-in/TOTP,
historical records and disabled/controlled integrations before opening access.
Keep push disabled and its scheduler stopped during recovery acceptance to
avoid sending reminders from a test restore. Use encrypted offsite storage; mode 0600 is not encryption. Automated
scheduling/retention, offsite encryption, point-in-time recovery, monitoring,
RPO/RTO and disaster exercises are still operational work.

## Status and completion matrix

The local task workflows below are implemented against the existing Task
database, not a second dashboard database. The overall feature request is
**not fully accepted against live providers**: both connectors are manually
triggered implementations with explicit supported mappings. Provider account
configuration, consent and live acceptance are still required.

| Requirement | Delivered behavior | Remaining work |
|---|---|---|
| Fast capture and details | Title-only Enter capture, Cmd/Ctrl+K, inline rename, notes, dates, duration, relationships, tags, category, links, validated JSON custom fields | — |
| Shared smart views | Active/completed/all are primary; My Day, important, planned, upcoming, overdue, unscheduled, inbox, no due date, owner-local recently completed, Archived Tasks and Trash remain secondary | — |
| Individual duplication/archive | Duplicate with optional steps and scheduling fields; separate archive/restore preserving IDs/history | Copies deliberately exclude recurrence and attachment bytes; see Phase 1 contract |
| Lists | Create, rename/edit, descriptions, icons, neutral tones, move tasks, archive/restore, duplicate, reorder, default sorting/view/detail/completed settings | Duplication intentionally resets execution, dates and reminders and does not copy files |
| Folders | Create, rename, delete while retaining lists, reorder, move lists using list settings | Folder deletion with explicit destruction of its lists is deliberately not offered |
| Eisenhower | Explicit independent importance/urgency, automatic quadrant, 2x2 drop targets, quick creation, search, quadrant filtering, keyboard-accessible quadrant selector and 7/30-day historical completion aggregates | Historical aggregates are a table, not a trend chart |
| Other presentations | Standard, compact and detailed lists, status Kanban, navigable Monday-first month calendar and chronological agenda | Mobile calendar becomes a dated agenda; quadrant organization uses Matrix rather than a second Kanban |
| Search | Title, description, notes, list and tags; combinable status/list/folder/quadrant/importance/urgency/priority/date/recurrence filters; save and delete views | — |
| Steps | Create, rename, complete/reopen, delete, reorder, completed/total progress | — |
| Recurrence | Daily/weekly/monthly/yearly, intervals, weekday restrictions for daily/weekly, start/end boundaries, independent occurrences with fresh steps | No RFC 5545 free-text rule editor; only the structured supported rules |
| My Day | Select existing records, create, reorder, complete, remove without deleting, move to another date | — |
| Daily Planning | Independent 24-hour text sheet; date selector; atomic complete publication/replacement without history | Deliberately no task insertion, allocations, overlap/execution workflow or templates |
| Command Center | Read-only nonempty published hours for the current owner-local date; independent My Day task section retains task actions | No schedule execution controls or schedule analytics |
| Reminders | Owner-authenticated foreground polling/acknowledgement plus optional per-device server-scheduled Web Push, retries/expiry/health/status | Background receipt requires deployed worker, VAPID keys, HTTPS and browser permission; OS-specific acceptance remains; no email channel |
| Attachments | Private PostgreSQL content, maximum 5 MiB, authenticated download, delete, activity record | No inline previews or external object storage |
| History and Trash | Append-only application activity events; soft deletion/restoration; prior-day title/status snapshots protected by PostgreSQL; whole-database dump/clean restore verified | Global LIFE OS Trash, selective export and operational backup automation remain separate unfinished work |
| Microsoft authentication | Entra authorization-code flow with PKCE, expiring owner-bound state, HttpOnly cookie, encrypted refresh tokens, durable account binding, disconnect preserving mappings | Real tenant credentials and live authorization testing required |
| Microsoft synchronization | Manual paginated list/task reads, list create/rename/delete/restore, task create/edit/completion/importance/due/reminder/text body/delete/restore, bidirectional checklist title/completion/create/delete/restore, cross-list moves preserving synchronized steps, local and supported native recurrence, stable source markers, three-way conflicts, explicit errors and retry lock | Native relative/monthly ordinal/numbered-range recurrence and incompatible anchors/week boundaries, file synchronization, and local moves containing provider recurrence/files/foreign links are unsupported; live account validation remains required |
| Microsoft recovery | Pending mappings before POST; ambiguous creates and move deletions reconcile from the next snapshot; DELETE 404 is idempotent; deletion-versus-edit conflicts support local/remote resolution | Ambiguous/non-unique matches stop and require manual reconciliation; no recovery administration UI |
| Google Calendar | PKCE OAuth, encrypted tokens, account binding, dedicated calendar, all-day/timed primary task scheduling, existing-event import, bidirectional title/description/date/time edits, conflict details/resolution, deletion as unscheduling, deterministic event IDs, conditional ETag writes and renewable lease | Live credentials/consent/acceptance required; existing unrelated calendars, multi-day/native-series/subminute events and multiple-block exports are outside the supported mapping |

## Data and behavior decisions

- Task remains the source of truth. Steps reuse its existing parent relation.
  Lists and folders are optional. No smart view creates task records.
- `TaskDailyAssignment` is unique per task/date. It stores position and a
  title/status/completion snapshot. Current/future snapshots follow task
  changes; prior-day snapshots cannot be updated/deleted while their owner
  exists. A soft-deleted task remains visible in its historical My Day.
- The additive adoption migration snapshots existing scheduled tasks and
  linked blocks without changing their IDs. These initial snapshots represent
  state at adoption, not a reconstruction of past changes that were never
  recorded.
- Importance, urgency, priority and deadline are separate. A deadline never
  automatically changes a quadrant.
- Historical analysis counts at most one completion per task per owner-local
  day, using the last completion transition that day and its recorded
  importance/urgency, not the task's current classification. Subsequent
  renames, classification changes and Trash actions do not rewrite history.
  Steps are excluded. Incomplete legacy classification snapshots are shown
  as unavailable rather than guessed. Imported completions use their provider
  completion instant; imports with no known completion time are excluded,
  rather than counted as completed on their import date.
- The calendar uses complete Monday-first weeks, includes deadlines and all
  scheduled/My Day dates, and renders each task only once per day even if
  several date relationships match. Month navigation and day links never
  create task records. Completing either calendar entry updates the same task.
- Recurrence produces the next occurrence only on completion. A unique
  source/date key prevents completing, reopening and recompleting a task from
  creating duplicate future occurrences. Monthly/yearly rules retain their
  original anchor and clamp to the final day for shorter months.
- Task scheduling changes and date assignments share a transaction but do not
  create, update or move daily planning blocks. Task time ranges can overlap
  independently; they never overwrite the hourly sheet. Legacy blocks remain
  until the owner explicitly replaces that date through hourly publication.
- Attachments are returned as downloads with `nosniff` and `private, no-store`.
  The server-action body limit is 6 MiB to accommodate the 5 MiB file limit
  plus multipart overhead. Any production proxy must allow the same bound.
- Calendar semantics continue to use `America/Argentina/Buenos_Aires`, the
  application's existing centralized owner timezone.
- Prisma PostgreSQL application, seed and test connections explicitly use UTC,
  which the adapter requires for timestamp serialization. Calendar dates
  remain date-only; owner-local display and reporting convert explicitly.
  No legacy timestamp values are rewritten. Deployments previously using
  non-UTC sessions may contain ambiguous historical timestamp offsets and
  should review affected records rather than apply a blanket correction.
- Custom record names, notes, tags and content are not translated. Interface
  copy uses the existing Spanish/English/Italian/French catalog.

## Microsoft setup and field mapping

Register a confidential web application in Microsoft Entra with delegated
`Tasks.ReadWrite`, `User.Read` and `offline_access`. `User.Read` verifies only
the signed-in account ID, preventing another account's records from being
mistaken for deletions on reconnect. Configure its exact Web redirect URI:

```text
http://localhost:3001/api/integrations/microsoft/callback
```

Use the actual HTTPS canonical origin in production. Set server environment
variables locally; do not send secrets in chat or commit them:

```text
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
MICROSOFT_REDIRECT_URI
MICROSOFT_TENANT_ID=common
```

The existing stable `BETTER_AUTH_SECRET` also derives the token encryption key.
Changing it invalidates encrypted integration credentials as well as affecting
authentication. Connect from Tasks → Microsoft To Do. No external API is
contacted merely by opening Tasks.

| LIFE OS | Microsoft Graph v1.0 | Policy |
|---|---|---|
| List name | todoTaskList.displayName | Three-way rename conflict detection |
| Task title | todoTask.title | No silent truncation |
| Description | body.content, contentType=text | HTML is flagged, not rendered or silently converted |
| TODO/INBOX, IN_PROGRESS, COMPLETED | notStarted, inProgress, completed | INBOX exports as notStarted; CANCELLED has no exact counterpart |
| Important | importance=high/normal | Conventional LIFE OS priority and urgency stay local |
| Deadline | dueDateTime | Preserve calendar date; do not infer urgency |
| Reminder instant | isReminderOn, reminderDateTime | UTC/Argentina/IANA conversions; unsupported zones fail visibly |
| Completion time | completedDateTime | Use provider time when supplied; do not invent an imported timestamp |
| Deleted task | DELETE /tasks/{id} or missing remote ID | Preserve local Trash; concurrent edits are conflicts |
| Deleted list | DELETE /lists/{id} or missing remote ID | Preserve and unlist local tasks; concurrent remote content changes or local edits cause conflicts |
| Restored task/list | New provider record and external ID | Preserve the LIFE OS ID, relationships and history |
| Task list | Source marker in linkedResources.externalId | Reconcile native ID changes before missing-list/task deletion; basic local moves use guarded copy/delete |
| Notes, tags, custom fields, My Day, urgency | No mapping | Never overwrite through this connector |
| Local recurrence | Export each LIFE OS-generated occurrence as an independent todoTask | LIFE OS is the only generator for local series |
| Supported native recurrence | Pattern/range plus explicit Microsoft authority marker | Microsoft generates these occurrences; LIFE OS imports each independently and does not generate another |
| Steps | checklistItem displayName/isChecked, checkedDateTime on pull | Stable per-step mappings, three-way conflicts, soft deletion/history; position stays local because Graph exposes no ordering property |

The connector uses full paginated snapshots, not delta cursors or webhooks.
Unsupported native recurrence shapes, statuses/bodies and task/list mapping problems
are surfaced as conflicts. “Keep LIFE OS/Microsoft” resolves supported field
conflicts globally for that run; it does not repair unsupported mappings.
Mapped conflicts include task/list links and details; unsupported imports
include their title, provider ID and reason in the connection error.
Tasks without a list are local-only. Deleting a synchronized LIFE OS list
preserves/unlists its local tasks but deletes the Microsoft list and its
provider contents after conflict checks. A remote list deletion similarly
preserves local tasks. Restoring a deleted list does not automatically put
previously unlisted tasks back into it.

Tasks carry a stable LIFE OS source ID and a task URL in `linkedResources`.
The connector reads all synchronized lists before reconciling native moves,
including moves followed by deletion of their source list. Local moves use
create-then-delete because no supported Graph v1.0 move action is assumed.
Provider files, recurrence and foreign linked resources stop
this operation visibly instead of being discarded. Source deletion is retried
idempotently if the destination was created but the response was interrupted.
For tasks with steps, the source checklist is synchronized before the move.
Local step IDs and history are retained while destination checklist IDs are
created and confirmed before source deletion. Interrupted checklist writes
reuse pending mappings rather than duplicating destination steps. Recovery
compares the source checklist to its pre-move snapshot; changed source steps
preserve both provider tasks and require reconciliation rather than deleting
untransferred edits.
The source marker must survive a native move for automatic identity
reconciliation; this behavior still requires live acceptance testing.

Checklist items synchronize as independent existing LIFE OS step records,
never as top-level tasks. Titles and completion synchronize both ways.
Provider completion instants are retained when available, not invented when
missing. Each step has its own owner-scoped mapping and baseline; notes and
local position are untouched. Parent completion does not complete its steps.
Provider deletions soft-delete only the corresponding step; local restoration
recreates it with a new provider ID. Concurrent edits/deletions require the
same explicit Keep LIFE OS/Microsoft resolution as task conflicts.

Pending checklist mappings are persisted before POST. An interrupted create
is reconciled using its intended fields and pre-create ID snapshot, and
zero/multiple matches stop rather than create duplicates. Same-title steps
are otherwise independent; title equality is not used as a general identity.
Replacing a parent provider task reexports local active steps when its new
checklist is empty. A changed parent ID with existing remote checklist
contents reuses the mappings only when all previously active checklist IDs
survive exactly. Rebinding retains step IDs, baselines, order and notes and
records a history event. Partial/regenerated IDs and pending writes require
manual identity review instead of guessing native-move matches. Removing a parent mapping cascades only its step mappings, preserving
the local steps. Checklist-only edits are included in task/list deletion
conflict checks, so unchanged parent fields cannot hide changed steps.

LIFE OS-generated daily/weekly/monthly/yearly/custom-interval occurrences
synchronize individually without sending a Graph `recurrence` property.
Completing an occurrence in either application runs the same local recurrence
service and preserves its history. The unique series/date constraint prevents
reopen/recomplete from generating another future occurrence. A remotely
completed occurrence is followed by its new occurrence on the next sync pass
if it was generated after that list's task snapshot was loaded. Native
Microsoft series must not be enabled on these exported occurrences; doing so
is surfaced as an unsupported mapping instead of risking duplicate generators.

Supported native Microsoft daily, weekly, absolute monthly and absolute yearly
rules import with a durable `microsoftRecurrenceAuthority` marker. The editor
shows Microsoft as the authority. Local completion of these tasks does not
run the local generator; synchronization sends completion to Microsoft and
imports any new provider occurrences on subsequent reads. Rule edits are
bidirectional, with three-way conflicts. Each imported occurrence has its own
local task/history; local-only relationships and notes remain attached to
that occurrence and are not guessed onto another provider ID.

Copied source markers on native successors are replaced with that occurrence's
own LIFE OS source ID. A prior completed provider snapshot/baseline distinguishes
a new active occurrence from a native list move. Unsupported relative rules,
numbered ranges, anchor mismatches and multiweek non-Monday boundaries are
flagged rather than reinterpreted. Recreating a deleted completed native series
is blocked until the occurrence is reopened, avoiding accidental generation
from posting an already-completed recurring task.

Disconnecting clears the encrypted token and invalidates the lease, retaining
the connection's original account ID, personal tasks and mappings. Every sync
verifies that ID before interpreting provider lists or deletions. Reconnects
to another account are rejected, and conditional writes prevent concurrent
authorizations from replacing each other's tokens.

Legacy connections without an account ID bind it through their existing
refresh token, not a newly selected account. Reauthorization may be required
for `User.Read`. Legacy mappings whose connection was already deleted cannot
prove their original account; authorization stops for manual reconciliation
instead of silently adopting a different account.
Do not treat this connector as fully verified or enable it against important
data without a backup and dedicated live acceptance testing.

Verified API references:

- [todoTask resource](https://learn.microsoft.com/en-us/graph/api/resources/todotask?view=graph-rest-1.0)
- [todoTaskList resource](https://learn.microsoft.com/en-us/graph/api/resources/todotasklist?view=graph-rest-1.0)
- [List tasks](https://learn.microsoft.com/en-us/graph/api/todotasklist-list-tasks?view=graph-rest-1.0)
- [Task delta](https://learn.microsoft.com/en-us/graph/api/todotask-delta?view=graph-rest-1.0)
- [Create linkedResource](https://learn.microsoft.com/en-us/graph/api/todotask-post-linkedresources?view=graph-rest-1.0)
- [Get signed-in user and permissions](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0)
- [Checklist item resource and supported properties](https://learn.microsoft.com/en-us/graph/api/resources/checklistitem?view=graph-rest-1.0)

## Google Calendar setup and scheduling contract

Enable the Google Calendar API and register a **Web application** OAuth client
with this exact local authorized redirect URI:

```text
http://localhost:3001/api/integrations/google/callback
```

Configure these values in the server environment, not chat or source control:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
```

Set the real HTTPS canonical origin in production. Add the owner as an OAuth
test user if the consent screen is in testing mode. Configure the requested
scopes on the consent screen:

- `openid` for a stable account subject, retrieved from Google's authenticated
  userinfo endpoint
- `https://www.googleapis.com/auth/calendar.app.created` for secondary
  calendars created by this application
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly` to discover
  the dedicated calendar after an interrupted creation

Connect and synchronize from Tasks → Google Calendar. No provider request is
made just by viewing Tasks. Calendar synchronization is manual; the optional
server-scheduled reminder worker is a separate native notification concern.

The connector creates a dedicated calendar named **LIFE OS** with a stable
opaque owner marker. It does not choose the primary calendar, modify
unrelated calendars, or delete the calendar on disconnect. A pending
calendar-create record prevents blindly creating another calendar after
an ambiguous response; zero or multiple recovery matches require review.

Each task's **primary scheduled date** maps to one event. An all-day date uses
Google's exclusive next-day end. Start/end times map to an owner-timezone
event, including end-of-day `24:00`. Additional My Day selections, deadlines
and hourly planning text do not create extra provider events. A task without
a primary time window is represented as all-day.

| LIFE OS | Google event | Behavior |
|---|---|---|
| Title/description | summary/description | Bidirectional, with existing task limits and no silent truncation |
| scheduledDate | start.date, exclusive end.date | Single-day all-day event |
| startTime/endTime | start/end.dateTime and timeZone | Convert explicit provider offsets/zones to owner-local minutes |
| Task ID | extendedProperties.private.lifeosTaskId | Stable source marker; preserve unrelated private properties on patches |
| New event in the dedicated calendar | New task and optional task time range, independent of hourly planning | Mapping, task and assignment commit atomically; no planner block is allocated |
| Local unscheduling/Trash | Provider event deletion | Does not hard-delete the task |
| Remote deletion | Local unscheduling | Preserves task, completion, relationships, files and history |
| Restored scheduling/Trash | New provider event ID | Preserve original LIFE OS task ID; retry creates no duplicate events |
| Completion, priorities, recurrence rules, reminders, My Day ordering, relationships, files | No event-field mapping | Remain in LIFE OS; recurring occurrences export separately when scheduled |

Remote edits use the same validated task persistence service as local edits.
Optimistic task versions and historical task-date protection remain in force.
Old local scheduled dates are not reconciled. The hourly sheet is independent,
so task time-range overlap or retired execution blocks do not block
rescheduling. This calendar is not an attendance or task-completion authority.

Three-way baselines detect concurrent changes; explicit Keep LIFE OS/Google
actions resolve supported conflicts. Failed mappings are shown with their
task links and conflict details. Imports without a task mapping show the
provider event ID and failure in the connection error. Unsupported native
Google recurrence, multi-day events, subminute times and out-of-day windows
are rejected, not flattened into misleading records.

Event creates use deterministic Google-valid IDs written before the request.
Retries reconcile an already-created event instead of inserting a duplicate.
Updates/deletions use `If-Match` ETags so edits made since the snapshot produce
an explicit `412` instead of being overwritten. Authorization headers never
follow redirects. API pagination, throttling, timeouts and lease expiry are
surfaced. A reconnect must use the original Google subject; disconnect clears
the encrypted refresh token and invalidates the lease but retains the
calendar/account binding and mappings. Revoke the grant in Google account
settings if server-side grant revocation is also desired.

Official API references:

- [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Insert event](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Patch event](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch)
- [Conditional modification](https://developers.google.com/workspace/calendar/api/guides/version-resources)

## Verification

The automated verification suite has 169 tests across 29 files and includes
real-PostgreSQL task/planning/provider workflows with mocked provider HTTP.
Type-checking, lint, production build and migration/schema drift checks pass.
These results include Phase 1 native independence, concurrent/failed takeover
recovery, archived view/execution semantics, no carry-forward, reminder
backlog/acknowledgement, durable push delivery/retry/expiry/permission guards,
real Web Push encryption construction, service-worker event handling and real
PostgreSQL clean backup restoration including push delivery identities and
published hourly plans and controlled module-removal rollback/preservation. All 22
migrations deploy from scratch; the additive Phase 1 migrations are also applied
to the preview with zero drift. Disposable source/restore/verification
databases and the browser account were removed. The preview responds with
HTTP 200 and unauthenticated reminder/push requests return 401. A real scheduled
CLI invocation succeeds against an empty isolated queue. These checks do
not establish live provider acceptance or actual device/OS push receipt.

Run the normal checks:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

For real PostgreSQL integration tests, create a **dedicated disposable
database**, apply all committed migrations with `DATABASE_URL` pointing to it,
then run:

```bash
TASK_MANAGEMENT_TEST_DATABASE_URL='postgresql://.../lifeos_test' \
DAILY_PLANNING_TEST_DATABASE_URL='postgresql://.../lifeos_test' npm test
```

The integration suites create uniquely named accounts and clean only their
own fixtures. They cover ownership, optimistic edits, capture/history,
assignments/reordering, Trash/restore, historical immutability, scheduling
and rollback, optional classification, hourly-plan independence, independent recurrence/steps,
leap-year/month-week layout, historical quadrant snapshots/local-day boundaries,
folder/list lifecycle, attachments, saved views, and real-database Graph
mapping, concurrent list/task deletion conflicts, restored provider IDs,
cross-list identity preservation, ambiguous move deletion recovery and saved
view deletion isolation with a mocked HTTP provider. Google coverage includes
PKCE/state/expiry/account isolation, encrypted credentials, calendar/event
ambiguous-create recovery, all-day/timed mappings, transactional imports,
conflicts/deletion/restoration, private-property preservation, native-event
validation and published-hour preservation. Recurrence sync tests complete
occurrences from both LIFE OS and Microsoft and reopen/recomplete without
generating duplicates. Native-series recovery preserves provider recurrence
after list deletion and reassignment and rejects recreation of completed
series. Account tests cover PKCE/state, encrypted credentials, legacy account
adoption, different-account rejection, concurrent reconnects, owner isolation
and disconnect retaining mappings. Checklist tests cover create/import,
bidirectional edits/completion, deletion/restoration, conflicting deletion,
parent/list deletion protection, checklist-preserving cross-list moves,
interrupted destination checklist creation, concurrent source edits during
move recovery, retained-ID native checklist moves without title matching,
partial-ID rejection, ambiguous-write recovery, native-parent
identity changes, same-title independence, ownership constraints, mapping
cascades and invalid input without truncation. Provider
tests never contact Microsoft or need real credentials.

Authenticated browser verification uses a temporary account with normal TOTP
enrollment. Checks include cross-view completion, matrix drop handlers and
reload persistence, a 1.1 MB upload/download, independent hourly publication,
in-app reminders, and 1280px/375px layouts. This does not substitute for
live Microsoft acceptance or a production accessibility/security audit.
The month calendar was additionally checked at both viewport sizes, including
completion reflected in both date entries and historical analysis, persistence
after reload, and deletion of a saved view.
