# Score Editor (Ask Palette) — Full Spec

**Status:** Spec complete. Build will ship in two slices.
**Date:** 2026-05-05
**Suggested repo path:** `docs/score-editor-spec-2026-05-05.md`

## Summary

Scorva grows a score editor with two interaction modes: a natural-language Ask Palette (primary) and click-to-edit precision selection (fallback). The editor handles transposition plus a bounded set of light fixes (single-note pitch, single-note rhythm, accidental corrections). Director edits create new ensemble-visible versions through the standard publish + diff + migration pipeline. Player edits create private personal versions visible only to that player, supporting multiple named branches. Verovio renders edits in-app live; MuseScore CLI renders saved versions to PDF.

The architecture pivot from "Scorva is a viewer" to "Scorva is an editor" is intentional but bounded — this is composer-copyist tier editing, not Sibelius replacement.

## Decisions

- **A. Editor audience:** Both directors and players, with player-emphasis. Director edits create new ensemble versions (replace authoritative). Player edits create private personal versions (fork, only-self-visible).
- **B. Edit scope:** Transposition (key change, instrument change, octave displacement) + single-note pitch fix + single-note rhythm fix + accidental correction. No structural edits (no add/remove measures, no repeats, no codas).
- **C. Output mode:** User chooses per session — "Preview only" or "Save as new version" (player) / "Save and publish" (director). Preview is non-destructive.
- **D. Renderers:** Verovio in-browser for live preview after each Apply. MuseScore CLI server-side for PDF generation when saving as new version. Verovio output is always available; MuseScore PDF is only generated on save.
- **E. Interaction model:** Ask Palette is primary entry. Click-to-edit is precision fallback when natural language is ambiguous or selection is needed.
- **F. Render timing:** Render on commit, not live keystroke. User issues a command, presses Apply, sees the result.
- **G. Range violations:** Warn but allow. Modal dialog: "This puts notes outside the violin's playable range. Apply anyway? / Cancel."
- **H. Annotation handling on edit:**
  - Player creates personal version: existing annotations on the original part automatically carry forward to the personal version. Anchor logic uses existing measure-level migration.
  - Director publishes a new ensemble version via edit: annotations migrate via the standard cross-version migration pipeline (treating the edited result as v_n+1).
- **I. Branching for personal versions:** Players can create multiple named personal versions ("quiet recital edit," "concert pitch read," "loud festival edit") and switch between them in the part view. Each personal version forks from a specific authoritative version.

## Architectural pieces

This feature introduces three things Scorva hasn't built before. Worth naming explicitly:

**1. Ask Palette LLM routing layer.** Free text in → structured operation grammar out. The LLM emits validated JSON operations like `{ "op": "transpose", "interval": "down_half_step", "scope": "whole_part" }`. The application never executes free-form code; it executes operations from a closed set. This containment matters because LLM output is not deterministic and bad output should produce a clean "I didn't understand" rather than a corrupted score.

**2. Music21 as a backend dependency.** Python library, added to the OMR sidecar service or a sibling sidecar. Handles all transposition, pitch arithmetic, rhythm changes, accidental conversion. We do not rewrite music21; we orchestrate it. The sidecar accepts MusicXML + operation JSON, returns transformed MusicXML.

