#!/usr/bin/env npx ts-node
/**
 * End-to-end test for annotation migration.
 *
 * Creates a minimal test scenario in the real DB:
 *   - ensemble + user (or reuses existing)
 *   - chart with two versions (v1 and v2)
 *   - one part per version (Bass)
 *   - a fake but realistic version_diff with a measure mapping
 *   - 6 test annotations on v1 covering all anchor types
 *
 * Then calls migrateAnnotationsForVersion() and prints what happened.
 * Cleans up everything it created at the end.
 *
 * Usage:
 *   cd backend
 *   npx ts-node scripts/test-annotation-migration.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { db } from '../src/db';
import { migrateAnnotationsForVersion } from '../src/lib/annotation-migration';
import type { VersionDiffJson } from '../src/lib/diff';

// ── Fake diff — Bass part, 20 measures, m.5-7 shifted by +2, m.12 deleted ────

const FAKE_DIFF: VersionDiffJson = {
  parts: {
    Bass: {
      changedMeasures:    [6, 7],
      changeDescriptions: { 6: 'rhythm changed', 7: 'pitch changed' },
      structuralChanges:  {
        insertedMeasures:    [14, 15],
        deletedMeasures:     [12],
        sectionLabelChanges: ['Section "B" moved from m.8 to m.10'],
      },
      measureMapping: {
        1: 1, 2: 2, 3: 3, 4: 4,
        5: 7, 6: 8, 7: 9,          // shifted by +2
        8: 10, 9: 11,
        10: 13,                     // skipped over inserted 14,15
        11: 16, 12: null,           // m.12 deleted
        13: 17, 14: 18, 15: 19,
        16: 20, 17: 21, 18: 22,
        19: 23, 20: 24,
      },
    },
  },
};

async function main() {
  const client = await db.connect();

  const ids: {
    ensembleId?: string;
    userId?: string;
    chartId?: string;
    v1Id?: string;
    v2Id?: string;
    oldPartId?: string;
    newPartId?: string;
    diffId?: string;
    annotationIds?: string[];
  } = {};

  try {
    await client.query('BEGIN');

    // ── Create test user & ensemble ──────────────────────────────────────────
    const userRes = await client.query(
      `INSERT INTO users (email, name, password_hash)
       VALUES ('migration-test@test.local', 'Migration Test User', 'x')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    );
    ids.userId = userRes.rows[0].id;

    const ensRes = await client.query(
      `INSERT INTO ensembles (name, owner_id)
       VALUES ('Migration Test Ensemble', $1)
       RETURNING id`,
      [ids.userId],
    );
    ids.ensembleId = ensRes.rows[0].id;

    await client.query(
      `INSERT INTO ensemble_members (ensemble_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [ids.ensembleId, ids.userId],
    );

    // ── Create chart ─────────────────────────────────────────────────────────
    const chartRes = await client.query(
      `INSERT INTO charts (ensemble_id, title) VALUES ($1, 'Migration Test Chart') RETURNING id`,
      [ids.ensembleId],
    );
    ids.chartId = chartRes.rows[0].id;

    // ── Create two chart versions ────────────────────────────────────────────
    const v1Res = await client.query(
      `INSERT INTO chart_versions (chart_id, version_number, version_name, is_active, created_by)
       VALUES ($1, 1, 'Version 1', false, $2) RETURNING id`,
      [ids.chartId, ids.userId],
    );
    ids.v1Id = v1Res.rows[0].id;

    const v2Res = await client.query(
      `INSERT INTO chart_versions (chart_id, version_number, version_name, is_active, created_by)
       VALUES ($1, 2, 'Version 2', true, $2) RETURNING id`,
      [ids.chartId, ids.userId],
    );
    ids.v2Id = v2Res.rows[0].id;

    // ── Create parts (dummy S3 keys — we only need the rows to exist) ────────
    const oldPartRes = await client.query(
      `INSERT INTO parts (chart_version_id, instrument_name, pdf_s3_key, omr_status)
       VALUES ($1, 'Bass', 'test/v1-bass.pdf', 'complete') RETURNING id`,
      [ids.v1Id],
    );
    ids.oldPartId = oldPartRes.rows[0].id;

    const newPartRes = await client.query(
      `INSERT INTO parts (chart_version_id, instrument_name, pdf_s3_key, omr_status)
       VALUES ($1, 'Bass', 'test/v2-bass.pdf', 'complete') RETURNING id`,
      [ids.v2Id],
    );
    ids.newPartId = newPartRes.rows[0].id;

    // ── Save the version diff ────────────────────────────────────────────────
    const diffRes = await client.query(
      `INSERT INTO version_diffs (chart_id, from_version_id, to_version_id, diff_json)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [ids.chartId, ids.v1Id, ids.v2Id, JSON.stringify(FAKE_DIFF)],
    );
    ids.diffId = diffRes.rows[0].id;

    // ── Seed 6 test annotations on the old part ──────────────────────────────
    const annotations = [
      { type: 'measure', anchor: { measureNumber: 5 },                            label: 'measure m.5 → should become m.7' },
      { type: 'measure', anchor: { measureNumber: 12 },                           label: 'measure m.12 deleted → should flag' },
      { type: 'beat',    anchor: { measureNumber: 6, beat: 2 },                   label: 'beat in m.6 → should become m.8 beat 2' },
      { type: 'note',    anchor: { measureNumber: 7, beat: 1, pitch: 'D3', duration: 'q' }, label: 'note in m.7 → should become m.9' },
      { type: 'section', anchor: { sectionLabel: 'B', measureOffset: 1 },         label: 'section B → should pass through' },
      { type: 'page',    anchor: { page: 1, measureHint: 5 },                     label: 'page with hint m.5 → should upgrade to measure m.7' },
    ];

    ids.annotationIds = [];
    for (const ann of annotations) {
      const r = await client.query(
        `INSERT INTO annotations (part_id, user_id, anchor_type, anchor_json, content_type, content_json)
         VALUES ($1, $2, $3, $4, 'text', '{"text": "test"}') RETURNING id`,
        [ids.oldPartId, ids.userId, ann.type, JSON.stringify(ann.anchor)],
      );
      ids.annotationIds.push(r.rows[0].id);
      console.log(`  Seeded: [${ann.type}] ${ann.label}`);
    }

    await client.query('COMMIT');
    console.log(`\nTest data created. Running migration...\n`);

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ── Run migration (uses the db pool directly, outside the test transaction) ─
  const summaries = await migrateAnnotationsForVersion(ids.v1Id!, ids.v2Id!, FAKE_DIFF);

  // ── Print results ─────────────────────────────────────────────────────────
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const s of summaries) {
    console.log(`Instrument: ${s.instrument}`);
    console.log(`  Total annotations: ${s.total}`);
    console.log(`  Migrated cleanly:  ${s.migrated}`);
    console.log(`  Flagged for review: ${s.flagged}`);
    console.log(`  Skipped (dup):     ${s.skipped}`);
  }
  console.log('');

  // Show the migrated annotations
  const migrated = await db.query(
    `SELECT a.anchor_type, a.anchor_json, a.is_unresolved, a.migrated_from_annotation_id
     FROM annotations a
     WHERE a.part_id = $1 AND a.deleted_at IS NULL
     ORDER BY a.created_at`,
    [ids.newPartId],
  );

  console.log('Annotations on new part (v2):');
  for (const row of migrated.rows) {
    const status = row.is_unresolved ? '⚠ NEEDS REVIEW' : '✓ clean';
    console.log(`  [${row.anchor_type}] ${JSON.stringify(row.anchor_json)}  ${status}`);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  console.log('\nCleaning up test data...');
  const cleanClient = await db.connect();
  try {
    await cleanClient.query('BEGIN');
    // Delete in reverse FK order
    await cleanClient.query(`DELETE FROM annotations WHERE part_id IN ($1, $2)`, [ids.oldPartId, ids.newPartId]);
    await cleanClient.query(`DELETE FROM version_diffs WHERE id = $1`, [ids.diffId]);
    await cleanClient.query(`DELETE FROM parts WHERE id IN ($1, $2)`, [ids.oldPartId, ids.newPartId]);
    await cleanClient.query(`DELETE FROM chart_versions WHERE id IN ($1, $2)`, [ids.v1Id, ids.v2Id]);
    await cleanClient.query(`DELETE FROM charts WHERE id = $1`, [ids.chartId]);
    await cleanClient.query(`DELETE FROM ensemble_members WHERE ensemble_id = $1`, [ids.ensembleId]);
    await cleanClient.query(`DELETE FROM ensembles WHERE id = $1`, [ids.ensembleId]);
    await cleanClient.query(`DELETE FROM users WHERE id = $1`, [ids.userId]);
    await cleanClient.query('COMMIT');
    console.log('Done — all test data removed.');
  } catch (err) {
    await cleanClient.query('ROLLBACK');
    console.error('Cleanup failed (test data may remain):', err);
  } finally {
    cleanClient.release();
    await db.end();
  }
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
