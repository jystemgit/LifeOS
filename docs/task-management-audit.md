# Native task management audit and completion roadmap

> Historical pre-simplification audit. The current approved scope is documented
> in [implementation status](./implementation-status.md). Removed modules and
> planner integrations mentioned below are no longer available or pending work.
> Goals and periods were also removed under subsequent explicit authorization.

Audit date: 2026-10-30

## Post-audit Phase 1 implementation update

The audit below is retained as the **pre-implementation baseline**, not a
claim that its originally missing features are still absent. The current
[Phase 1 completion matrix and recovery instructions](./task-management.md#native-independence-phase-1)
supersede those historical classifications for this increment.

| Original gap / acceptance item | Current classification | Evidence / remaining limitation |
|---|---|---|
| Individual duplication | Complete and verified at service/database level | Optional steps/scheduling, fresh identities, no provider mappings or copied completion/history |
| Individual archive | Complete and verified at shared-service/view level | Separate archive timestamp, Archived Tasks, restore; preserves history and selections |
| Archived lists leaking into active views | Complete and verified at shared-filter/execution level | All active smart filters, planner picker, reminders, Command Center and current execution use consistent exclusions; historical review preserved |
| Imported recurrence native independence | Complete and verified for explicit takeover with known identities | Transaction/lease/history/retry recovery tested; remote generator cannot be stopped while disconnected; unknown provider successors quarantined rather than guessed |
| Recently Completed UTC boundary | Complete and verified | Owner-local dates and local-midnight tests |
| Unfinished-date integrity | Complete and verified | Reads leave scheduled date/version unchanged; no carry-forward; explicit reschedule tested |
| Reminder reliability implementation | Complete and verified for supported states/service behavior | Durable foreground acknowledgement and optional server-scheduled Web Push with subscription expiry, bounded retries, lease/outbox deduplication and explicit permission/configuration status |
| Actual device/OS push receipt | Blocked by deployment/browser configuration | Requires HTTPS, stable VAPID keys, a scheduled worker and browser consent; integrated browser denies permission; no successful OS delivery claimed |
| Backup/recovery acceptance | Complete and verified for whole-database clean restoration | Real PostgreSQL archive restored; every migrated table compared, attachment bytes/history/recurrence/IDs/constraints verified; operational offsite automation remains |
| Fresh interactive acceptance of Phase 1 controls | Complete and verified for targeted flows | Disposable ordinary sign-in/TOTP, takeover/duplication/archive/list restore/reminder acknowledgement and error recovery; mobile form has no overflow |
| Live Microsoft/Google acceptance | Blocked by external configuration | Owner credentials/consent still required; not a native feature dependency |

The wider roadmap (templates, series-wide editing, advanced reports and
operational deployment) remains open. Passing checks do not establish that
the whole task system is complete.

## Executive conclusion

**LIFE OS already contains a substantial native task management system, but
it is not yet a fully complete, independent Microsoft To Do replacement.**

Task capture, editing, lists, folders, steps, local recurrence, Eisenhower,
My Day, planning, execution, history and files use PostgreSQL records owned
by LIFE OS. Microsoft and Google credentials are not prerequisites for those
native operations. External synchronization is an optional second layer.

The highest-value native gaps are:

1. Individual task duplication and individual task archive/unarchive
2. A supported conversion of Microsoft-owned recurrence to native recurrence
3. Dependable reminders beyond an open application
4. Complete native recurrence scheduling and series-management behavior
5. Native task templates and focused context/review workflows
6. Task-level execution and goal-contribution reporting

Live OAuth acceptance is **not** a blocker for completing native features.
It remains a blocker only for accepting the corresponding external connector.
The absence of Microsoft credentials must never be described as the reason
the native product is incomplete.

This deliverable is an audit and implementation roadmap. No application code,
database models or existing user records were changed during this audit.

## Status definitions and evidence

| Code | Classification | Meaning |
|---|---|---|
| CV | Complete and verified | Working persistence/domain behavior supported by relevant passing automated checks; not a claim of exhaustive UI or production certification |
| IV | Implemented but not fully verified | Real code exists; the exact end-to-end acceptance behavior lacks sufficient verification |
| P | Partially implemented | Useful behavior exists but a material part of the requirement is absent |
| M | Missing | No native implementation for the requested capability was found |
| E | Blocked by external configuration | Live external acceptance requires owner configuration/consent; no bearing on native acceptance |
| NA | Not applicable | Deliberately not required or not an equivalent provider concept |

Fresh verification during this audit:

- All 17 migrations applied successfully to a newly created disposable
  PostgreSQL database
- **195 tests passed across 32 files**, with both task and Daily Planning
  PostgreSQL integration suites enabled
- TypeScript `--noEmit` and ESLint passed
- Provider tests use mocked HTTP with real local database persistence;
  they are not live Microsoft or Google tests
- Existing earlier authenticated browser checks are supporting evidence,
  not a fresh browser acceptance run for this audit
- Production build passed earlier in this session; it was not rerun for this
  read-only application audit

Tests do not establish production deployment, backup recovery, closed-browser
notification delivery, accessibility compliance or decade-scale performance.

## Native completion matrix

### A. Task creation, editing and lifecycle

| Requirement | Status | Existing behavior and gap |
|---|---|---|
| Quick creation | CV | Title-only capture; Enter submission and Cmd/Ctrl+K focus; real native Task creation |
| Detailed creation | CV | Shared validated persistence for description, notes, dates, relationships and organization |
| Editing | CV | Version-checked native persistence; shared editor and inline title edit |
| Individual duplication | M | List duplication creates copied tasks, but there is no standalone duplicate-task command |
| Individual archiving | M | Task has `deletedAt`, not task archive state; list archiving is not individual task archiving; Cancelled is not an archive substitute |
| Deletion and restoration | CV | Native soft deletion, task Trash and restore preserve the Task ID and history |
| Description and notes | CV | Separate persistent description and notes fields with validation limits |
| Due date and scheduled date | CV | Distinct deadline and scheduling fields; assignments reference the same Task |
| Start/end time | CV | Validated windows, including 24:00; shared allocation and overlap rollback |
| Estimated duration | CV | Persistent validated 1–1440 minute estimate; no complete task-level estimate-versus-actual reporting |
| Reminder date/time | CV | Persistent reminder instant and owner-authenticated due-reminder query |
| In-app notifications | IV | Polling and visible dismissible reminders while the application is open; earlier browser check exists, but dedicated delivery/lifecycle regression coverage is limited |
| Closed-browser/mobile reminders | M | No service worker/push scheduling, background delivery or email channel found |
| Native recurring occurrences | CV | Daily/weekly/monthly/yearly, intervals, weekdays, boundaries, independent occurrences, unique series/date key, fresh steps |
| Complete recurrence management | P | No series-wide edit/stop workflow or native-authority conversion; generated time fields do not automatically allocate the next planner block |
| Subtasks/checklist | CV | Steps are native child Task records with create/edit/complete/delete/reorder and progress |
| Step restoration UX | P | Soft-deleted steps persist, but detail serialization hides them and no dedicated deleted-step restore interface exists |
| Attachments | CV | Private PostgreSQL bytes, authenticated download/delete and activity history; 5 MiB per file |
| Links | IV | Validated HTTP/HTTPS links persist in task details; richer link presentation/preview and dedicated interaction tests are not established |
| Tags and category | IV | Native validated values and tag search exist; dedicated tag/category/context filters are absent |
| Custom fields | IV | Persistent validated string-valued JSON map; technical JSON editing rather than a friendly field builder |
| Task history | CV | Creation/modification/status/list/date/classification events persist; latest 200 detail events shown |
| Completion and reopening | CV | Shared native actions refresh task/planning/Command Center surfaces and preserve independent recurrence history |

### B. Lists and organization

| Requirement | Status | Existing behavior and gap |
|---|---|---|
| Create/edit/rename lists | CV | Owner-scoped native list persistence |
| Duplicate lists | CV | Copies active top-level tasks and steps with fresh IDs; intentionally resets execution/scheduling/reminders and omits files/recurrence |
| Delete/restore lists | CV | Soft deletion unlists tasks rather than deleting them; restoring the list does not guess previous membership |
| Name, description, icon, color | CV | Persistent names/descriptions; five icons and monochrome neutral color options preserve brand identity |
| Reorder lists | CV | Native positions and swap actions |
| Archive/restore lists | CV | Native list archive state; restores without external calls |
| Folders | CV | Create/rename/reorder/group lists; delete folder without destroying lists |
| Move tasks between lists | CV | Native move is a local relationship update; connector restrictions do not prevent the native operation |
| Sorting/display preferences | IV | Default sort/view/completed/detail preferences persist and are wired; complete combinatorial/UI testing is not established |
| Smart lists | CV | Shared filters over Task records, including overdue, important, upcoming, no due date and recent completion |
| Archive visibility semantics | P | Archived lists disappear from ordinary navigation, but `listArchived` is not excluded by shared task filters or Command Center; archive does not mean “remove these tasks from active execution” |

### C. Task views

All these views operate on the same native Task dataset. Daily selection is
represented by TaskDailyAssignment, not another task database.

| View | Status | Semantics |
|---|---|---|
| My Day | CV | Date-specific assignment or primary scheduled date; select/remove/reorder without cloning/deleting tasks |
| All Tasks | CV | Non-Trash records; completed/cancelled behavior can be refined with filters |
| Important | CV | Explicit important flag on open tasks |
| Planned | CV | Open tasks with deadline, primary schedule or current/future assignment |
| Upcoming | CV | Future deadline/schedule/assignment; selected date is the reference |
| Overdue | CV | Open tasks with deadline before the selected date; does not set urgency |
| Unscheduled | CV | Open tasks without primary schedule or current/future assignments; may still have a deadline |
| Completed | CV | Completed native records |
| Custom Lists | CV | List relationship filter over the same records |
| Eisenhower Matrix | CV | Explicit importance/urgency, derived 2x2 quadrants, completion and edits |
| Standard/compact/detailed presentation | IV | Implemented real views, not mocks; full interaction parity not independently certified |
| Status Kanban | IV | Status columns and shared status actions; complete drag/drop UI coverage is not established |
| Calendar and agenda | IV | Navigable month and chronological views; earlier responsive/persistence browser checks support them |
| Recently completed | P | Exists, but `completedAt.slice(0, 10)` uses UTC rather than the owner-local day; differs from the historical-analysis timezone contract |

### D. Prioritization and discovery

| Requirement | Status | Evidence or limit |
|---|---|---|
| Independent importance/urgency | CV | Two booleans; neither deadline nor conventional priority determines urgency |
| Derived quadrants | CV | DO / SCHEDULE / DELEGATE / ELIMINATE computed from those flags |
| Four quadrant UX | CV | Fourth label is “Reconsiderar” / Reconsider, an intentional softer label for ELIMINATE, not a separate data classification |
| Conventional priority | CV | LOW / MEDIUM / HIGH / CRITICAL |
| Manual ordering | CV | Native task/list/day positions and step order |
| Combined filters | CV | Status/list/folder/quadrant/flags/priority/dates/area/goal/project/recurrence |
| Search | CV | Title, description, notes, list name and tags |
| Saved views | CV | Persist and delete owner-scoped query configurations |
| Context filtering | P | Tags/category can represent contexts, but category and exact tag/context filters are missing |
| Bulk operations | CV | Shared multi-record transactional completion/delete/classify/move/day actions |
| Keyboard workflows | IV | Enter capture, Cmd/Ctrl+K and editor Escape; not a complete accessible keyboard alternative to every drag operation |

### E. Planning, execution and LIFE OS integration

| Requirement | Status | Evidence or gap |
|---|---|---|
| Daily Planning / Plan My Day | CV | Existing tasks linked through taskId; assignment and schedule persistence are shared |
| Scheduled versus all-day tasks | CV | Timed DailyActivity blocks versus native date assignments; all-day tasks do not require blocks |
| Independent activities | CV | DailyActivity may have no taskId; does not fabricate a Task |
| Daily execution | CV | Activity start/end/skip persist; task completion and activity execution intentionally remain independent |
| Command Center | CV | Owner-local current date, persisted schedule/tasks/priorities/deadlines/progress, task actions and collapsible sections |
| No automatic carry-forward | IV | Read/filter paths do not move unfinished tasks; date moves require explicit actions; dedicated midnight/date-transition acceptance test is still needed |
| Goals | CV | Validated native relationship and filters; not equivalent to contribution accounting |
| Goal contribution tracking | M | Goal progress uses quantitative/milestone/qualitative inputs, not weighted task contributions |
| Projects | CV | Native task relation, project task presentation and task filtering |
| Life Areas | CV | Validated relationship and filtering |
| Routines and habits | P | Native relationship/routine activity linkage exists; completing a task does not automatically execute a routine or write a habit log |
| Calendar event references | P | Planner supports validated calendarEventId; Tasks has native calendar presentation but no general-purpose native event CRUD module |
| Planned versus actual time | P | Real activity timestamps/duration/deviation are shown in schedule review; no task-level multi-block/time aggregation or stopwatch |
| Task statistics | CV | Today's counts/completion rate/overdue and 7/30-day completion-time quadrant analysis |
| Task review workflows | P | Completed/history views and Daily Log exist; dedicated periodic task review, backlog triage and defer decisions are absent |
| Task templates | M | Daily Plan templates exist, but reusable Task/step templates do not |
| Task dependencies | M | No blocker/dependency graph or cycle prevention; subtasks and goals are not dependencies |

## Independent architecture findings

### Working foundations to preserve

- Task is the native source of truth; external IDs default to optional JSON
  and connector records are optional relations
- Native save/complete/reopen/step/list/day actions do not call either provider
- Owner scoping, optimistic versions, validation and transactions already exist
- Legacy task actions delegate persistence/completion to shared services;
  the legacy edit route redirects to the current editor
- My Day selection is unique per task/date; multiple blocks can reference
  one task; historical title/status snapshots are protected by PostgreSQL
- Disconnect clears tokens/leases without deleting native tasks or histories
- LIFE OS-only notes, urgency, relationships and organization are not
  overwritten by supported provider mappings
- Local recurrence is generated locally without provider configuration
- Native move/edit succeeds independently even when later optional sync
  refuses an unsupported provider operation

### Material independence exception: imported recurrence

`statusSideEffects` returns before local generation when the Task's optional
metadata contains `microsoftRecurrenceAuthority: true`. Disconnect clears the
token but leaves that marker. The editor offers explanation, not a supported
transfer-to-LIFE-OS command.

Consequently, an imported Microsoft recurring occurrence can be edited and
completed natively, but future occurrences remain dependent on later Microsoft
synchronization. This is a **native independence gap**, not merely an OAuth
acceptance issue. The fix must use an explicit, transactional authority
transfer; silently enabling two generators would risk duplicates.

### Durability and scale qualifications

- Browser-independent from Microsoft does not mean browser-offline: native
  operations require the LIFE OS server and PostgreSQL
- There is no delivered offline/PWA mutation queue
- Workspace and Command Center load all owner tasks and filter in memory;
  no server-side pagination or long-history performance acceptance was found
- Task detail history shows at most 200 events without paging
- Private file storage works, but no demonstrated backup/export/restore
  acceptance supports an indefinite-use claim
- Owner timezone is centralized but fixed to
  America/Argentina/Buenos_Aires, not an owner-selectable/browser-local setting

## External integration completion matrix

These statuses concern optional connectors, not native product readiness.

| Connector requirement | Status | Delivered implementation / remaining work |
|---|---|---|
| Microsoft OAuth/PKCE/account binding/encrypted credentials | IV | Code and automated flow tests pass; live authorization not established |
| Microsoft owner registration and consent | E | Entra client/environment and interactive consent required |
| Microsoft lists and supported task fields | IV | Bidirectional manual sync with real-DB/mocked-HTTP tests; live behavior unverified |
| Microsoft checklist synchronization | IV | Title/completion/create/delete/restore, stable mappings and history; no provider order property |
| Microsoft moves with checklists | IV | Confirm destination steps before source deletion; pending recovery and source-change guards |
| Native provider moves | IV | Source marker and retained checklist IDs preserve local identities; regenerated/partial IDs stop; live ID survival not established |
| Microsoft local/native recurrence mapping | IV | Single source-selected generator and supported structured pattern/range mapping; independence transfer missing |
| Unsupported Microsoft relative/numbered/anchor/week shapes | P | Explicit failure, not lossy conversion; further mapping/rule development required if desired |
| Microsoft attachments | M | No file synchronization; native attachments work independently |
| Microsoft moves with files/native recurrence/foreign links | P | Native local move works; provider copy/delete is guarded to prevent loss |
| Microsoft LIFE OS-only fields | NA | Urgency, My Day, goals/areas/projects/habits/custom data have no chosen exact mapping; remain native |
| Microsoft deletions/conflicts/retry | IV | Three-way baselines, pending writes, locks, idempotent deletes and explicit errors tested with provider mocks |
| Conflict resolution granularity | P | Global Keep LIFE OS/Microsoft for a run; no per-field/per-record reconciliation administration |
| Automatic Microsoft sync | M | Manual full paginated snapshots; no webhooks, delta-based automation or background scheduler |
| Google OAuth/account/calendar binding | IV | Implemented/tested encrypted PKCE connector; live flow unverified |
| Google owner configuration and consent | E | Google client, Calendar API configuration and owner consent required |
| Dedicated Google task calendar | IV | Primary all-day/timed schedule, import/edit/unschedule, ETag and deterministic IDs tested |
| Google unrelated calendars/multiple blocks/native recurrence/multi-day events | P | Not exported/imported by this contract; explicit exclusions |
| Google completion/strategic fields | NA | Remain native, not treated as Calendar equivalents |
| Connector removal preserves native records | CV | Token clearing/lease invalidation retain Task/history/mappings; recurring authority exception noted above |

## Prioritized implementation roadmap

### Priority 1 — Core replacement and independence

1. **Transfer recurrence authority to LIFE OS**
   - Add an explicit native takeover/detach action, valid even without tokens
   - Retain original tasks/history; transactionally choose a single local
     generator and establish source/date identity
   - On reconnect, require reconciliation rather than re-enabling provider
     recurrence silently
   - Acceptance: disconnect, complete imported series offline from providers,
     generate next occurrence locally, reopen/recomplete without duplicates;
     reconnect does not create a second series

2. **Individual duplicate-task action**
   - Reuse/extract the existing native list-copy behavior
   - Explicitly reset completion/execution/provider metadata; copy steps with
     fresh IDs; make date/reminder/recurrence/attachment policy visible
   - Acceptance: original unchanged, no inherited external IDs, valid links,
     ownership checks, unique history and independent completion

3. **Individual archive/unarchive**
   - Add additive task archive state, not a new Task database
   - Define active/smart-list/planner/Command Center behavior centrally;
     protect past snapshots and executed blocks
   - Archive must not count as completion, deletion or recurrence execution
   - Acceptance: restore same ID and history; native archive works disconnected;
     archives excluded/included consistently under explicit view policy

4. **Make reminder delivery dependable and explicit**
   - First test foreground polling, dismissal, owner isolation, overdue
     reminder backlog and loading/error behavior
   - Add owner-authorized Web Push/background scheduling only with an actual
     deployment/service-worker path; no Microsoft dependency
   - Clearly expose unsupported permissions/delivery states
   - Acceptance: supported devices receive the due notification with the tab
     closed; retries do not duplicate delivery

5. **Small native correctness and recovery work**
   - Align Recently Completed with owner-local dates
   - Add explicit midnight/no-auto-rollover and cross-view regression tests
   - Clarify archive semantics and cancelled-task progress denominators
   - Verify export/backup restore before claiming indefinite durable use

### Priority 2 — Advanced native task management

1. Finish recurrence series actions: edit future rules, stop future generation,
   preserve completed occurrences and choose late-completion semantics
2. Reconcile generated timed occurrences through shared planner allocation;
   collisions must be visible and must not erase successful completion/history
3. Add reusable Task/step templates using the same copy/persistence helper;
   existing Daily Plan templates remain separate
4. Add exact tag/category/context filters and save them through existing views
5. Add deleted-step restoration without pretending steps are top-level tasks
6. Improve keyboard alternatives and focused backlog/weekly review UX
7. Keep existing Eisenhower and smart views; extend tests rather than rebuild
8. Defer a dependency graph until real usage demonstrates value; if added,
   enforce owner scoping, acyclic dependencies and clear blocking semantics

### Priority 3 — LIFE OS integration and analytics

1. Aggregate planned/actual minutes by Task across linked activity blocks;
   all-day task completion must not fabricate elapsed time
2. Show completed/remaining task contribution by goal/project/life area,
   without silently changing measured goal progress
3. Add task review summaries using existing immutable snapshots/history
4. Improve deep links from project/routine/area surfaces to exact tasks/views
5. Verify habit/routine interaction rules; any automatic log/completion change
   must be explicit and opt-in
6. Add server-side filtering/pagination and measurable large-history tests
   when scale threatens everyday performance

### Priority 4 — Optional external synchronization

1. Run isolated live Microsoft and Google acceptance when owner consent is
   available; never block native acceptance on it
2. Add per-record conflict/recovery decisions and disconnected native-takeover
   reconciliation before automatic synchronization
3. Extend only mappings justified by actual API capabilities and owner value
4. Treat file/complex recurrence support as connector development, not a limit
   on native attachments or native recurrence
5. Consider delta/webhooks/background sync only after mappings and recovery
   are validated against live accounts

## Native acceptance gate

Before declaring “complete Microsoft To Do replacement,” verify with **no
Microsoft/Google connection and no provider credentials**:

- Capture, organize, edit, duplicate, archive, delete and restore tasks/lists
- Complete/reopen and review the same task from every relevant view
- Create local recurring tasks and take over imported recurring tasks
- Keep unfinished tasks on their existing dates across midnight/reload
- Schedule existing tasks as all-day or timed without cloning them
- Protect executed blocks and historical reports during edits/Trash actions
- Deliver reminders according to an explicit tested device/delivery contract
- Preserve history, steps, files and relationships through backup recovery
- Explain optional connector failures without disabling native operations

## Source map

- [Native Task models](../prisma/schema.prisma)
- [Shared task persistence and recurrence](../src/lib/task-management.ts)
- [Native actions, organization and steps](../src/app/tasks/manage-actions.ts)
- [Task views, classification and validation](../src/domain/task-management.ts)
- [Workspace UI](../src/components/task-workspace.tsx)
- [Task editor](../src/components/task-editor.tsx)
- [Reminders](../src/components/task-reminders.tsx)
- [Reminder query](../src/app/api/tasks/reminders/route.ts)
- [Planning persistence and execution](../src/lib/daily-planning.ts)
- [Command Center](../src/app/page.tsx)
- [Daily task execution sections](../src/components/daily-tasks.tsx)
- [Planned/actual schedule review](../src/components/daily-schedule.tsx)
- [Goal progress semantics](../src/domain/goal-progress.ts)
- [Optional Microsoft connector](../src/lib/microsoft-todo.ts)
- [Microsoft disconnect/actions](../src/app/tasks/microsoft-actions.ts)
- [Optional Google connector](../src/lib/google-calendar.ts)
- [Native PostgreSQL regression suite](../src/lib/task-management.integration.test.ts)
- [Detailed existing mappings and setup](./task-management.md)
