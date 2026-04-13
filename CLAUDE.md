# ChartKeeper — Project Memory

## What This Is
Version control for music charts. Bandleaders push new PDF versions; players see exactly what changed in their part, highlighted, before rehearsal. Player annotations (crescendos, fingerings, text reminders) migrate intelligently across versions — tied to musical moments, not page positions.

## Tech Stack
- **Backend:** Node.js + Express, PostgreSQL, S3-compatible storage (for PDFs/audio)
- **Frontend:** React + TypeScript
- **Mobile/Tablet:** React Native (iPad-first)
- **OMR Engine:** Audiveris (open source) for PDF-to-MusicXML semantic extraction
- **Auth:** JWT, per-ensemble role model (owner / editor / player)
- **Notifications:** Push via APNs (iOS) + web push

## Repo Structure
```
/backend          Express API
/frontend         React web app (composer/bandleader dashboard)
/mobile           React Native iPad app (player stand view)
/omr-service      Audiveris wrapper microservice
/shared           Types, constants shared across packages
/migrations       SQL migrations (numbered, sequential)
/scripts          Dev utilities
```

## Key Commands
```bash
npm run dev           # Start all services locally (docker-compose)
npm run test          # Run full test suite
npm run migrate       # Run pending DB migrations
npm run omr:process   # Process a single PDF through OMR pipeline (for testing)
```

## Database Conventions
- All tables have `id` (UUID), `created_at`, `updated_at`
- Soft deletes via `deleted_at` (never hard delete music data)
- Migrations are numbered: `001_initial.sql`, `002_add_annotations.sql` etc.

## Core Domain Objects
- **Ensemble** — a group (band, orchestra, class). Has members with roles.
- **Chart** — a piece of music. Belongs to an ensemble.
- **ChartVersion** — a snapshot of a chart. Has one or more Parts.
- **Part** — a single instrument's PDF for a given version. Has a semantic MusicXML representation after OMR processing.
- **Annotation** — a player's marking on a Part. Has an anchor (see SPEC.md for anchor types).
- **VersionDiff** — computed diff between two ChartVersions. Stored as JSON.

## Non-Negotiables
- Never hard-delete a ChartVersion or Annotation. Restore must always be possible.
- OMR processing is async — always queue it, never block the upload response.
- Annotation anchors are stored as structured JSON, never as raw page coordinates alone.
- Per-part access control: players only receive their own part, never the full score unless explicitly granted.

## Testing
- Unit tests for all OMR parsing and diff logic
- Integration tests for version push → diff → notification pipeline
- Snapshot tests for annotation migration across known version-change scenarios
- Always run tests before marking a task complete
