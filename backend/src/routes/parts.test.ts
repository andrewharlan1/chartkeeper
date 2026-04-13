import supertest from 'supertest';
import { app } from '../index';
import { db } from '../db';

jest.mock('../lib/s3', () => ({
  uploadFile: jest.fn().mockResolvedValue('mocked-key'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed'),
}));

const request = supertest(app);

async function clearDb() {
  await db.query(`DELETE FROM version_diffs`);
  await db.query(`DELETE FROM parts`);
  await db.query(`DELETE FROM chart_versions`);
  await db.query(`DELETE FROM charts`);
  await db.query(`DELETE FROM ensemble_members`);
  await db.query(`DELETE FROM ensembles`);
  await db.query(`DELETE FROM users`);
}

async function signup(email: string) {
  const res = await request.post('/auth/signup').send({ email, name: 'Test', password: 'password123' });
  return res.body as { token: string; user: { id: string } };
}

let token: string;
let partId: string;
let chartId: string;
let versionId: string;
let ensembleId: string;

beforeAll(async () => {
  await clearDb();
  const auth = await signup('partstest@example.com');
  token = auth.token;

  const ens = await request.post('/ensembles').set('Authorization', `Bearer ${token}`).send({ name: 'Parts Band' });
  ensembleId = ens.body.ensemble.id;

  const chart = await request.post('/charts').set('Authorization', `Bearer ${token}`).send({ ensembleId, title: 'Test Chart' });
  chartId = chart.body.chart.id;

  const version = await request
    .post(`/charts/${chartId}/versions`)
    .set('Authorization', `Bearer ${token}`)
    .attach('alto_sax', Buffer.from('%PDF-1.4 fake'), { filename: 'alto_sax.pdf', contentType: 'application/pdf' });

  versionId = version.body.version.id;
  partId = version.body.parts[0].id;
});

afterAll(async () => { await db.end(); });

describe('GET /parts/:id', () => {
  it('returns part with signed PDF URL', async () => {
    const res = await request.get(`/parts/${partId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.part.instrument_name).toBe('alto_sax');
    expect(res.body.part.pdfUrl).toBe('https://s3.example.com/signed');
    expect(res.body.part.omr_status).toBe('pending');
    expect(res.body.part.omr_json).toBeUndefined();
  });

  it('returns 404 for unknown part', async () => {
    const res = await request
      .get('/parts/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for non-member', async () => {
    const other = await signup('partsoutsider@example.com');
    const res = await request.get(`/parts/${partId}`).set('Authorization', `Bearer ${other.token}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /parts/:id/diff', () => {
  it('returns null when no diff exists (first version)', async () => {
    const res = await request.get(`/parts/${partId}/diff`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.diff).toBeNull();
  });

  it('returns part diff slice when version_diff exists', async () => {
    // Insert a fake version diff
    await db.query(
      `INSERT INTO version_diffs (chart_id, from_version_id, to_version_id, diff_json)
       VALUES ($1, $2, $2, $3)`,
      [chartId, versionId, JSON.stringify({
        parts: {
          alto_sax: {
            changedMeasures: [4, 8],
            changeDescriptions: { 4: 'm.4: G4 replaces F4' },
            structuralChanges: { insertedMeasures: [], deletedMeasures: [], sectionLabelChanges: [] },
            measureMapping: { 1: 1, 2: 2, 3: 3, 4: 4 },
          },
        },
      })]
    );

    const res = await request.get(`/parts/${partId}/diff`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.diff.changedMeasures).toEqual([4, 8]);
    expect(res.body.diff.changeDescriptions[4]).toContain('G4');
  });
});
