# Scorva — Build Handoff

**For:** Claude Code, one big agentic session
**Prepared:** April 30, 2026
**Mode:** Sequential phases within one session, with commits between phases

---

## TL;DR (for the human running the session)

Before starting Claude Code:

1. **Commit or stash** the uncommitted PostUploadModal revert. Working tree should be clean.
2. **Push `main`** to origin if you haven't (it's 21 commits ahead). Gives you a safety net.
3. **Create `/design-source/`** at the repo root and put these in it:
   - `Scorva__Remix_.zip` (or the extracted folder)
   - `wireframes/scorva_player_wireframes.html`
   - `wireframes/scorva_events_wireframes.html`
   - `logo/scorva-logo-primary.svg`
   - `logo/scorva-logo-unicode.svg`
   - `logo/scorva-logo-favicon.svg`
   - This file as `HANDOFF.md`
4. **Run `npm test`** once and note the baseline: 9 suites pass, 10 fail (3 root causes per recon). This is your "known broken" state — Claude Code shouldn't make it worse.
5. **Open Claude Code** in the repo root.
6. **Paste the master prompt** (next section) into a fresh Claude Code session.
7. **Walk away** for a few hours. Come back to commits at phase boundaries.

After Claude Code finishes:

8. Run `npm test` and verify the baseline is the same or better.
9. Run the dev server and click through the wireframes' screen IDs to verify each one was built.
10. Read the session summary Claude Code writes at the end.

---

## The Master Prompt

Paste this whole block. Nothing before it, nothing after it.

> # Scorva build session — full handoff
>
> You are picking up a working Scorva codebase to do a major build. Read `/design-source/HANDOFF.md` (this file) for the full plan, then execute it phase by phase. Commit at every phase boundary with `chore(handoff): phase N — <summary>`.
>
> **Read these files before starting any work:**
> - `/design-source/HANDOFF.md` (this whole document)
> - `/design-source/wireframes/scorva_player_wireframes.html`
> - `/design-source/wireframes/scorva_events_wireframes.html`
> - `/design-source/Scorva__Remix_.zip` — extract if needed; the design system lives in `hifi-styles.css`
>
> **Codebase state has already been inventoried** — see "Codebase Inventory" appendix below. Do not re-explore the codebase; trust the inventory.
>
> **Your job:** execute phases 1 through 6 in order. Each phase has scope, references, and acceptance criteria below. Stop and write a short status comment to me after each phase commit so I can see progress when I scroll back. If you hit a genuinely blocking issue in any phase, stop and write what you found instead of inventing a solution.
>
> **Don't:**
> - Rebuild the annotation object model — it's already shipped (PdfViewer.tsx, AnnotationToolbar, SelectionOverlay, all of it). Reuse.
> - Rebuild the data model for workspaces / ensembles / charts / versions / parts / slots / annotations — it's all there.
> - Touch the OMR pipeline or diff worker.
> - Modify migration files numbered 001-019. Add new ones starting at 020.
> - "Improve" the wireframes' design choices. Implement them as specified.
> - Add cross-ensemble events (deferred).
> - Add features marked DEFER in this document.
>
> **Do:**
> - Match the wireframes pixel-honestly for layout, IA, and interactions.
> - Use the design tokens from `hifi-styles.css` exactly. Do not reinvent the palette.
> - Centralize role/permission checks in a `usePermission()` hook so the eventual director-vs-player split is easy.
> - Write tests for new backend routes (events CRUD).
> - Keep existing tests passing — match or beat the baseline.
>
> Begin with Phase 1.

---

## What's already built (DO NOT rebuild)

Reuse these. They're stable.

**Data model:** All of `workspaces`, `workspaceMembers`, `ensembles`, `charts`, `versions`, `parts`, `instrumentSlots`, `instrumentSlotAssignments`, `partSlotAssignments`, `annotations`, `annotationLayers`, `versionDiffs`, `notifications`, `jobs`. All annotation fields including `kind`, `scope`, `layerId`, `sourceAnnotationId`, `sourceVersionId`, `migratedFromAnnotationId` are in place.

