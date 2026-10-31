# Daily planning

Open **Plan My Day**, select a date, and enter arbitrary text in any of the
24 hourly fields, 00:00–23:00. Empty hours are valid. Press the single
**Plan My Day** button and wait for the success message.

Unpublished edits exist only in the open editor's React state. Navigation or
reload loads the persisted publication, not those edits. Publishing replaces
the entire selected date, including deleting text from newly empty hours.
There is no autosave, draft record, version, history, archive or confirmation
workflow. Whitespace-only fields are empty. Each hour accepts up to 2,000
characters; dates and all 24 strings are validated on the server and rendered
as text, never HTML.

## Command Center

**Today's Plan** reads only the owner's current local date, using the existing
`America/Argentina/Buenos_Aires` timezone. Nonempty entries appear chronologically.
No publication or an all-empty publication shows an empty state and planning
link. Publication invalidates the planner and Command Center immediately.
Returning to Command Center reads the new plan; another already-open tab may
refresh to retrieve it.

No schedule completion controls, timers, progress bars, execution states,
templates, planned/actual comparisons, copying or carry-forward exist.
Tasks and optional calendar/provider synchronization never modify the sheet.

## Persistence

`DailyPlan` retains only its ID, owner/date, `publishedHours`, and timestamps.
An owner/date unique constraint prevents duplicate plans; a SQL check enforces
exactly 24 strings when published. Publication uses a transactional upsert;
concurrent writes serialize on that record, and the last committed whole
publication wins. A failure leaves the prior publication intact.

Migration `20261030234500_hourly_daily_plan` introduced the hourly column.
Migration `20261031000000_remove_unused_modules` removes the legacy activity
and template tables, execution trigger/function, obsolete plan fields and
unpublished legacy plan records. Actual hourly publications are retained.
Legacy helper/UI/action code is removed, not hidden behind compatibility routes.
See [controlled migration](./architecture.md#controlled-module-removal).

## Verification

Use both database environment variables from the [README](../README.md).
Tests cover the 24-field/one-button shape, empty and invalid inputs,
chronological read-only rendering, reconnect persistence, replacement/removal,
owner/date isolation, unpublished edits, local midnight, concurrency,
injected-update rollback, no carry-forward and task/Google independence.
The removal migration test also preserves published hours and checks rollback
with records in every removed table family.
