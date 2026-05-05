/**
 * Integration tests for the cross-instrument migration worker.
 * Validates wide-reading semantics, multi-author migration, privacy opt-out,
 * same/cross instrument classification, and idempotency.
 */
import { eq, and, isNull } from 'drizzle-orm';
import { dz, db } from '../db';
import {
  users, workspaces, workspaceMembers,
  ensembles, charts, versions, parts, annotations,
  instrumentSlots, partSlotAssignments,
} from '../schema';
import { enqueueJob, claimNextJob, completeJob } from '../lib/queue';

// Import the worker's processing logic via a test export
import { processMigrationSource } from './migration.worker.testexport';

let userAlice: string;
let userBob: string;
let userCarol: string; // requesting user (destination owner)
let ensembleId: string;
let chartId: string;
let v1Id: string;
let v2Id: string;
let violinSlotId: string;
let celloSlotId: string;
let sourceViolinPartId: string;
let sourceCelloPartId: string;
let targetViolinPartId: string;

const omrMeasures = {
  measures: [
    { number: 1, bounds: { x: 50, y: 100, w: 200, h: 80, page: 1 } },
    { number: 2, bounds: { x: 250, y: 100, w: 200, h: 80, page: 1 } },
    { number: 3, bounds: { x: 50, y: 200, w: 200, h: 80, page: 1 } },
  ],
};

beforeAll(async () => {
  // Clean DB
  await db.query(`DELETE FROM annotations`);
  await db.query(`DELETE FROM version_diffs`);
  await db.query(`DELETE FROM part_slot_assignments`);
  await db.query(`DELETE FROM instrument_slot_assignments`);
  await db.query(`DELETE FROM parts`);
  await db.query(`DELETE FROM versions`);
  await db.query(`DELETE FROM charts`);
  await db.query(`DELETE FROM instrument_slots`);
  await db.query(`DELETE FROM ensembles`);
  await db.query(`DELETE FROM workspace_members`);
  await db.query(`DELETE FROM workspaces`);
  await db.query(`DELETE FROM users`);

  // Create users
  const [alice] = await dz.insert(users).values({ email: 'alice@test.local', passwordHash: 'x', displayName: 'Alice' }).returning();
  const [bob] = await dz.insert(users).values({ email: 'bob@test.local', passwordHash: 'x', displayName: 'Bob' }).returning();
  const [carol] = await dz.insert(users).values({ email: 'carol@test.local', passwordHash: 'x', displayName: 'Carol' }).returning();
  userAlice = alice.id;
  userBob = bob.id;
  userCarol = carol.id;

  // Create ensemble
  const [ws] = await dz.insert(workspaces).values({ name: 'Migration Test WS' }).returning();
  await dz.insert(workspaceMembers).values([
    { workspaceId: ws.id, userId: userAlice, role: 'member' },
    { workspaceId: ws.id, userId: userBob, role: 'member' },
    { workspaceId: ws.id, userId: userCarol, role: 'member' },
  ]);

  const [ens] = await dz.insert(ensembles).values({ workspaceId: ws.id, name: 'Quartet' }).returning();
  ensembleId = ens.id;

  // Create instrument slots
  const [violinSlot] = await dz.insert(instrumentSlots).values({ ensembleId: ens.id, name: 'Violin 1' }).returning();
  const [celloSlot] = await dz.insert(instrumentSlots).values({ ensembleId: ens.id, name: 'Cello' }).returning();
  violinSlotId = violinSlot.id;
  celloSlotId = celloSlot.id;

  // Create chart with two versions
  const [chart] = await dz.insert(charts).values({ ensembleId: ens.id, name: 'Sonata' }).returning();
  chartId = chart.id;

  const [v1] = await dz.insert(versions).values({ chartId: chart.id, name: 'v1', sortOrder: 0 }).returning();
  const [v2] = await dz.insert(versions).values({ chartId: chart.id, name: 'v2', sortOrder: 1 }).returning();
  v1Id = v1.id;
  v2Id = v2.id;

  // Create source parts in v1
  const [violinPart] = await dz.insert(parts).values({
    versionId: v1Id, name: 'Violin 1', kind: 'part', omrStatus: 'complete', omrJson: omrMeasures,
  }).returning();
  sourceViolinPartId = violinPart.id;

  const [celloPart] = await dz.insert(parts).values({
    versionId: v1Id, name: 'Cello', kind: 'part', omrStatus: 'complete', omrJson: omrMeasures,
  }).returning();
  sourceCelloPartId = celloPart.id;

  // Create target part in v2 (assigned to violin slot)
  const [targetViolin] = await dz.insert(parts).values({
    versionId: v2Id, name: 'Violin 1', kind: 'part', omrStatus: 'complete', omrJson: omrMeasures,
  }).returning();
  targetViolinPartId = targetViolin.id;

  // Assign slots
  await dz.insert(partSlotAssignments).values([
    { partId: sourceViolinPartId, instrumentSlotId: violinSlotId },
    { partId: sourceCelloPartId, instrumentSlotId: celloSlotId },
    { partId: targetViolinPartId, instrumentSlotId: violinSlotId },
  ]);
});