**Annotation system end-to-end:** `PdfViewer.tsx` (1429 lines), `AnnotationToolbar`, `SelectionOverlay`, `useAnnotationHistory` (undo/redo), kind-specific renderers (`InkRenderer`, `TextRenderer`, `HighlightRenderer`), measure-anchoring, the diff highlight layer. All of it. Reuse as-is.

**OMR + diff workers:** Don't touch. The diff is per-instrument and stable.

**Existing pages that stay (with visual rebrand only):** `Dashboard`, `ChartPage`, `UploadVersion`, `VersionDetail`, `MigrationSourcesPage`, `Login`, `Signup`.

**Notifications panel:** Bell-icon-with-dropdown in sidebar. Stays as-is, but a new dedicated `/notifications` page gets added (Phase 4).

---

## What's missing (BUILD this)

**Backend:**
- `events` table + migration `020_events.sql`
- `event_charts` join table
- Events CRUD routes
- Optional: events read endpoint for "my events across ensembles" used by My Parts pivot

**Frontend pages:**
- `EventDetailPage` (route: `/ensembles/:id/events/:eventId`) — wireframe E4
- `NotificationsPage` (route: `/notifications`) — wireframe screen 03
- `PartHistoryPage` (route: `/charts/:cId/versions/:vId/parts/:pId/history`) — wireframe screen 09

**Frontend pages that get major restructure:**
- `EnsemblePage` — current "Charts list / Instruments / Members" → wireframe E1 layout (chart cards + Roster & Instruments combined table + slide-in panel for Members & Events)
- `PlayerView` (`/my-parts`) — current "ensemble→chart inline player" → split into:
  - `MyPartsPage` (`/my-parts`) — list of parts, three pivot tabs (chart/ensemble/event) — wireframes 01 + E5
  - `OpenedPartView` (`/charts/:cId/versions/:vId/parts/:pId`) — the actual focused player view — wireframe screen 04
- `ChartPage` — visual rebrand, keep functionality (the instrument-centric layout from commit 0635574 stays)

**Frontend components (new):**
- `SidePanel` (slide-in from right) with `PanelSection` collapsibles — wireframe E1b
- `ChartCard` for the ensemble landing grid
- `RosterTable` for combined instruments + members
- `EventMini` (compact event card for the side panel)
- `EventCardLarge` (full event card for ensemble events list and event detail)
- `DiffBanner` (Approach A — persistent banner) — wireframe screen 05a
- `DiffSheet` (Approach B — bottom-sheet summary) — wireframe screen 05b — implement schema for, default-disable
- `DiffStepper` (Approach C — guided walkthrough) — DEFER UI, wire up data path only
- `EventContextBar` for player view when accessed via event — wireframe screen E6
- `VersionDropdown` (player-view version switcher) — wireframe screen 08
- `AnnotationFilterPopover` — wireframe screen 08

**Frontend hooks (new):**
- `usePermission(action: string)` — wraps role checks. v1 returns true for owner/admin on writes, true for everyone on reads.

---

## Phase plan

Each phase ends with a commit. Format: `chore(handoff): phase N — <summary>`.

### Phase 1 — Visual rebrand to Claude Design tokens

**Scope:** Replace the purple/Inter design with the warm-orange-on-paper Fraunces+Inter+JetBrains Mono system. Drop in the Scorva logo SVG. No layout changes yet — pure visual.

**Steps:**
1. Read `/design-source/Scorva__Remix_.zip/hifi-styles.css` (extract the zip first if not already extracted).
2. Replace `frontend/src/index.css` design-token block with the full token set from `hifi-styles.css`:
   - All `--paper-*`, `--card-*`, `--ink-*`, `--line-*` color tokens
   - `--accent: #c8531c` (replaces current purple), `--accent-2`, `--accent-soft`
   - Diff palette: `--add`, `--add-bg`, `--rem`, `--rem-bg`, `--mod`, `--mod-bg`
   - `--ok`, `--ok-soft`, `--warn`, `--warn-soft`
   - Typography: `--serif`, `--sans`, `--mono` (Fraunces, Inter, JetBrains Mono)
   - `--r-sm` through `--r-xl`, `--shadow-sm/md/lg`
