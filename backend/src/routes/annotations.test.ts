import supertest from 'supertest';
import { app } from '../index';
import { db, dz } from '../db';
import { parts } from '../schema';
import { eq } from 'drizzle-orm';

jest.mock('../lib/s3', () => ({
  s3: {},
  BUCKET: 'test-bucket',
  uploadFile: jest.fn().mockResolvedValue('mocked-key'),
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('fake')),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed'),
}));

const request = supertest(app);

let token: string;
let partId: string;
let annotationId: string;

// ── Valid content fixtures ──────────────────────────────────────────────────

const validInkContent = {
  strokes: [{
    points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
    color: '#000000',
    width: 0.02,
  }],
  boundingBox: { x: 0.05, y: 0.1, width: 0.3, height: 0.4 },
};

const validTextContent = {
  text: 'Watch the dynamics here!',
  fontSize: 0.15,
  color: '#333333',
  fontWeight: 'normal',
  fontStyle: 'normal',
  boundingBox: { x: 0.5, y: 0.1, widthPageUnits: 0.08, heightPageUnits: 0.02 },
};

const validHighlightContent = {
  color: '#FFFF00',
  opacity: 0.3,
  boundingBox: { x: 0, y: 0, width: 1, height: 1 },
};

// ── Setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
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

  const signup = await request.post('/auth/signup').send({
    email: 'ann-test@example.com',
    name: 'Annotation Tester',
    password: 'securepassword',
  });
  token = signup.body.token;
  const workspaceId = signup.body.workspaceId;

  const ens = await request.post('/ensembles')
    .set('Authorization', `Bearer ${token}`)
    .send({ workspaceId, name: 'Ann Test Ensemble' });

  const chart = await request.post('/charts')
    .set('Authorization', `Bearer ${token}`)
    .send({ ensembleId: ens.body.ensemble.id, name: 'Ann Test Chart' });

  const ver = await request.post('/versions')
    .set('Authorization', `Bearer ${token}`)
    .send({ chartId: chart.body.chart.id, name: 'v1' });

  // Create part directly via Drizzle (avoids needing S3 upload)
  const [part] = await dz.insert(parts).values({
    versionId: ver.body.version.id,
    name: 'Trumpet',
    pdfS3Key: 'test/trumpet.pdf',
    omrStatus: 'complete',
  }).returning();
  partId = part.id;
});

afterAll(async () => {
  await db.end();
});

// ── POST tests ──────────────────────────────────────────────────────────────

describe('POST /parts/:partId/annotations', () => {
  it('creates an ink annotation with valid content', async () => {
    const res = await request.post(`/parts/${partId}/annotations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        anchorType: 'measure',
        anchorJson: { measureNumber: 5 },
        kind: 'ink',
        contentJson: validInkContent,
      });

    expect(res.status).toBe(201);
    expect(res.body.annotation.partId).toBe(partId);
    expect(res.body.annotation.anchorType).toBe('measure');
    expect(res.body.annotation.kind).toBe('ink');
    expect(res.body.annotation.ownerName).toBe('Annotation Tester');
    annotationId = res.body.annotation.id;
  });

  it('creates a text annotation with valid content', async () => {
    const res = await request.post(`/parts/${partId}/annotations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        anchorType: 'measure',
        anchorJson: { measureNumber: 3 },
        kind: 'text',
        contentJson: validTextContent,
      });

    expect(res.status).toBe(201);
    expect(res.body.annotation.kind).toBe('text');
    expect(res.body.annotation.contentJson.text).toBe('Watch the dynamics here!');
  });

  it('creates a highlight annotation with valid content', async () => {
    const res = await request.post(`/parts/${partId}/annotations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        anchorType: 'measure',
        anchorJson: { measureNumber: 1 },
        kind: 'highlight',
        contentJson: validHighlightContent,
      });

    expect(res.status).toBe(201);
    expect(res.body.annotation.kind).toBe('highlight');
    expect(res.body.annotation.contentJson.opacity).toBe(0.3);
  });

  it('rejects shape kind (not creatable in v1)', async () => {
    const res = await request.post(`/parts/${partId}/annotations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        anchorType: 'measure',
        anchorJson: { measureNumber: 1 },
        kind: 'shape',
        contentJson: {
          shapeType: 'circle',
          strokeColor: '#FF0000',
          strokeWidth: 0.01,
          boundingBox: { x: 0, y: 0, width: 0.5, height: 0.5 },
        },
      });

    expect(res.status).toBe(400);
  });

  it('rejects invalid anchor', async () => {
    const res = await request.post(`/parts/${partId}/annotations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        anchorType: 'measure',
        anchorJson: { garbage: true },
        kind: 'ink',
        contentJson: validInkContent,
      });

    expect(res.status).toBe(400);
  });

  it('rejects ink content missing boundingBox', async () => {
    const res = await request.post(`/parts/${partId}/annotations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        anchorType: 'measure',
        anchorJson: { measureNumber: 1 },
        kind: 'ink',
        contentJson: {
          strokes: [{ points: [{ x: 0, y: 0 }], color: '#000000', width: 0.02 }],
        },
      });

    expect(res.status).toBe(400);
  });

  it('rejects text content with invalid hex color', async () => {
    const res = await request.post(`/parts/${partId}/annotations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        anchorType: 'measure',
        anchorJson: { measureNumber: 1 },
        kind: 'text',
        contentJson: { ...validTextContent, color: 'red' },
      });

    expect(res.status).toBe(400);
  });

  it('rejects highlight with opacity > 1', async () => {
    const res = await request.post(`/parts/${partId}/annotations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        anchorType: 'measure',
        anchorJson: { measureNumber: 1 },
        kind: 'highlight',
        contentJson: { ...validHighlightContent, opacity: 1.5 },
      });

    expect(res.status).toBe(400);
  });
});

