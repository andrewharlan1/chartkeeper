/**
 * Smoke integration test for the Scorva data model.
 *
 * Walks the new schema end-to-end:
 *   signup → workspace → ensemble → instrument slots → v1 → upload parts
 *   → OMR completes → player annotates → v2 (seeded from v1) → upload changed part
 *   → OMR completes → annotation migration → verify migration results
 *
 * S3 is mocked. Everything else hits a real Postgres database.
 */

import supertest from 'supertest';
import { app } from '../index';
import { db, dz } from '../db';
import { parts, annotations } from '../schema';
import { eq, and, isNull } from 'drizzle-orm';
import { migrateAnnotationsForVersion } from '../lib/annotation-migration';
import type { VersionDiffJson } from '../lib/diff';

jest.mock('../lib/s3', () => ({
  s3: {},
  BUCKET: 'test-bucket',
  uploadFile: jest.fn().mockResolvedValue('mocked-key'),
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('fake')),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed'),
}));

const request = supertest(app);

// ── DB teardown ───────────────────────────────────────────────────────────────

async function clearDb() {
  await db.query(`DELETE FROM annotations`);
  await db.query(`DELETE FROM annotation_layers`);
  await db.query(`DELETE FROM version_diffs`);
  await db.query(`DELETE FROM part_slot_assignments`);
  await db.query(`DELETE FROM parts`);
  await db.query(`DELETE FROM versions`);
  await db.query(`DELETE FROM charts`);
  await db.query(`DELETE FROM instrument_slots`);
  await db.query(`DELETE FROM ensembles`);
  await db.query(`DELETE FROM workspace_members`);
  await db.query(`DELETE FROM workspaces`);
  await db.query(`DELETE FROM users`);

  // Ensure jobs table exists (not in Drizzle schema)
  await db.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      last_error TEXT,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`DELETE FROM jobs`);
}

beforeAll(clearDb);
afterAll(async () => { await db.end(); });

// ── Test state ────────────────────────────────────────────────────────────────

let ownerToken: string;
let ownerWorkspaceId: string;
let playerToken: string;
let outsiderToken: string;

let ensembleId: string;
let chartId: string;
let trumpetSlotId: string;
let bassSlotId: string;

let v1Id: string;
let v1TrumpetPartId: string;
let v1BassPartId: string;

let v2Id: string;
let v2TrumpetPartId: string;

// ── 1. Auth ──────────────────────────────────────────────────────────────────

describe('1. Auth', () => {
  it('owner signs up and gets default workspace', async () => {
    const res = await request.post('/auth/signup').send({
      email: 'smoke-owner@test.local',
      name: 'Band Leader',
      password: 'password123',
    });
    expect(res.status).toBe(201);
    ownerToken = res.body.token;
    ownerWorkspaceId = res.body.workspaceId;
    expect(ownerToken).toBeDefined();
    expect(ownerWorkspaceId).toBeDefined();
  });

  it('player signs up', async () => {
    const res = await request.post('/auth/signup').send({
      email: 'smoke-player@test.local',
      name: 'Trumpet Player',
      password: 'password123',
    });
    expect(res.status).toBe(201);
    playerToken = res.body.token;
  });

  it('outsider signs up (should not have access to owner resources)', async () => {
    const res = await request.post('/auth/signup').send({
      email: 'smoke-outsider@test.local',
      name: 'Outsider',
      password: 'password123',
    });
    expect(res.status).toBe(201);
    outsiderToken = res.body.token;
  });
});

// ── 2. Workspace ─────────────────────────────────────────────────────────────

