/**
 * Re-exports the core diff job processing function for use in tests.
 * The main worker file starts a polling loop on import, so we isolate
 * the testable logic here.
 */
import { completeJob, failJob } from '../lib/queue';
import { diffVersion, OmrJson } from '../lib/diff';
import { db } from '../db';

interface DiffJobPayload {
  chartId: string;
  fromVersionId: string;
  toVersionId: string;
}

export async function processDiffJobForTest(jobId: string, payload: DiffJobPayload): Promise<void> {
  const { chartId, fromVersionId, toVersionId } = payload;

  const fromParts = await db.query<{ instrument_name: string; omr_json: OmrJson }>(
    `SELECT instrument_name, omr_json FROM parts
     WHERE chart_version_id = $1 AND omr_status = 'complete' AND omr_json IS NOT NULL`,
    [fromVersionId]
  );

  const toParts = await db.query<{ instrument_name: string; omr_json: OmrJson }>(
    `SELECT instrument_name, omr_json FROM parts
     WHERE chart_version_id = $1 AND omr_status = 'complete' AND omr_json IS NOT NULL`,
    [toVersionId]
  );

  if (fromParts.rows.length === 0 || toParts.rows.length === 0) {
    await completeJob(jobId);
    return;
  }

  const toPartMap = new Map(toParts.rows.map((p) => [p.instrument_name, p.omr_json]));
  const pairs = fromParts.rows
    .filter((p) => toPartMap.has(p.instrument_name))
    .map((p) => ({
      instrument: p.instrument_name,
      oldOmr: p.omr_json,
      newOmr: toPartMap.get(p.instrument_name)!,
    }));

  if (pairs.length === 0) {
    await completeJob(jobId);
    return;
  }

  const diffJson = diffVersion(pairs);

  await db.query(
    `INSERT INTO version_diffs (chart_id, from_version_id, to_version_id, diff_json)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (from_version_id, to_version_id)
     DO UPDATE SET diff_json = EXCLUDED.diff_json, updated_at = NOW()`,
    [chartId, fromVersionId, toVersionId, JSON.stringify(diffJson)]
  );

  await completeJob(jobId);
}
