import supertest from 'supertest';
import { app } from '../index';
import { db } from '../db';

const request = supertest(app);

let token: string;
let workspaceId: string;
let ensembleId: string;
let chartId: string;

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
    email: 'charts-test@example.com',
    name: 'Chart Tester',
    password: 'securepassword',
  });
  token = signup.body.token;
  workspaceId = signup.body.workspaceId;

  const ens = await request.post('/ensembles')
    .set('Authorization', `Bearer ${token}`)
    .send({ workspaceId, name: 'Chart Test Ensemble' });
  ensembleId = ens.body.ensemble.id;
});

afterAll(async () => {
  await db.end();
});

describe('POST /charts', () => {
  it('creates a chart in an ensemble', async () => {
    const res = await request.post('/charts')
      .set('Authorization', `Bearer ${token}`)
      .send({ ensembleId, name: 'Autumn Leaves', composer: 'Joseph Kosma' });

    expect(res.status).toBe(201);
    expect(res.body.chart.name).toBe('Autumn Leaves');
    expect(res.body.chart.composer).toBe('Joseph Kosma');
    expect(res.body.chart.ensembleId).toBe(ensembleId);
    chartId = res.body.chart.id;
  });

  it('rejects empty name', async () => {
    const res = await request.post('/charts')
      .set('Authorization', `Bearer ${token}`)
      .send({ ensembleId, name: '' });
    expect(res.status).toBe(400);
  });

  it('auto-increments sortOrder', async () => {
    const res = await request.post('/charts')
      .set('Authorization', `Bearer ${token}`)
      .send({ ensembleId, name: 'Blue Bossa' });
    expect(res.status).toBe(201);
    expect(res.body.chart.sortOrder).toBe(1);
  });
});

describe('GET /charts?ensembleId=...', () => {
  it('lists charts for an ensemble', async () => {
    const res = await request.get(`/charts?ensembleId=${ensembleId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.charts.length).toBe(2);
    expect(res.body.charts[0].name).toBe('Autumn Leaves');
    expect(res.body.charts[1].name).toBe('Blue Bossa');
  });

  it('returns 400 without ensembleId', async () => {
    const res = await request.get('/charts')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('returns 403 for non-member', async () => {
    const other = await request.post('/auth/signup').send({
      email: 'charts-outsider@example.com',
      name: 'Outsider',
      password: 'securepassword',
    });
    const res = await request.get(`/charts?ensembleId=${ensembleId}`)
      .set('Authorization', `Bearer ${other.body.token}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /charts/:id', () => {
  it('returns chart details', async () => {
    const res = await request.get(`/charts/${chartId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.chart.name).toBe('Autumn Leaves');
  });
});

describe('PATCH /charts/:id', () => {
  it('updates the chart name', async () => {
    const res = await request.patch(`/charts/${chartId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Autumn Leaves (arr. Miles)' });
    expect(res.status).toBe(200);
    expect(res.body.chart.name).toBe('Autumn Leaves (arr. Miles)');
  });
});

describe('DELETE /charts/:id', () => {
  it('soft-deletes a chart', async () => {
    const create = await request.post('/charts')
      .set('Authorization', `Bearer ${token}`)
      .send({ ensembleId, name: 'Doomed Chart' });

    const res = await request.delete(`/charts/${create.body.chart.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    // Should not appear in list
    const list = await request.get(`/charts?ensembleId=${ensembleId}`)
      .set('Authorization', `Bearer ${token}`);
    const names = list.body.charts.map((c: any) => c.name);
    expect(names).not.toContain('Doomed Chart');
  });
});
