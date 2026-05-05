# Cross-Instrument Annotation Migration — Build Summary

**Date:** 2026-05-05
**Spec:** `docs/cross-instrument-migration-spec-2026-05-05.md`
**Status:** Backend complete, frontend scaffolding complete

## What was built

### Backend (8 commits)

1. **Schema migration** — `migrations/021_annotation_migration_columns.sql`
   - `migration_source_kind` enum (`same_instrument | cross_instrument`)
   - `needs_review` boolean column (replaces `contentJson._needsReview` pattern)
   - `migratable` boolean column (per-annotation privacy opt-out, default true)
   - Partial indexes for review queries and migratable filtering

2. **Migration candidates endpoint** — `GET /ensembles/:id/migration-candidates?partId=`
   - Returns all parts in ensemble with annotation counts grouped by version
   - Wide-reading: counts all migratable annotations regardless of owner
   - Determines `isSameInstrument` via slot assignment overlap
   - Sorted: same-instrument first, then by annotation count

3. **Version creation extended** — `POST /versions` accepts `migrationSources`
   - Optional array of `{ sourcePartId, sourceVersionId, targetPartId }`
   - Enqueues background migration job when provided

4. **Migration status** — `GET /versions/:id/migration-status`
   - Polls jobs table for migration jobs targeting this version
   - Derives overall status: none/pending/processing/complete/partial/failed

5. **Enqueue endpoint** — `POST /versions/:id/enqueue-cross-migration`
   - Called after parts uploaded (when target part IDs are known)
   - Validates and enqueues migration job

6. **Privacy toggle** — `PATCH /annotations/:id/migratable`
   - Owner-only permission check
   - Sets migratable boolean for privacy opt-out

7. **Annotation list extended** — `GET /parts/:partId/annotations`
   - Now returns `migrationSourceKind`, `needsReview`, `migratable`, `sourceAnnotationId`, `sourceVersionId`
   - Resolves provenance: `sourcePartName`, `sourceVersionLabel`, `sourceAuthorName`
   - Server-side join through source annotation → part → version → user

8. **Migration worker** — `backend/src/workers/migration.worker.ts`
   - Polling-based job processor for `type='migration'`
   - Wide-reading source query: `migratable=TRUE AND deleted_at IS NULL`, NO owner filter
   - Determines `migration_source_kind` by slot overlap
   - Cross-instrument: always flagged `needsReview=true`
   - Same-instrument: uses anchor confidence from diff
   - Destination user owns the copy (`owner_user_id` = requesting user)
   - Idempotent via `sourceAnnotationId` check
   - 10 integration tests passing

### Frontend (5 commits)

1. **Types & API** — Extended `Annotation` interface, added API functions
   - `getMigrationCandidates`, `getMigrationStatus`, `enqueueCrossMigration`, `setAnnotationMigratable`

2. **MigrationSourcePicker** — Modal with cascading part → version selection
   - Shows annotation counts (wide-reading)
   - Marks same-instrument sources
   - Dims empty sources

3. **MigrationSourcesCard** — Inline card for upload dialog
   - Manages selected sources as removable chips
   - Triggers picker modal

4. **MigrationProgressBadge** — Polls migration-status, shows processing count
   - Auto-hides on completion, fires `onComplete` callback

5. **MigrationFailureModal** — Shows per-source success/failure with retry

6. **AnnotationProvenancePopover** — Displays source part, version, author for cross-instrument

7. **AnnotationPrivacyToggle** — Owner-only migratable toggle

8. **Upload page integration** — MigrationSourcesCard in "Publish as new" flow, enqueues job after upload

9. **Part view integration** — Badge in topbar, auto-reloads annotations on completion

## Critical design decisions preserved

- **Wide-reading semantics**: No `owner_user_id` filter on source queries. Any user's migratable annotations are pulled.
- **Push-copy semantics**: Migrated annotations are independent copies. Source edits don't propagate.
- **Destination user owns copies**: `owner_user_id` = the user who triggered migration, not the original author.
- **`migratable` opt-out**: Per-annotation privacy flag. Default true. Only the owner can change it.
- **No `source_annotation_id IS NULL` filter**: Confirmed this pattern never existed in the codebase (spec warning was for linked-reference case that was never built).

## What's left for follow-up

- AnnotationLayer integration (wire AnnotationProvenancePopover into the annotation popover/context menu)
- AnnotationPrivacyToggle integration into annotation context menu
- Default pre-check logic (spec decision 3.3: same-instrument most-recent auto-selected)
- Push notification on migration complete (depends on notification infrastructure)
- Worker crash recovery (mark stale `processing` jobs as failed)
- OMR-blocked migration wait (60s timeout before failing)
- `annotationsByUser` optional field in picker