3. Map old token names to new where existing components reference them. Add a compatibility layer at the top of `index.css` so the old names still work during transition:
   ```css
   :root {
     /* Compat shims — remove after all components are migrated */
     --bg: var(--paper);
     --surface: var(--card);
     --surface-raised: var(--card);
     --surface-hover: var(--paper-2);
     --border: var(--line);
     --border-subtle: var(--line-2);
     --text: var(--ink);
     --text-muted: var(--ink-3);
     --text-faint: var(--ink-4);
     /* --accent intentionally NOT shimmed — should always be the new value */
   }
   ```
4. Add font imports for Fraunces, Inter, and JetBrains Mono. Use Google Fonts CDN or self-host — pick one and document.
5. Update dark mode overrides: most of the Claude Design palette is light-theme-first. For dark mode, invert the surfaces but preserve the warm-orange accent. Take a first pass and don't over-engineer.
6. Replace the gradient-S brand box with the SVG logo:
   - Drop `scorva-logo-primary.svg` into `frontend/public/` as `logo.svg`
   - Drop `scorva-logo-favicon.svg` as `favicon.svg`
   - Update `Layout.tsx` (and `Login.tsx`, `Signup.tsx`) to use `<img src="/logo.svg" />` instead of the gradient div
   - Update `index.html` favicon link
7. Spot-check pages in the dev server: dashboard, ensemble page, chart page, my-parts. The pages should *look* different but not be visually broken. Inline styles using old tokens may need ad-hoc cleanup.
8. Commit: `chore(handoff): phase 1 — visual rebrand to design system tokens + logo`.

**Acceptance:** Open every existing page. None should be visually broken. The brand should read as warm-orange-on-paper, not purple. The logo SVG should appear in the sidebar and login page.

---

### Phase 2 — Permission hook + auth scaffolding

**Scope:** Centralize role checks in one place so the future player/director split is easy.

**Steps:**
1. Add `frontend/src/hooks/usePermission.ts`:
   ```ts
   import { useAuth } from './useAuth';

   export type Action =
     | 'ensemble.edit'
     | 'ensemble.member.invite'
     | 'instrument.add'
     | 'instrument.reassign'
     | 'chart.create' | 'chart.edit' | 'chart.delete'
     | 'event.create' | 'event.edit' | 'event.delete'
     | 'event.charts.add' | 'event.charts.reorder'
     | 'version.push' | 'version.delete';

   export function usePermission(action: Action, ensembleId?: string): boolean {
     const { user, role } = useAuth();
     if (!user) return false;
     // v1: workspace owner/admin can do everything writeable; member/viewer reads only.
     // ensembleId param reserved for per-ensemble role refinement (deferred).
     return role === 'owner' || role === 'admin';
   }
   ```
2. Add a `<PermissionGate>` component that wraps action buttons. Use it in subsequent phases for "+ New chart", "+ Invite", "+ New event", etc.
3. Don't refactor existing pages to use this yet. Just have the hook + component ready for Phases 3-5.
4. Commit: `chore(handoff): phase 2 — permission hook scaffolding`.

**Acceptance:** Hook compiles, `<PermissionGate action="chart.create">` renders children only for owner/admin. No regressions.

---

### Phase 3 — Events backend

**Scope:** Tables, routes, tests. No UI yet.

**Steps:**
1. Create `migrations/020_events.sql`:
   ```sql
   CREATE TYPE event_type AS ENUM ('gig', 'rehearsal', 'recording', 'workshop', 'other');

   CREATE TABLE events (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     ensemble_id UUID NOT NULL REFERENCES ensembles(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     event_type event_type NOT NULL DEFAULT 'gig',
     starts_at TIMESTAMPTZ NOT NULL,
     location TEXT,
     notes TEXT,
     sort_order INT NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     deleted_at TIMESTAMPTZ
   );

   CREATE INDEX idx_events_ensemble_id ON events(ensemble_id) WHERE deleted_at IS NULL;
   CREATE INDEX idx_events_starts_at ON events(starts_at) WHERE deleted_at IS NULL;

   CREATE TABLE event_charts (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
     chart_id UUID NOT NULL REFERENCES charts(id) ON DELETE CASCADE,
     sort_order INT NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE(event_id, chart_id)
   );

   CREATE INDEX idx_event_charts_event_id ON event_charts(event_id);
   CREATE INDEX idx_event_charts_chart_id ON event_charts(chart_id);
   ```
