import supertest from 'supertest';
import { app } from '../index';
import { db } from '../db';

const request = supertest(app);

let token: string;

beforeAll(async () => {
  await db.query(`DELETE FROM workspace_members`);
  await db.query(`DELETE FROM workspaces`);
  await db.query(`DELETE FROM users`);

  const signup = await request.post('/auth/signup').send({
    email: 'dt-test@example.com',
    name: 'DT Tester',
    password: 'password123',
  });
  token = signup.body.token;
});

afterAll(async () => {
  await db.end();
});

// device_tokens route is currently stubbed — see TODO in deviceTokens.ts.
// Push notification delivery is deferred (see docs/DEFERRED.md).

describe('POST /device-tokens', () => {
  it('returns 201 (stubbed)', async () => {
    const res = await request
      .post('/device-tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'abc123iostoken', platform: 'ios' });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await request
      .post('/device-tokens')
      .send({ token: 'abc', platform: 'ios' });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /device-tokens/:token', () => {
  it('returns 204 (stubbed)', async () => {
    const res = await request
      .delete('/device-tokens/some-token')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