afterAll(async () => {
  await db.end();
});

describe('cross-instrument migration worker', () => {
  beforeEach(async () => {
    await db.query(`DELETE FROM annotations`);
  });

  it('wide-reading: migrates annotations from multiple authors without owner filter', async () => {
    // Alice and Bob both annotate the source violin part
    await dz.insert(annotations).values([
      { partId: sourceViolinPartId, ownerUserId: userAlice, anchorType: 'measure', anchorJson: { measureNumber: 1 }, kind: 'text', contentJson: { text: 'Alice note' } },
      { partId: sourceViolinPartId, ownerUserId: userBob, anchorType: 'measure', anchorJson: { measureNumber: 2 }, kind: 'text', contentJson: { text: 'Bob bowing' } },
    ]);

    // Carol triggers migration (she owns the destination)
    const result = await processMigrationSource(
      { sourcePartId: sourceViolinPartId, sourceVersionId: v1Id, targetPartId: targetViolinPartId },
      userCarol,
    );

    expect(result.migrated).toBe(2);
    expect(result.failed).toBe(false);

    // Both annotations land on target, owned by Carol (destination user)
    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, targetViolinPartId), isNull(annotations.deletedAt)));
    expect(migrated.length).toBe(2);
    expect(migrated.every(a => a.ownerUserId === userCarol)).toBe(true);
  });

  it('same-instrument migration: sets migration_source_kind to same_instrument', async () => {
    await dz.insert(annotations).values({
      partId: sourceViolinPartId, ownerUserId: userAlice,
      anchorType: 'measure', anchorJson: { measureNumber: 1 },
      kind: 'text', contentJson: { text: 'same instrument' },
    });

    await processMigrationSource(
      { sourcePartId: sourceViolinPartId, sourceVersionId: v1Id, targetPartId: targetViolinPartId },
      userCarol,
    );

    const [migrated] = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, targetViolinPartId), isNull(annotations.deletedAt)));
    expect(migrated.migrationSourceKind).toBe('same_instrument');
    expect(migrated.needsReview).toBe(false); // same instrument with identity mapping
  });

  it('cross-instrument migration: sets migration_source_kind and flags for review', async () => {
    // Cello → Violin is cross-instrument (different slots)
    await dz.insert(annotations).values({
      partId: sourceCelloPartId, ownerUserId: userBob,
      anchorType: 'measure', anchorJson: { measureNumber: 1 },
      kind: 'text', contentJson: { text: 'cello bowing' },
    });

    const result = await processMigrationSource(
      { sourcePartId: sourceCelloPartId, sourceVersionId: v1Id, targetPartId: targetViolinPartId },
      userCarol,
    );

    expect(result.flagged).toBe(1);

    const [migrated] = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, targetViolinPartId), isNull(annotations.deletedAt)));
    expect(migrated.migrationSourceKind).toBe('cross_instrument');
    expect(migrated.needsReview).toBe(true);
  });

  it('respects migratable=false privacy opt-out', async () => {
    await dz.insert(annotations).values([
      { partId: sourceViolinPartId, ownerUserId: userAlice, anchorType: 'measure', anchorJson: { measureNumber: 1 }, kind: 'text', contentJson: { text: 'public' }, migratable: true },
      { partId: sourceViolinPartId, ownerUserId: userAlice, anchorType: 'measure', anchorJson: { measureNumber: 2 }, kind: 'text', contentJson: { text: 'private' }, migratable: false },
    ]);

    const result = await processMigrationSource(
      { sourcePartId: sourceViolinPartId, sourceVersionId: v1Id, targetPartId: targetViolinPartId },
      userCarol,
    );

    expect(result.migrated).toBe(1); // only the public one

    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, targetViolinPartId), isNull(annotations.deletedAt)));
    expect(migrated.length).toBe(1);
    expect((migrated[0].contentJson as any).text).toBe('public');
  });

  it('idempotent: skips already-migrated annotations on re-run', async () => {
    await dz.insert(annotations).values({
      partId: sourceViolinPartId, ownerUserId: userAlice,
      anchorType: 'measure', anchorJson: { measureNumber: 1 },
      kind: 'text', contentJson: { text: 'test' },
    });

    // First run
    await processMigrationSource(
      { sourcePartId: sourceViolinPartId, sourceVersionId: v1Id, targetPartId: targetViolinPartId },
      userCarol,
    );

    // Second run
    const result = await processMigrationSource(
      { sourcePartId: sourceViolinPartId, sourceVersionId: v1Id, targetPartId: targetViolinPartId },
      userCarol,
    );

    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(1);

    // Still only one copy on target
    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, targetViolinPartId), isNull(annotations.deletedAt)));
    expect(migrated.length).toBe(1);
  });

  it('sets sourceAnnotationId and sourceVersionId for provenance', async () => {
    const [src] = await dz.insert(annotations).values({
      partId: sourceViolinPartId, ownerUserId: userAlice,
      anchorType: 'measure', anchorJson: { measureNumber: 1 },
      kind: 'text', contentJson: { text: 'provenance test' },
    }).returning();

    await processMigrationSource(
      { sourcePartId: sourceViolinPartId, sourceVersionId: v1Id, targetPartId: targetViolinPartId },
      userCarol,
    );

    const [migrated] = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, targetViolinPartId), isNull(annotations.deletedAt)));
    expect(migrated.sourceAnnotationId).toBe(src.id);
    expect(migrated.sourceVersionId).toBe(v1Id);
  });

  it('migrated copy is migratable by default regardless of source', async () => {
    await dz.insert(annotations).values({
      partId: sourceViolinPartId, ownerUserId: userAlice,
      anchorType: 'measure', anchorJson: { measureNumber: 1 },
      kind: 'text', contentJson: { text: 'test' },
      migratable: true,
    });

    await processMigrationSource(
      { sourcePartId: sourceViolinPartId, sourceVersionId: v1Id, targetPartId: targetViolinPartId },
      userCarol,
    );

    const [migrated] = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, targetViolinPartId), isNull(annotations.deletedAt)));
    expect(migrated.migratable).toBe(true);
  });

  it('does not include soft-deleted annotations from source', async () => {
    await dz.insert(annotations).values([
      { partId: sourceViolinPartId, ownerUserId: userAlice, anchorType: 'measure', anchorJson: { measureNumber: 1 }, kind: 'text', contentJson: { text: 'active' } },
      { partId: sourceViolinPartId, ownerUserId: userAlice, anchorType: 'measure', anchorJson: { measureNumber: 2 }, kind: 'text', contentJson: { text: 'deleted' }, deletedAt: new Date() },
    ]);

    const result = await processMigrationSource(
      { sourcePartId: sourceViolinPartId, sourceVersionId: v1Id, targetPartId: targetViolinPartId },
      userCarol,
    );

    expect(result.migrated).toBe(1);

    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, targetViolinPartId), isNull(annotations.deletedAt)));
    expect(migrated.length).toBe(1);
    expect((migrated[0].contentJson as any).text).toBe('active');
  });

  it('multi-source: handles annotations from different source parts independently', async () => {
    // Annotations on both source parts
    await dz.insert(annotations).values([
      { partId: sourceViolinPartId, ownerUserId: userAlice, anchorType: 'measure', anchorJson: { measureNumber: 1 }, kind: 'text', contentJson: { text: 'from violin' } },
      { partId: sourceCelloPartId, ownerUserId: userBob, anchorType: 'measure', anchorJson: { measureNumber: 1 }, kind: 'text', contentJson: { text: 'from cello' } },
    ]);

    // Migrate from both sources to same target
    const r1 = await processMigrationSource(
      { sourcePartId: sourceViolinPartId, sourceVersionId: v1Id, targetPartId: targetViolinPartId },
      userCarol,
    );
    const r2 = await processMigrationSource(
      { sourcePartId: sourceCelloPartId, sourceVersionId: v1Id, targetPartId: targetViolinPartId },
      userCarol,
    );

    expect(r1.migrated).toBe(1);
    expect(r2.flagged).toBe(1); // cross-instrument = flagged

    // Both coexist on target (conflicts coexist per spec decision 2.2)
    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, targetViolinPartId), isNull(annotations.deletedAt)));
    expect(migrated.length).toBe(2);
  });

  it('does not filter by owner: Alice can pull Bob annotations', async () => {
    // Only Bob has annotations on the source
    await dz.insert(annotations).values({
      partId: sourceViolinPartId, ownerUserId: userBob,
      anchorType: 'measure', anchorJson: { measureNumber: 1 },
      kind: 'ink', contentJson: { strokes: [], boundingBox: { x: 0, y: 0, width: 1, height: 1 } },
    });

    // Alice triggers (different user from annotation author)
    const result = await processMigrationSource(
      { sourcePartId: sourceViolinPartId, sourceVersionId: v1Id, targetPartId: targetViolinPartId },
      userAlice, // Alice as requester, Bob as original author
    );

    expect(result.migrated).toBe(1);

    const [migrated] = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, targetViolinPartId), isNull(annotations.deletedAt)));
    // Alice owns the copy
    expect(migrated.ownerUserId).toBe(userAlice);
    // Source is Bob's annotation
    expect(migrated.sourceAnnotationId).toBeDefined();
  });
});
