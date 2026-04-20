/**
 * Integration tests for annotation migration — runs against the real DB.
 * Validates that the measure-geometry logic (migrateAnchor, relocateInkContent)
 * is wired correctly through the Drizzle queries.
 */
import { eq, and, isNull } from 'drizzle-orm';
import { dz, db } from '../db';
import {
  users, workspaces, workspaceMembers,
  ensembles, charts, versions, parts, annotations,
} from '../schema';
import { migrateAnnotationsForVersion } from './annotation-migration';
import type { VersionDiffJson } from './diff';

// ── Test data ────────────────────────────────────────────────────────────────

let userId: string;
let ensembleId: string;
let v1Id: string;
let v2Id: string;
let oldPartId: string;
let newPartId: string;

beforeAll(async () => {
  // Clean DB in FK order
  await db.query(`DELETE FROM annotations`);
  await db.query(`DELETE FROM part_slot_assignments`);
  await db.query(`DELETE FROM parts`);
  await db.query(`DELETE FROM versions`);
  await db.query(`DELETE FROM charts`);
  await db.query(`DELETE FROM instrument_slots`);
  await db.query(`DELETE FROM ensembles`);
  await db.query(`DELETE FROM workspace_members`);
  await db.query(`DELETE FROM workspaces`);
  await db.query(`DELETE FROM users`);

  // Seed minimal hierarchy
  const [user] = await dz.insert(users).values({
    email: 'ann-migration-test@test.local',
    passwordHash: 'not-real',
    displayName: 'Ann Tester',
  }).returning();
  userId = user.id;

  const [ws] = await dz.insert(workspaces).values({ name: 'Ann Test WS' }).returning();
  await dz.insert(workspaceMembers).values({ workspaceId: ws.id, userId, role: 'owner' });

  const [ens] = await dz.insert(ensembles).values({ workspaceId: ws.id, name: 'Ann Test Ensemble' }).returning();
  ensembleId = ens.id;

  const [chart] = await dz.insert(charts).values({ ensembleId: ens.id, name: 'Test Chart' }).returning();

  const [v1] = await dz.insert(versions).values({ chartId: chart.id, name: 'v1', sortOrder: 0 }).returning();
  const [v2] = await dz.insert(versions).values({ chartId: chart.id, name: 'v2', sortOrder: 1 }).returning();
  v1Id = v1.id;
  v2Id = v2.id;

  const [oldPart] = await dz.insert(parts).values({
    versionId: v1Id, name: 'Bass', pdfS3Key: 'test/bass-v1.pdf', omrStatus: 'complete',
    omrJson: {
      measures: [
        { number: 1, bounds: { x: 50, y: 100, w: 200, h: 80, page: 1 } },
        { number: 2, bounds: { x: 250, y: 100, w: 200, h: 80, page: 1 } },
        { number: 3, bounds: { x: 50, y: 300, w: 200, h: 80, page: 1 } },
      ],
    },
  }).returning();
  oldPartId = oldPart.id;

  const [newPart] = await dz.insert(parts).values({
    versionId: v2Id, name: 'Bass', pdfS3Key: 'test/bass-v2.pdf', omrStatus: 'complete',
    omrJson: {
      measures: [
        { number: 1, bounds: { x: 50, y: 100, w: 200, h: 80, page: 1 } },
        // Measure 2 deleted
        { number: 3, bounds: { x: 250, y: 100, w: 200, h: 80, page: 1 } }, // moved right
        { number: 4, bounds: { x: 50, y: 300, w: 200, h: 80, page: 1 } }, // inserted
      ],
    },
  }).returning();
  newPartId = newPart.id;
});

afterAll(async () => {
  await db.end();
});

function makePartDiff(mapping: Record<number, number | null>, confidence?: Record<number, number>) {
  return {
    changedMeasures: [],
    changeDescriptions: {},
    structuralChanges: { insertedMeasures: [], deletedMeasures: [], sectionLabelChanges: [] },
    measureMapping: mapping,
    ...(confidence ? { measureConfidence: confidence } : {}),
  };
}

