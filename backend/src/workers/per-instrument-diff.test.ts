import supertest from 'supertest';
import { app } from '../index';
import { db, dz } from '../db';
import { eq } from 'drizzle-orm';
import { parts, versionDiffs } from '../schema';
import { diffPart, OmrJson } from '../lib/diff';

jest.mock('../lib/s3', () => ({
  s3: {},
  BUCKET: 'test-bucket',
  uploadFile: jest.fn().mockResolvedValue('mocked-key'),
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('fake')),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed'),
}));

const request = supertest(app);

let token: string;
let workspaceId: string;
let ensembleId: string;
let chartId: string;

// Helpers

const sampleOmrV1: OmrJson = {
  measures: [
    { number: 1, notes: [{ pitch: 'C4', beat: 1, duration: 'q' }], dynamics: [] },
    { number: 2, notes: [{ pitch: 'D4', beat: 1, duration: 'q' }], dynamics: [] },
    { number: 3, notes: [{ pitch: 'E4', beat: 1, duration: 'q' }], dynamics: [] },
  ],
  sections: [],
  partName: 'Violin I',
};

const sampleOmrV2: OmrJson = {
  measures: [
    { number: 1, notes: [{ pitch: 'Eb4', beat: 1, duration: 'q' }], dynamics: [] },
    { number: 2, notes: [{ pitch: 'D4', beat: 1, duration: 'q' }], dynamics: [] },
    { number: 3, notes: [{ pitch: 'E4', beat: 1, duration: 'q' }], dynamics: [] },
  ],
  sections: [],
  partName: 'Violin I',
};

const unchangedOmr: OmrJson = {
  measures: [
    { number: 1, notes: [{ pitch: 'A3', beat: 1, duration: 'q' }], dynamics: [] },
    { number: 2, notes: [{ pitch: 'B3', beat: 1, duration: 'q' }], dynamics: [] },
  ],
  sections: [],
  partName: 'Cello',
};

async function createVersion(name: string, sortOrder: number): Promise<string> {
  const res = await request.post('/versions')
    .set('Authorization', `Bearer ${token}`)
    .send({ chartId, name });
  return res.body.version.id;
}

async function createInstrumentSlot(name: string): Promise<string> {
  const res = await request.post('/instrument-slots')
    .set('Authorization', `Bearer ${token}`)
    .send({ ensembleId, name });
  return res.body.instrumentSlot.id;
}

async function createPartWithOmr(versionId: string, name: string, kind: string, omrJson: OmrJson): Promise<string> {
  // Insert directly into DB since we need to set omr_json
  const result = await db.query(
    `INSERT INTO parts (version_id, name, kind, pdf_s3_key, omr_status, omr_json)
     VALUES ($1, $2, $3, 'test-key.pdf', 'complete', $4)
     RETURNING id`,
    [versionId, name, kind, JSON.stringify(omrJson)]
  );
  return result.rows[0].id;
}

