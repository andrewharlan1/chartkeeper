import supertest from 'supertest';
import { app } from '../index';
import { db } from '../db';

const request = supertest(app);

let token: string;
let workspaceId: string;

beforeAll(async () => {
  // Clean new-schema tables in FK order
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

  // Create a user (signup seeds a default workspace)
  const signup = await request.post('/auth/signup').send({
    email: 'ws-test@example.com',
    name: 'WS Tester',
    password: 'securepassword',
  });
  token = signup.body.token;
  workspaceId = signup.body.workspaceId;
});

afterAll(async () => {
  await db.end();
});

describe('GET /workspaces', () => {
  it('returns the user workspaces', async () => {
    const res = await request.get('/workspaces')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.workspaces.length).toBeGreaterThanOrEqual(1);
    expect(res.body.workspaces[0].role).toBe('owner');
  });

  it('returns 401 without auth', async () => {
    const res = await request.get('/workspaces');
    expect(res.status).toBe(401);
  });
});

describe('POST /workspaces', () => {
  it('creates a new workspace and adds caller as owner', async () => {
    const res = await request.post('/workspaces')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Second Workspace' });

    expect(res.status).toBe(201);
    expect(res.body.workspace.name).toBe('Second Workspace');
    expect(res.body.workspace.role).toBe('owner');
  });

  it('rejects empty name', async () => {
    const res = await request.post('/workspaces')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' });

    expect(res.status).toBe(400);
  });
});

describe('GET /workspaces/:id', () => {
  it('returns workspace details for a member', async () => {
    const res = await request.get(`/workspaces/${workspaceId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.workspace.id).toBe(workspaceId);
    expect(res.body.workspace.role).toBe('owner');
  });

  it('returns 403 for non-member', async () => {
    // Create another user
    const other = await request.post('/auth/signup').send({
      email: 'ws-other@example.com',
      name: 'Other',
      password: 'securepassword',
    });

    const res = await request.get(`/workspaces/${workspaceId}`)
      .set('Authorization', `Bearer ${other.body.token}`);

    expect(res.status).toBe(403);
  });
});

describe('PATCH /workspaces/:id', () => {
  it('renames the workspace (owner)', async () => {
    const res = await request.patch(`/workspaces/${workspaceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed WS' });

    expect(res.status).toBe(200);
    expect(res.body.workspace.name).toBe('Renamed WS');
  });
});

describe('DELETE /workspaces/:id', () => {
  it('soft-deletes the workspace (owner)', async () => {
    // Create a throwaway workspace to delete
    const create = await request.post('/workspaces')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Doomed WS' });

    const res = await request.delete(`/workspaces/${create.body.workspace.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });
});