2. Add Drizzle schema for both tables in `backend/src/schema.ts`. Match existing camelCase conventions.
3. Add Zod schemas for create/update payloads. `event_type` enum, ISO datetime for `starts_at`.
4. Add `backend/src/routes/events.ts`:
   - `GET    /ensembles/:ensembleId/events` — list events for ensemble
   - `POST   /ensembles/:ensembleId/events` — create
   - `GET    /events/:eventId` — get one with chart list
   - `PATCH  /events/:eventId` — update
   - `DELETE /events/:eventId` — soft delete
   - `POST   /events/:eventId/charts` — add chart `{ chartId, sortOrder? }` (idempotent if pair exists)
   - `DELETE /events/:eventId/charts/:chartId` — remove
   - `PUT    /events/:eventId/charts/order` — reorder `{ chartIds: [...] in order }`
   - `GET    /me/events` — my events across all ensembles I'm a member of, used by My Parts "by event" pivot
5. Auth: all writes require `requireEnsembleAdmin`. Reads require `requireEnsembleMember`.
6. Mount in `backend/src/index.ts`.
7. Add tests in `backend/src/routes/events.test.ts`. Cover: create, list, idempotent add-chart, reorder, soft-delete cascading, unique-constraint on chart-in-event.
8. Commit: `chore(handoff): phase 3 — events backend tables, routes, tests`.

**Acceptance:** New tests pass. Existing test baseline maintained. `curl -X POST http://localhost:PORT/ensembles/<id>/events ...` works locally.

---

### Phase 4 — Ensemble page restructure (E1) + slide-in panel (E1b) + create event (E2) + drag charts (E3) + event detail (E4)

**Scope:** Redesign `EnsemblePage`, build the slide-in panel, build the events feature UI end-to-end.

**Wireframe references:** Open `/design-source/wireframes/scorva_events_wireframes.html`. Screens E1, E1b, E2, E3, E4. Match layouts.

**Steps:**

1. **Restructure `EnsemblePage`:**
   - Header: stats row (3 active charts / 5 members / N parts changed this week) — see E1
   - Charts section: card grid using new `<ChartCard>` component
   - Roster & Instruments section: combined table with one row per slot showing instrument name + assigned member (if any) + score-lane row at top — see E1's bottom section
   - Topbar: add "Members & events" trigger button with badge dot when an upcoming event is imminent
   - Remove existing "Members" section as a separate block — it now lives in the slide-in panel

2. **Build `<ChartCard>`:**
   - Thumbnail area at top with light staff lines + "X CHANGED" / "DRAFT" / "ARCHIVED" badge
   - Title + version pill + author/parts metadata
   - Sparkline (decorative, can be 6 random bars)
   - Footer with status + timestamp
   - Hover lift effect from design system

3. **Build `<RosterTable>`:**
   - One row per `instrumentSlot` ordered by `sortOrder`
   - Score row at top (prefer rendering when an ensemble has any score-kind part assigned to a special "conductor" slot — for v1, just render a static "Conductor's Score" row at the top with the ensemble owner)
   - Each row: instrument icon, instrument name + "you" pill if user is assigned, person column (avatar + name + "since YEAR"), action buttons (Re-assign, Mute) gated by `<PermissionGate>`

4. **Build `<SidePanel>`:**
   - Slides in from right, 360px wide
   - Backdrop dims page to `rgba(14,26,43,0.18)`
   - ESC key, × button, and clicking backdrop all close it
   - Two `<PanelSection>` children: Members and Events
   - Each `<PanelSection>` has a collapsible header with caret, title, count, and an action ("+ invite" / "+ new")
   - Members rows show avatar + name + role + version-status stat
   - Events rows are `<EventMini>` cards with imminent treatment for events within 24h

