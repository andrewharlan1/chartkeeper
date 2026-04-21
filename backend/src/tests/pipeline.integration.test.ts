/**
 * End-to-end pipeline integration test.
 *
 * Walks the complete Phase 1 flow:
 *   signup → ensemble → invite player → chart → upload version
 *   → OMR completes → diff job enqueued → diff computed
 *   → notifications written → GET /parts/:id → GET /parts/:id/diff
 *   → GET /notifications → restore version → restore notification
 *
 * S3 and push are stubbed. Everything else hits a real Postgres database.
 */

import supertest from 'supertest';
import { app } from '../index';
import { db } from '../db';
import { claimNextJob, completeJob } from '../lib/queue';
import { processDiffJobForTest } from '../workers/diff.worker.testexport';

jest.mock('../lib/s3', () => ({
  uploadFile: jest.fn().mockResolvedValue('mocked-s3-key'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed-url'),
}));

jest.mock('../lib/push', () => ({
  sendPush: jest.fn().mockResolvedValue(undefined),
}));

const request = supertest(app);

// ── DB teardown ───────────────────────────────────────────────────────────────

async function clearDb() {
  await db.query(`DELETE FROM notifications`);
  await db.query(`DELETE FROM jobs`);
  await db.query(`DELETE FROM version_diffs`);
  await db.query(`DELETE FROM parts`);
  await db.query(`DELETE FROM chart_versions`);
  await db.query(`DELETE FROM charts`);
  await db.query(`DELETE FROM invitations`);
  await db.query(`DELETE FROM ensemble_members`);
  await db.query(`DELETE FROM ensembles`);
  await db.query(`DELETE FROM users`);
}

beforeAll(clearDb);
afterAll(async () => { await db.end(); });

// ── Test state ────────────────────────────────────────────────────────────────

let ownerToken: string;
let playerToken: string;
let ensembleId: string;
let chartId: string;
let v1Id: string;
let v1TrumpetPartId: string;
let v2Id: string;
let v2TrumpetPartId: string;

// ── Step 1: Auth ──────────────────────────────────────────────────────────────

describe('1. Auth', () => {
  it('owner signs up', async () => {
    const res = await request.post('/auth/signup').send({
      email: 'owner@pipeline.test',
      name: 'Band Leader',
      password: 'password123',
    });
    expect(res.status).toBe(201);
    ownerToken = res.body.token;
    expect(ownerToken).toBeDefined();
  });

  it('player signs up', async () => {
    const res = await request.post('/auth/signup').send({
      email: 'player@pipeline.test',
      name: 'Trumpet Player',
      password: 'password123',
    });
    expect(res.status).toBe(201);
    playerToken = res.body.token;
  });
});

// ── Step 2: Ensemble ──────────────────────────────────────────────────────────

describe('2. Ensemble', () => {
  it('owner creates ensemble', async () => {
    const res = await request
      .post('/ensembles')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Pipeline Jazz Band' });
    expect(res.status).toBe(201);
    ensembleId = res.body.ensemble.id;
  });

  it('owner invites player and player accepts', async () => {
    const inviteRes = await request
      .post(`/ensembles/${ensembleId}/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'player@pipeline.test', role: 'player' });
    expect(inviteRes.status).toBe(201);

    const inviteToken = inviteRes.body.inviteUrl.split('/').pop();
    const acceptRes = await request
      .post(`/auth/accept-invite/${inviteToken}`)
      .send({ email: 'player@pipeline.test', password: 'password123' });
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.ensembleId).toBe(ensembleId);
  });

  it('ensemble now has 2 members', async () => {
    const res = await request
      .get(`/ensembles/${ensembleId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.body.members).toHaveLength(2);
  });
});

// ── Step 3: Chart + Version 1 ─────────────────────────────────────────────────

describe('3. Chart and first version', () => {
  it('owner creates chart', async () => {
    const res = await request
      .post('/charts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ensembleId, title: 'Autumn Leaves', composer: 'Joseph Kosma' });
    expect(res.status).toBe(201);
    chartId = res.body.chart.id;
  });

  it('owner uploads Version 1 with trumpet part', async () => {
    const res = await request
      .post(`/charts/${chartId}/versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('trumpet', Buffer.from('%PDF-1.4 v1'), {
        filename: 'trumpet.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(201);
    expect(res.body.version.versionNumber).toBe(1);
    expect(res.body.version.isActive).toBe(true);
    v1Id = res.body.version.id;
    v1TrumpetPartId = res.body.parts[0].id;
  });

  it('OMR job was enqueued for trumpet part', async () => {
    const row = await db.query(
      `SELECT payload FROM jobs WHERE type = 'omr' AND payload->>'partId' = $1`,
      [v1TrumpetPartId]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].payload.instrument).toBe('trumpet');
  });
});

// ── Step 4: Simulate OMR completion for V1 ───────────────────────────────────

const v1OmrJson = {
  measures: [
    { number: 1, notes: [{ pitch: 'E4', beat: 1, duration: 'q' }, { pitch: 'D4', beat: 2, duration: 'q' }], dynamics: [] },
    { number: 2, notes: [{ pitch: 'C4', beat: 1, duration: 'h' }], dynamics: [{ type: 'mf', beat: 1 }] },
    { number: 3, notes: [{ pitch: 'B3', beat: 1, duration: 'q' }], dynamics: [] },
  ],
  sections: [{ label: 'A', measureNumber: 1 }],
  partName: 'trumpet',
};

describe('4. OMR completion (V1)', () => {
  it('simulates OMR processing completing for V1 trumpet', async () => {
    await db.query(
      `UPDATE parts SET omr_status = 'complete', omr_json = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(v1OmrJson), v1TrumpetPartId]
    );
    const row = await db.query(`SELECT omr_status FROM parts WHERE id = $1`, [v1TrumpetPartId]);
    expect(row.rows[0].omr_status).toBe('complete');
  });

  it('no diff job enqueued for V1 (first version — nothing to diff against)', async () => {
    const row = await db.query(
      `SELECT id FROM jobs WHERE type = 'diff' AND payload->>'toVersionId' = $1`,
      [v1Id]
    );
    expect(row.rows).toHaveLength(0);
  });
});

// ── Step 5: Upload Version 2 ──────────────────────────────────────────────────

const v2OmrJson = {
  measures: [
    { number: 1, notes: [{ pitch: 'E4', beat: 1, duration: 'q' }, { pitch: 'D4', beat: 2, duration: 'q' }], dynamics: [] },
    { number: 2, notes: [{ pitch: 'Eb4', beat: 1, duration: 'h' }], dynamics: [{ type: 'mf', beat: 1 }] }, // m.2 changed: C4→Eb4
    { number: 3, notes: [{ pitch: 'B3', beat: 1, duration: 'q' }], dynamics: [] },
  ],
  sections: [{ label: 'A', measureNumber: 1 }],
  partName: 'trumpet',
};

describe('5. Version 2 upload + OMR', () => {
  it('owner uploads Version 2', async () => {
    const res = await request
      .post(`/charts/${chartId}/versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .field('versionName', 'Recording Session')
      .attach('trumpet', Buffer.from('%PDF-1.4 v2'), {
        filename: 'trumpet.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(201);
    expect(res.body.version.versionNumber).toBe(2);
    v2Id = res.body.version.id;
    v2TrumpetPartId = res.body.parts[0].id;
  });

  it('simulates OMR completing for V2', async () => {
    await db.query(
      `UPDATE parts SET omr_status = 'complete', omr_json = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(v2OmrJson), v2TrumpetPartId]
    );
  });

  it('manually enqueues diff job (normally done by maybeEnqueueDiff in omr worker)', async () => {
    // In production the OMR worker calls maybeEnqueueDiff after completing a part.
    // Here we trigger it directly to keep the test self-contained.
    const { enqueueJob } = await import('../lib/queue');
    await enqueueJob('diff', { chartId, fromVersionId: v1Id, toVersionId: v2Id });

    const row = await db.query(
      `SELECT id FROM jobs WHERE type = 'diff' AND payload->>'toVersionId' = $1`,
      [v2Id]
    );
    expect(row.rows).toHaveLength(1);
  });
});

// ── Step 6: Diff computation ──────────────────────────────────────────────────

describe('6. Diff computation', () => {
  it('diff worker processes the job and writes version_diffs', async () => {
    const job = await claimNextJob('diff');
    expect(job).not.toBeNull();
    await processDiffJobForTest(job!.id, job!.payload as any);

    const diffRow = await db.query(
      `SELECT diff_json FROM version_diffs WHERE from_version_id = $1 AND to_version_id = $2`,
      [v1Id, v2Id]
    );
    expect(diffRow.rows).toHaveLength(1);

    const diff = diffRow.rows[0].diff_json;
    expect(diff.parts.trumpet.changedMeasures).toContain(2);
    expect(diff.parts.trumpet.changedMeasures).not.toContain(1);
    expect(diff.parts.trumpet.changedMeasures).not.toContain(3);
    expect(diff.parts.trumpet.changeDescriptions[2]).toContain('Eb4');
    expect(diff.parts.trumpet.measureMapping[1]).toBe(1);
    expect(diff.parts.trumpet.measureMapping[2]).toBe(2);
    expect(diff.parts.trumpet.measureMapping[3]).toBe(3);
  });
});

// ── Step 7: Notifications ─────────────────────────────────────────────────────

describe('7. Notifications', () => {
  it('notifications were written for both members after diff', async () => {
    // processDiffJobForTest calls notifyNewVersion internally via the real diff.worker.testexport
    // Confirm notifications exist
    const rows = await db.query(
      `SELECT user_id, message FROM notifications WHERE chart_version_id = $1 ORDER BY created_at`,
      [v2Id]
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.rows[0].message).toContain('Autumn Leaves');
    expect(rows.rows[0].message).toContain('1 measure');
  });

  it('GET /notifications returns inbox for player', async () => {
    const res = await request
      .get('/notifications')
      .set('Authorization', `Bearer ${playerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.notifications.length).toBeGreaterThanOrEqual(1);
    expect(res.body.notifications[0].message).toContain('Autumn Leaves');
  });

  it('GET /notifications?unreadOnly=true returns only unread', async () => {
    const res = await request
      .get('/notifications?unreadOnly=true')
      .set('Authorization', `Bearer ${playerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.notifications.every((n: any) => n.read_at === null)).toBe(true);
  });

  it('POST /notifications/mark-read marks notifications as read', async () => {
    const listRes = await request
      .get('/notifications')
      .set('Authorization', `Bearer ${playerToken}`);
    const ids = listRes.body.notifications.map((n: any) => n.id);

    const markRes = await request
      .post('/notifications/mark-read')
      .set('Authorization', `Bearer ${playerToken}`)
      .send({ ids });
    expect(markRes.status).toBe(200);

    const unreadRes = await request
      .get('/notifications?unreadOnly=true')
      .set('Authorization', `Bearer ${playerToken}`);
    expect(unreadRes.body.notifications).toHaveLength(0);
  });
});

// ── Step 8: GET /parts endpoints ──────────────────────────────────────────────

describe('8. Parts endpoints', () => {
  it('GET /parts/:id returns part metadata + signed PDF URL', async () => {
    const res = await request
      .get(`/parts/${v2TrumpetPartId}`)
      .set('Authorization', `Bearer ${playerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.part.instrument_name).toBe('trumpet');
    expect(res.body.part.omr_status).toBe('complete');
    expect(res.body.part.pdfUrl).toBe('https://s3.example.com/signed-url');
    expect(res.body.part.omr_json).toBeUndefined(); // not exposed
  });

  it('GET /parts/:id/diff returns this part\'s diff slice', async () => {
    const res = await request
      .get(`/parts/${v2TrumpetPartId}/diff`)
      .set('Authorization', `Bearer ${playerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.diff).not.toBeNull();
    expect(res.body.diff.changedMeasures).toContain(2);
    expect(res.body.diff.changeDescriptions[2]).toContain('Eb4');
  });

  it('GET /parts/:id/diff returns null for a part with no diff yet (V1)', async () => {
    const res = await request
      .get(`/parts/${v1TrumpetPartId}/diff`)
      .set('Authorization', `Bearer ${playerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.diff).toBeNull();
  });

  it('GET /parts/:id returns 403 for non-member', async () => {
    const outsiderRes = await request.post('/auth/signup').send({
      email: 'outsider@pipeline.test',
      name: 'Outsider',
      password: 'password123',
    });
    const res = await request
      .get(`/parts/${v2TrumpetPartId}`)
      .set('Authorization', `Bearer ${outsiderRes.body.token}`);
    expect(res.status).toBe(403);
  });
});

// ── Step 9: Version restore ───────────────────────────────────────────────────

describe('9. Version restore', () => {
  it('owner restores V1', async () => {
    const res = await request
      .post(`/charts/${chartId}/versions/${v1Id}/restore`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.restoredVersionId).toBe(v1Id);
  });

  it('V1 is now active, V2 is not', async () => {
    const res = await request
      .get(`/charts/${chartId}/versions`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const v1 = res.body.versions.find((v: any) => v.id === v1Id);
    const v2 = res.body.versions.find((v: any) => v.id === v2Id);
    expect(v1.is_active).toBe(true);
    expect(v2.is_active).toBe(false);
  });

  it('restore notification was written', async () => {
    const rows = await db.query(
      `SELECT message FROM notifications WHERE chart_version_id = $1 AND type = 'restore'`,
      [v1Id]
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.rows[0].message).toContain('restored');
    expect(rows.rows[0].message).toContain('Version 1');
  });
});
