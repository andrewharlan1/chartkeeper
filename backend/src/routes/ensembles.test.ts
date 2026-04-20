import supertest from 'supertest';
import { app } from '../index';
import { db } from '../db';

const request = supertest(app);

let token: string;
let workspaceId: string;
let ensembleId: string;

beforeAll(async () => {
  await db.query(`DELETE FROM annotations`);
  await db.query(`DELETE FROM annotation_layers`);
  await db.query(`DELETE FROM version_diffs`);
  await db.query(`DELETE FROM parts`);
  await db.query(`DELETE FROM versions`);
  await db.query(`DELETE FROM instrument_slots`);
  await db.query(`DELETE FROM ensembles`);
  await db.query(`DELETE FROM workspace_members`);
  await db.query(`DELETE FROM workspaces`);
  await db.query(`DELETE FROM users`);

  const signup = await request.post('/auth/signup').send({
    email: 'ens-test@example.com',
    name: 'Ensemble Tester',
    password: 'securepassword',
  });
  token = signup.body.token;
  workspaceId = signup.body.workspaceId;
});

afterAll(async () => {
  await db.end();
});

describe('POST /ensembles', () => {
  it('creates an ensemble in a workspace', async () => {
    const res = await request.post('/ensembles')
      .set('Authorization', `Bearer ${token}`)
      .send({ workspaceId, name: 'Jazz Combo' });

    expect(res.status).toBe(201);
    expect(res.body.ensemble.name).toBe('Jazz Combo');
    expect(res.body.ensemble.workspaceId).toBe(workspaceId);
    ensembleId = res.body.ensemble.id;
  });

  it('rejects missing workspaceId', async () => {
    const res = await request.post('/ensembles')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'No WS' });

    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await request.post('/ensembles').send({ workspaceId, name: 'No Auth' });
    expect(res.status).toBe(401);
  });
});

describe('GET /ensembles?workspaceId=...', () => {
  it('lists ensembles in a workspace', async () => {
    const res = await request.get(`/ensembles?workspaceId=${workspaceId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ensembles.length).toBeGreaterThanOrEqual(1);
    expect(res.body.ensembles[0].name).toBe('Jazz Combo');
  });

  it('returns 400 without workspaceId', async () => {
    const res = await request.get('/ensembles')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /ensembles/:id', () => {
  it('returns ensemble details for a member', async () => {
    const res = await request.get(`/ensembles/${ensembleId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ensemble.id).toBe(ensembleId);
  });

  it('returns 403 for non-member', async () => {
    const other = await request.post('/auth/signup').send({
      email: 'ens-outsider@example.com',
      name: 'Outsider',
      password: 'securepassword',
    });
    const res = await request.get(`/ensembles/${ensembleId}`)
      .set('Authorization', `Bearer ${other.body.token}`);

    expect(res.status).toBe(403);
  });
});

describe('PATCH /ensembles/:id', () => {
  it('renames the ensemble', async () => {
    const res = await request.patch(`/ensembles/${ensembleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Big Band' });

    expect(res.status).toBe(200);
    expect(res.body.ensemble.name).toBe('Big Band');
  });
});

describe('DELETE /ensembles/:id', () => {
  it('soft-deletes the ensemble', async () => {
    const create = await request.post('/ensembles')
      .set('Authorization', `Bearer ${token}`)
      .send({ workspaceId, name: 'Doomed Ensemble' });

    const res = await request.delete(`/ensembles/${create.body.ensemble.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    // Should no longer appear in list
    const list = await request.get(`/ensembles?workspaceId=${workspaceId}`)
      .set('Authorization', `Bearer ${token}`);
    const ids = list.body.ensembles.map((e: any) => e.id);
    expect(ids).not.toContain(create.body.ensemble.id);
  });
});
