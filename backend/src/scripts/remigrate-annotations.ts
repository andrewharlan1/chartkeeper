/**
 * Delete stale migrated annotations and re-run annotation migration
 * for all version diffs that have existing migrated annotations.
 *
 * This is needed when the migration logic changes (e.g., adding stroke
 * coordinate relocation) and old migrated annotations have stale data.
 *
 * Usage: npx ts-node src/scripts/remigrate-annotations.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { db } from '../db';
import { migrateAnnotationsForVersion } from '../lib/annotation-migration';
import type { VersionDiffJson } from '../lib/diff';

async function main() {
  // Find all version diffs that have migrated annotations
  const { rows: diffs } = await db.query<{
    from_version_id: string;
    to_version_id: string;
    diff_json: VersionDiffJson;
  }>(
    `SELECT vd.from_version_id, vd.to_version_id, vd.diff_json
     FROM version_diffs vd
     WHERE EXISTS (
       SELECT 1 FROM annotations a
       JOIN parts p ON p.id = a.part_id
       WHERE p.chart_version_id = vd.to_version_id
         AND a.migrated_from_annotation_id IS NOT NULL
         AND a.deleted_at IS NULL
     )`
  );

  if (diffs.length === 0) {
    console.log('No version diffs with migrated annotations found.');
    await db.end();
    return;
  }

  console.log(`Found ${diffs.length} version diff(s) with migrated annotations.`);

  for (const diff of diffs) {
    console.log(`\nRe-migrating: ${diff.from_version_id} → ${diff.to_version_id}`);

    // Delete existing migrated annotations for the target version
    const { rowCount } = await db.query(
      `UPDATE annotations SET deleted_at = NOW()
       WHERE migrated_from_annotation_id IS NOT NULL
         AND deleted_at IS NULL
         AND part_id IN (
           SELECT id FROM parts WHERE chart_version_id = $1 AND deleted_at IS NULL
         )`,
      [diff.to_version_id]
    );
    console.log(`  Soft-deleted ${rowCount} stale migrated annotation(s).`);

    // Re-run migration with the updated logic (includes stroke relocation)
    const summaries = await migrateAnnotationsForVersion(
      diff.from_version_id,
      diff.to_version_id,
      diff.diff_json,
    );

    for (const s of summaries) {
      if (s.total > 0) {
        console.log(
          `  ${s.instrument}: ${s.migrated} clean, ${s.flagged} flagged, ${s.skipped} skipped (of ${s.total})`
        );
      }
    }
  }

  console.log('\nDone.');
  await db.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
