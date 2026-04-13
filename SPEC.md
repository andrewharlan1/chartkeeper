# ChartKeeper — Product Spec

## The Promise
"Push a new chart. Every player opens their iPad and sees exactly what changed, highlighted, before rehearsal starts. Their annotations follow the music — not the page."

---

## Phase 1 — Core Version Control & Diff
*Goal: A bandleader can push a new PDF version and every player sees what changed.*

### 1.1 Ensemble & User Management
- User signup/login (email + password, JWT)
- Create an Ensemble (name, instrument list)
- Invite players by email → they receive a link, create account, join ensemble
- Roles: `owner` (full control), `editor` (can push versions), `player` (read-only, own part only)
- A user can belong to multiple ensembles

### 1.2 Chart & Version Management
- Owner/editor can create a Chart (title, composer, key, time signature — all optional metadata)
- Upload a new ChartVersion: accepts one PDF per instrument part (e.g., "trumpet.pdf", "trombone.pdf")
- Version gets a name (auto: "Version 1", "Version 2" or custom: "Recording Session Draft")
- Versions are immutable once created — never overwrite, always create new
- Version list UI shows all versions with timestamps, names, and status

### 1.3 OMR Processing Pipeline
- On PDF upload, queue an async OMR job via the omr-service
- OMR extracts: measure numbers, note pitches/rhythms, dynamic markings, section labels (rehearsal letters, repeat markers, named sections)
- Output stored as MusicXML + structured JSON per Part
- OMR status exposed via API: `pending | processing | complete | failed`
- If OMR fails, the PDF is still usable — just without semantic diff capabilities (graceful degradation)

### 1.4 Version Diff Engine
- When a new ChartVersion is created, compute a VersionDiff against the previous version for each Part
- Diff compares at measure level using OMR output
- Diff output (JSON) includes:
  - `changedMeasures`: array of measure numbers that differ
  - `changeDescriptions`: human-readable strings per changed measure (e.g., "m.34: E♭ replaces D; accent added")
  - `structuralChanges`: insertions/deletions of measures, section label changes
  - `measureMapping`: a map from old measure numbers → new measure numbers (accounting for insertions/deletions)
- `measureMapping` is critical — it is used by the annotation migration engine

### 1.5 Player Notification
- When a new version is pushed, all players receive a push notification
- Notification text: "[Chart name] updated — [N] measures changed in your part"
- Notification links directly to their part in the new version with diff overlay active

### 1.6 Player View (iPad)
- Player sees their part (PDF rendered full-screen)
- Changed measures highlighted in amber/yellow overlay
- Diff summary panel (collapsible): lists changed measures in plain language
- Toggle: "Show changes" / "Hide changes"
- Offline-capable: parts and annotations cached locally, sync on reconnect

### 1.7 Version Restore
- Owner can restore any prior ChartVersion as the "active" version
- Restoring creates no new version — just changes which version is marked active
- Players are notified of the restore with a push notification

---

## Phase 2 — Smart Annotation Migration
*Goal: Player annotations survive version updates and land in the right musical place.*

### 2.1 Annotation Data Model
Each Annotation has:
- `id`: UUID
- `partId`: which Part it belongs to
- `type`: enum — `dynamic | fingering | text | highlight | bowing | form_mark`
- `content`: the annotation content (text string, or symbol type)
- `anchor`: structured JSON — see Anchor Types below
- `pagePosition`: raw x/y/page coordinates (always stored as fallback)
- `createdAt`, `updatedAt`
- `deletedAt` (soft delete only)

### 2.2 Anchor Types
Three anchor modes — the system picks the most semantically precise one available:

**Note-level anchor** (most precise)
```json
{
  "type": "note",
  "measureNumber": 12,
  "beat": 3,
  "pitch": "D4"
}
```
Use for: fingerings, articulations tied to a specific note.

**Measure-span anchor**
```json
{
  "type": "measureSpan",
  "startMeasure": 17,
  "endMeasure": 32
}
```
Use for: dynamics (crescendo, decrescendo), highlights spanning a passage, bowings across a phrase.

**Structural landmark anchor**
```json
{
  "type": "landmark",
  "sectionLabel": "Coda",
  "offsetMeasures": 2
}
```
Use for: text reminders tied to a structural moment ("watch conductor here"), cuts, form marks.

### 2.3 Anchor Assignment at Creation Time
- When a player draws or places an annotation, the app determines the best anchor type:
  - If placed on/near a single note: note-level anchor
  - If spanning multiple measures: measure-span anchor
  - If near a rehearsal letter, repeat sign, or named section: landmark anchor
- `pagePosition` is always stored alongside the anchor as a fallback

### 2.4 Annotation Migration on Version Update
When a new ChartVersion is pushed for a chart:
1. For each player's annotations on the previous version's Part:
2. For each annotation, compute its new position using the `measureMapping` from the VersionDiff:
   - **Note-level**: look up `measureMapping[oldMeasure]` → new measure number. If the measure was deleted, flag as `NEEDS_REVIEW`.
   - **Measure-span**: map `startMeasure` and `endMeasure` through `measureMapping`. If the span was partially deleted, flag as `NEEDS_REVIEW`.
   - **Landmark**: find the matching section label in the new version's OMR output. Apply `offsetMeasures` from the new label position.