describe('2. Workspace', () => {
  it('owner sees their default workspace', async () => {
    const res = await request.get('/workspaces')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.workspaces.length).toBeGreaterThanOrEqual(1);
    expect(res.body.workspaces[0].role).toBe('owner');
  });

  it('outsider cannot access owner workspace', async () => {
    const res = await request.get(`/workspaces/${ownerWorkspaceId}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });

  it('add player to owner workspace via direct DB insert', async () => {
    // In production this would be an invite flow; for smoke test we insert directly
    const playerUser = await db.query(
      `SELECT id FROM users WHERE email = 'smoke-player@test.local'`
    );
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [ownerWorkspaceId, playerUser.rows[0].id]
    );

    // Verify player can now see the workspace
    const res = await request.get(`/workspaces/${ownerWorkspaceId}`)
      .set('Authorization', `Bearer ${playerToken}`);
    expect(res.status).toBe(200);
  });
});

// ── 3. Ensemble ──────────────────────────────────────────────────────────────

describe('3. Ensemble', () => {
  it('owner creates ensemble in workspace', async () => {
    const res = await request.post('/ensembles')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ workspaceId: ownerWorkspaceId, name: 'Smoke Test Jazz Combo' });
    expect(res.status).toBe(201);
    ensembleId = res.body.ensemble.id;
    expect(res.body.ensemble.name).toBe('Smoke Test Jazz Combo');
  });

  it('player can list ensembles (member of workspace)', async () => {
    const res = await request.get(`/ensembles?workspaceId=${ownerWorkspaceId}`)
      .set('Authorization', `Bearer ${playerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ensembles.length).toBe(1);
    expect(res.body.ensembles[0].id).toBe(ensembleId);
  });

  it('outsider cannot list ensembles', async () => {
    const res = await request.get(`/ensembles?workspaceId=${ownerWorkspaceId}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });
});

// ── 4. Instrument slots ──────────────────────────────────────────────────────

describe('4. Instrument slots', () => {
  it('owner creates Trumpet slot', async () => {
    const res = await request.post('/instrument-slots')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ensembleId, name: 'Trumpet', section: 'Brass' });
    expect(res.status).toBe(201);
    trumpetSlotId = res.body.instrumentSlot.id;
    expect(res.body.instrumentSlot.section).toBe('Brass');
  });

  it('owner creates Bass slot', async () => {
    const res = await request.post('/instrument-slots')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ensembleId, name: 'Bass', section: 'Rhythm' });
    expect(res.status).toBe(201);
    bassSlotId = res.body.instrumentSlot.id;
  });

  it('lists both slots sorted', async () => {
    const res = await request.get(`/instrument-slots?ensembleId=${ensembleId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.instrumentSlots.length).toBe(2);
    expect(res.body.instrumentSlots[0].name).toBe('Trumpet');
    expect(res.body.instrumentSlots[1].name).toBe('Bass');
  });
});

// ── 5. Chart + Version 1 + parts ────────────────────────────────────────────

describe('5. Chart, Version 1 and parts', () => {
  it('owner creates chart in ensemble', async () => {
    const res = await request.post('/charts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ensembleId, name: 'Smoke Test Song' });
    expect(res.status).toBe(201);
    chartId = res.body.chart.id;
    expect(res.body.chart.name).toBe('Smoke Test Song');
  });

  it('owner creates version 1', async () => {
    const res = await request.post('/versions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ chartId, name: 'Original Charts' });
    expect(res.status).toBe(201);
    v1Id = res.body.version.id;
    expect(res.body.version.name).toBe('Original Charts');
    expect(res.body.version.sortOrder).toBe(0);
  });

  it('owner uploads Trumpet part PDF with slot assignment', async () => {
    const res = await request.post('/parts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .field('versionId', v1Id)
      .field('name', 'Trumpet')
      .field('slotIds', JSON.stringify([trumpetSlotId]))
      .attach('file', Buffer.from('%PDF-1.4 trumpet-v1'), {
        filename: 'trumpet.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(201);
    v1TrumpetPartId = res.body.part.id;
    expect(res.body.part.name).toBe('Trumpet');
    expect(res.body.part.omrStatus).toBe('pending');
  });

  it('OMR job was enqueued for trumpet part', async () => {
    const row = await db.query(
      `SELECT payload FROM jobs WHERE type = 'omr' AND payload->>'partId' = $1`,
      [v1TrumpetPartId]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].payload.instrument).toBe('Trumpet');
  });

  it('owner uploads Bass part PDF with slot assignment', async () => {
    const res = await request.post('/parts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .field('versionId', v1Id)
      .field('name', 'Bass')
      .field('slotIds', JSON.stringify([bassSlotId]))
      .attach('file', Buffer.from('%PDF-1.4 bass-v1'), {
        filename: 'bass.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(201);
    v1BassPartId = res.body.part.id;
  });

  it('GET /parts?versionId lists both parts', async () => {
    const res = await request.get(`/parts?versionId=${v1Id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.parts.length).toBe(2);
  });

  it('outsider cannot access parts', async () => {
    const res = await request.get(`/parts?versionId=${v1Id}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    // outsider is not a workspace member, so the version lookup fails or auth rejects
    expect([403, 404]).toContain(res.status);
  });
});

// ── 6. Simulate OMR completion for V1 ───────────────────────────────────────

const v1TrumpetOmr = {
  measures: [
    { number: 1, bounds: { x: 50, y: 100, w: 200, h: 80, page: 1 } },
    { number: 2, bounds: { x: 250, y: 100, w: 200, h: 80, page: 1 } },
    { number: 3, bounds: { x: 50, y: 300, w: 200, h: 80, page: 1 } },
    { number: 4, bounds: { x: 250, y: 300, w: 200, h: 80, page: 1 } },
  ],
};

describe('6. OMR completion (V1)', () => {
  it('simulates OMR completing for V1 Trumpet', async () => {
    await db.query(
      `UPDATE parts SET omr_status = 'complete', omr_json = $1, omr_engine = 'vision' WHERE id = $2`,
      [JSON.stringify(v1TrumpetOmr), v1TrumpetPartId]
    );
    const row = await db.query(`SELECT omr_status, omr_engine FROM parts WHERE id = $1`, [v1TrumpetPartId]);
    expect(row.rows[0].omr_status).toBe('complete');
    expect(row.rows[0].omr_engine).toBe('vision');
  });

  it('GET /parts/:id/measure-layout returns bounding boxes', async () => {
    const res = await request.get(`/parts/${v1TrumpetPartId}/measure-layout`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.measureLayout.length).toBe(4);
    expect(res.body.measureLayout[0].measureNumber).toBe(1);
    expect(res.body.measureLayout[0].x).toBe(50);
  });
});

// ── 7. Player creates annotations on V1 ────────────────────────────────────

describe('7. Player annotations on V1', () => {
  let measureAnnotationId: string;
  let beatAnnotationId: string;
  let inkAnnotationId: string;
  let deletedMeasureAnnotationId: string;

  it('player creates a measure-anchored text annotation', async () => {
    const res = await request.post(`/parts/${v1TrumpetPartId}/annotations`)
      .set('Authorization', `Bearer ${playerToken}`)
      .send({
        anchorType: 'measure',
        anchorJson: { measureNumber: 1 },
        kind: 'text',
        contentJson: {
          text: 'Play forte here',
          fontSize: 0.15,
          color: '#000000',
          fontWeight: 'bold',
          fontStyle: 'normal',
          boundingBox: { x: 0.5, y: 0.1, widthPageUnits: 0.08, heightPageUnits: 0.02 },
        },
      });
    expect(res.status).toBe(201);
    measureAnnotationId = res.body.annotation.id;
    expect(res.body.annotation.ownerName).toBe('Trumpet Player');
  });

  it('player creates a beat-anchored text annotation', async () => {
    const res = await request.post(`/parts/${v1TrumpetPartId}/annotations`)
      .set('Authorization', `Bearer ${playerToken}`)
      .send({
        anchorType: 'beat',
        anchorJson: { measureNumber: 3, beat: 2.5 },
        kind: 'text',
        contentJson: {
          text: 'accent',
          fontSize: 0.12,
          color: '#333333',
          fontWeight: 'normal',
          fontStyle: 'italic',
          boundingBox: { x: 0.3, y: 0.05, widthPageUnits: 0.06, heightPageUnits: 0.015 },
        },
      });
    expect(res.status).toBe(201);
    beatAnnotationId = res.body.annotation.id;
  });

  it('player creates an ink annotation on measure 3', async () => {
    const res = await request.post(`/parts/${v1TrumpetPartId}/annotations`)
      .set('Authorization', `Bearer ${playerToken}`)
      .send({
        anchorType: 'measure',
        anchorJson: { measureNumber: 3 },
        kind: 'ink',
        contentJson: {
          strokes: [{
            points: [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }],
            color: '#000000',
            width: 0.02,
          }],
          boundingBox: { x: 0.15, y: 0.25, width: 0.3, height: 0.3 },
        },
      });
    expect(res.status).toBe(201);
    inkAnnotationId = res.body.annotation.id;
  });

  it('player creates a text annotation on measure 2 (will be deleted in v2)', async () => {
    const res = await request.post(`/parts/${v1TrumpetPartId}/annotations`)
      .set('Authorization', `Bearer ${playerToken}`)
      .send({
        anchorType: 'measure',
        anchorJson: { measureNumber: 2 },
        kind: 'text',
        contentJson: {
          text: 'watch the tempo',
          fontSize: 0.12,
          color: '#000000',
          fontWeight: 'normal',
          fontStyle: 'normal',
          boundingBox: { x: 0.1, y: 0.1, widthPageUnits: 0.1, heightPageUnits: 0.02 },
        },
      });
    expect(res.status).toBe(201);
    deletedMeasureAnnotationId = res.body.annotation.id;
  });

  it('lists all 4 annotations', async () => {
    const res = await request.get(`/parts/${v1TrumpetPartId}/annotations`)
      .set('Authorization', `Bearer ${playerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.annotations.length).toBe(4);
  });

  it('outsider cannot read annotations', async () => {
    const res = await request.get(`/parts/${v1TrumpetPartId}/annotations`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });
});

// ── 8. Version 2 (seeded from V1) ──────────────────────────────────────────

const v2TrumpetOmr = {
  measures: [
    // Measure 1: same position
    { number: 1, bounds: { x: 50, y: 100, w: 200, h: 80, page: 1 } },
    // Measure 2: DELETED (not present)
    // Measure 3: moved to where measure 2 was (shifted left)
    { number: 3, bounds: { x: 250, y: 100, w: 200, h: 80, page: 1 } },
    // Measure 4: same position
    { number: 4, bounds: { x: 250, y: 300, w: 200, h: 80, page: 1 } },
    // Measure 5: inserted
    { number: 5, bounds: { x: 50, y: 500, w: 200, h: 80, page: 2 } },
  ],
};

describe('8. Version 2 creation', () => {
  it('owner creates version 2 seeded from v1', async () => {
    const res = await request.post('/versions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ chartId, name: 'After Rehearsal Fix', seededFromVersionId: v1Id });
    expect(res.status).toBe(201);
    v2Id = res.body.version.id;
    expect(res.body.version.seededFromVersionId).toBe(v1Id);
    expect(res.body.version.sortOrder).toBe(1);
  });

  it('owner uploads new Trumpet part for v2', async () => {
    const res = await request.post('/parts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .field('versionId', v2Id)
      .field('name', 'Trumpet')
      .field('slotIds', JSON.stringify([trumpetSlotId]))
      .attach('file', Buffer.from('%PDF-1.4 trumpet-v2'), {
        filename: 'trumpet.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(201);
    v2TrumpetPartId = res.body.part.id;
  });

  it('simulates OMR completing for V2 Trumpet', async () => {
    await db.query(
      `UPDATE parts SET omr_status = 'complete', omr_json = $1, omr_engine = 'vision' WHERE id = $2`,
      [JSON.stringify(v2TrumpetOmr), v2TrumpetPartId]
    );
    const row = await db.query(`SELECT omr_status FROM parts WHERE id = $1`, [v2TrumpetPartId]);
    expect(row.rows[0].omr_status).toBe('complete');
  });

  it('GET /versions/:id shows v2 with partCount 1', async () => {
    const res = await request.get(`/versions/${v2Id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.version.partCount).toBe(1);
  });
});

// ── 9. Annotation migration ────────────────────────────────────────────────

describe('9. Annotation migration (simulated diff + migration)', () => {
  // The diff worker normally computes this via Vision API.
  // For the smoke test we construct it manually: measure 2 deleted, 3 maps to 3.
  const diffJson: VersionDiffJson = {
    parts: {
      Trumpet: {
        changedMeasures: [3],
        changeDescriptions: { 3: 'Measure moved position' },
        structuralChanges: {
          insertedMeasures: [5],
          deletedMeasures: [2],
          sectionLabelChanges: [],
        },
        measureMapping: { 1: 1, 2: null, 3: 3, 4: 4 },
      },
    },
  };

  it('runs annotation migration from v1 → v2', async () => {
    const summaries = await migrateAnnotationsForVersion(v1Id, v2Id, diffJson);

    expect(summaries.length).toBe(1);
    expect(summaries[0].instrument).toBe('Trumpet');
    expect(summaries[0].total).toBe(4);      // 4 annotations on v1 Trumpet
    expect(summaries[0].migrated).toBe(3);    // measure 1, beat 3, ink 3
    expect(summaries[0].flagged).toBe(1);     // measure 2 was deleted
    expect(summaries[0].skipped).toBe(0);
  });

  it('migrated annotations exist on v2 Trumpet part', async () => {
    const res = await request.get(`/parts/${v2TrumpetPartId}/annotations`)
      .set('Authorization', `Bearer ${playerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.annotations.length).toBe(4);
  });

  it('measure-1 text annotation migrated cleanly', async () => {
    const migrated = await dz.select()
      .from(annotations)
      .where(and(
        eq(annotations.partId, v2TrumpetPartId),
        isNull(annotations.deletedAt),
      ));

    const m1 = migrated.find(a =>
      a.anchorType === 'measure' &&
      a.kind === 'text' &&
      (a.contentJson as any).text === 'Play forte here'
    );
    expect(m1).toBeDefined();
    expect((m1!.anchorJson as any).measureNumber).toBe(1);
    expect(m1!.migratedFromAnnotationId).toBeDefined();
    expect((m1!.contentJson as any)._needsReview).toBeUndefined();
  });

  it('measure-2 annotation flagged for review (measure deleted)', async () => {
    const migrated = await dz.select()
      .from(annotations)
      .where(and(
        eq(annotations.partId, v2TrumpetPartId),
        isNull(annotations.deletedAt),
      ));

    const m2 = migrated.find(a =>
      (a.contentJson as any).text === 'watch the tempo'
    );
    expect(m2).toBeDefined();
    expect((m2!.contentJson as any)._needsReview).toBe(true);
  });

  it('beat annotation on measure 3 preserves beat value', async () => {
    const migrated = await dz.select()
      .from(annotations)
      .where(and(
        eq(annotations.partId, v2TrumpetPartId),
        isNull(annotations.deletedAt),
      ));

    const beat = migrated.find(a => a.anchorType === 'beat');
    expect(beat).toBeDefined();
    expect((beat!.anchorJson as any).measureNumber).toBe(3);
    expect((beat!.anchorJson as any).beat).toBe(2.5);
  });

  it('ink annotation preserves measure-relative coords (object model)', async () => {
    const migrated = await dz.select()
      .from(annotations)
      .where(and(
        eq(annotations.partId, v2TrumpetPartId),
        isNull(annotations.deletedAt),
      ));

    const ink = migrated.find(a => a.kind === 'ink');
    expect(ink).toBeDefined();
    const content = ink!.contentJson as any;

    // Object-model ink uses measure-relative coords (0-1).
    // These are preserved as-is — no page-coordinate relocation.
    expect(content.strokes[0].points[0].x).toBe(0.2);
    expect(content.strokes[0].points[0].y).toBe(0.3);
    expect(content.strokes[0].points[1].x).toBe(0.4);
    expect(content.strokes[0].points[1].y).toBe(0.5);
    expect(content.boundingBox).toEqual({ x: 0.15, y: 0.25, width: 0.3, height: 0.3 });
  });

  it('migration is idempotent — running again skips all', async () => {
    const summaries = await migrateAnnotationsForVersion(v1Id, v2Id, diffJson);
    expect(summaries[0].total).toBe(4);
    expect(summaries[0].migrated).toBe(0);
    expect(summaries[0].flagged).toBe(0);
    expect(summaries[0].skipped).toBe(4);

    // Still only 4 annotations on v2 part
    const migrated = await dz.select()
      .from(annotations)
      .where(and(
        eq(annotations.partId, v2TrumpetPartId),
        isNull(annotations.deletedAt),
      ));
    expect(migrated.length).toBe(4);
  });
});

// ── 10. Cross-cutting: soft deletes, GET consistency ────────────────────────

describe('10. Cross-cutting checks', () => {
  it('deleting an annotation soft-deletes it', async () => {
    // Create a throwaway annotation on v2 to delete
    const create = await request.post(`/parts/${v2TrumpetPartId}/annotations`)
      .set('Authorization', `Bearer ${playerToken}`)
      .send({
        anchorType: 'measure',
        anchorJson: { measureNumber: 1 },
        kind: 'highlight',
        contentJson: {
          color: '#00FF00',
          opacity: 0.4,
          boundingBox: { x: 0, y: 0, width: 1, height: 1 },
        },
      });
    expect(create.status).toBe(201);

    const del = await request.delete(`/annotations/${create.body.annotation.id}`)
      .set('Authorization', `Bearer ${playerToken}`);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);

    // Verify it no longer appears in list
    const list = await request.get(`/parts/${v2TrumpetPartId}/annotations`)
      .set('Authorization', `Bearer ${playerToken}`);
    const ids = list.body.annotations.map((a: any) => a.id);
    expect(ids).not.toContain(create.body.annotation.id);

    // But it still exists in DB (soft delete)
    const row = await db.query(
      `SELECT deleted_at FROM annotations WHERE id = $1`,
      [create.body.annotation.id]
    );
    expect(row.rows[0].deleted_at).not.toBeNull();
  });

  it('GET /versions lists both versions in order', async () => {
    const res = await request.get(`/versions?chartId=${chartId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.versions.length).toBe(2);
    expect(res.body.versions[0].id).toBe(v1Id);
    expect(res.body.versions[1].id).toBe(v2Id);
    expect(res.body.versions[1].seededFromVersionId).toBe(v1Id);
  });

  it('soft-deleting ensemble hides it from list', async () => {
    // Create a throwaway ensemble
    const create = await request.post('/ensembles')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ workspaceId: ownerWorkspaceId, name: 'Doomed Ensemble' });

    const del = await request.delete(`/ensembles/${create.body.ensemble.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(del.status).toBe(200);

    const list = await request.get(`/ensembles?workspaceId=${ownerWorkspaceId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const names = list.body.ensembles.map((e: any) => e.name);
    expect(names).not.toContain('Doomed Ensemble');
  });

  it('player can see parts they uploaded via /player/my-parts', async () => {
    // Player hasn't uploaded anything in this test, but the endpoint should work
    const res = await request.get('/player/my-parts')
      .set('Authorization', `Bearer ${playerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.parts)).toBe(true);
  });
});
