/**
 * Re-enqueue OMR jobs for parts that need (re)processing.
 *
 * Usage:
 *   npx ts-node src/scripts/reprocess-omr.ts         # only parts with empty measures
 *   npx ts-node src/scripts/reprocess-omr.ts --all   # ALL parts (force reprocess)
 */
import dotenv from 'dotenv';
dotenv.config();

import { db } from '../db';
import { enqueueJob } from '../lib/queue';

const forceAll = process.argv.includes('--all');

async function main() {
  const whereClause = forceAll
    ? `p.deleted_at IS NULL AND p.pdf_s3_key IS NOT NULL`
    : `p.deleted_at IS NULL
       AND p.pdf_s3_key IS NOT NULL
       AND (p.omr_json IS NULL OR p.omr_json->'measures' = '[]'::jsonb)`;

  const { rows } = await db.query<{
    id: string;
    pdf_s3_key: string;
    instrument_name: string;
    chart_id: string;
    chart_version_id: string;
  }>(
    `SELECT p.id, p.pdf_s3_key, p.instrument_name,
            c.id AS chart_id, p.chart_version_id
     FROM parts p
     JOIN chart_versions cv ON cv.id = p.chart_version_id
     JOIN charts c ON c.id = cv.chart_id
     WHERE ${whereClause}`
  );

  if (rows.length === 0) {
    console.log('No parts need reprocessing.');
    await db.end();
    return;
  }

  console.log(`Found ${rows.length} part(s) to reprocess${forceAll ? ' (--all)' : ''}.`);

  for (const part of rows) {
    // Reset status so the worker picks it up
    await db.query(
      `UPDATE parts SET omr_status = 'pending', updated_at = NOW() WHERE id = $1`,
      [part.id]
    );

    await enqueueJob('omr', {
      partId: part.id,
      pdfS3Key: part.pdf_s3_key,
      chartId: part.chart_id,
      versionId: part.chart_version_id,
      instrument: part.instrument_name,
    });

    console.log(`  Enqueued: ${part.instrument_name} (part ${part.id})`);
  }

  console.log(`Done. ${rows.length} job(s) enqueued. Run the OMR worker to process them.`);
  await db.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