**3. Personal version branching.** New data model dimension. A `versions` row gains optional `private_owner_user_id` (null = ensemble-visible, set = visible only to that user) and `branch_label` (user's name for the version). Plus a `parent_version_id` self-FK for the fork point.

## Data model

### `versions` table — additions

```sql
ALTER TABLE versions
  ADD COLUMN private_owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN branch_label TEXT,
  ADD COLUMN parent_version_id UUID REFERENCES versions(id) ON DELETE SET NULL,
  ADD COLUMN edit_origin TEXT
    CHECK (edit_origin IN ('upload', 'editor_director', 'editor_player'));

CREATE INDEX idx_versions_private_owner
  ON versions (part_id, private_owner_user_id)
  WHERE private_owner_user_id IS NOT NULL;
```

- `private_owner_user_id`: null → standard ensemble version. Set → personal fork visible only to that user.
- `branch_label`: user-given name. Null for ensemble versions; defaults to user-supplied label for personal versions.
- `parent_version_id`: which authoritative version this forks from. Null for original uploads.
- `edit_origin`: how the version came to exist. `'upload'` for OMR-from-PDF, `'editor_director'` for director Ask Palette save, `'editor_player'` for player personal version save.

**Critical query change:** Every existing query that lists versions must filter `private_owner_user_id IS NULL OR private_owner_user_id = $currentUserId`. This is a one-line change per query but applies broadly. Audit before merging Slice 1.

### `edit_operations` table — new

Captures the audit trail of each Ask Palette command. Useful for debugging, useful for re-running an edit, useful for showing the user what they did.

```sql
CREATE TABLE edit_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  parent_version_id UUID NOT NULL REFERENCES versions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  natural_language_input TEXT,
  operation_json JSONB NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_edit_operations_version
  ON edit_operations (version_id);
```

`operation_json` is the structured grammar (see below). `natural_language_input` is what the user typed (null for click-to-edit operations that didn't go through the palette).

### `versions.musicxml_blob` and `versions.pdf_blob` — assumed already exist

Verify during Slice 1: each version needs storage for both the MusicXML it represents and the rendered PDF. If the schema currently only stores `pdf_url` and derives MusicXML lazily from OMR, we need to make MusicXML first-class (since editor versions don't come from PDFs — they come from MusicXML transformations).

## Operation grammar

Closed set of operations the LLM is allowed to emit. Anything outside this grammar is rejected with "I didn't understand that command."

```ts
type EditOperation =
  | TransposeOp
  | OctaveDisplaceOp
  | InstrumentChangeOp
  | PitchFixOp
  | RhythmFixOp
  | AccidentalFixOp;

type TransposeOp = {
  op: 'transpose';
  interval: 'up_half_step' | 'down_half_step' | 'up_whole_step' | 'down_whole_step'
          | 'up_minor_third' | 'down_minor_third' | 'up_major_third' | 'down_major_third'
          | 'up_perfect_fourth' | 'down_perfect_fourth' | 'up_perfect_fifth' | 'down_perfect_fifth'
          | 'up_octave' | 'down_octave';
  scope: 'whole_part' | { measureRange: [number, number] };
};

type OctaveDisplaceOp = {
  op: 'octave_displace';
  direction: 'up' | 'down';
  scope: 'whole_part' | { measureRange: [number, number] };
};

type InstrumentChangeOp = {
  op: 'instrument_change';
  newInstrument: string;  // e.g. "trumpet_in_bb", "horn_in_f", "violin"
  // System computes implied transposition automatically
};

type PitchFixOp = {
  op: 'pitch_fix';
  measure: number;
  beat: number;          // 1-indexed within the measure
  voiceIndex?: number;   // for multi-voice measures
  oldPitch?: string;     // optional sanity-check ("F#4")
  newPitch: string;      // required ("G4")
};

type RhythmFixOp = {
  op: 'rhythm_fix';
  measure: number;
  beat: number;
  voiceIndex?: number;
  newDuration: 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth'
             | 'dotted_half' | 'dotted_quarter' | 'dotted_eighth';
  // Note: changing duration may require subsequent beat adjustments;
  // music21 handles this and may return an error if the change can't be reconciled
  // within the measure
};

type AccidentalFixOp = {
  op: 'accidental_fix';
  measure: number;
  beat: number;
  voiceIndex?: number;
  newAccidental: 'natural' | 'sharp' | 'flat' | 'double_sharp' | 'double_flat';
};
```

The LLM is given the grammar in its prompt and instructed to emit JSON matching exactly one of these shapes. Validation happens server-side via Zod before the operation is sent to music21.

If the user's natural language doesn't map to a valid operation — for example, "make this part funkier" — the LLM is instructed to return `{ op: 'unknown', reason: '<short user-readable explanation>' }` and the UI surfaces the reason.

## Ask Palette routing

```
User types: "transpose down a step"
         ↓
Frontend sends: { naturalLanguage: "transpose down a step", contextPartId, contextVersionId }
         ↓
Backend: POST /api/edits/parse
         ↓
LLM call (Claude Sonnet) with system prompt containing:
  - Operation grammar
  - Current part context (part name, measure count, key signature)
  - Instruction to return ONLY valid operation JSON
         ↓
LLM returns: { op: 'transpose', interval: 'down_whole_step', scope: 'whole_part' }
         ↓
Backend validates against Zod schema → returns to frontend
         ↓
Frontend: User clicks Apply → POST /api/edits/apply with operation
         ↓
Backend forwards to music21 sidecar → returns transformed MusicXML
         ↓
Backend renders Verovio preview → returns to frontend
         ↓
User clicks Save (or Save and Publish) → backend creates new version row
                                       → renders MusicXML to PDF via MuseScore CLI
                                       → triggers annotation migration (per Decision H)
```

## Renderer architecture

**Verovio (frontend, in-browser):**
- npm package `verovio` or via CDN
- Takes MusicXML string, renders SVG inline
- Used for: live preview after Apply
- No server roundtrip for rendering

**MuseScore CLI (backend sidecar):**
- New service or subprocess invocation: `musescore -o output.pdf input.musicxml`
- Used for: PDF generation when saving a new version
- Slow (5-15 seconds per render) — runs as a background job after the version row is created
- The version row gets a `pdf_render_status` field: `'pending' | 'rendering' | 'complete' | 'failed'`
- Frontend shows the version with the Verovio SVG until PDF render completes

**MuseScore CLI deployment caveat:** MuseScore must be installed on the server. For local dev, expect a local install. For production, expect a Docker image addition. Same operational concern as Audiveris. This is real ops surface.

## Edit modes

### Player edit (creates personal version)

1. Player opens part view of Flute v2.
2. Clicks "Edit" button → enters edit mode.
3. Types in Ask Palette: "transpose down a step."
4. Apply renders Verovio preview inline.
5. Player decides:
   - **Discard:** exits edit mode. Original Flute v2 unchanged.
   - **Save as personal version:** prompts for branch label ("Concert pitch read"). Creates new row in `versions` with `private_owner_user_id = currentUserId`, `branch_label = "Concert pitch read"`, `parent_version_id = Flute_v2.id`, `edit_origin = 'editor_player'`. Annotations from Flute v2 migrate to the personal version automatically (see Decision H).

The player then sees a version dropdown on the part view: "v2 (ensemble) | Concert pitch read (you) | Quiet recital edit (you)." Switching between them is instant; only the visible version's annotations and rendering load.

### Director edit (creates new ensemble version)

1. Director opens part view of Flute v2.
2. Clicks "Edit" button → enters edit mode.
3. Types: "fix the F# in m.42 to G."
4. Apply renders Verovio preview inline.
5. Director decides:
   - **Discard:** exits edit mode.
   - **Save and publish:** creates new row in `versions` with `private_owner_user_id = NULL` (ensemble-visible), `parent_version_id = Flute_v2.id`, `edit_origin = 'editor_director'`. Triggers standard cross-version migration. All ensemble members get notified per the notifications buildout.

The director sees the new version published immediately. Players see it on next reload.

## Range checking

Every operation result is checked against the destination instrument's range before being presented to the user.

```ts
const RANGES: Record<string, { absoluteLow: string; absoluteHigh: string; comfortableLow: string; comfortableHigh: string }> = {
  flute: { absoluteLow: 'C4', absoluteHigh: 'D7', comfortableLow: 'D4', comfortableHigh: 'C7' },
  trumpet_in_bb: { absoluteLow: 'F#3', absoluteHigh: 'D6', comfortableLow: 'A3', comfortableHigh: 'B5' },
  // ... full database for all v1 instruments
};
```

After music21 transforms the MusicXML, the backend extracts the pitch list and checks against the relevant instrument's `absoluteLow` / `absoluteHigh`. Notes outside this range trigger the warn-but-allow modal. The modal lists specific measures and pitches that are out of range, e.g.:

> ⚠️ This change puts these notes outside the flute's range:
> - m.34: B♭3 (below C4, the flute's lowest note)
> - m.41: E7 (above D7, the flute's highest note)
>
> [Apply anyway] [Cancel]

## Click-to-edit (precision fallback)

For ambiguous selections (e.g., "change this F" when there are multiple Fs in m.42), the user can click directly on a note head in the Verovio SVG. Verovio assigns each note a stable ID; the click handler captures it and pre-populates the operation form.

```
User clicks note head → Verovio returns noteId "n_42_3_2_0"
                     → Frontend resolves to (measure, beat, voiceIndex)
                     → Pre-populates pitch/rhythm/accidental form
                     → User picks new value, clicks Apply
                     → Standard apply pipeline runs
```

This is opt-in; the Ask Palette is the primary entry. Click-to-edit is for when the natural-language is ambiguous or the user wants pixel-precision.

## API surface

### `POST /api/edits/parse`

Parses natural language to operation JSON.

Body:
```ts
{
  naturalLanguage: string;
  contextPartId: string;
  contextVersionId: string;
}
```

Response:
```ts
{ op: ValidOperation } | { op: 'unknown'; reason: string }
```

### `POST /api/edits/apply`

Applies an operation to a version's MusicXML, returns transformed MusicXML and Verovio-ready SVG. Does NOT save.

Body:
```ts
{
  partId: string;
  versionId: string;
  operation: ValidOperation;
}
```

Response:
```ts
{
  transformedMusicXml: string;
  verovioSvg: string;
  rangeWarnings?: Array<{ measure: number; pitch: string; reason: string }>;
}
```

### `POST /api/parts/:partId/versions/edited`

Saves an edited result as a new version. This is where personal vs ensemble visibility is determined.

Body:
```ts
{
  parentVersionId: string;
  transformedMusicXml: string;
  operationJson: ValidOperation;
  naturalLanguageInput?: string;
  saveMode: 'personal' | 'ensemble';
  branchLabel?: string;  // required if saveMode = 'personal'
  versionLabel?: string; // required if saveMode = 'ensemble'
}
```

Response: the new version row, plus the migration job ID if saveMode is ensemble.

### Existing version-listing endpoints — must filter

Every endpoint that returns versions must add the visibility filter:

```sql
WHERE part_id = $partId
  AND (private_owner_user_id IS NULL OR private_owner_user_id = $currentUserId)
```

Audit: search for `versions WHERE` in `backend/src/`.

### `DELETE /api/parts/:partId/versions/:versionId/personal`

Deletes a personal version. Permission: only `private_owner_user_id` can delete. Hard delete is fine since personal versions are never authoritative.

### `PATCH /api/parts/:partId/versions/:versionId/personal`

Renames a personal version's `branch_label`. Same permission model.

## Frontend surface

### New components

- `EditModeToggle` — "Edit" button on part view. Enters edit mode, swaps the toolbar.
- `AskPalette` — input field, submit button, conversational-style result display showing the parsed operation before applying.
- `OperationPreview` — shows the parsed operation in human-readable form ("Transpose whole part down a whole step. Apply?") with Apply / Cancel.
- `EditPreviewView` — Verovio-rendered SVG of the result, replacing the static PDF view while in edit mode.
- `RangeWarningModal` — warn-but-allow dialog listing out-of-range notes.
- `SaveAsPersonalDialog` — branch label input + save.
- `SaveAndPublishDialog` — version label input + confirmation. Uses standard publish flow under the hood.
- `BranchSwitcher` — dropdown on part view showing all visible versions: ensemble versions plus the current user's personal versions for this part.
- `ClickToEditOverlay` — Verovio SVG with click handlers on note elements. Dormant until user activates "select note" mode.

### Modified components

- `PartView` — adds Edit button, branch switcher dropdown, edit-mode toolbar swap.
- Version listing UI everywhere — must reflect the visibility filter.

## Out of scope (explicit)

- Structural edits: add/remove measures, repeats, codas, voltas, time signature changes, key signature changes (key signature changes through transposition are in scope; manually editing the key signature itself is not).
- Multi-note operations beyond transposition. Cannot select 8 notes and change all of them in one operation; do them one at a time.
- Tempo / dynamic / articulation editing.
- Editing layout (page breaks, system breaks, spacing).
- Importing edits from external apps.
- Live re-rendering on every keystroke. Render on commit (Decision F).
- Sharing personal versions between users. Personal is personal.
- Forking from a personal version. Personal versions can only fork from ensemble versions.
- Branching for ensemble versions. Director edits are linear; the system has no merge UI for ensemble branches.

## Open questions for build time

1. **MusicXML storage location and format.** Stored as text in DB? In S3 with a URL in DB? Compressed? Slice 1 needs to answer this concretely. Recommendation: text column on `versions` for v1; revisit if files get large.
2. **MuseScore CLI deployment.** Local install for dev. Production deployment is a real ops decision (Docker image, network call to a separate service, or pre-rendered to a queue). Defer to Slice 2.
3. **LLM prompt iteration.** First version of the LLM system prompt will get the obvious cases. Edge cases ("transpose just the chorus down a step" — but the chorus isn't tagged in the MusicXML) will need iteration. Plan for the prompt to evolve.
4. **Personal version annotation migration after director publishes a new ensemble version.** The cellist has "Concert pitch read" forked from Flute v2 with annotations carried over. The director publishes Flute v3. What happens to the personal version? Three options:
   - The personal version stays pinned to v2 forever. User can re-fork from v3 manually.
   - The personal version's parent_version_id auto-updates to v3, with annotation re-migration.
   - Prompt the user: "Flute v3 was published. Update your personal version to fork from v3?"
   Recommendation: option 1 for v1 (pin to fork point). Re-forking is manual. Surface in Slice 2.
5. **Click-to-edit hit testing reliability.** Verovio's note ID stability across re-renders is the load-bearing assumption. Test thoroughly in Slice 2 before exposing in UI.
6. **Edit history beyond `edit_operations` audit.** Should the editor support undo within a session? For Slice 1: each Apply replaces the previous Apply (linear, no undo stack). For Slice 2: consider a simple undo for the current session.
7. **What does the LLM use for instrument context?** The LLM needs to know "this is a flute part" to produce sensible defaults. Pass `partName` and `instrumentSlot` in the parse request context.

## Sign-off

9 product decisions. New data model: 4 columns on versions, new `edit_operations` table. New backend service: music21 sidecar (or extension to OMR sidecar). New external dependency: MuseScore CLI. New frontend dependency: Verovio. New API surface: 4 endpoints plus 2 modifications. Two-slice build plan.

This is the largest single feature spec'd to date.