3. Confidence scoring:
   - `HIGH`: clean mapping, no ambiguity → migrate silently
   - `LOW`: measure deleted, span partially removed, landmark not found → flag as `NEEDS_REVIEW`
4. Migrated annotations appear on the new Part automatically
5. `NEEDS_REVIEW` annotations are shown to the player in a review panel: "We moved your [annotation type] — does this look right?" with Accept / Adjust / Discard options

### 2.5 Annotation Types — Creation UI
- **Dynamic markings**: tap-and-drag to set span, choose symbol (crescendo, decrescendo, accent, etc.)
- **Fingerings**: tap a note, type or select fingering
- **Text reminders**: tap anywhere, type text
- **Highlights**: tap-and-drag across a passage, choose color
- **Bowings**: tap-and-drag, choose bowing symbol (strings instruments)
- **Form marks**: tap near a barline, mark as cut / repeat / coda etc.

---

## Phase 3 — Transposition & Range Intelligence
*Goal: A composer can transpose any part to any key with automatic range flagging.*

### 3.1 Transposition
- Available for any Part that has completed OMR processing (MusicXML available)
- Transpose to any key, any clef
- Transposition is non-destructive — creates a new derived Part on the same ChartVersion
- Original-key Part is always preserved

### 3.2 Range Intelligence
- Instrument range database: every standard orchestral/jazz/commercial instrument
- Fields per instrument: `absoluteLow`, `absoluteHigh`, `comfortableLow`, `comfortableHigh`
- After transposition: scan every note in the transposed Part
- Flag notes outside comfortable range (warning) and outside absolute range (error)
- UI shows: flagged measures highlighted in orange (warning) or red (error)
- Per flagged note: suggest alternatives — "Drop this passage an octave?" (auto-preview available)

### 3.3 Audio File Attachments
- Audio files (reference recordings, demos, play-alongs) can be attached to any ChartVersion
- Treated as artifacts, not independently versioned
- Playback available in the player view
- Supported formats: MP3, AAC, WAV

---

## Data Model Summary

```sql
users (id, email, name, created_at)
ensembles (id, name, owner_id, created_at)
ensemble_members (id, ensemble_id, user_id, role, created_at)
charts (id, ensemble_id, title, composer, metadata_json, created_at)
chart_versions (id, chart_id, version_number, version_name, is_active, created_by, created_at)
parts (id, chart_version_id, instrument_name, pdf_s3_key, musicxml_s3_key, omr_status, omr_json, created_at)
version_diffs (id, chart_id, from_version_id, to_version_id, diff_json, created_at)
annotations (id, part_id, user_id, type, content, anchor_json, page_position_json, confidence, migration_status, deleted_at, created_at, updated_at)
audio_attachments (id, chart_version_id, label, s3_key, mime_type, created_at)
notifications (id, user_id, ensemble_id, chart_version_id, type, message, read_at, created_at)
```

---

## API Outline

```
POST   /auth/signup
POST   /auth/login

POST   /ensembles
GET    /ensembles/:id
POST   /ensembles/:id/invite
GET    /ensembles/:id/members

POST   /charts
GET    /charts/:id
POST   /charts/:id/versions          # Upload new version (multipart: PDFs per instrument)
GET    /charts/:id/versions          # List all versions
GET    /charts/:id/versions/:vId     # Get version detail + diff from previous
POST   /charts/:id/versions/:vId/restore

GET    /parts/:id                    # Get part (PDF url + OMR status)
GET    /parts/:id/diff               # Get diff overlay data for this part

POST   /parts/:id/annotations        # Create annotation
GET    /parts/:id/annotations        # Get all annotations for this part (current user)
PATCH  /annotations/:id             # Update annotation (content, position)
DELETE /annotations/:id             # Soft delete

POST   /parts/:id/transpose          # Request transposition (async)
GET    /parts/:id/range-report       # Get range intelligence report post-transpose
```

---

## Phase Execution Order

### Do Phase 1 first. In this order:
1. DB schema + migrations (all tables)
2. Auth (signup, login, JWT middleware)
3. Ensemble + member management
4. Chart + ChartVersion creation + S3 upload
5. OMR service wrapper (Audiveris, async queue)
6. VersionDiff computation engine
7. Player notification (push)
8. Backend API complete + tested
9. Web dashboard (React): composer/bandleader view
10. iPad app (React Native): player view with diff overlay

### Then Phase 2:
1. Annotation data model + API
2. Anchor assignment logic
3. Migration engine (measureMapping → new anchors)
4. Confidence scoring + NEEDS_REVIEW flow
5. Annotation UI (all types) in iPad app

### Then Phase 3:
1. Instrument range database
2. Transposition via MusicXML
3. Range report + flagging UI
4. Audio attachment upload + playback

---

## Open Technical Questions (Resolve Before Implementing)
1. **OMR accuracy threshold**: at what confidence level do we fall back to image-only mode and skip diff?
2. **Annotation conflict**: if two players annotate the same measure and a new version drops, whose anchor wins? (Current answer: each player's annotations are private — no conflict)
3. **Offline sync**: what is the conflict resolution strategy when a player annotates offline and syncs while a new version is live?
4. **OMR hosting**: run Audiveris as a sidecar container or a separate persistent service?
