import supertest from 'supertest';
import { app } from '../index';
import { db } from '../db';

const request = supertest(app);

let token: string;
let workspaceId: string;
let ensembleId: string;
let chartId1: string;
let chartId2: string;
let chartId3: string;
let eventId: string;

beforeAll(async () => {
  await db.query(`DELETE FROM event_charts`);
  await db.query(`DELETE FROM events`);
  await db.query(`DELETE FROM annotations`);
  await db.query(`DELETE FROM annotation_layers`);
  await db.query(`DELETE FROM version_diffs`);
  await db.query(`DELETE FROM part_slot_assignments`);
  await db.query(`DELETE FROM parts`);
  await db.query(`DELETE FROM versions`);
  await db.query(`DELETE FROM charts`);
  await db.query(`DELETE FROM instrument_slot_assignments`);
  await db.query(`DELETE FROM instrument_slots`);
  await db.query(`DELETE FROM ensembles`);
  await db.query(`DELETE FROM workspace_members`);
  await db.query(`DELETE FROM workspaces`);
  await db.query(`DELETE FROM notifications`);
  await db.query(`DELETE FROM users`);

  const signup = await request.post('/auth/signup').send({
    email: 'events-test@example.com',
    name: 'Events Tester',
    password: 'securepassword',
  });
  token = signup.body.token;
  workspaceId = signup.body.workspaceId;

  // Create an ensemble
  const ensRes = await request.post('/ensembles')
    .set('Authorization', `Bearer ${token}`)
    .send({ workspaceId, name: 'Test Band' });
  ensembleId = ensRes.body.ensemble.id;

  // Create three charts
  for (const name of ['Autumn Leaves', 'All The Things', 'Giant Steps']) {
    const chartRes = await request.post('/charts')
      .set('Authorization', `Bearer ${token}`)
      .send({ ensembleId, name });
    if (name === 'Autumn Leaves') chartId1 = chartRes.body.chart.id;
    else if (name === 'All The Things') chartId2 = chartRes.body.chart.id;
    else chartId3 = chartRes.body.chart.id;
  }
});

afterAll(async () => {
  await db.end();
});

describe('POST /ensembles/:ensembleId/events', () => {
  it('creates an event', async () => {
    const res = await request.post(`/ensembles/${ensembleId}/events`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Friday Night Gig',
        eventType: 'gig',
        startsAt: '2026-05-15T20:00:00.000Z',
        location: 'Blue Note',
        notes: 'Bring charts',
      });

    expect(res.status).toBe(201);
    expect(res.body.event.name).toBe('Friday Night Gig');
    expect(res.body.event.eventType).toBe('gig');
    expect(res.body.event.location).toBe('Blue Note');
    expect(res.body.event.ensembleId).toBe(ensembleId);
    eventId = res.body.event.id;
  });

  it('defaults eventType to gig', async () => {
    const res = await request.post(`/ensembles/${ensembleId}/events`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Rehearsal Tuesday',
        startsAt: '2026-05-13T18:00:00.000Z',
      });

    expect(res.status).toBe(201);
    expect(res.body.event.eventType).toBe('gig');
  });

  it('rejects missing name', async () => {
    const res = await request.post(`/ensembles/${ensembleId}/events`)
      .set('Authorization', `Bearer ${token}`)
      .send({ startsAt: '2026-05-15T20:00:00.000Z' });

    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await request.post(`/ensembles/${ensembleId}/events`)
      .send({ name: 'No Auth', startsAt: '2026-05-15T20:00:00.000Z' });
    expect(res.status).toBe(401);
  });
});

