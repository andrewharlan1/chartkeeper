import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VersionDiffJson } from './diff';

// ── Mock the DB so tests run without a real Postgres connection ───────────────

vi.mock('../db', () => ({
  db: {
    query: vi.fn(),
  },
}));

import { db } from '../db';
import { migrateAnnotationsForVersion } from './annotation-migration';

const mockQuery = db.query as ReturnType<typeof vi.fn>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePartDiff(mapping: Record<number, number | null>) {
  return {
    changedMeasures:    [],
    changeDescriptions: {},
    structuralChanges:  { insertedMeasures: [], deletedMeasures: [], sectionLabelChanges: [] },
    measureMapping:     mapping,
  };
}

function makeAnnotation(
  id: string,
  anchorType: string,
  anchorJson: Record<string, unknown>,
) {
  return {
    id,
    user_id:      'user-1',
    anchor_type:  anchorType,
    anchor_json:  anchorJson,
    content_type: 'text',
    content_json: { text: 'remember to breathe' },
  };
}

const FROM_VERSION = 'aaaaaaaa-0000-0000-0000-000000000001';
const TO_VERSION   = 'aaaaaaaa-0000-0000-0000-000000000002';
const OLD_PART_ID  = 'bbbbbbbb-0000-0000-0000-000000000001';
const NEW_PART_ID  = 'bbbbbbbb-0000-0000-0000-000000000002';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('migrateAnnotationsForVersion', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  function setupPartQueries(annotations: ReturnType<typeof makeAnnotation>[]) {
    mockQuery
      // old part lookup
      .mockResolvedValueOnce({ rows: [{ id: OLD_PART_ID }] })
      // new part lookup
      .mockResolvedValueOnce({ rows: [{ id: NEW_PART_ID }] })
      // annotations on old part
      .mockResolvedValueOnce({ rows: annotations });

    // For each annotation: idempotency check + insert
    for (let i = 0; i < annotations.length; i++) {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })   // idempotency check — not yet migrated
        .mockResolvedValueOnce({ rows: [] });   // INSERT
    }
  }

  it('migrates a measure anchor cleanly when measure maps 1:1', async () => {
    const ann = makeAnnotation('ann-1', 'measure', { measureNumber: 5 });
    const diffJson: VersionDiffJson = {
      parts: { Bass: makePartDiff({ 5: 7 }) },
    };
    setupPartQueries([ann]);

    const summaries = await migrateAnnotationsForVersion(FROM_VERSION, TO_VERSION, diffJson);

    expect(summaries[0]).toMatchObject({ instrument: 'Bass', total: 1, migrated: 1, flagged: 0 });

    // Verify the INSERT used the new measure number
    const insertCall = mockQuery.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO annotations')
    );
    expect(insertCall).toBeDefined();
    const insertedAnchorJson = JSON.parse(insertCall![1][3]);
    expect(insertedAnchorJson).toEqual({ measureNumber: 7 });
    expect(insertCall![1][7]).toBe(false); // is_unresolved = false
  });

  it('flags a measure anchor when the measure was deleted', async () => {
    const ann = makeAnnotation('ann-2', 'measure', { measureNumber: 10 });
    const diffJson: VersionDiffJson = {
      parts: { Violin: makePartDiff({ 10: null }) },
    };
    setupPartQueries([ann]);

    const summaries = await migrateAnnotationsForVersion(FROM_VERSION, TO_VERSION, diffJson);

    expect(summaries[0]).toMatchObject({ migrated: 0, flagged: 1 });

    const insertCall = mockQuery.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO annotations')
    );
    expect(insertCall![1][7]).toBe(true); // is_unresolved = true
  });

  it('migrates a beat anchor, preserving the beat value', async () => {
    const ann = makeAnnotation('ann-3', 'beat', { measureNumber: 3, beat: 2.5 });
    const diffJson: VersionDiffJson = {
      parts: { Cello: makePartDiff({ 3: 5 }) },
    };
    setupPartQueries([ann]);

    await migrateAnnotationsForVersion(FROM_VERSION, TO_VERSION, diffJson);

    const insertCall = mockQuery.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO annotations')
    );
    const newAnchor = JSON.parse(insertCall![1][3]);
    expect(newAnchor).toEqual({ measureNumber: 5, beat: 2.5 });
    expect(insertCall![1][2]).toBe('beat'); // anchor_type unchanged
  });

  it('migrates a note anchor, preserving pitch and duration', async () => {
    const ann = makeAnnotation('ann-4', 'note', { measureNumber: 8, beat: 1, pitch: 'G4', duration: 'q' });
    const diffJson: VersionDiffJson = {
      parts: { Trumpet: makePartDiff({ 8: 9 }) },
    };
    setupPartQueries([ann]);

    await migrateAnnotationsForVersion(FROM_VERSION, TO_VERSION, diffJson);

    const insertCall = mockQuery.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO annotations')
    );
    const newAnchor = JSON.parse(insertCall![1][3]);
    expect(newAnchor).toEqual({ measureNumber: 9, beat: 1, pitch: 'G4', duration: 'q' });
  });

  it('passes section anchors through unchanged', async () => {
    const ann = makeAnnotation('ann-5', 'section', { sectionLabel: 'Verse', measureOffset: 2 });
    const diffJson: VersionDiffJson = {
      parts: { Piano: makePartDiff({ 1: 1 }) },
    };
    setupPartQueries([ann]);

    const summaries = await migrateAnnotationsForVersion(FROM_VERSION, TO_VERSION, diffJson);

    expect(summaries[0]).toMatchObject({ migrated: 1, flagged: 0 });
    const insertCall = mockQuery.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO annotations')
    );
    const newAnchor = JSON.parse(insertCall![1][3]);
    expect(newAnchor).toEqual({ sectionLabel: 'Verse', measureOffset: 2 });
  });

  it('upgrades a page anchor to measure when measureHint maps cleanly', async () => {
    const ann = makeAnnotation('ann-6', 'page', { page: 2, measureHint: 14 });
    const diffJson: VersionDiffJson = {
      parts: { Trombone: makePartDiff({ 14: 16 }) },
    };
    setupPartQueries([ann]);

    const summaries = await migrateAnnotationsForVersion(FROM_VERSION, TO_VERSION, diffJson);

    expect(summaries[0]).toMatchObject({ migrated: 1, flagged: 0 });
    const insertCall = mockQuery.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO annotations')
    );
    expect(insertCall![1][2]).toBe('measure'); // upgraded anchor_type
    const newAnchor = JSON.parse(insertCall![1][3]);
    expect(newAnchor).toEqual({ measureNumber: 16 });
  });

  it('flags a page anchor with no measureHint', async () => {
    const ann = makeAnnotation('ann-7', 'page', { page: 3 });
    const diffJson: VersionDiffJson = {
      parts: { Flute: makePartDiff({ 1: 1 }) },
    };
    setupPartQueries([ann]);

    const summaries = await migrateAnnotationsForVersion(FROM_VERSION, TO_VERSION, diffJson);

    expect(summaries[0]).toMatchObject({ migrated: 0, flagged: 1 });
  });

  it('skips annotations that were already migrated (idempotency)', async () => {
    const ann = makeAnnotation('ann-8', 'measure', { measureNumber: 1 });
    const diffJson: VersionDiffJson = {
      parts: { Oboe: makePartDiff({ 1: 1 }) },
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: OLD_PART_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: NEW_PART_ID }] })
      .mockResolvedValueOnce({ rows: [ann] })
      // idempotency check returns existing row
      .mockResolvedValueOnce({ rows: [{ id: 'existing-migration' }] });

    const summaries = await migrateAnnotationsForVersion(FROM_VERSION, TO_VERSION, diffJson);

    expect(summaries[0]).toMatchObject({ total: 1, migrated: 0, flagged: 0, skipped: 1 });
    // No INSERT should have been called
    const insertCall = mockQuery.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO annotations')
    );
    expect(insertCall).toBeUndefined();
  });

  it('skips an instrument when old or new part is missing', async () => {
    const diffJson: VersionDiffJson = {
      parts: { Harp: makePartDiff({ 1: 1 }) },
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // old part not found
      .mockResolvedValueOnce({ rows: [{ id: NEW_PART_ID }] });

    const summaries = await migrateAnnotationsForVersion(FROM_VERSION, TO_VERSION, diffJson);

    expect(summaries).toHaveLength(0);
  });

  it('migrates multiple instruments in one call', async () => {
    const diffJson: VersionDiffJson = {
      parts: {
        Bass:   makePartDiff({ 1: 1, 2: 2 }),
        Violin: makePartDiff({ 1: 1 }),
      },
    };

    const bassAnn   = makeAnnotation('ann-bass',   'measure', { measureNumber: 2 });
    const violinAnn = makeAnnotation('ann-violin', 'measure', { measureNumber: 1 });

    // Bass part queries
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'bass-old' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'bass-new' }] })
      .mockResolvedValueOnce({ rows: [bassAnn] })
      .mockResolvedValueOnce({ rows: [] })   // idempotency
      .mockResolvedValueOnce({ rows: [] });  // insert
    // Violin part queries
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'violin-old' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'violin-new' }] })
      .mockResolvedValueOnce({ rows: [violinAnn] })
      .mockResolvedValueOnce({ rows: [] })   // idempotency
      .mockResolvedValueOnce({ rows: [] });  // insert

    const summaries = await migrateAnnotationsForVersion(FROM_VERSION, TO_VERSION, diffJson);

    expect(summaries).toHaveLength(2);
    expect(summaries.find(s => s.instrument === 'Bass')).toMatchObject({ migrated: 1 });
    expect(summaries.find(s => s.instrument === 'Violin')).toMatchObject({ migrated: 1 });
  });
});
