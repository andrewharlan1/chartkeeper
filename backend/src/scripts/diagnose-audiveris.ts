/**
 * Diagnostic: Parse the Audiveris MusicXML output using the codebase's
 * own parseMusicXml() function, then run the LCS diff engine.
 *
 * Usage: cd backend && npx tsx src/scripts/diagnose-audiveris.ts
 */
import fs from 'fs';
// parseMusicXml lives in omr-service which is outside backend's module boundary.
// Import via absolute path so tsx can resolve it.
import { parseMusicXml } from '/Users/andrewharlan/Desktop/chartkeeper/omr-service/src/audiveris';
import { diffPart } from '../lib/diff';
import type { OmrJson } from '../lib/diff';

const V1_XML = '/tmp/diagnose-v1.musicxml';
const V2_XML = '/tmp/diagnose-v2.musicxml';

function main() {
  console.log('=== Audiveris MusicXML Diagnostic ===\n');

  // ── Read MusicXML ───────────────────────────────────────────────────────────
  const xmlV1 = fs.readFileSync(V1_XML, 'utf8');
  const xmlV2 = fs.readFileSync(V2_XML, 'utf8');
  console.log(`V1 MusicXML: ${V1_XML} (${xmlV1.length} chars)`);
  console.log(`V2 MusicXML: ${V2_XML} (${xmlV2.length} chars)\n`);

  // ── Quick stats from raw XML ───────────────────────────────────────────────
  const measureCountV1 = (xmlV1.match(/<measure /g) || []).length;
  const measureCountV2 = (xmlV2.match(/<measure /g) || []).length;
  const noteCountV1 = (xmlV1.match(/<note/g) || []).length;
  const noteCountV2 = (xmlV2.match(/<note/g) || []).length;

  console.log('Raw XML stats:');
  console.log(`  V1: ${measureCountV1} <measure> elements, ${noteCountV1} <note> elements`);
  console.log(`  V2: ${measureCountV2} <measure> elements, ${noteCountV2} <note> elements\n`);

  // ── Parse with the codebase's parser ───────────────────────────────────────
  const omrV1 = parseMusicXml(xmlV1, 'Flute');
  const omrV2 = parseMusicXml(xmlV2, 'Flute');

  console.log('Parsed OmrJson:');
  console.log('| Version | Measures | Notes (total) | Sections | Has Bounds |');
  console.log('|---------|----------|---------------|----------|------------|');
  const notesV1 = omrV1.measures.reduce((s, m) => s + m.notes.length, 0);
  const notesV2 = omrV2.measures.reduce((s, m) => s + m.notes.length, 0);
  const boundsV1 = omrV1.measures.some(m => !!m.bounds);
  const boundsV2 = omrV2.measures.some(m => !!m.bounds);
  console.log(`| V1      | ${omrV1.measures.length.toString().padEnd(8)} | ${notesV1.toString().padEnd(13)} | ${omrV1.sections.length.toString().padEnd(8)} | ${boundsV1.toString().padEnd(10)} |`);
  console.log(`| V2      | ${omrV2.measures.length.toString().padEnd(8)} | ${notesV2.toString().padEnd(13)} | ${omrV2.sections.length.toString().padEnd(8)} | ${boundsV2.toString().padEnd(10)} |`);
  console.log();

  // ── Measure details ────────────────────────────────────────────────────────
  console.log('--- Measure Details ---\n');
  for (const [label, omr] of [['V1', omrV1], ['V2', omrV2]] as const) {
    console.log(`${label} measures:`);
    for (const m of omr.measures) {
      const notesStr = m.notes.length > 0
        ? m.notes.map(n => `${n.pitch}(b${n.beat},${n.duration})`).join(' ')
        : '(no notes)';
      console.log(`  m.${m.number}: ${notesStr}`);
    }
    console.log();
  }

  // ── Diff ───────────────────────────────────────────────────────────────────
  console.log('--- LCS Diff on Audiveris Output ---\n');
  const diff = diffPart(omrV1, omrV2);

  console.log(`Changed measures:  [${diff.changedMeasures.join(', ')}]`);
  console.log(`Inserted measures: [${diff.structuralChanges.insertedMeasures.join(', ')}]`);
  console.log(`Deleted measures:  [${diff.structuralChanges.deletedMeasures.join(', ')}]`);
  console.log();

  console.log('Measure mapping:');
  for (const [oldM, newM] of Object.entries(diff.measureMapping).sort(([a], [b]) => Number(a) - Number(b))) {
    console.log(`  m.${oldM} → ${newM === null ? 'DELETED' : `m.${newM}`}`);
  }
  console.log();

  console.log('Change descriptions:');
  for (const [m, desc] of Object.entries(diff.changeDescriptions)) {
    console.log(`  ${desc}`);
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

  const allReported = new Set([
    ...diff.changedMeasures,
    ...diff.structuralChanges.insertedMeasures,
    ...diff.structuralChanges.deletedMeasures,
  ]);

  console.log('| Measure | Expected         | Diff reported       | Match? |');
  console.log('|---------|------------------|---------------------|--------|');

  let allMatch = true;
  for (const mStr of Object.keys(expected).sort((a, b) => Number(a) - Number(b))) {
    const m = Number(mStr);
    const exp = expected[m];
    const isReported = allReported.has(m);
    const desc = diff.changeDescriptions[m] || (isReported ? 'structural change' : 'unchanged');
    const match = exp.changed === isReported;
    if (!match) allMatch = false;
    const matchStr = match ? 'YES' : '**NO**';
    console.log(`| m.${m.toString().padEnd(5)} | ${exp.description.padEnd(16)} | ${desc.substring(0, 19).padEnd(19)} | ${matchStr.padEnd(6)} |`);
  }

  console.log();
  console.log(`Diff matches ground truth: ${allMatch ? 'YES — FULL MATCH' : 'NO — MISMATCHES'}`);

  if (!allMatch) {
    const falseNeg: number[] = [];
    const falsePos: number[] = [];
    for (const [mStr, exp] of Object.entries(expected)) {
      const m = Number(mStr);
      const isReported = allReported.has(m);
      if (exp.changed && !isReported) falseNeg.push(m);
      if (!exp.changed && isReported) falsePos.push(m);
    }
    if (falseNeg.length > 0) console.log(`  FALSE NEGATIVES (missed): m.${falseNeg.join(', m.')}`);
    if (falsePos.length > 0) console.log(`  FALSE POSITIVES (phantom): m.${falsePos.join(', m.')}`);
  }
}

main();
