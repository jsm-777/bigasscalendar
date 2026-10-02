# Feature status

✅ implemented and tested (automated tests, or checked in a headless browser) · 🟡 partial · ⛔ blocked on configuration or devices · ⏭ later stage

## Year board & navigation
- ✅ Opens on the Year board; default range **Sep 2026 – Aug 2027**; any start month/year in Settings → Display; ‹ › moves 12 months.
- ✅ 12 month rows × day columns 1–31, a weekday label in every valid cell, invalid dates hatched (30-day months, February, leap years).
- ✅ Sticky day header and month labels; heavier lines after each quarter (3 months) and each Sunday; subtle weekend shading.
- ✅ Today and the selected date are highlighted separately.
- ✅ Event chips; multi-day events span cells and show ‹ › continuation across month rows.
- ✅ A "+N" overflow button opens the full list for that day; events are never hidden silently.
- ✅ Moon quarter markers in cells (labelled, can be hidden).
- ✅ Monthly notes column, collapsible.
- ✅ Fit-year / Detail modes (Fit keeps a 30px minimum column width and scrolls instead of shrinking text).
- ✅ Click a day to update the dashboard; double-click or Enter to create an event.
- ✅ Dragging an event changes its date and keeps its local time and duration; recurring events ask for the scope.
- ✅ Header:
  - Today (selects today and brings it into view, moving the range if needed) is separate from the Day view button.
  - Date picker, Day/Week/Month/Year switcher, and Me / partner / Together controls.
  - Add, search, planner and settings, and a notification status that shows the real state.
- ✅ Mobile: the dashboard becomes a drawer and Year stays the default view.

## Daily dashboard
- ✅ Selected date with "Return to today".
- ✅ Schedule ordered by time.
- ✅ To-dos due that day, Overdue and Unscheduled sections.
- ✅ Reminders: queued cues and on/off state.
- ✅ Daily note (autosave, local draft, Retry on error); link to the month's notes.
- ✅ Goals: progress, streaks, check-ins.
- ✅ Daily affirmation: original text with no author attribution, stable for the local date.
- ✅ Moon phase with illumination and the next quarter, plus an optional reflection labelled as interpretive.
- ✅ Empty sections show quiet Add actions instead of sample content.

## Events, calendars, recurrence
- ✅ Event fields: title, calendar, all-day, start/end, IANA time zone, location, notes, recurrence (daily / weekly on chosen days / monthly / yearly, with interval, until or count), multiple alerts, linked goal.
- ✅ Create, edit, duplicate, delete, search.
- ✅ Undo for event and to-do edits; it checks newer versions and reports conflicts.
- ✅ Recurring edits: this occurrence / this and following / all. Exceptions are kept, and one occurrence is never silently applied to the whole series.
- ✅ Overlaps produce a warning but are allowed.
- ✅ Calendars: add from optional templates or custom; rename, recolor, archive; per-viewer visibility independent of sharing.
- ✅ Month view (6-week grid, drag between days).
- ✅ Day/Week time grid:
  - All-day lane and current-time line.
  - Drag to move (including across days), resize from the bottom edge, drag on empty space to create.
  - Alt+arrow keys as a keyboard alternative.
- ✅ All views read from the same records, so a change shows everywhere.
- 🟡 Optimistic saves with rollback cover events, to-dos and calendar visibility. Other settings save without optimistic updates.
- 🟡 Calendars can be deleted through the API but not yet from the UI (archive is offered instead).

## To-dos & notes
- ✅ To-do fields: title, list, optional due date and optional due time (date-only and timed due are separate), priority, notes, recurrence, completion, reminder.
- ✅ Scheduling a to-do (drag onto Day/Week, or "Schedule time…") creates a linked time block and never completes it.
- ✅ Completing a to-do records one goal check-in (idempotent); reopening removes it. Completing a repeating to-do creates the next one once.
- ✅ "Snooze to tomorrow" moves a to-do's due date.
- ✅ Daily, monthly and unscheduled notes are private and never sent to a partner.
- 🟡 Only one default list ("To-dos"). The API can create more lists, but there's no UI for that yet.
- 🟡 Sharing a to-do list with a partner is not implemented; lists are private.
- 🟡 Undo doesn't cover notes; they autosave and are versioned instead.