// ── GET tests ───────────────────────────────────────────────────────────────

describe('GET /parts/:partId/annotations', () => {
  it('returns annotations for a part', async () => {
    const res = await request.get(`/parts/${partId}/annotations`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.annotations.length).toBeGreaterThanOrEqual(3);
  });
});

// ── PATCH tests ─────────────────────────────────────────────────────────────

describe('PATCH /annotations/:id', () => {
  it('updates the content', async () => {
    const newContent = { ...validInkContent, strokes: [{ ...validInkContent.strokes[0], color: '#FF0000' }] };
    const res = await request.patch(`/annotations/${annotationId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ contentJson: newContent });

    expect(res.status).toBe(200);
    expect(res.body.annotation.contentJson.strokes[0].color).toBe('#FF0000');
  });

  it('updates the anchor', async () => {
    const res = await request.patch(`/annotations/${annotationId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ anchorJson: { measureNumber: 10 } });

    expect(res.status).toBe(200);
    expect(res.body.annotation.anchorJson.measureNumber).toBe(10);
  });

  it('sets layerId to null', async () => {
    const res = await request.patch(`/annotations/${annotationId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ layerId: null });

    expect(res.status).toBe(200);
    expect(res.body.annotation.layerId).toBeNull();
  });

  it('rejects edit by non-owner', async () => {
    const other = await request.post('/auth/signup').send({
      email: 'ann-other@example.com',
      name: 'Other',
      password: 'securepassword',
    });

    const res = await request.patch(`/annotations/${annotationId}`)
      .set('Authorization', `Bearer ${other.body.token}`)
      .send({ contentJson: validInkContent });

    // Either 403 (not owner) or 404 (not found because they're in a different workspace)
    expect([403, 404]).toContain(res.status);
  });
});

// ── DELETE tests ─────────────────────────────────────────────────────────────

describe('DELETE /annotations/:id', () => {
  it('soft-deletes the annotation', async () => {
    // Create a throwaway annotation
    const create = await request.post(`/parts/${partId}/annotations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        anchorType: 'measure',
        anchorJson: { measureNumber: 1 },
        kind: 'highlight',
        contentJson: validHighlightContent,
      });

    const res = await request.delete(`/annotations/${create.body.annotation.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    // Should not appear in list anymore
    const list = await request.get(`/parts/${partId}/annotations`)
      .set('Authorization', `Bearer ${token}`);
    const ids = list.body.annotations.map((a: any) => a.id);
    expect(ids).not.toContain(create.body.annotation.id);
  });
});
