import supertest from 'supertest';
import { app } from '../index';
import { db } from '../db';

// Stub S3 so tests don't require live AWS credentials
jest.mock('../lib/s3', () => ({
  uploadFile: jest.fn().mockResolvedValue('mocked-s3-key'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed-url'),
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
  const res = await request.post('/auth/signup').send({
    email,
    name: 'Test User',
    password: 'password123',
  });
  return res.body as { token: string; user: { id: string } };
}

async function createEnsemble(token: string, name = 'Test Band') {
  const res = await request
    .post('/ensembles')
    .set('Authorization', `Bearer ${token}`)
    .send({ name });
  return res.body.ensemble as { id: string };
}

async function createChart(token: string, ensembleId: string) {
  const res = await request
    .post('/charts')
    .set('Authorization', `Bearer ${token}`)
    .send({ ensembleId, title: 'Take Five', composer: 'Dave Brubeck' });
  return res.body.chart as { id: string };
}

beforeAll(clearDb);
afterAll(async () => { await db.end(); });

describe('POST /charts', () => {
  let token: string;
  let ensembleId: string;

  beforeAll(async () => {
    const auth = await signup('chartowner@example.com');
    token = auth.token;
    const ensemble = await createEnsemble(token);
    ensembleId = ensemble.id;
  });

  it('creates a chart for an ensemble', async () => {
    const res = await request
      .post('/charts')
      .set('Authorization', `Bearer ${token}`)
      .send({ ensembleId, title: 'So What', composer: 'Miles Davis' });
    expect(res.status).toBe(201);
    expect(res.body.chart.title).toBe('So What');
    expect(res.body.chart.ensemble_id).toBe(ensembleId);
  });

  it('allows optional fields to be omitted', async () => {
    const res = await request
      .post('/charts')
      .set('Authorization', `Bearer ${token}`)
      .send({ ensembleId });
    expect(res.status).toBe(201);
    expect(res.body.chart.title).toBeNull();
  });

  it('returns 403 for non-member', async () => {
    const { token: other } = await signup('chartoutsider@example.com');
    const res = await request
      .post('/charts')
      .set('Authorization', `Bearer ${other}`)
      .send({ ensembleId });
    expect(res.status).toBe(403);
  });
});

describe('GET /charts/:id', () => {
  let token: string;
  let chartId: string;

  beforeAll(async () => {
    const auth = await signup('getchartowner@example.com');
    token = auth.token;
    const ensemble = await createEnsemble(token);
    const chart = await createChart(token, ensemble.id);
    chartId = chart.id;
  });

  it('returns chart for a member', async () => {
    const res = await request
      .get(`/charts/${chartId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.chart.id).toBe(chartId);
    expect(res.body.activeVersion).toBeNull();
  });

  it('returns 404 for unknown chart', async () => {
    const res = await request
      .get('/charts/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /charts/:id/versions', () => {
  let token: string;
  let chartId: string;

  beforeAll(async () => {
    const auth = await signup('versionowner@example.com');
    token = auth.token;
    const ensemble = await createEnsemble(token);
    const chart = await createChart(token, ensemble.id);
    chartId = chart.id;
  });

  it('creates a version with uploaded parts', async () => {
    const res = await request
      .post(`/charts/${chartId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .field('versionName', 'Recording Session Draft')
      .attach('trumpet', Buffer.from('%PDF-1.4 fake'), { filename: 'trumpet.pdf', contentType: 'application/pdf' })
      .attach('trombone', Buffer.from('%PDF-1.4 fake'), { filename: 'trombone.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.version.versionName).toBe('Recording Session Draft');
    expect(res.body.version.versionNumber).toBe(1);
    expect(res.body.version.isActive).toBe(true);
    expect(res.body.parts).toHaveLength(2);
    expect(res.body.parts[0].omr_status).toBe('pending');
  });

  it('auto-names version if no name provided', async () => {
    const res = await request
      .post(`/charts/${chartId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .attach('piano', Buffer.from('%PDF-1.4 fake'), { filename: 'piano.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.version.versionName).toBe('Version 2');
    expect(res.body.version.versionNumber).toBe(2);
  });

  it('new version deactivates previous active version', async () => {
    const versionsRes = await request
      .get(`/charts/${chartId}/versions`)
      .set('Authorization', `Bearer ${token}`);
    const activeVersions = versionsRes.body.versions.filter((v: any) => v.is_active);
    expect(activeVersions).toHaveLength(1);
    expect(activeVersions[0].version_number).toBe(2);
  });

  it('returns 400 with no files', async () => {
    const res = await request
      .post(`/charts/${chartId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .field('versionName', 'Empty');
    expect(res.status).toBe(400);
  });

  it('rejects non-PDF files', async () => {
    const res = await request
      .post(`/charts/${chartId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .attach('piano', Buffer.from('not a pdf'), { filename: 'piano.txt', contentType: 'text/plain' });
    expect(res.status).toBe(500); // multer fileFilter error
  });
});

describe('GET /charts/:id/versions', () => {
  let token: string;
  let chartId: string;

  beforeAll(async () => {
    const auth = await signup('listversions@example.com');
    token = auth.token;
    const ensemble = await createEnsemble(token);
    const chart = await createChart(token, ensemble.id);
    chartId = chart.id;
    await request
      .post(`/charts/${chartId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .attach('trumpet', Buffer.from('%PDF-1.4 fake'), { filename: 'trumpet.pdf', contentType: 'application/pdf' });
  });

  it('returns all versions with parts summary', async () => {
    const res = await request
      .get(`/charts/${chartId}/versions`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.versions).toHaveLength(1);
    expect(res.body.versions[0].parts[0].instrumentName).toBe('trumpet');
  });
});

describe('POST /charts/:id/versions/:vId/restore', () => {
  let token: string;
  let chartId: string;
  let v1Id: string;

  beforeAll(async () => {
    const auth = await signup('restoreowner@example.com');
    token = auth.token;
    const ensemble = await createEnsemble(token);
    const chart = await createChart(token, ensemble.id);
    chartId = chart.id;

    const v1 = await request
      .post(`/charts/${chartId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .attach('trumpet', Buffer.from('%PDF-1.4 fake'), { filename: 'trumpet.pdf', contentType: 'application/pdf' });
    v1Id = v1.body.version.id;

    await request
      .post(`/charts/${chartId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .attach('trumpet', Buffer.from('%PDF-1.4 fake'), { filename: 'trumpet.pdf', contentType: 'application/pdf' });
  });

  it('restores an older version as active', async () => {
    const res = await request
      .post(`/charts/${chartId}/versions/${v1Id}/restore`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.restoredVersionId).toBe(v1Id);

    const versionsRes = await request
      .get(`/charts/${chartId}/versions`)
      .set('Authorization', `Bearer ${token}`);
    const active = versionsRes.body.versions.find((v: any) => v.is_active);
    expect(active.id).toBe(v1Id);
  });
});
