/**
 * Re-exports the core diff job processing function for use in tests.
 * The main worker file starts a polling loop on import, so we isolate
 * the testable logic here.
 *
 * Uses the LCS-based diff (not Vision API) so tests can run without
 * external API calls. Matches parts by instrument slot assignment.
 */
import { completeJob } from '../lib/queue';
import { diffPart, OmrJson } from '../lib/diff';
import { notifyNewVersion, notifyNewVersionNoDiff } from '../lib/notifications';
import { db } from '../db';

interface DiffJobPayload {
  ensembleId: string;
  fromVersionId: string;
  toVersionId: string;
}

export async function processDiffJobForTest(jobId: string, payload: DiffJobPayload): Promise<void> {
  const { ensembleId, fromVersionId, toVersionId } = payload;

  // Get chartId
  const versionRow = await db.query<{ chart_id: string }>(
    `SELECT chart_id FROM versions WHERE id = $1`, [toVersionId]
  );
  if (versionRow.rows.length === 0) {
    await completeJob(jobId);
    return;
  }
  const chartId = versionRow.rows[0].chart_id;

  // Get new version parts with their slot assignments and OMR data
  const toParts = await db.query<{
    part_id: string; part_name: string; omr_json: OmrJson;
    slot_id: string | null; slot_name: string | null; kind: string;
  }>(
    `SELECT p.id AS part_id, p.name AS part_name, p.omr_json, p.kind,
            psa.instrument_slot_id AS slot_id, isl.name AS slot_name
     FROM parts p
     LEFT JOIN part_slot_assignments psa ON psa.part_id = p.id
     LEFT JOIN instrument_slots isl ON isl.id = psa.instrument_slot_id
     WHERE p.version_id = $1 AND p.omr_status = 'complete' AND p.omr_json IS NOT NULL
       AND p.deleted_at IS NULL`,
    [toVersionId]
  );

  if (toParts.rows.length === 0) {
    await completeJob(jobId);
    await notifyNewVersionNoDiff(ensembleId, toVersionId).catch(() => {});
    return;
  }

  // For each (part, slot) pair, find the previous version's part in the same slot
  const diffResults: Array<{
    instrument: string; partDiff: ReturnType<typeof diffPart>;
    fromPartId: string; toPartId: string; slotId: string | null;
  }> = [];

  for (const toPart of toParts.rows) {
    let fromPart: { part_id: string; omr_json: OmrJson } | null = null;

    if (toPart.kind === 'score') {
      // Score: find previous version's score
      const prevScore = await db.query<{ part_id: string; omr_json: OmrJson }>(
        `SELECT p.id AS part_id, p.omr_json
         FROM parts p
         INNER JOIN versions v ON v.id = p.version_id
         WHERE v.chart_id = $1 AND v.id != $2
           AND p.kind = 'score' AND p.omr_status = 'complete' AND p.omr_json IS NOT NULL
           AND p.deleted_at IS NULL AND v.deleted_at IS NULL
         ORDER BY v.sort_order DESC LIMIT 1`,
        [chartId, toVersionId]
      );
      if (prevScore.rows[0]) fromPart = prevScore.rows[0];
    } else if (toPart.slot_id) {
      // Instrument part: find previous version's part in the same slot
      const prevSlotPart = await db.query<{ part_id: string; omr_json: OmrJson }>(
        `SELECT p.id AS part_id, p.omr_json
         FROM parts p
         INNER JOIN part_slot_assignments psa ON psa.part_id = p.id
         INNER JOIN versions v ON v.id = p.version_id
         WHERE psa.instrument_slot_id = $1
           AND v.chart_id = $2 AND v.id != $3
           AND p.omr_status = 'complete' AND p.omr_json IS NOT NULL
           AND p.deleted_at IS NULL AND v.deleted_at IS NULL
         ORDER BY v.sort_order DESC, p.updated_at DESC LIMIT 1`,
        [toPart.slot_id, chartId, toVersionId]
      );
      if (prevSlotPart.rows[0]) fromPart = prevSlotPart.rows[0];
    }

    if (!fromPart) continue;

    const instrument = toPart.slot_name || toPart.part_name;
    const pd = diffPart(fromPart.omr_json, toPart.omr_json);
    diffResults.push({
      instrument,
      partDiff: pd,
      fromPartId: fromPart.part_id,
      toPartId: toPart.part_id,
      slotId: toPart.slot_id,
    });
  }

  if (diffResults.length === 0) {
    await completeJob(jobId);
    await notifyNewVersionNoDiff(ensembleId, toVersionId).catch(() => {});
    return;
  }

  // Build version diff JSON for notification/annotation migration
  const diffJsonParts: Record<string, ReturnType<typeof diffPart>> = {};
  for (const r of diffResults) {
    diffJsonParts[r.instrument] = r.partDiff;
  }

  // Store one version_diffs row per (part, slot) pair
  for (const r of diffResults) {
    await db.query(
      `INSERT INTO version_diffs (from_part_id, to_part_id, slot_id, diff_json)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (to_part_id, slot_id)
       DO UPDATE SET diff_json = EXCLUDED.diff_json, from_part_id = EXCLUDED.from_part_id, updated_at = NOW()`,
      [r.fromPartId, r.toPartId, r.slotId, JSON.stringify(r.partDiff)]
    );
  }

  await completeJob(jobId);
  await notifyNewVersion(ensembleId, toVersionId, { parts: diffJsonParts }).catch(() => {});
}
