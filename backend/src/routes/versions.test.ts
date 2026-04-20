import supertest from 'supertest';
import { app } from '../index';
import { db } from '../db';

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

  const signup = await request.post('/auth/signup').send({
    email: 'ver-test@example.com',
    name: 'Version Tester',
    password: 'securepassword',
  });
  token = signup.body.token;
  workspaceId = signup.body.workspaceId;

  const ens = await request.post('/ensembles')
    .set('Authorization', `Bearer ${token}`)
    .send({ workspaceId, name: 'Version Test Ensemble' });
  ensembleId = ens.body.ensemble.id;

  const chart = await request.post('/charts')
    .set('Authorization', `Bearer ${token}`)
    .send({ ensembleId, name: 'Test Song' });
  chartId = chart.body.chart.id;
});

afterAll(async () => {
  await db.end();
});

describe('POST /versions', () => {
  it('creates a version in a chart', async () => {
    const res = await request.post('/versions')
      .set('Authorization', `Bearer ${token}`)
      .send({ chartId, name: 'v1', notes: 'First version' });

    expect(res.status).toBe(201);
    expect(res.body.version.name).toBe('v1');
    expect(res.body.version.notes).toBe('First version');
    expect(res.body.version.chartId).toBe(chartId);
    expect(res.body.version.sortOrder).toBe(0);
    versionId = res.body.version.id;
  });

  it('auto-increments sortOrder', async () => {
    const res = await request.post('/versions')
      .set('Authorization', `Bearer ${token}`)
      .send({ chartId, name: 'v2' });

    expect(res.status).toBe(201);
    expect(res.body.version.sortOrder).toBe(1);
  });

  it('supports seededFromVersionId', async () => {
    const res = await request.post('/versions')
      .set('Authorization', `Bearer ${token}`)
      .send({ chartId, name: 'v3', seededFromVersionId: versionId });

    expect(res.status).toBe(201);
    expect(res.body.version.seededFromVersionId).toBe(versionId);
  });
});

describe('GET /versions?chartId=...', () => {
  it('lists versions in a chart', async () => {
    const res = await request.get(`/versions?chartId=${chartId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.versions.length).toBe(3);
    expect(res.body.versions[0].name).toBe('v1');
  });

  it('returns 400 without chartId', async () => {
    const res = await request.get('/versions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /versions/:id', () => {
  it('returns version with partCount', async () => {
    const res = await request.get(`/versions/${versionId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.version.id).toBe(versionId);
    expect(res.body.version.partCount).toBe(0);
  });
});

describe('PATCH /versions/:id', () => {
  it('renames the version', async () => {
    const res = await request.patch(`/versions/${versionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Version 1 (renamed)' });

    expect(res.status).toBe(200);
    expect(res.body.version.name).toBe('Version 1 (renamed)');
  });
});

describe('DELETE /versions/:id', () => {
  it('soft-deletes the version', async () => {
    const create = await request.post('/versions')
      .set('Authorization', `Bearer ${token}`)
      .send({ chartId, name: 'Doomed Version' });

    const res = await request.delete(`/versions/${create.body.version.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });
});