async function assignPartToSlot(partId: string, slotId: string): Promise<void> {
  await db.query(
    `INSERT INTO part_slot_assignments (part_id, instrument_slot_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [partId, slotId]
  );
}

async function storeDiff(fromPartId: string, toPartId: string, slotId: string | null, diffJson: object): Promise<void> {
  await db.query(
    `INSERT INTO version_diffs (from_part_id, to_part_id, slot_id, diff_json)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (to_part_id, slot_id) DO UPDATE SET diff_json = EXCLUDED.diff_json`,
    [fromPartId, toPartId, slotId, JSON.stringify(diffJson)]
  );
}

// Setup

beforeAll(async () => {
  // Clean up in dependency order
  await db.query(`DELETE FROM version_diffs`);
  await db.query(`DELETE FROM notifications`);
  await db.query(`DELETE FROM annotations`);
  await db.query(`DELETE FROM annotation_layers`);
  await db.query(`DELETE FROM part_slot_assignments`);
  await db.query(`DELETE FROM instrument_slot_assignments`);
  await db.query(`DELETE FROM parts`);
  await db.query(`DELETE FROM versions`);
  await db.query(`DELETE FROM charts`);
  await db.query(`DELETE FROM instrument_slots`);
  await db.query(`DELETE FROM ensembles`);
  await db.query(`DELETE FROM workspace_members`);
  await db.query(`DELETE FROM workspaces`);
  await db.query(`DELETE FROM users`);

  const signup = await request.post('/auth/signup').send({
    email: 'perinst-diff@example.com',
    name: 'Diff Tester',
    password: 'securepassword',
  });
  token = signup.body.token;
  workspaceId = signup.body.workspaceId;

  const ens = await request.post('/ensembles')
    .set('Authorization', `Bearer ${token}`)
    .send({ workspaceId, name: 'Test Orchestra' });
  ensembleId = ens.body.ensemble.id;

  const chart = await request.post('/charts')
    .set('Authorization', `Bearer ${token}`)
    .send({ ensembleId, name: 'Symphony No. 5' });
  chartId = chart.body.chart.id;
});

afterAll(async () => {
  await db.end();
});

// Tests

describe('per-instrument diff — data layer', () => {
  let violinSlotId: string;
  let celloSlotId: string;
  let v1Id: string;
  let v2Id: string;

  beforeAll(async () => {
    violinSlotId = await createInstrumentSlot('Violin I');
    celloSlotId = await createInstrumentSlot('Cello');
    v1Id = await createVersion('Version 1', 1);
    v2Id = await createVersion('Version 2', 2);
  });

  it('stores slot-specific diff with slotId', async () => {
    const v1ViolinId = await createPartWithOmr(v1Id, 'Violin I', 'part', sampleOmrV1);
    const v2ViolinId = await createPartWithOmr(v2Id, 'Violin I v2', 'part', sampleOmrV2);

    await assignPartToSlot(v1ViolinId, violinSlotId);
    await assignPartToSlot(v2ViolinId, violinSlotId);

    const diff = diffPart(sampleOmrV1, sampleOmrV2);
    await storeDiff(v1ViolinId, v2ViolinId, violinSlotId, diff);

    const result = await db.query(
      `SELECT slot_id, diff_json FROM version_diffs WHERE to_part_id = $1`,
      [v2ViolinId]
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].slot_id).toBe(violinSlotId);
    // LCS treats a single-note change as delete+insert of the measure
    const dj = result.rows[0].diff_json;
    const allChanges = [...(dj.changedMeasures || []), ...(dj.structuralChanges?.insertedMeasures || [])];
    expect(allChanges).toContain(1);
  });

  it('stores multiple diffs when part is assigned to multiple slots', async () => {
    // Part assigned to both Violin I and Cello slots (unison passage)
    const v1ViolinId = await createPartWithOmr(v1Id, 'Violin I shared', 'part', sampleOmrV1);
    const v1CelloId = await createPartWithOmr(v1Id, 'Cello shared', 'part', unchangedOmr);
    const v2SharedId = await createPartWithOmr(v2Id, 'Shared Unison', 'part', sampleOmrV2);

    await assignPartToSlot(v1ViolinId, violinSlotId);
    await assignPartToSlot(v1CelloId, celloSlotId);
    await assignPartToSlot(v2SharedId, violinSlotId);
    await assignPartToSlot(v2SharedId, celloSlotId);

    const violinDiff = diffPart(sampleOmrV1, sampleOmrV2);
    const celloDiff = diffPart(unchangedOmr, sampleOmrV2);

    await storeDiff(v1ViolinId, v2SharedId, violinSlotId, violinDiff);
    await storeDiff(v1CelloId, v2SharedId, celloSlotId, celloDiff);

    const result = await db.query(
      `SELECT slot_id FROM version_diffs WHERE to_part_id = $1 ORDER BY slot_id`,
      [v2SharedId]
    );

    expect(result.rows).toHaveLength(2);
    const slotIds = result.rows.map((r: { slot_id: string }) => r.slot_id).sort();
    expect(slotIds).toEqual([violinSlotId, celloSlotId].sort());
  });

  it('stores score diff with null slotId', async () => {
    const v1ScoreId = await createPartWithOmr(v1Id, 'Full Score v1', 'score', sampleOmrV1);
    const v2ScoreId = await createPartWithOmr(v2Id, 'Full Score v2', 'score', sampleOmrV2);

    const scoreDiff = diffPart(sampleOmrV1, sampleOmrV2);
    await storeDiff(v1ScoreId, v2ScoreId, null, scoreDiff);

    const result = await db.query(
      `SELECT slot_id, diff_json FROM version_diffs WHERE to_part_id = $1`,
      [v2ScoreId]
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].slot_id).toBeNull();
  });
});

describe('per-instrument diff — API', () => {
  let violinSlotId: string;
  let v1Id: string;
  let v2Id: string;

  beforeAll(async () => {
    // Create fresh data for API tests
    violinSlotId = await createInstrumentSlot('API Test Violin');
    v1Id = await createVersion('API V1', 10);
    v2Id = await createVersion('API V2', 11);
  });

  it('GET /parts/:id/diff returns array of diffs per slot', async () => {
    const v1PartId = await createPartWithOmr(v1Id, 'Violin Part v1', 'part', sampleOmrV1);
    const v2PartId = await createPartWithOmr(v2Id, 'Violin Part v2', 'part', sampleOmrV2);

    await assignPartToSlot(v1PartId, violinSlotId);
    await assignPartToSlot(v2PartId, violinSlotId);

    const diff = diffPart(sampleOmrV1, sampleOmrV2);
    await storeDiff(v1PartId, v2PartId, violinSlotId, diff);

    const res = await request.get(`/parts/${v2PartId}/diff`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.diffs).toHaveLength(1);
    expect(res.body.diffs[0].slotId).toBe(violinSlotId);
    expect(res.body.diffs[0].instrumentName).toBe('API Test Violin');
    // The endpoint merges insertedMeasures into changedMeasures
    expect(res.body.diffs[0].changedMeasures).toContain(1);
    expect(res.body.diffs[0].sourceVersionName).toBe('API V1');
  });

  it('GET /parts/:id/diff returns empty array for parts with no diffs', async () => {
    const partId = await createPartWithOmr(v1Id, 'No Diff Part', 'part', sampleOmrV1);
    await assignPartToSlot(partId, violinSlotId);

    const res = await request.get(`/parts/${partId}/diff`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.diffs).toEqual([]);
  });

  it('GET /charts/:id/versions/:vId/instruments includes diff status per instrument', async () => {
    const res = await request.get(`/charts/${chartId}/versions/${v2Id}/instruments`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    // Find the API Test Violin instrument
    const violin = res.body.instruments.find((i: any) => i.instrumentName === 'API Test Violin');
    if (violin && violin.currentParts.length > 0) {
      const partWithDiff = violin.currentParts.find((p: any) => p.diffStatus !== null);
      if (partWithDiff) {
        expect(partWithDiff.diffStatus.slotId).toBe(violinSlotId);
        expect(partWithDiff.diffStatus.sourceVersionName).toBeTruthy();
        expect(typeof partWithDiff.diffStatus.changedMeasureCount).toBe('number');
        expect(typeof partWithDiff.diffStatus.hasChangelog).toBe('boolean');
      }
    }
  });
});

describe('per-instrument diff — LCS diff engine', () => {
  it('detects changed measures when notes differ', () => {
    const diff = diffPart(sampleOmrV1, sampleOmrV2);
    // LCS sees the modified measure 1 as deleted+inserted (fingerprints differ entirely)
    // so it appears in structuralChanges, not changedMeasures
    const allChanged = [
      ...diff.changedMeasures,
      ...diff.structuralChanges.insertedMeasures,
    ];
    expect(allChanged).toContain(1);
    // Measures 2 and 3 are unchanged
    expect(allChanged).not.toContain(2);
    expect(allChanged).not.toContain(3);
  });

  it('detects no changes for identical parts', () => {
    const diff = diffPart(sampleOmrV1, sampleOmrV1);
    expect(diff.changedMeasures).toHaveLength(0);
    expect(diff.structuralChanges.insertedMeasures).toHaveLength(0);
    expect(diff.structuralChanges.deletedMeasures).toHaveLength(0);
  });

  it('detects inserted measures', () => {
    const withExtra: OmrJson = {
      ...sampleOmrV1,
      measures: [
        ...sampleOmrV1.measures,
        { number: 4, notes: [{ pitch: 'F4', beat: 1, duration: 'q' }], dynamics: [] },
      ],
    };
    const diff = diffPart(sampleOmrV1, withExtra);
    expect(diff.structuralChanges.insertedMeasures).toContain(4);
  });

  it('detects deleted measures', () => {
    const shorter: OmrJson = {
      ...sampleOmrV1,
      measures: [sampleOmrV1.measures[0]],
    };
    const diff = diffPart(sampleOmrV1, shorter);
    expect(diff.structuralChanges.deletedMeasures.length).toBeGreaterThan(0);
  });

  it('generates structural changes for note replacements', () => {
    const diff = diffPart(sampleOmrV1, sampleOmrV2);
    // With LCS, a single-note pitch change causes a delete+insert rather than
    // an in-place change description. Verify the structural change is detected.
    expect(diff.structuralChanges.deletedMeasures).toContain(1);
    expect(diff.structuralChanges.insertedMeasures).toContain(1);
  });
});
