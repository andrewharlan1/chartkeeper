# Sidecar Diagnostic — 2026-05-05

**Answer: Category 4 — sidecar is producing output, but the API endpoint isn't surfacing it.**

The musicdiff sidecar is running on port 8484 (`/health` returns `{"status":"ok"}`). The diff worker process is running and calls the sidecar via `POST /diff` when both parts have `audiverisMxlS3Key`. The worker stores the result nested inside `diffJson` as `{ ...lcsDiff, musicdiff: { changedMeasures, insertedMeasures, deletedMeasures, noteOperations } }` (diff.worker.ts:365-366). However, the `GET /parts/:id/diff` endpoint (parts.ts:611-638) casts `diffJson` to a type that omits the `musicdiff` key entirely — it only extracts `changedMeasures`, `changeDescriptions`, `changedMeasureBounds`, and `structuralChanges`. The frontend type `SlotDiff` already has an optional `noteOperations` field (api/parts.ts:79) and `DiffLog.tsx` renders it (lines 128-130, 253-269), but the field is always undefined because the backend never sends it.

**Fix (one line):** In `backend/src/routes/parts.ts`, add `musicdiff?: { noteOperations?: Array<{ measure: number; operation: string; description: string }> }` to the `diffJson` type cast at line 612, then add `noteOperations: diff.musicdiff?.noteOperations ?? []` to the return object at line 627.
