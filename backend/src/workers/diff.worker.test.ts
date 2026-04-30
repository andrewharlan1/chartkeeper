import { db } from '../db';
import { enqueueJob, claimNextJob } from '../lib/queue';

jest.mock('../lib/s3', () => ({
  uploadFile: jest.fn().mockResolvedValue('mocked-key'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://example.com/signed'),
}));

async function clearDb() {
  await db.query(`DELETE FROM version_diffs`);
  await db.query(`DELETE FROM jobs`);
  await db.query(`DELETE FROM parts`);
  await db.query(`DELETE FROM versions`);
  await db.query(`DELETE FROM charts`);
  await db.query(`DELETE FROM workspace_members`);
  await db.query(`DELETE FROM ensembles`);
  await db.query(`DELETE FROM users`);
}

const sampleOmrJson = {
  measures: [
    { number: 1, notes: [{ pitch: 'C4', beat: 1, duration: 'q' }], dynamics: [] },
    { number: 2, notes: [{ pitch: 'D4', beat: 1, duration: 'q' }], dynamics: [] },
  ],
  sections: [],
  partName: 'trumpet',
};

const changedOmrJson = {
  measures: [
    { number: 1, notes: [{ pitch: 'Eb4', beat: 1, duration: 'q' }], dynamics: [] },
    { number: 2, notes: [{ pitch: 'D4', beat: 1, duration: 'q' }], dynamics: [] },
  ],
  sections: [],
  partName: 'trumpet',
};

async function seedVersions() {
  const userRes = await db.query(
    `INSERT INTO users (email, name, password_hash) VALUES ('difftest@example.com', 'Diff Test', 'x') RETURNING id`
  );
  const userId = userRes.rows[0].id;

  const ensRes = await db.query(
    `INSERT INTO ensembles (name, owner_id) VALUES ('Diff Band', $1) RETURNING id`, [userId]
  );
  const ensembleId = ensRes.rows[0].id;

  const chartRes = await db.query(
    `INSERT INTO charts (ensemble_id, title) VALUES ($1, 'Test Chart') RETURNING id`, [ensembleId]
  );
  const chartId = chartRes.rows[0].id;

  const v1Res = await db.query(
    `INSERT INTO chart_versions (chart_id, version_number, version_name, is_active, created_by)
     VALUES ($1, 1, 'Version 1', false, $2) RETURNING id`, [chartId, userId]
  );
  const v2Res = await db.query(
    `INSERT INTO chart_versions (chart_id, version_number, version_name, is_active, created_by)
     VALUES ($1, 2, 'Version 2', true, $2) RETURNING id`, [chartId, userId]
  );

  return { chartId, v1Id: v1Res.rows[0].id, v2Id: v2Res.rows[0].id, userId };
}

beforeAll(clearDb);
afterEach(clearDb);
afterAll(async () => { await db.end(); });

describe('diff worker — processDiffJob', () => {
  it('creates a version_diff row when both versions have OMR data', async () => {
    const { chartId, v1Id, v2Id } = await seedVersions();

    // Insert complete parts with OMR data for both versions
    await db.query(
      `INSERT INTO parts (chart_version_id, instrument_name, pdf_s3_key, omr_status, omr_json)
       VALUES ($1, 'trumpet', 'key1.pdf', 'complete', $2)`,
      [v1Id, JSON.stringify(sampleOmrJson)]
    );
    await db.query(
      `INSERT INTO parts (chart_version_id, instrument_name, pdf_s3_key, omr_status, omr_json)
       VALUES ($1, 'trumpet', 'key2.pdf', 'complete', $2)`,
      [v2Id, JSON.stringify(changedOmrJson)]
    );

    // Simulate what the diff worker does by importing and calling processDiffJob
    // We test this indirectly via the queue + DB state
    await enqueueJob('diff', { chartId, fromVersionId: v1Id, toVersionId: v2Id });
    const job = await claimNextJob('diff');
    expect(job).not.toBeNull();

    // Manually invoke the core logic (extracted for testability)
    const { processDiffJobForTest } = await import('./diff.worker.testexport');
    await processDiffJobForTest(job!.id, job!.payload as any);

    const diffRow = await db.query(
      `SELECT diff_json FROM version_diffs WHERE from_version_id = $1 AND to_version_id = $2`,
      [v1Id, v2Id]
    );
    expect(diffRow.rows).toHaveLength(1);
    const diffJson = diffRow.rows[0].diff_json;
    expect(diffJson.parts.trumpet.changedMeasures).toContain(1);
    expect(diffJson.parts.trumpet.measureMapping[1]).toBe(1);
    expect(diffJson.parts.trumpet.measureMapping[2]).toBe(2);
  });

  it('skips diff when previous version has no OMR data', async () => {
    const { chartId, v1Id, v2Id } = await seedVersions();

    // v1 has no parts; v2 has complete OMR
    await db.query(
      `INSERT INTO parts (chart_version_id, instrument_name, pdf_s3_key, omr_status, omr_json)
       VALUES ($1, 'trumpet', 'key2.pdf', 'complete', $2)`,
      [v2Id, JSON.stringify(sampleOmrJson)]
    );

    await enqueueJob('diff', { chartId, fromVersionId: v1Id, toVersionId: v2Id });
    const job = await claimNextJob('diff');

    const { processDiffJobForTest } = await import('./diff.worker.testexport');
    await processDiffJobForTest(job!.id, job!.payload as any);

    const diffRow = await db.query(
      `SELECT id FROM version_diffs WHERE from_version_id = $1 AND to_version_id = $2`,
      [v1Id, v2Id]
    );
    expect(diffRow.rows).toHaveLength(0);
  });
});
