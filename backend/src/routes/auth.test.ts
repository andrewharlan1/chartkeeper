import supertest from 'supertest';
import { app } from '../index';
import { db } from '../db';

const request = supertest(app);

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
});

afterAll(async () => {
  await db.end();
});

describe('POST /auth/signup', () => {
  it('creates a user and returns a token', async () => {
    const res = await request.post('/auth/signup').send({
      email: 'player@example.com',
      name: 'Test Player',
      password: 'securepassword',
    });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('player@example.com');
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('rejects duplicate email with 409', async () => {
    const payload = { email: 'dup@example.com', name: 'Dup', password: 'securepassword' };
    await request.post('/auth/signup').send(payload);
    const res = await request.post('/auth/signup').send(payload);
    expect(res.status).toBe(409);
  });

  it('rejects invalid input with 400', async () => {
    const res = await request.post('/auth/signup').send({ email: 'notanemail' });
    expect(res.status).toBe(400);
  });

  it('normalizes email to lowercase', async () => {
    const res = await request.post('/auth/signup').send({
      email: 'Upper@Example.COM',
      name: 'Upper',
      password: 'securepassword',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('upper@example.com');
  });
});

describe('POST /auth/login', () => {
  beforeAll(async () => {
    await request.post('/auth/signup').send({
      email: 'login@example.com',
      name: 'Login User',
      password: 'correctpassword',
    });
  });

  it('returns a token for valid credentials', async () => {
    const res = await request.post('/auth/login').send({
      email: 'login@example.com',
      password: 'correctpassword',
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('returns 401 for wrong password', async () => {
    const res = await request.post('/auth/login').send({
      email: 'login@example.com',
      password: 'wrongpassword',
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for unknown email', async () => {
    const res = await request.post('/auth/login').send({
      email: 'nobody@example.com',
      password: 'doesntmatter',
    });
    expect(res.status).toBe(401);
  });

  it('returns same error message for wrong password and unknown email', async () => {
    const wrongPass = await request.post('/auth/login').send({
      email: 'login@example.com',
      password: 'wrong',
    });
    const unknownEmail = await request.post('/auth/login').send({
      email: 'nobody@example.com',
      password: 'wrong',
    });
    expect(wrongPass.body.error).toBe(unknownEmail.body.error);
  });
});
