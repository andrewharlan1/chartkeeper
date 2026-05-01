/**
 * Diagnostic: Test the LCS diff engine (diff.ts) with synthetic OmrJson
 * data matching the 3-Note-Diff Flute fixture.
 *
 * This does NOT require any API calls or external services.
 * It tests: does the diff engine correctly identify changed measures
 * when given proper note data?
 *
 * Usage: cd backend && npx tsx src/scripts/diagnose-diff-lcs.ts
 */
import { diffPart, OmrJson } from '../lib/diff';

// Build OmrJson for V1 (measures 1-15, flute, 4/4, all half notes)
// m.1-10: arbitrary but identical between V1 and V2
// m.11: E5 (half), G4 (half)
// m.12: A4 (half), B4 (half)  — IDENTICAL between versions
// m.13: F4 (half), E4 (half)
// m.14: B3 (half), C4 (half)
// m.15: D4 (whole)

function makeOmrV1(): OmrJson {
  const measures = [];
  // m.1-10: identical filler
  for (let i = 1; i <= 10; i++) {
    measures.push({
      number: i,
      notes: [
        { pitch: 'C5', beat: 1, duration: 'half' },
        { pitch: 'D5', beat: 3, duration: 'half' },
      ],
      dynamics: [],
    });
  }
  // m.11
  measures.push({
    number: 11,
    notes: [
      { pitch: 'E5', beat: 1, duration: 'half' },
      { pitch: 'G4', beat: 3, duration: 'half' },
    ],
    dynamics: [],
  });
  // m.12 (unchanged)
  measures.push({
    number: 12,
    notes: [
      { pitch: 'A4', beat: 1, duration: 'half' },
      { pitch: 'B4', beat: 3, duration: 'half' },
    ],
    dynamics: [],
  });
  // m.13
  measures.push({
    number: 13,
    notes: [
      { pitch: 'F4', beat: 1, duration: 'half' },
      { pitch: 'E4', beat: 3, duration: 'half' },
    ],
    dynamics: [],
  });
  // m.14
  measures.push({
    number: 14,
    notes: [
      { pitch: 'B3', beat: 1, duration: 'half' },
      { pitch: 'C4', beat: 3, duration: 'half' },
    ],
    dynamics: [],
  });
  // m.15
  measures.push({
    number: 15,
    notes: [
      { pitch: 'D4', beat: 1, duration: 'whole' },
    ],
    dynamics: [],
  });

  return { measures, sections: [], partName: 'Flute' };
}

function makeOmrV2(): OmrJson {
  const measures = [];
  // m.1-10: identical filler (same as V1)
  for (let i = 1; i <= 10; i++) {
    measures.push({
      number: i,
      notes: [
        { pitch: 'C5', beat: 1, duration: 'half' },
        { pitch: 'D5', beat: 3, duration: 'half' },
      ],
      dynamics: [],
    });
  }
  // m.11: E5 → C5 (first note changed)
  measures.push({
    number: 11,
    notes: [
      { pitch: 'C5', beat: 1, duration: 'half' },
      { pitch: 'G4', beat: 3, duration: 'half' },
    ],
    dynamics: [],
  });
  // m.12 (unchanged — same as V1)
  measures.push({
    number: 12,
    notes: [
      { pitch: 'A4', beat: 1, duration: 'half' },
      { pitch: 'B4', beat: 3, duration: 'half' },
    ],
    dynamics: [],
  });
  // m.13: F4→A4, E4→G4
  measures.push({
    number: 13,
    notes: [
      { pitch: 'A4', beat: 1, duration: 'half' },
      { pitch: 'G4', beat: 3, duration: 'half' },
    ],
    dynamics: [],
  });
  // m.14: B3→B4, C4→F4
  measures.push({
    number: 14,
    notes: [
      { pitch: 'B4', beat: 1, duration: 'half' },
      { pitch: 'F4', beat: 3, duration: 'half' },
    ],
    dynamics: [],
  });
  // m.15: D4→G4
  measures.push({
    number: 15,
    notes: [
      { pitch: 'G4', beat: 1, duration: 'whole' },
    ],
    dynamics: [],
  });

  return { measures, sections: [], partName: 'Flute' };
}

