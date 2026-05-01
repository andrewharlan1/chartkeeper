/**
 * Diagnostic script: runs the active OMR pipeline (Vision-based measure layout)
 * and the active diff pipeline (Vision-based diff) on a pair of test PDFs.
 *
 * Usage:
 *   cd backend && npx tsx src/scripts/diagnose-omr.ts
 */
import dotenv from 'dotenv';
dotenv.config({ override: true });

import path from 'path';
import fs from 'fs';

import { extractMeasureLayout } from '../legacy/vision-measure-layout';
import { computeMeasureMapping, visionResultToPartDiff } from '../legacy/vision-diff';
import type { OmrJson } from '../lib/diff';

const FIXTURE_DIR = path.resolve(__dirname, '../../test-data/pairs/Flute');
const V1_PATH = path.join(FIXTURE_DIR, 'V1.pdf');
const V2_PATH = path.join(FIXTURE_DIR, 'V2.pdf');

async function main() {
  console.log('=== ChartKeeper OMR/Diff Diagnostic ===\n');

  const v1Buf = fs.readFileSync(V1_PATH);
  const v2Buf = fs.readFileSync(V2_PATH);
  console.log(`V1: ${V1_PATH} (${v1Buf.length} bytes)`);
  console.log(`V2: ${V2_PATH} (${v2Buf.length} bytes)\n`);

  // ── Vision OMR on both PDFs ────────────────────────────────────────────────
  console.log('--- OMR: extractMeasureLayout (Vision) ---\n');

  console.log('Processing V1...');
  const t1 = Date.now();
  let omrV1: OmrJson;
  try {
    omrV1 = await extractMeasureLayout(v1Buf, 'Flute');
    console.log(`  V1 done in ${Date.now() - t1}ms`);
  } catch (err) {
    console.error('  V1 FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log('Processing V2...');
  const t2 = Date.now();
  let omrV2: OmrJson;
  try {
    omrV2 = await extractMeasureLayout(v2Buf, 'Flute');
    console.log(`  V2 done in ${Date.now() - t2}ms`);
  } catch (err) {
    console.error('  V2 FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  fs.writeFileSync('/tmp/diagnose-v1-omr.json', JSON.stringify(omrV1, null, 2));
  fs.writeFileSync('/tmp/diagnose-v2-omr.json', JSON.stringify(omrV2, null, 2));
  console.log('\nOMR JSON saved to /tmp/diagnose-v1-omr.json and /tmp/diagnose-v2-omr.json\n');

  // Summary table
  console.log('OMR Summary:');
  console.log('| Version | Measures | Sections | Notes (total) | Has Bounds |');
  console.log('|---------|----------|----------|---------------|------------|');
  const noteCountV1 = omrV1.measures.reduce((s, m) => s + m.notes.length, 0);
  const noteCountV2 = omrV2.measures.reduce((s, m) => s + m.notes.length, 0);
  const hasBoundsV1 = omrV1.measures.some(m => !!m.bounds);
  const hasBoundsV2 = omrV2.measures.some(m => !!m.bounds);
  console.log(`| V1      | ${omrV1.measures.length.toString().padEnd(8)} | ${omrV1.sections.length.toString().padEnd(8)} | ${noteCountV1.toString().padEnd(13)} | ${hasBoundsV1.toString().padEnd(10)} |`);
  console.log(`| V2      | ${omrV2.measures.length.toString().padEnd(8)} | ${omrV2.sections.length.toString().padEnd(8)} | ${noteCountV2.toString().padEnd(13)} | ${hasBoundsV2.toString().padEnd(10)} |`);
  console.log();

  // Measure details
  console.log('--- OMR Measure Details ---\n');
  for (const [label, omr] of [['V1', omrV1], ['V2', omrV2]] as const) {
    console.log(`${label} measures:`);
    for (const m of omr.measures) {
      const notesStr = m.notes.length > 0
        ? m.notes.map(n => `${n.pitch}(b${n.beat},${n.duration})`).join(' ')
        : '(no notes)';
      const boundsStr = m.bounds
        ? `p${m.bounds.page} [${m.bounds.x.toFixed(3)},${m.bounds.y.toFixed(3)} ${m.bounds.w.toFixed(3)}x${m.bounds.h.toFixed(3)}]`
        : '(no bounds)';
      console.log(`  m.${m.number}: ${notesStr} | ${boundsStr}`);
    }
    console.log();
  }

  // ── Vision Diff ────────────────────────────────────────────────────────────
  console.log('--- Diff: computeMeasureMapping (Vision) ---\n');
  const td = Date.now();
  let diffResult;
  try {
    diffResult = await computeMeasureMapping(v1Buf, v2Buf, 'Flute');
    console.log(`Diff done in ${Date.now() - td}ms`);
  } catch (err) {
    console.error('Diff FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  fs.writeFileSync('/tmp/diagnose-diff.json', JSON.stringify(diffResult, null, 2));
  const partDiff = visionResultToPartDiff(diffResult);
  fs.writeFileSync('/tmp/diagnose-partdiff.json', JSON.stringify(partDiff, null, 2));
  console.log('Diff JSON saved to /tmp/diagnose-diff.json\n');

  console.log('Diff Result:');
  console.log(`  Model used:         ${diffResult.modelUsed}`);
  console.log(`  Overall confidence: ${diffResult.overallConfidence}`);
  console.log(`  Changed measures:   [${diffResult.changedMeasures.join(', ')}]`);
  console.log(`  Inserted measures:  [${diffResult.insertedMeasures.join(', ')}]`);
  console.log(`  Deleted measures:   [${diffResult.deletedMeasures.join(', ')}]`);
  console.log(`  Processing ms:      ${diffResult.processingMs}`);
  console.log();

  console.log('Measure mapping:');
  for (const [oldM, newM] of Object.entries(diffResult.measureMapping)) {
    const conf = diffResult.confidence[Number(oldM)];
    const confStr = conf !== undefined ? ` (conf=${conf.toFixed(2)})` : '';
    console.log(`  m.${oldM} → ${newM === null ? 'DELETED' : `m.${newM}`}${confStr}`);
  }
  console.log();

  console.log('Change descriptions:');
  for (const [m, desc] of Object.entries(diffResult.changeDescriptions)) {
    console.log(`  m.${m}: ${desc}`);
  }
  console.log();

  // ── Ground truth comparison ────────────────────────────────────────────────
  console.log('--- Ground Truth Comparison ---\n');

  const expected: Record<number, { changed: boolean; description: string }> = {};
  for (let m = 1; m <= 10; m++) {
    expected[m] = { changed: false, description: 'unchanged' };
  }
  expected[11] = { changed: true,  description: 'E5->C5 (1 note)' };
  expected[12] = { changed: false, description: 'unchanged' };
  expected[13] = { changed: true,  description: 'F4->A4, E4->G4' };
  expected[14] = { changed: true,  description: 'B3->B4, C4->F4' };
  expected[15] = { changed: true,  description: 'D4->G4 (1 note)' };

  console.log('| Measure | Expected         | Diff reported      | Match? |');
  console.log('|---------|------------------|--------------------|--------|');

  let allMatch = true;
  for (const mStr of Object.keys(expected).sort((a, b) => Number(a) - Number(b))) {
    const m = Number(mStr);
    const exp = expected[m];
    const isReportedChanged = diffResult.changedMeasures.includes(m)
      || diffResult.insertedMeasures.includes(m)
      || diffResult.deletedMeasures.includes(m);
    const reportedDesc = diffResult.changeDescriptions[m] || (isReportedChanged ? 'change detected' : 'unchanged');
    const match = exp.changed === isReportedChanged;
    if (!match) allMatch = false;
    const matchStr = match ? 'YES' : '**NO**';
    console.log(`| m.${m.toString().padEnd(5)} | ${exp.description.padEnd(16)} | ${reportedDesc.substring(0, 18).padEnd(18)} | ${matchStr.padEnd(6)} |`);
  }

  console.log();
  console.log('=== DIAGNOSTIC SUMMARY ===\n');
  console.log(`Audiveris status:     NOT AVAILABLE (no Java/Audiveris installed)`);
  console.log(`Active OMR engine:    Vision (vision-measure-layout.ts)`);
  console.log(`Active diff engine:   Vision (vision-diff.ts)`);
  console.log(`OMR extracts notes:   NO — Vision OMR produces empty notes[]/dynamics[]`);
  console.log(`Diff uses Vision:     YES — both OMR and diff use @anthropic-ai/sdk`);
  console.log(`  OMR call site:      backend/src/lib/vision-measure-layout.ts:338`);
  console.log(`  Diff call site:     backend/src/lib/vision-diff.ts:220`);
  console.log(`LCS diff available:   YES (backend/src/lib/diff.ts) but NOT USED in production`);
  console.log(`Diff matches truth:   ${allMatch ? 'YES' : 'NO / PARTIAL'}`);

  if (!allMatch) {
    const falsePos: number[] = [];
    const falseNeg: number[] = [];
    for (const [mStr, exp] of Object.entries(expected)) {
      const m = Number(mStr);
      const isReported = diffResult.changedMeasures.includes(m)
        || diffResult.insertedMeasures.includes(m)
        || diffResult.deletedMeasures.includes(m);
      if (exp.changed && !isReported) falseNeg.push(m);
      if (!exp.changed && isReported) falsePos.push(m);
    }
    if (falseNeg.length > 0) console.log(`  Missed changes (false negatives): m.${falseNeg.join(', m.')}`);
    if (falsePos.length > 0) console.log(`  Phantom changes (false positives): m.${falsePos.join(', m.')}`);
  }

  console.log();
  console.log('KEY INSIGHT: The LCS diff engine (diff.ts:diffPart) requires OmrJson');
  console.log('with populated notes[]. The Vision OMR engine produces EMPTY notes[],');
  console.log('so LCS sees every measure as identical (all fingerprints = "|").');
  console.log('Production bypasses LCS entirely and uses Vision for diffing too.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
