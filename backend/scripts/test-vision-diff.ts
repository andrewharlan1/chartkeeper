#!/usr/bin/env npx ts-node
/**
 * Quick manual test for the Vision diff engine.
 *
 * Usage:
 *   cd backend
 *   ANTHROPIC_API_KEY=sk-ant-... npx ts-node scripts/test-vision-diff.ts <old.pdf> <new.pdf> [instrument-name]
 *
 * Example:
 *   npx ts-node scripts/test-vision-diff.ts ~/Desktop/bass-v1.pdf ~/Desktop/bass-v2.pdf "Bass"
 */

import dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { computeMeasureMapping, visionResultToPartDiff } from '../src/lib/vision-diff';

const [,, oldPath, newPath, instrument = 'Part'] = process.argv;

if (!oldPath || !newPath) {
  console.error('Usage: npx ts-node scripts/test-vision-diff.ts <old.pdf> <new.pdf> [instrument]');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY not set (add it to backend/.env or prefix the command)');
  process.exit(1);
}

async function main() {
  const oldPdf = fs.readFileSync(path.resolve(oldPath));
  const newPdf = fs.readFileSync(path.resolve(newPath));

  console.log(`\nRunning Vision diff for "${instrument}"...`);
  console.log(`  v1: ${oldPath} (${(oldPdf.length / 1024).toFixed(1)} KB)`);
  console.log(`  v2: ${newPath} (${(newPdf.length / 1024).toFixed(1)} KB)\n`);

  const result = await computeMeasureMapping(oldPdf, newPdf, instrument);

  const partDiff = visionResultToPartDiff(result);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Model:              ${result.modelUsed}`);
  console.log(`Overall confidence: ${(result.overallConfidence * 100).toFixed(1)}%`);
  console.log(`Latency:            ${result.processingMs}ms`);
  console.log(`Measures mapped:    ${Object.keys(result.measureMapping).length}`);
  console.log(`Changed:            ${result.changedMeasures.length}  ${result.changedMeasures.join(', ')}`);
  console.log(`Inserted:           ${result.insertedMeasures.length}  ${result.insertedMeasures.join(', ')}`);
  console.log(`Deleted:            ${result.deletedMeasures.length}  ${result.deletedMeasures.join(', ')}`);

  if (result.sectionLabels.length > 0) {
    console.log(`\nSection labels:`);
    for (const s of result.sectionLabels) {
      console.log(`  "${s.label}"  m.${s.startMeasure}–${s.endMeasure}`);
    }
  }

  if (Object.keys(result.changeDescriptions).length > 0) {
    console.log(`\nChange descriptions:`);
    for (const [m, desc] of Object.entries(result.changeDescriptions)) {
      console.log(`  m.${m}: ${desc}`);
    }
  }

  console.log('\nMeasure mapping (v1 → v2):');
  for (const [old, nw] of Object.entries(result.measureMapping)) {
    const conf = result.confidence[Number(old)];
    const confStr = conf !== undefined ? ` (${(conf * 100).toFixed(0)}%)` : '';
    const changed = result.changedMeasures.includes(Number(old)) ? ' ← CHANGED' : '';
    console.log(`  m.${old} → ${nw ?? 'DELETED'}${confStr}${changed}`);
  }

  console.log('\nPartDiff JSON:');
  console.log(JSON.stringify(partDiff, null, 2));
}

main().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