## Accounts, sharing, Together
- ✅ Real accounts: scrypt password hashes; random session tokens stored only as SHA-256 hashes; httpOnly SameSite cookies (Secure in production); a custom-header check on every change request.
- ✅ Invite-only signup once open signup is off; single-use invitation links that expire after 7 days. Nothing is emailed, and no one else's account is created.
- ✅ Per-calendar sharing (private / free-busy / details / edit), enforced by the server on reads, writes and plan imports.
- ✅ Together side-by-side with synced scrolling, plus Overlay with person initials; times converted between people's zones.
- 🟡 Supports exactly one partner connection per person.
- 🟡 Missing: password reset, email verification, login rate limiting. **Add these before exposing the app on the public internet.**

## Reminders & notifications
- ✅ Server-side planner plus durable SQLite job table:
  - Jobs keyed by a dedupe key, so re-planning never creates duplicates.
  - Rescheduling, deleting, completing, reopening or changing a recurring item updates or cancels its jobs.
  - Expiry, so late jobs are dropped instead of arriving in a flood.
  - Bounded retries, and removal of revoked or stale endpoints.
- ✅ In-app notification center: recent items, queued reminders, snooze, per-device list, and the last delivery error.
- ✅ Preferences:
  - Default lead times for events and to-dos.
  - Reminder time for date-only to-dos.
  - Optional daily agenda.
  - Quiet hours (push held back; in-app only).
  - Snooze length.
  - Titles on the lock screen (off by default).
  - Single device or all devices.
- ✅ States: enabled / permission needed / blocked / unsupported / server setup incomplete. Permission is only requested from a "Turn on push here" click. Test-notification button, plus an explanation of OS and browser limits.
- ✅ Service worker for push and notification clicks.
- ⛔ **Real web push needs:**
  - VAPID keys (`npm run vapid`)
  - an HTTPS deployment
  - testing on your devices (phone, desktop, closed browser)
  
  It has **not** been verified on a real device. Reliability is not claimed until that's done.
- ⏭ Email reminders (separate opt-in).

## Goals & streaks
- ✅ Goals with a flexible weekly target or a daily mode with planned rest days; optional quantity unit; short reflections.
- ✅ Check-ins can be edited or removed, and repeated submissions never double count.
- ✅ The streak rule is shown in the UI and calculated in the user's time zone.
- ✅ Planned practice (events linked to a goal) is counted separately from completed check-ins.

## Planning intelligence
- ✅ Validated JSON plan import, preview (conflicts, destinations, errors, questions), Apply, Undo with conflict reporting.
- ✅ Plans go through the same permission checks as normal edits; nothing changes without Apply.
- 🟡 In-app assistant (Claude, server-side) is written and wired up, but **untested against the live API**: it needs `ANTHROPIC_API_KEY` in `.env`. Without a key, the UI says so and offers import instead.
- ⏭ Voice input; an authenticated MCP integration.

## Platform
- ✅ Relational schema with migrations; JSON export/backup of your own data.
- ✅ Offline banner; failed saves roll back with a visible error; editors stay open on failure; note drafts survive errors and reloads.
- ✅ No secrets in the browser bundle: VAPID private key and API key are server-side only.
- 🟡 Accessibility:
  - In place: keyboard navigation, focus rings, ARIA labels, reduced-motion support, text-labelled moon phases.
  - Not done: an audit with a screen reader.
- 🟡 Dark theme: color tokens exist (`data-theme="dark"`), but there's no switch in the UI yet.
- 🟡 Unsaved text in a new-event dialog is kept while the dialog is open, but lost on page reload.
