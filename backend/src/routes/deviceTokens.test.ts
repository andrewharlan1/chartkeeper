import supertest from 'supertest';
import { app } from '../index';
import { db } from '../db';

// Stub push so no real APNs/web-push calls are made
jest.mock('../lib/push', () => ({
  sendPush: jest.fn().mockResolvedValue(undefined),
}));

const request = supertest(app);

async function clearDb() {
  await db.query(`DELETE FROM device_tokens`);
  await db.query(`DELETE FROM users`);
}

async function signup(email: string) {
  const res = await request.post('/auth/signup').send({
    email,
    name: 'Test',
    password: 'password123',
  });
  return res.body.token as string;
}

beforeAll(clearDb);
afterAll(async () => { await db.end(); });

describe('POST /device-tokens', () => {
  it('registers an iOS token', async () => {
    const token = await signup('ios@example.com');
    const res = await request
      .post('/device-tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'abc123iostoken', platform: 'ios' });
    expect(res.status).toBe(201);
  });

  it('registers a web push token', async () => {
    const token = await signup('web@example.com');
    const res = await request
      .post('/device-tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({
        token: 'web-sub-token',
        platform: 'web',
        webEndpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        webP256dh: 'p256dhkey',
        webAuth: 'authsecret',
      });
    expect(res.status).toBe(201);
  });

  it('is idempotent — registering same token twice does not error', async () => {
    const token = await signup('idem@example.com');
    const body = { token: 'same-token', platform: 'ios' };
    await request.post('/device-tokens').set('Authorization', `Bearer ${token}`).send(body);
    const res = await request.post('/device-tokens').set('Authorization', `Bearer ${token}`).send(body);
    expect(res.status).toBe(201);
  });

  it('returns 400 for missing platform', async () => {
    const token = await signup('bad@example.com');
    const res = await request
      .post('/device-tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'abc' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for web platform missing endpoint fields', async () => {
    const token = await signup('badweb@example.com');
    const res = await request
      .post('/device-tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'abc', platform: 'web' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /device-tokens/:token', () => {
  it('deregisters a token', async () => {
    const token = await signup('delete@example.com');
    await request
      .post('/device-tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'to-delete', platform: 'ios' });

    const res = await request
      .delete('/device-tokens/to-delete')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);

    const row = await db.query(`SELECT id FROM device_tokens WHERE token = 'to-delete'`);
    expect(row.rows).toHaveLength(0);
  });

  it('is a no-op for unknown token', async () => {
    const token = await signup('nodeltarget@example.com');
    const res = await request
      .delete('/device-tokens/nonexistent')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
