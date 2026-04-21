import supertest from 'supertest';
import { app } from '../index';
import { db } from '../db';
import { notifyNewVersion, notifyNewVersionNoDiff, notifyRestore } from './notifications';

const request = supertest(app);

let token: string;
let ensembleId: string;
let versionId: string;

async function clearDb() {
  await db.query(`DELETE FROM version_diffs`);
  await db.query(`DELETE FROM parts`);
  await db.query(`DELETE FROM versions`);
  await db.query(`DELETE FROM charts`);
  await db.query(`DELETE FROM ensembles`);
  await db.query(`DELETE FROM workspace_members`);
  await db.query(`DELETE FROM workspaces`);
  await db.query(`DELETE FROM users`);
}

beforeAll(async () => {
  await clearDb();

  const signup = await request.post('/auth/signup').send({
    email: 'notiftest@example.com',
    name: 'Owner',
    password: 'password123',
  });
  token = signup.body.token;
  const workspaceId = signup.body.workspaceId;

  const ens = await request.post('/ensembles')
    .set('Authorization', `Bearer ${token}`)
    .send({ workspaceId, name: 'Notify Band' });
  ensembleId = ens.body.ensemble.id;

  const chart = await request.post('/charts')
    .set('Authorization', `Bearer ${token}`)
    .send({ ensembleId, name: 'Blue Rondo' });
  const chartId = chart.body.chart.id;

  const version = await request.post('/versions')
    .set('Authorization', `Bearer ${token}`)
    .send({ chartId, name: 'Version 2' });
  versionId = version.body.version.id;
});

afterAll(async () => {
  await db.end();
});

describe('notifyNewVersion', () => {
  it('logs notification summary with changed-measure count', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();

    const diffJson = {
      parts: {
        trumpet: {
          changedMeasures: [3, 7],
          changeDescriptions: {},
          structuralChanges: { insertedMeasures: [], deletedMeasures: [], sectionLabelChanges: [] },
          measureMapping: {},
        },
      },
    };

    await notifyNewVersion(ensembleId, versionId, diffJson);

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('2 measures changed')
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('Version 2')
    );

    spy.mockRestore();
  });

  it('logs "new version available" when no measures changed', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();

    const diffJson = {
      parts: {
        trumpet: {
          changedMeasures: [],
          changeDescriptions: {},
          structuralChanges: { insertedMeasures: [], deletedMeasures: [], sectionLabelChanges: [] },
          measureMapping: {},
        },
      },
    };

    await notifyNewVersion(ensembleId, versionId, diffJson);

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('new version available')
    );

    spy.mockRestore();
  });
});

describe('notifyNewVersionNoDiff', () => {
  it('logs fallback "new version available" message', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();

    await notifyNewVersionNoDiff(ensembleId, versionId);

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('new version available')
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('Version 2')
    );

    spy.mockRestore();
  });
});

describe('notifyRestore', () => {
  it('logs restore notification', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();

    await notifyRestore(ensembleId, versionId);

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('restored')
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('Version 2')
    );

    spy.mockRestore();
  });
});
