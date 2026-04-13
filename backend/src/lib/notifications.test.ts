import { db } from '../db';
import { notifyNewVersion, notifyNewVersionNoDiff, notifyRestore } from './notifications';

jest.mock('./push', () => ({
  sendPush: jest.fn().mockResolvedValue(undefined),
}));

import { sendPush } from './push';
const mockSendPush = sendPush as jest.Mock;

async function clearDb() {
  await db.query(`DELETE FROM notifications`);
  await db.query(`DELETE FROM device_tokens`);
  await db.query(`DELETE FROM version_diffs`);
  await db.query(`DELETE FROM parts`);
  await db.query(`DELETE FROM chart_versions`);
  await db.query(`DELETE FROM charts`);
  await db.query(`DELETE FROM ensemble_members`);
  await db.query(`DELETE FROM ensembles`);
  await db.query(`DELETE FROM users`);
}

async function seedScenario() {
  const userRes = await db.query(
    `INSERT INTO users (email, name, password_hash) VALUES ('notiftest@example.com', 'Owner', 'x') RETURNING id`
  );
  const playerRes = await db.query(
    `INSERT INTO users (email, name, password_hash) VALUES ('player@example.com', 'Player', 'x') RETURNING id`
  );
  const ownerId = userRes.rows[0].id;
  const playerId = playerRes.rows[0].id;

  const ensRes = await db.query(
    `INSERT INTO ensembles (name, owner_id) VALUES ('Notify Band', $1) RETURNING id`, [ownerId]
  );
  const ensembleId = ensRes.rows[0].id;
  await db.query(
    `INSERT INTO ensemble_members (ensemble_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'player')`,
    [ensembleId, ownerId, playerId]
  );

  const chartRes = await db.query(
    `INSERT INTO charts (ensemble_id, title) VALUES ($1, 'Blue Rondo') RETURNING id`, [ensembleId]
  );
  const chartId = chartRes.rows[0].id;

  const v1Res = await db.query(
    `INSERT INTO chart_versions (chart_id, version_number, version_name, is_active, created_by)
     VALUES ($1, 1, 'Version 1', false, $2) RETURNING id`, [chartId, ownerId]
  );
  const v2Res = await db.query(
    `INSERT INTO chart_versions (chart_id, version_number, version_name, is_active, created_by)
     VALUES ($1, 2, 'Version 2', true, $2) RETURNING id`, [chartId, ownerId]
  );

  // Register a device token for the player
  await db.query(
    `INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, 'player-ios-token', 'ios')`,
    [playerId]
  );

  return { chartId, v1Id: v1Res.rows[0].id, v2Id: v2Res.rows[0].id, ownerId, playerId, ensembleId };
}

beforeAll(clearDb);
afterEach(async () => {
  await clearDb();
  mockSendPush.mockClear();
});
afterAll(async () => { await db.end(); });

describe('notifyNewVersion', () => {
  it('writes notification rows for all members and calls sendPush for device tokens', async () => {
    const { chartId, v2Id, playerId } = await seedScenario();

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

    await notifyNewVersion(chartId, v2Id, diffJson);

    const rows = await db.query(`SELECT * FROM notifications WHERE chart_version_id = $1`, [v2Id]);
    expect(rows.rows.length).toBeGreaterThanOrEqual(2); // owner + player
    expect(rows.rows[0].message).toContain('Blue Rondo');
    expect(rows.rows[0].message).toContain('2 measures changed');

    // sendPush called once for the player's iOS token
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(mockSendPush.mock.calls[0][0].token).toBe('player-ios-token');
  });
});

describe('notifyNewVersionNoDiff', () => {
  it('sends a fallback "new version available" notification', async () => {
    const { chartId, v2Id } = await seedScenario();
    await notifyNewVersionNoDiff(chartId, v2Id);

    const rows = await db.query(`SELECT message FROM notifications WHERE chart_version_id = $1`, [v2Id]);
    expect(rows.rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.rows[0].message).toContain('new version available');
  });
});

describe('notifyRestore', () => {
  it('sends a restore notification to all members', async () => {
    const { chartId, v1Id } = await seedScenario();
    await notifyRestore(chartId, v1Id);

    const rows = await db.query(`SELECT message FROM notifications WHERE chart_version_id = $1`, [v1Id]);
    expect(rows.rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.rows[0].message).toContain('restored');
    expect(rows.rows[0].message).toContain('Version 1');
  });
});