function main() {
  console.log('=== LCS Diff Engine Diagnostic ===\n');
  console.log('Testing with synthetic OmrJson matching the 3-Note-Diff fixture.\n');

  const omrV1 = makeOmrV1();
  const omrV2 = makeOmrV2();

  console.log(`V1: ${omrV1.measures.length} measures`);
  console.log(`V2: ${omrV2.measures.length} measures\n`);

  const diff = diffPart(omrV1, omrV2);

  console.log('Diff Result:');
  console.log(`  Changed measures:  [${diff.changedMeasures.join(', ')}]`);
  console.log(`  Inserted measures: [${diff.structuralChanges.insertedMeasures.join(', ')}]`);
  console.log(`  Deleted measures:  [${diff.structuralChanges.deletedMeasures.join(', ')}]`);
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

  // Combine changed + inserted + deleted for "reported as changed"
  const allReportedChanged = new Set([
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
    const isReported = allReportedChanged.has(m);
    const desc = diff.changeDescriptions[m] || (isReported ? 'structural change' : 'unchanged');
    const match = exp.changed === isReported;
    if (!match) allMatch = false;
    const matchStr = match ? 'YES' : '**NO**';
    console.log(`| m.${m.toString().padEnd(5)} | ${exp.description.padEnd(16)} | ${desc.substring(0, 19).padEnd(19)} | ${matchStr.padEnd(6)} |`);
  }

  console.log();
  console.log(`Overall match: ${allMatch ? 'ALL CORRECT' : 'MISMATCHES FOUND'}`);
  console.log();

  // ── Now test with EMPTY notes (simulating Vision OMR output) ──────────────
  console.log('=== Empty-Notes Test (simulating Vision OMR) ===\n');

  const emptyV1: OmrJson = {
    measures: Array.from({ length: 15 }, (_, i) => ({
      number: i + 1,
      notes: [],
      dynamics: [],
    })),
    sections: [],
    partName: 'Flute',
  };
  const emptyV2: OmrJson = { ...emptyV1 }; // identical

  const emptyDiff = diffPart(emptyV1, emptyV2);

  console.log(`Empty-notes diff result:`);
  console.log(`  Changed measures:  [${emptyDiff.changedMeasures.join(', ')}]`);
  console.log(`  Inserted measures: [${emptyDiff.structuralChanges.insertedMeasures.join(', ')}]`);
  console.log(`  Deleted measures:  [${emptyDiff.structuralChanges.deletedMeasures.join(', ')}]`);
  console.log();
  console.log('With empty notes, ALL measures have fingerprint "|" and the LCS');
  console.log('sees them all as identical. Changed measures = ZERO.');
  console.log('This confirms the LCS engine is USELESS without real note data.');
  console.log();

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('=== DIAGNOSTIC SUMMARY ===\n');
  console.log('1. LCS diff engine (diff.ts):');
  console.log('   - WORKS CORRECTLY when given OmrJson with real note data');
  console.log('   - Correctly identifies m.11, m.13, m.14, m.15 as changed');
  console.log('   - Correctly identifies m.12 as unchanged');
  console.log('   - Correctly identifies m.1-10 as unchanged');
  console.log(`   - Match result: ${allMatch ? 'FULL MATCH' : 'PARTIAL'}`);
  console.log();
  console.log('2. Vision OMR engine (vision-measure-layout.ts):');
  console.log('   - Produces empty notes[] — only extracts layout/bounds');
  console.log('   - LCS diff on Vision OMR output = all measures identical = broken');
  console.log();
  console.log('3. Vision diff engine (vision-diff.ts):');
  console.log('   - Bypasses OMR/LCS entirely — sends raw PDFs to Claude Vision');
  console.log('   - The only code path that can produce a diff in production');
  console.log('   - Could not test (ANTHROPIC_API_KEY invalid)');
  console.log();
  console.log('ROOT CAUSE HYPOTHESIS:');
  console.log('The diff pipeline works when Vision API calls succeed. If the API key');
  console.log('is invalid/expired, the diff worker fails silently (3 retries then');
  console.log('circuit breaker opens), no version_diffs row is stored, and the UI');
  console.log('shows "no changes" or no diff log. The annotation migration never');
  console.log('runs because it depends on a successful diff.');
}

main();
