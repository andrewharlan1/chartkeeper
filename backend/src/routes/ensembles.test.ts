import supertest from 'supertest';
import { app } from '../index';
import { db } from '../db';

const request = supertest(app);

async function clearDb() {
  await db.query(`DELETE FROM invitations`);
  await db.query(`DELETE FROM ensemble_members`);
  await db.query(`DELETE FROM ensembles`);
  await db.query(`DELETE FROM users`);
}

async function signup(email: string, name = 'Test User', password = 'password123') {
  const res = await request.post('/auth/signup').send({ email, name, password });
  return res.body as { token: string; user: { id: string; email: string; name: string } };
}

beforeAll(clearDb);
afterAll(async () => { await db.end(); });

describe('POST /ensembles', () => {
  it('creates an ensemble and adds creator as owner', async () => {
    const { token } = await signup('owner@example.com');
    const res = await request
      .post('/ensembles')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Band' });

    expect(res.status).toBe(201);
    expect(res.body.ensemble.name).toBe('Test Band');
  });

  it('returns 401 without token', async () => {
    const res = await request.post('/ensembles').send({ name: 'No Auth Band' });
    expect(res.status).toBe(401);
  });
});

describe('GET /ensembles/:id', () => {
  let token: string;
  let ensembleId: string;

  beforeAll(async () => {
    await clearDb();
    const auth = await signup('getowner@example.com');
    token = auth.token;
    const res = await request
      .post('/ensembles')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Get Band' });
    ensembleId = res.body.ensemble.id;
  });

  it('returns ensemble for a member', async () => {
    const res = await request
      .get(`/ensembles/${ensembleId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ensemble.id).toBe(ensembleId);
  });

  it('returns 403 for non-member', async () => {
    const { token: otherToken } = await signup('outsider@example.com');
    const res = await request
      .get(`/ensembles/${ensembleId}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /ensembles/:id/members', () => {
  let token: string;
  let ensembleId: string;

  beforeAll(async () => {
    await clearDb();
    const auth = await signup('membersowner@example.com');
    token = auth.token;
    const res = await request
      .post('/ensembles')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Members Band' });
    ensembleId = res.body.ensemble.id;
  });

  it('returns members list including owner', async () => {
    const res = await request
      .get(`/ensembles/${ensembleId}/members`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].role).toBe('owner');
  });
});

describe('POST /ensembles/:id/invite', () => {
  let ownerToken: string;
  let playerToken: string;
  let ensembleId: string;

  beforeAll(async () => {
    await clearDb();
    const auth = await signup('inviteowner@example.com');
    ownerToken = auth.token;
    const res = await request
      .post('/ensembles')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Invite Band' });
    ensembleId = res.body.ensemble.id;

    // Add a player member to test permission restriction
    const inviteRes = await request
      .post(`/ensembles/${ensembleId}/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'existingplayer@example.com', role: 'player' });
    const inviteToken = inviteRes.body.inviteUrl.split('/').pop();
    const playerAuth = await signup('existingplayer@example.com', 'Player');
    // Accept via signup with inviteToken
    await request.post('/auth/signup').send({
      email: 'playerformember@example.com',
      name: 'Player For Member',
      password: 'password123',
      inviteToken,
    });
    playerToken = playerAuth.token;
  });

  it('owner can invite a new user', async () => {
    const res = await request
      .post(`/ensembles/${ensembleId}/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'newplayer@example.com', role: 'player' });
    expect(res.status).toBe(201);
    expect(res.body.inviteUrl).toMatch(/\/auth\/accept-invite\//);
  });

  it('returns same invite URL for duplicate pending invite', async () => {
    const res1 = await request
      .post(`/ensembles/${ensembleId}/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'duppending@example.com', role: 'player' });
    const res2 = await request
      .post(`/ensembles/${ensembleId}/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'duppending@example.com', role: 'player' });
    expect(res1.body.inviteUrl).toBe(res2.body.inviteUrl);
  });

  it('player cannot invite', async () => {
    const res = await request
      .post(`/ensembles/${ensembleId}/invite`)
      .set('Authorization', `Bearer ${playerToken}`)
      .send({ email: 'another@example.com', role: 'player' });
    expect(res.status).toBe(403);
  });

  it('returns 409 if user is already a member', async () => {
    const res = await request
      .post(`/ensembles/${ensembleId}/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'inviteowner@example.com', role: 'player' });
    expect(res.status).toBe(409);
  });
});

describe('Invite flow: new user joins via invite', () => {
  let ownerToken: string;
  let ensembleId: string;
  let inviteToken: string;

  beforeAll(async () => {
    await clearDb();
    const auth = await signup('flowowner@example.com');
    ownerToken = auth.token;
    const res = await request
      .post('/ensembles')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Flow Band' });
    ensembleId = res.body.ensemble.id;

    const inviteRes = await request
      .post(`/ensembles/${ensembleId}/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'newbie@example.com', role: 'player' });
    inviteToken = inviteRes.body.inviteUrl.split('/').pop();
  });

  it('new user signs up with invite token and is added to ensemble', async () => {
    const res = await request.post('/auth/signup').send({
      email: 'newbie@example.com',
      name: 'Newbie Player',
      password: 'password123',
      inviteToken,
    });
    expect(res.status).toBe(201);

    const membersRes = await request
      .get(`/ensembles/${ensembleId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const emails = membersRes.body.members.map((m: any) => m.email);
    expect(emails).toContain('newbie@example.com');
  });
});

describe('Invite flow: existing user accepts invite', () => {
  let ownerToken: string;
  let ensembleId: string;
  let inviteToken: string;

  beforeAll(async () => {
    await clearDb();
    const auth = await signup('existingflowowner@example.com');
    ownerToken = auth.token;
    const res = await request
      .post('/ensembles')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Existing Flow Band' });
    ensembleId = res.body.ensemble.id;

    await signup('existingmember@example.com');

    const inviteRes = await request
      .post(`/ensembles/${ensembleId}/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'existingmember@example.com', role: 'editor' });
    inviteToken = inviteRes.body.inviteUrl.split('/').pop();
  });

  it('existing user accepts invite and is added to ensemble', async () => {
    const res = await request
      .post(`/auth/accept-invite/${inviteToken}`)
      .send({ email: 'existingmember@example.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.ensembleId).toBe(ensembleId);

    const membersRes = await request
      .get(`/ensembles/${ensembleId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const member = membersRes.body.members.find((m: any) => m.email === 'existingmember@example.com');
    expect(member?.role).toBe('editor');
  });
});
