import supertest from 'supertest';
import { app } from '../index';
import { db, dz } from '../db';
import { eq } from 'drizzle-orm';
import { parts } from '../schema';

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
let versionId: string;

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

  // Ensure jobs table exists for enqueueJob
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
    email: 'parts-test@example.com',
    name: 'Parts Tester',
    password: 'securepassword',
  });
  token = signup.body.token;
  workspaceId = signup.body.workspaceId;

  const ens = await request.post('/ensembles')
    .set('Authorization', `Bearer ${token}`)
    .send({ workspaceId, name: 'Parts Test Ensemble' });
  ensembleId = ens.body.ensemble.id;

  const chart = await request.post('/charts')
    .set('Authorization', `Bearer ${token}`)
    .send({ ensembleId, name: 'Test Song' });
  chartId = chart.body.chart.id;

  const ver = await request.post('/versions')
    .set('Authorization', `Bearer ${token}`)
    .send({ chartId, name: 'v1' });
  versionId = ver.body.version.id;
});

afterAll(async () => {
  await db.end();
});

describe('POST /parts (upload)', () => {
  it('creates a part via multipart upload', async () => {
    const pdfBuf = Buffer.from('%PDF-1.4 test');
    const res = await request.post('/parts')
      .set('Authorization', `Bearer ${token}`)
      .field('versionId', versionId)
      .field('name', 'Trumpet')
      .field('kind', 'part')
      .attach('file', pdfBuf, { filename: 'trumpet.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.part.name).toBe('Trumpet');
    expect(res.body.part.versionId).toBe(versionId);
    expect(res.body.part.omrStatus).toBe('pending');
  });

  it('rejects missing file', async () => {
    const res = await request.post('/parts')
      .set('Authorization', `Bearer ${token}`)
      .field('versionId', versionId)
      .field('name', 'NoFile');

    expect(res.status).toBe(400);
  });

  it('rejects missing name', async () => {
    const pdfBuf = Buffer.from('%PDF-1.4 test');
    const res = await request.post('/parts')
      .set('Authorization', `Bearer ${token}`)
      .field('versionId', versionId)
      .attach('file', pdfBuf, { filename: 'test.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
  });
});

describe('GET /parts?versionId=...', () => {
  it('lists parts in a version', async () => {
    const res = await request.get(`/parts?versionId=${versionId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.parts.length).toBeGreaterThanOrEqual(1);
    expect(res.body.parts[0].name).toBe('Trumpet');
  });

  it('returns 400 without versionId', async () => {
    const res = await request.get('/parts')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /parts/:id', () => {
  it('returns part details with pdfUrl', async () => {
    const list = await request.get(`/parts?versionId=${versionId}`)
      .set('Authorization', `Bearer ${token}`);
    const partId = list.body.parts[0].id;

    const res = await request.get(`/parts/${partId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.part.id).toBe(partId);
    expect(res.body.part.pdfUrl).toBe(`/parts/${partId}/pdf`);
  });

  it('returns 404 for unknown part', async () => {
    const res = await request
      .get('/parts/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /parts/:id/measure-layout', () => {
  it('returns empty array when no omr_json', async () => {
    const list = await request.get(`/parts?versionId=${versionId}`)
      .set('Authorization', `Bearer ${token}`);
    const partId = list.body.parts[0].id;

    const res = await request.get(`/parts/${partId}/measure-layout`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.measureLayout).toEqual([]);
  });

  it('returns bounding boxes when omr_json has measures', async () => {
    const list = await request.get(`/parts?versionId=${versionId}`)
      .set('Authorization', `Bearer ${token}`);
    const partId = list.body.parts[0].id;

    await dz.update(parts).set({
      omrJson: {
        measures: [
          { number: 1, bounds: { x: 10, y: 20, w: 100, h: 50, page: 1 } },
          { number: 2, bounds: { x: 110, y: 20, w: 100, h: 50, page: 1 } },
        ],
      },
    }).where(eq(parts.id, partId));

    const res = await request.get(`/parts/${partId}/measure-layout`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.measureLayout.length).toBe(2);
    expect(res.body.measureLayout[0].measureNumber).toBe(1);
    expect(res.body.measureLayout[0].x).toBe(10);
  });
});

describe('DELETE /parts/:id', () => {
  it('soft-deletes the part', async () => {
    const pdfBuf = Buffer.from('%PDF-1.4 test');
    const create = await request.post('/parts')
      .set('Authorization', `Bearer ${token}`)
      .field('versionId', versionId)
      .field('name', 'Doomed Part')
      .attach('file', pdfBuf, { filename: 'doomed.pdf', contentType: 'application/pdf' });

    const res = await request.delete(`/parts/${create.body.part.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });
});