describe('migrateAnnotationsForVersion (integration)', () => {
  beforeEach(async () => {
    // Clear annotations between tests
    await db.query(`DELETE FROM annotations`);
  });

  it('migrates a measure anchor when measure maps 1:1', async () => {
    await dz.insert(annotations).values({
      partId: oldPartId, ownerUserId: userId,
      anchorType: 'measure', anchorJson: { measureNumber: 1 },
      kind: 'text', contentJson: { text: 'forte here' },
    });

    const diffJson: VersionDiffJson = { parts: { Bass: makePartDiff({ 1: 1, 2: null, 3: 3 }) } };
    const summaries = await migrateAnnotationsForVersion(v1Id, v2Id, diffJson);

    expect(summaries[0]).toMatchObject({ instrument: 'Bass', total: 1, migrated: 1, flagged: 0 });

    // Check the migrated annotation
    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, newPartId), isNull(annotations.deletedAt)));
    expect(migrated.length).toBe(1);
    expect((migrated[0].anchorJson as any).measureNumber).toBe(1);
    expect(migrated[0].migratedFromAnnotationId).toBeDefined();
  });

  it('flags an annotation when its measure was deleted', async () => {
    await dz.insert(annotations).values({
      partId: oldPartId, ownerUserId: userId,
      anchorType: 'measure', anchorJson: { measureNumber: 2 },
      kind: 'text', contentJson: { text: 'watch the tempo' },
    });

    const diffJson: VersionDiffJson = { parts: { Bass: makePartDiff({ 1: 1, 2: null, 3: 3 }) } };
    const summaries = await migrateAnnotationsForVersion(v1Id, v2Id, diffJson);

    expect(summaries[0]).toMatchObject({ migrated: 0, flagged: 1 });

    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, newPartId), isNull(annotations.deletedAt)));
    expect(migrated.length).toBe(1);
    expect((migrated[0].contentJson as any)._needsReview).toBe(true);
  });

  it('migrates beat anchor preserving beat value', async () => {
    await dz.insert(annotations).values({
      partId: oldPartId, ownerUserId: userId,
      anchorType: 'beat', anchorJson: { measureNumber: 3, beat: 2.5 },
      kind: 'text', contentJson: { text: 'accent' },
    });

    const diffJson: VersionDiffJson = { parts: { Bass: makePartDiff({ 3: 3 }) } };
    const summaries = await migrateAnnotationsForVersion(v1Id, v2Id, diffJson);

    expect(summaries[0].migrated).toBe(1);

    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, newPartId), isNull(annotations.deletedAt)));
    expect((migrated[0].anchorJson as any)).toEqual({ measureNumber: 3, beat: 2.5 });
  });

  it('passes section anchors through unchanged', async () => {
    await dz.insert(annotations).values({
      partId: oldPartId, ownerUserId: userId,
      anchorType: 'section', anchorJson: { sectionLabel: 'Bridge', measureOffset: 2 },
      kind: 'text', contentJson: { text: 'key change!' },
    });

    const diffJson: VersionDiffJson = { parts: { Bass: makePartDiff({ 1: 1 }) } };
    const summaries = await migrateAnnotationsForVersion(v1Id, v2Id, diffJson);

    expect(summaries[0].migrated).toBe(1);

    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, newPartId), isNull(annotations.deletedAt)));
    expect((migrated[0].anchorJson as any)).toEqual({ sectionLabel: 'Bridge', measureOffset: 2 });
  });

  it('upgrades page anchor to measure when measureHint maps', async () => {
    await dz.insert(annotations).values({
      partId: oldPartId, ownerUserId: userId,
      anchorType: 'page', anchorJson: { page: 1, measureHint: 3 },
      kind: 'highlight', contentJson: { color: 'yellow' },
    });

    const diffJson: VersionDiffJson = { parts: { Bass: makePartDiff({ 3: 3 }) } };
    const summaries = await migrateAnnotationsForVersion(v1Id, v2Id, diffJson);

    expect(summaries[0].migrated).toBe(1);

    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, newPartId), isNull(annotations.deletedAt)));
    expect(migrated[0].anchorType).toBe('measure');
    expect((migrated[0].anchorJson as any).measureNumber).toBe(3);
  });

  it('skips already-migrated annotations (idempotency)', async () => {
    // First migration
    await dz.insert(annotations).values({
      partId: oldPartId, ownerUserId: userId,
      anchorType: 'measure', anchorJson: { measureNumber: 1 },
      kind: 'text', contentJson: { text: 'test' },
    });

    const diffJson: VersionDiffJson = { parts: { Bass: makePartDiff({ 1: 1 }) } };
    await migrateAnnotationsForVersion(v1Id, v2Id, diffJson);

    // Second migration — should be idempotent
    const summaries = await migrateAnnotationsForVersion(v1Id, v2Id, diffJson);

    expect(summaries[0]).toMatchObject({ total: 1, migrated: 0, skipped: 1 });

    // Should still only have one migrated annotation
    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, newPartId), isNull(annotations.deletedAt)));
    expect(migrated.length).toBe(1);
  });

  it('relocates ink strokes when measure moves position', async () => {
    // Measure 3 is at (50,300) in v1, (250,100) in v2 — moved right and up
    await dz.insert(annotations).values({
      partId: oldPartId, ownerUserId: userId,
      anchorType: 'measure', anchorJson: { measureNumber: 3 },
      kind: 'ink', contentJson: {
        strokes: [{ points: [{ x: 100, y: 320 }, { x: 120, y: 340 }] }],
        highlights: [{ x: 60, y: 310, w: 80, h: 20 }],
      },
    });

    const diffJson: VersionDiffJson = { parts: { Bass: makePartDiff({ 3: 3 }) } };
    const summaries = await migrateAnnotationsForVersion(v1Id, v2Id, diffJson);

    expect(summaries[0].migrated).toBe(1);

    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, newPartId), isNull(annotations.deletedAt)));
    const content = migrated[0].contentJson as any;

    // Old measure center: (50+100, 300+40) = (150, 340)
    // New measure center: (250+100, 100+40) = (350, 140)
    // dx = 200, dy = -200
    expect(content.strokes[0].points[0].x).toBeCloseTo(300, 0);
    expect(content.strokes[0].points[0].y).toBeCloseTo(120, 0);
    expect(content.highlights[0].x).toBeCloseTo(260, 0);
    expect(content.highlights[0].y).toBeCloseTo(110, 0);
  });

  // ── Object-model annotation migration tests ──────────────────────────────

  // V1 measure 3: bounds (50,300,w=200,h=80)  → 100pt wide, aspect 2.5
  // V2 measure 3: bounds (250,100,w=200,h=80) → same width, moved position
  // The object-model uses measure-relative coords (0-1), so NO page-coordinate
  // relocation should happen. The content should be copied as-is.

  it('migrates ink object-model annotation without relocating strokes', async () => {
    await dz.insert(annotations).values({
      partId: oldPartId, ownerUserId: userId,
      anchorType: 'measure', anchorJson: { measureNumber: 3 },
      kind: 'ink', contentJson: {
        strokes: [{
          points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
          color: '#000000',
          width: 0.02,
        }],
        boundingBox: { x: 0.05, y: 0.1, width: 0.3, height: 0.4 },
      },
    });

    const diffJson: VersionDiffJson = { parts: { Bass: makePartDiff({ 3: 3 }) } };
    const summaries = await migrateAnnotationsForVersion(v1Id, v2Id, diffJson);

    expect(summaries[0]).toMatchObject({ migrated: 1, flagged: 0 });

    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, newPartId), isNull(annotations.deletedAt)));
    const content = migrated[0].contentJson as any;

    // Measure-relative coords are preserved — NOT shifted by page dx/dy
    expect(content.strokes[0].points[0].x).toBe(0.1);
    expect(content.strokes[0].points[0].y).toBe(0.2);
    expect(content.strokes[0].points[1].x).toBe(0.3);
    expect(content.strokes[0].points[1].y).toBe(0.4);
    expect(content.boundingBox).toEqual({ x: 0.05, y: 0.1, width: 0.3, height: 0.4 });
  });

  it('migrates text object-model annotation preserving size and position', async () => {
    await dz.insert(annotations).values({
      partId: oldPartId, ownerUserId: userId,
      anchorType: 'measure', anchorJson: { measureNumber: 1 },
      kind: 'text', contentJson: {
        text: 'breathe',
        fontSize: 0.015,
        color: '#333333',
        fontWeight: 'normal',
        fontStyle: 'normal',
        boundingBox: { x: 0.5, y: 0.1, widthPageUnits: 0.08, heightPageUnits: 0.02 },
      },
    });

    const diffJson: VersionDiffJson = { parts: { Bass: makePartDiff({ 1: 1 }) } };
    const summaries = await migrateAnnotationsForVersion(v1Id, v2Id, diffJson);

    expect(summaries[0].migrated).toBe(1);

    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, newPartId), isNull(annotations.deletedAt)));
    const content = migrated[0].contentJson as any;

    // Text size preserved (absolute page units unchanged)
    expect(content.boundingBox.widthPageUnits).toBe(0.08);
    expect(content.boundingBox.heightPageUnits).toBe(0.02);
    // Position within measure preserved
    expect(content.boundingBox.x).toBe(0.5);
    expect(content.boundingBox.y).toBe(0.1);
    // Other text fields unchanged
    expect(content.text).toBe('breathe');
    expect(content.fontSize).toBe(0.015);
  });

  it('migrates highlight object-model annotation preserving measure-relative bounds', async () => {
    await dz.insert(annotations).values({
      partId: oldPartId, ownerUserId: userId,
      anchorType: 'measure', anchorJson: { measureNumber: 3 },
      kind: 'highlight', contentJson: {
        color: '#FFFF00',
        opacity: 0.3,
        boundingBox: { x: 0, y: 0, width: 1, height: 1 },
      },
    });

    const diffJson: VersionDiffJson = { parts: { Bass: makePartDiff({ 3: 3 }) } };
    const summaries = await migrateAnnotationsForVersion(v1Id, v2Id, diffJson);

    expect(summaries[0].migrated).toBe(1);

    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, newPartId), isNull(annotations.deletedAt)));
    const content = migrated[0].contentJson as any;

    // Full-measure highlight stays full-measure (stretches with measure)
    expect(content.boundingBox).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(content.color).toBe('#FFFF00');
    expect(content.opacity).toBe(0.3);
  });

  it('flags object-model annotation when its measure is deleted', async () => {
    await dz.insert(annotations).values({
      partId: oldPartId, ownerUserId: userId,
      anchorType: 'measure', anchorJson: { measureNumber: 2 },
      kind: 'ink', contentJson: {
        strokes: [{ points: [{ x: 0.5, y: 0.5 }], color: '#FF0000', width: 0.01 }],
        boundingBox: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
      },
    });

    const diffJson: VersionDiffJson = { parts: { Bass: makePartDiff({ 1: 1, 2: null, 3: 3 }) } };
    const summaries = await migrateAnnotationsForVersion(v1Id, v2Id, diffJson);

    expect(summaries[0]).toMatchObject({ migrated: 0, flagged: 1 });

    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, newPartId), isNull(annotations.deletedAt)));
    expect((migrated[0].contentJson as any)._needsReview).toBe(true);
  });

  it('migrates annotation when measures are reordered via mapping', async () => {
    // Measure 1 in v1 maps to measure 3 in v2 (reordered)
    await dz.insert(annotations).values({
      partId: oldPartId, ownerUserId: userId,
      anchorType: 'measure', anchorJson: { measureNumber: 1 },
      kind: 'highlight', contentJson: {
        color: '#00FF00',
        opacity: 0.5,
        boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      },
    });

    // Mapping: old m.1 → new m.3, old m.3 → new m.1 (swap)
    const diffJson: VersionDiffJson = { parts: { Bass: makePartDiff({ 1: 3, 3: 1 }) } };
    const summaries = await migrateAnnotationsForVersion(v1Id, v2Id, diffJson);

    expect(summaries[0].migrated).toBe(1);

    const migrated = await dz.select().from(annotations)
      .where(and(eq(annotations.partId, newPartId), isNull(annotations.deletedAt)));
    // Anchor updated to new measure number
    expect((migrated[0].anchorJson as any).measureNumber).toBe(3);
    // Content unchanged
    expect((migrated[0].contentJson as any).boundingBox).toEqual({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
  });
});