describe('GET /ensembles/:ensembleId/events', () => {
  it('lists events for the ensemble', async () => {
    const res = await request.get(`/ensembles/${ensembleId}/events`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeGreaterThanOrEqual(1);
    expect(res.body.events.some((e: any) => e.name === 'Friday Night Gig')).toBe(true);
  });
});

describe('GET /events/:eventId', () => {
  it('returns event with empty chart list', async () => {
    const res = await request.get(`/events/${eventId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.event.id).toBe(eventId);
    expect(res.body.charts).toEqual([]);
  });

  it('returns 404 for non-existent event', async () => {
    const res = await request.get('/events/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /events/:eventId', () => {
  it('updates event fields', async () => {
    const res = await request.patch(`/events/${eventId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Saturday Night Gig', location: 'Village Vanguard' });

    expect(res.status).toBe(200);
    expect(res.body.event.name).toBe('Saturday Night Gig');
    expect(res.body.event.location).toBe('Village Vanguard');
  });
});

describe('POST /events/:eventId/charts', () => {
  it('adds a chart to the event', async () => {
    const res = await request.post(`/events/${eventId}/charts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ chartId: chartId1 });

    expect(res.status).toBe(201);
    expect(res.body.eventChart.chartId).toBe(chartId1);
    expect(res.body.eventChart.eventId).toBe(eventId);
  });

  it('adds a second chart', async () => {
    const res = await request.post(`/events/${eventId}/charts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ chartId: chartId2 });

    expect(res.status).toBe(201);
  });

  it('adds a third chart', async () => {
    const res = await request.post(`/events/${eventId}/charts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ chartId: chartId3 });

    expect(res.status).toBe(201);
  });

  it('returns 409 on duplicate add (idempotent check)', async () => {
    const res = await request.post(`/events/${eventId}/charts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ chartId: chartId1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already/i);
  });

  it('returns event with chart list after adds', async () => {
    const res = await request.get(`/events/${eventId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.charts.length).toBe(3);
    expect(res.body.charts[0].chartName).toBe('Autumn Leaves');
  });
});

describe('PUT /events/:eventId/charts/order', () => {
  it('reorders charts within the event', async () => {
    // Reverse the order: chartId3 first, then chartId1, then chartId2
    const res = await request.put(`/events/${eventId}/charts/order`)
      .set('Authorization', `Bearer ${token}`)
      .send({ chartIds: [chartId3, chartId1, chartId2] });

    expect(res.status).toBe(200);

    // Verify new order
    const getRes = await request.get(`/events/${eventId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.body.charts[0].chartId).toBe(chartId3);
    expect(getRes.body.charts[1].chartId).toBe(chartId1);
    expect(getRes.body.charts[2].chartId).toBe(chartId2);
  });
});

describe('DELETE /events/:eventId/charts/:chartId', () => {
  it('removes a chart from the event', async () => {
    const res = await request.delete(`/events/${eventId}/charts/${chartId2}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    // Verify chart is gone from event
    const getRes = await request.get(`/events/${eventId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.body.charts.length).toBe(2);
    expect(getRes.body.charts.every((c: any) => c.chartId !== chartId2)).toBe(true);
  });

  it('does not remove the chart from the ensemble', async () => {
    const res = await request.get(`/charts?ensembleId=${ensembleId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.charts.length).toBe(3); // All three charts still exist
    expect(res.body.charts.some((c: any) => c.name === 'All The Things')).toBe(true);
  });
});

describe('DELETE /events/:eventId (soft delete)', () => {
  it('soft-deletes the event', async () => {
    const res = await request.delete(`/events/${eventId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('deleted event no longer appears in list', async () => {
    const res = await request.get(`/ensembles/${ensembleId}/events`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.events.every((e: any) => e.id !== eventId)).toBe(true);
  });

  it('deleted event returns 404 on direct access', async () => {
    const res = await request.get(`/events/${eventId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /me/events', () => {
  it('returns events across all ensembles', async () => {
    // Create a new event (the old one was soft-deleted)
    const createRes = await request.post(`/ensembles/${ensembleId}/events`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Workshop',
        eventType: 'workshop',
        startsAt: '2026-06-01T10:00:00.000Z',
      });
    expect(createRes.status).toBe(201);

    const res = await request.get('/me/events')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeGreaterThanOrEqual(1);
    expect(res.body.events.some((e: any) => e.name === 'Workshop')).toBe(true);
    expect(res.body.events[0].ensembleName).toBe('Test Band');
  });
});