5. **Build `<EventMini>` and `<EventCardLarge>`:**
   - `<EventMini>` is the compact one for the side panel
   - `<EventCardLarge>` is for the ensemble events list (not currently shown in wireframes — events live in the panel only — but useful for E4's "this event" header)

6. **Build create-event modal (E2):**
   - Triggered from "+ new" in the side panel
   - Fields: name, date, time, type (gig/rehearsal/recording/workshop/other), location, notes
   - On submit, POST to `/ensembles/:id/events`
   - Navigate to `/ensembles/:id/events/:eventId` (the new EventDetailPage) on success — wireframe E4

7. **Build `EventDetailPage` (E4):**
   - Route: `/ensembles/:id/events/:eventId`
   - Header card: type pill, date, name, location, notes, actions (Edit, Open setlist)
   - Setlist section: chart-row list with sort number, chart name, your part info, version pill, duration, drag-handle for reorder
   - "Open setlist" button → navigate to first chart's player view with event context (covered in Phase 5)

8. **Build the drag-charts-into-event flow (E3):**
   - From EventDetailPage, an "Add charts" mode opens a split view
   - Left: ensemble's charts as draggable cards
   - Right: current setlist as drop zone with "drop here" affordance
   - Use `@dnd-kit/core` (add to dependencies if missing)
   - On drop: POST to `/events/:eventId/charts` with `{ chartId, sortOrder: <next> }`
   - Reorder within the setlist: PUT to `/events/:eventId/charts/order`
   - Idempotency: backend rejects duplicate adds with 409; frontend shows a toast "already in setlist"

9. **Wire the topbar trigger badge dot:** show the accent dot when `events.some(e => starts_at within 24h)`.

10. Commit: `chore(handoff): phase 4 — ensemble redesign + events UI end-to-end`.

**Acceptance:**
- Can create an event from the side panel
- Can drag charts into the event
- Can reorder charts within the event
- Can remove a chart from the event
- The original chart is NOT removed from the ensemble's chart list when added to an event
- The slide-in panel opens and closes via button, ESC, or backdrop click
- Members section in the panel shows version-status stats per member

---

### Phase 5 — Player view enhancement (My Parts list, opened-part view, version history, notifications page)

**Scope:** Split the current monolithic `/my-parts` into a list page + a focused opened-part page. Add version history and a dedicated notifications inbox.

**Wireframe references:** Open `/design-source/wireframes/scorva_player_wireframes.html`. Screens 01, 03, 04, 05a, 06 (already built — verify), 08, 09, 10. From the events file: E5 (My Parts pivots), E6 (event-context bar).

**Steps:**

1. **Refactor `/my-parts` into `MyPartsPage` (list-only):**
   - Wireframe screen 01 (default) and E5 (with by-event pivot)
   - Three pivot tabs in the topbar: "By chart" (default, flat list), "By ensemble" (current grouping), "By event" (E5 layout with event-grouped sections)
   - Rows are tappable and navigate to the opened-part view, NOT inline. Remove the inline `PdfViewer` rendering from this page.
   - "By chart" rows: instrument glyph, "Part — Chart" title, "Ensemble · context", version pill, updated badge, last activity
   - "By ensemble" rows: keep current grouping behavior with the new visual style
   - "By event" rows: events grouped, charts in setlist order with "opens at N" hint

2. **Create `OpenedPartView` (`/charts/:cId/versions/:vId/parts/:pId`):**
   - Wireframe screen 04 + 06 + 08 + 10
   - This is the focused "opened part" view — exactly what the wireframe shows
   - Reuses existing `PdfViewer` for the canvas
   - Adds: top toolbar with crumbs/version pill/tools, side toolbar (mirrors top), page controls bar with foot-pedal hint and zoom
   - Version dropdown popover (screen 08): lists versions of THIS chart for THIS part, click to switch
   - Annotation filter popover (screen 08): show all toggle, source filter checkboxes, hide-all shortcut
   - Existing PdfViewer's annotation modes plug in here; the toolbar should drive PdfViewer's mode state

3. **Add diff banner Approach A (screen 05a) — default treatment:**
   - When opening a part where the user's last opened version differs from current, show `<DiffBanner>` above the canvas
   - "v3 · 4 measures changed · your N annotations preserved · m.X, m.Y, m.Z"
   - Buttons: "Show changes" (scrolls to first changed measure), "Reviewed" (dismisses, marks as seen)
   - Persistence: track `last_opened_version_id` per `(user, part)` in a new tiny table or localStorage. Recommend a backend `user_part_views` table; for v1 localStorage is acceptable to keep scope tight, but flag it as a tech-debt note in your phase summary.

4. **Approach B (DiffSheet) and Approach C (DiffStepper):**
   - Build the components per wireframe but DEFER wiring them up by default
   - Add a behind-the-scenes preference flag on `<DiffBanner>` for `mode: 'banner' | 'sheet' | 'stepper'`. Banner is the default. The other two render but aren't reachable without explicit user setting (which is also DEFERRED).

5. **Create `PartHistoryPage` (`/charts/:cId/versions/:vId/parts/:pId/history`):**
   - Wireframe screen 09
   - Split layout: preview of part at selected version on left, version history rail on right
   - Read-only; clicking a version updates the preview
   - "Open at v3" button navigates back to OpenedPartView at that version
   - Per-part scoping: the rail shows versions where this part existed (or is a "ghost" entry if it didn't yet)

6. **Create `NotificationsPage` (`/notifications`):**
   - Wireframe screen 03
   - Replaces the dropdown panel for users who want a full inbox view (the dropdown stays for quick access)
   - Each row: actor icon, plain-language summary, sub-text with reassurance ("annotations preserved"), timestamp
   - Tap to deep-link to the relevant chart/part with `?from=notification` so OpenedPartView can show appropriate context
   - Filter chips: "all" / "only my parts"

7. **Commit:** `chore(handoff): phase 5 — split my-parts, add OpenedPartView/PartHistory/Notifications, diff banner`.

**Acceptance:**
- `/my-parts` is a list, not an inline player
- Tapping a row opens `/charts/:cId/versions/:vId/parts/:pId`
- The pivot tabs work (chart / ensemble / event)
- Opening a part with a newer version shows the persistent diff banner with preserved-annotation reassurance
- Version dropdown switches versions in-place without leaving the player view
- Version history is reachable from the version dropdown ("see full version history")
- Notifications page shows the inbox; the existing bell-icon panel still works

---

### Phase 6 — Event context, My Parts "by event" pivot, cleanup, verification

**Scope:** Wire up the bridge between events and the player view. Address the known-stale tests if cheap. Final verification pass.

**Steps:**

1. **`<EventContextBar>` on player view (E6):**
   - Renders only when OpenedPartView is reached via an event (e.g., from "Open setlist" or from the by-event pivot)
   - Pass event context via React Router state or `?event=<id>` query param
   - Bar shows: "setlist" pill, event name, position ("2 of 5"), time-remaining estimate, "next: <chart>" button
   - Next-chart button advances to setlist position N+1, preserving event context

2. **My Parts "by event" pivot data wiring:**
   - Use the `GET /me/events` endpoint built in Phase 3
   - Group results by event, sort upcoming first, render setlist order

3. **Clean up the stale tests if you can do it in <30 min total:**
   - `diff.worker.test.ts`: rename `chart_versions` → `versions`, `ensemble_members` → `workspace_members` in the clearDb()
   - `diff.test.ts`: fix the `never[]` type issue on the sections array
   - `vision-diff.test.ts`: skip it explicitly with a comment ("uses vitest, not ported to Jest — see deferred features doc")
   - The 6 test-isolation failures are not your problem — they were broken before this session. Note them in your final summary.

4. **Verification:**
   - Run `npm test` — confirm baseline maintained or improved
   - Run dev server and walk through every wireframe screen, verify each one is reachable and looks right
   - Test the events end-to-end flow: create event → drag charts in → reorder → open setlist → next-chart navigation → finish

5. **Write a final session summary** in `/docs/handoff-session-2026-04-30.md`:
   - What was built
   - What known-broken stuff is still broken
   - Any TODOs or FIXMEs introduced
   - Any wireframe deviations and why

6. **Commit:** `chore(handoff): phase 6 — event context, by-event pivot, cleanup, summary`.

**Acceptance:**
- Opening a chart via an event shows the event-context bar; opening directly does not
- Next-chart button advances through the setlist
- "By event" pivot in My Parts is functional
- Final session summary exists

---

## Visual rebrand spec (Phase 1 reference)

**Token mapping table:**

| Old token | New token | Notes |
|---|---|---|
| `--bg` | `--paper` (#f5f2ec) | Page background |
| `--surface` | `--card` (#ffffff) | Card surface |
| `--surface-raised` | `--card` | Same; old name was rarely-used |
| `--surface-hover` | `--paper-2` (#ebe7df) | Hover state |
| `--border` | `--line` (#d8d2c5) | Primary border |
| `--border-subtle` | `--line-2` (#e7e2d6) | Hairline |
| `--text` | `--ink` (#0e1a2b) | Primary text |
| `--text-muted` | `--ink-3` (#6a778a) | Secondary |
| `--text-faint` | `--ink-4` (#9aa4b3) | Quaternary |
| `--accent: #5b4cf5` | `--accent: #c8531c` | **Hard replace; do NOT shim.** Warm orange. |
| `--accent-hover` | `--accent-2` (#e0763f) | |
| `--accent-subtle` | `--accent-soft` (#fbe7d7) | |
| `--danger` | `--rem` (#b94545) | Plus add `--rem-bg` |
| `--success` | `--add` (#2f8d57) | Plus `--add-bg`, `--ok`, `--ok-soft` |
| `--warning` | `--mod` (#b58200) | Plus `--mod-bg`, `--warn`, `--warn-soft` |
| (none) | `--ink-2` (#324155) | New: secondary ink |
| (none) | `--serif`, `--sans`, `--mono` | New: type families |

**Type families:**
- `--serif`: `"Fraunces", "Iowan Old Style", Georgia, serif` — used for headings, brand, chart titles, event names
- `--sans`: `"Inter", "Söhne", "Helvetica Neue", system-ui, sans-serif` — body
- `--mono`: `"JetBrains Mono", "Geist Mono", ui-monospace, monospace` — labels, eyebrows, version pills, timestamps

**Logo:** `frontend/public/logo.svg` ← copy from `/design-source/logo/scorva-logo-primary.svg`. Use 32x32 in sidebar, 64x64 in login header. Favicon ← `scorva-logo-favicon.svg`.

---

## Events data model spec (Phase 3 reference)

Already inline in Phase 3 step 1. Key constraints:

- `event_charts` has `UNIQUE(event_id, chart_id)` — a chart can appear at most once per event.
- Soft-delete `events` via `deleted_at`. Cascading hard-delete via FK because `event_charts` is a join table (no point keeping orphan rows).
- `sort_order` on `event_charts` is the setlist position. PUT order endpoint takes a full ordered array of chart IDs and rewrites all `sort_order` values to match index.
- `event_type` enum is fixed at five values. If a director needs something else they pick "other" + free-text in `notes`.

---

## Wireframe screen index

**Player wireframes file:** `/design-source/wireframes/scorva_player_wireframes.html`

| ID | Screen | Phase |
|---|---|---|
| 01 | My Parts — entry list | 5 |
| 02 | Chart list (within ensemble) | partly covered by ChartPage rebrand in 1 |
| 03 | Notifications inbox | 5 |
| 04 | Opened part — resting | 5 |
| 05a | Diff banner (Approach A — default) | 5 |
| 05b | Diff sheet (Approach B — schema only) | 5 |
| 05c | Diff stepper (Approach C — DEFER UI) | 5 (data only) |
| 06 | Annotation create + select | already shipped, verify |
| 07 | Auto-split at barlines | already shipped, verify the one-time tooltip exists |
| 08 | Version dropdown + annotation filter | 5 |
| 09 | Version history | 5 |
| 10 | Laptop layout | responsive testing only |

**Events wireframes file:** `/design-source/wireframes/scorva_events_wireframes.html`

| ID | Screen | Phase |
|---|---|---|
| E1 | Ensemble landing — chart cards + roster | 4 |
| E1b | Slide-in panel — Members & Events | 4 |
| E2 | Create event modal | 4 |
| E3 | Drag chart into event | 4 |
| E4 | Event detail / setlist | 4 |
| E5 | My Parts · by event pivot | 5 + 6 |
| E6 | Player view · event context bar | 6 |

---

## Definitely defer (NOT v1 — do NOT build)

These items appear in the deferred-features doc and stay deferred:

- Annotation propagation (composer-to-parts, player-to-section)
- Cross-ensemble events (events that pull from multiple ensembles)
- Annotation layers UI (schema is there; toggling layers visually is post-v1)
- Annotation scope beyond `self`
- Educator workflows (private teacher with multiple students)
- Phase 3 features from original ChartKeeper vision: key transposition, MusicXML import, audio attachments, Git-style branching, copyist accounts
- Multi-staff override UI
- Diff sheet (Approach B) wiring as default — schema-only in v1
- Diff stepper (Approach C) UI — DEFER, data path only
- Pricing/payments
- OMR partner replacements
- Offline mode
- Recurring events
- iCal export
- Per-event setlist position notes ("dedicated to Sarah")
- Auto-advance setlist on last page
- Pinning the slide-in panel as persistent

When in doubt about scope: if a feature isn't in this doc and isn't in the wireframes, it's deferred.

---

## Commit / verification protocol

- Commit at every phase boundary. Format: `chore(handoff): phase N — <summary>`.
- Run `npm test` at the end of phases 3, 4, 5, and 6. If tests regress beyond baseline, stop and explain.
- Don't push to origin during the session. Let the human decide when to push.
- If you genuinely need to make a decision the wireframes don't cover, take the simplest reasonable path and note it in the phase commit message as `decision: <what you decided and why>`.

---

## Codebase Inventory (appendix — already collected, don't re-explore)

Stack: TypeScript / Node / Express 4.19.2 / Drizzle ORM 0.45.2 / PostgreSQL. Validation Zod. Storage S3-compatible (MinIO local). Vision via @anthropic-ai/sdk. Tests Jest 29 with ts-jest, run via `npm test` (`jest --runInBand --forceExit`). Workers: `worker:omr` and `worker:diff` are standalone Node processes polling a Postgres job queue.

Migrations: `/migrations/` numbered SQL files, currently 001–019. Manual, no Drizzle Kit auto-gen. Add new migration as `020_events.sql`.

Frontend: React 18.3.1 + Vite 5.3.3, React Router DOM 6.24.1, Context for state (AuthContext, ToastProvider). PDF rendering via pdfjs-dist. Routes in `frontend/src/App.tsx`. Pages in `frontend/src/pages/`. Components in `frontend/src/components/`. API in `frontend/src/api/`. Hooks in `frontend/src/hooks/`. Types in `frontend/src/types.ts`. Global CSS in `frontend/src/index.css` (CSS custom properties, no Tailwind).

Existing routes:
- `/login`, `/signup`
- `/` → Dashboard
- `/ensembles/:id` → EnsemblePage
- `/charts/:id` → ChartPage
- `/charts/:id/upload` → UploadVersion
- `/charts/:id/versions/:vId` → VersionDetail
- `/charts/:id/migration-sources` → MigrationSourcesPage
- `/my-parts` → PlayerView (current; will be split in Phase 5)

Existing tables: users, workspaces, workspaceMembers, ensembles, charts, instrumentSlots, instrumentSlotAssignments, versions, parts, partSlotAssignments, annotationLayers, annotations, versionDiffs, notifications, jobs.

Test baseline: 9 suites pass, 10 fail. Three root causes: (1) test-isolation DB-state bleed between suites, (2) two suites reference renamed tables, (3) one suite imports vitest in a Jest project. None of these are blocking new work; they were broken before this session.

Uncommitted changes at session start: PostUploadModal revert (delete + UploadVersion modification). The human will commit or stash before starting.

Branch state: `main` is 21 commits ahead of `origin/main`.

Key conventions:
- Backend: one route file per resource in `backend/src/routes/`, exported as `<resource>Router`, mounted in `backend/src/index.ts`. Pattern: Zod validate → auth check (`requireEnsembleMember` / `requireEnsembleAdmin`) → Drizzle query → JSON.
- Frontend: one file per route in `pages/`, one file per component in `components/`. Inline styles predominate. Only `PdfViewer.css` is a separate CSS file.
- Tests: co-located with source (`.test.ts` next to file) or in `src/tests/` for integration.

---

End of handoff document.
