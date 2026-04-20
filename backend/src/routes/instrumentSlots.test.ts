import supertest from 'supertest';
import { app } from '../index';
import { db } from '../db';

const request = supertest(app);

let token: string;
let workspaceId: string;
let ensembleId: string;
let slotId: string;

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
    email: 'slots-test@example.com',
    name: 'Slots Tester',
    password: 'securepassword',
  });
  token = signup.body.token;
  workspaceId = signup.body.workspaceId;

  const ens = await request.post('/ensembles')
    .set('Authorization', `Bearer ${token}`)
    .send({ workspaceId, name: 'Slot Test Ensemble' });
  ensembleId = ens.body.ensemble.id;
});

afterAll(async () => {
  await db.end();
});

describe('POST /instrument-slots', () => {
  it('creates an instrument slot', async () => {
    const res = await request.post('/instrument-slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ ensembleId, name: 'Trumpet 1', section: 'Brass' });

    expect(res.status).toBe(201);
    expect(res.body.instrumentSlot.name).toBe('Trumpet 1');
    expect(res.body.instrumentSlot.section).toBe('Brass');
    expect(res.body.instrumentSlot.ensembleId).toBe(ensembleId);
    slotId = res.body.instrumentSlot.id;
  });

  it('auto-increments sortOrder', async () => {
    const res = await request.post('/instrument-slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ ensembleId, name: 'Alto Sax' });

    expect(res.status).toBe(201);
    expect(res.body.instrumentSlot.sortOrder).toBe(1);
  });

  it('rejects empty name', async () => {
    const res = await request.post('/instrument-slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ ensembleId, name: '' });

    expect(res.status).toBe(400);
  });
});

describe('GET /instrument-slots?ensembleId=...', () => {
  it('lists slots in an ensemble', async () => {
    const res = await request.get(`/instrument-slots?ensembleId=${ensembleId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.instrumentSlots.length).toBeGreaterThanOrEqual(2);
    expect(res.body.instrumentSlots[0].name).toBe('Trumpet 1');
  });

  it('returns 400 without ensembleId', async () => {
    const res = await request.get('/instrument-slots')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /instrument-slots/:id', () => {
  it('returns slot details', async () => {
    const res = await request.get(`/instrument-slots/${slotId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.instrumentSlot.id).toBe(slotId);
  });
});

describe('PATCH /instrument-slots/:id', () => {
  it('renames the slot', async () => {
    const res = await request.patch(`/instrument-slots/${slotId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Trumpet 2' });

    expect(res.status).toBe(200);
    expect(res.body.instrumentSlot.name).toBe('Trumpet 2');
  });
});

describe('DELETE /instrument-slots/:id', () => {
  it('soft-deletes the slot', async () => {
    const create = await request.post('/instrument-slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ ensembleId, name: 'Doomed Slot' });

    const res = await request.delete(`/instrument-slots/${create.body.instrumentSlot.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });
});
