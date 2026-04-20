import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseVisionResponse, visionResultToPartDiff, ConcurrencyPool } from './vision-diff';

// ── parseVisionResponse unit tests ────────────────────────────────────────────

describe('parseVisionResponse', () => {
  const now = Date.now();

  it('parses a well-formed response', () => {
    const raw = JSON.stringify({
      measure_mapping: { '1': 1, '2': 2, '3': null },
      inserted_measures: [4],
      deleted_measures: [3],
      changed_measures: [2],
      change_descriptions: { '2': 'dynamics changed' },
      section_labels: [{ label: 'A', start_measure: 1, end_measure: 4 }],
      measure_bounds: { '2': { page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
      confidence: { '1': 0.95, '2': 0.8, '3': 0.5 },
      overall_confidence: 0.88,
    });

    const result = parseVisionResponse(raw, 'claude-sonnet-4-6', 1200);

    expect(result.measureMapping).toEqual({ 1: 1, 2: 2, 3: null });
    expect(result.insertedMeasures).toEqual([4]);
    expect(result.deletedMeasures).toEqual([3]);
    expect(result.changedMeasures).toEqual([2]);
    expect(result.changeDescriptions[2]).toBe('dynamics changed');
    expect(result.sectionLabels).toEqual([{ label: 'A', startMeasure: 1, endMeasure: 4 }]);
    expect(result.measureBounds![2]).toEqual({ page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.1 });
    expect(result.confidence[1]).toBeCloseTo(0.95);
    expect(result.overallConfidence).toBeCloseTo(0.88);
    expect(result.modelUsed).toBe('claude-sonnet-4-6');
    expect(result.processingMs).toBe(1200);
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n{"measure_mapping":{"1":1},"inserted_measures":[],"deleted_measures":[],"changed_measures":[],"change_descriptions":{},"section_labels":[],"confidence":{"1":0.9},"overall_confidence":0.9}\n```';
    const result = parseVisionResponse(raw, 'model', 100);
    expect(result.measureMapping[1]).toBe(1);
  });

  it('clamps confidence values to [0, 1]', () => {
    const raw = JSON.stringify({
      measure_mapping: { '1': 1 },
      inserted_measures: [],
      deleted_measures: [],
      changed_measures: [],
      change_descriptions: {},
      section_labels: [],
      confidence: { '1': 1.5 },
      overall_confidence: -0.2,
    });
    const result = parseVisionResponse(raw, 'model', 100);
    expect(result.confidence[1]).toBe(1.0);
    expect(result.overallConfidence).toBe(0.0);
  });

  it('throws on non-JSON response', () => {
    expect(() => parseVisionResponse('This is not JSON at all.', 'model', 100))
      .toThrow('Vision API returned non-JSON');
  });

  it('handles missing optional fields gracefully', () => {
    const raw = JSON.stringify({
      measure_mapping: { '1': 1 },
      overall_confidence: 0.7,
    });
    const result = parseVisionResponse(raw, 'model', 100);
    expect(result.insertedMeasures).toEqual([]);
    expect(result.deletedMeasures).toEqual([]);
    expect(result.changedMeasures).toEqual([]);
    expect(result.sectionLabels).toEqual([]);
    expect(result.measureBounds).toBeUndefined();
  });

  it('ignores non-integer keys in measure_mapping', () => {
    const raw = JSON.stringify({
      measure_mapping: { '1': 1, 'm.2': 2, 'abc': 3 },
      overall_confidence: 0.9,
    });
    const result = parseVisionResponse(raw, 'model', 100);
    expect(Object.keys(result.measureMapping)).toEqual(['1']);
  });
});

// ── visionResultToPartDiff unit tests ─────────────────────────────────────────

describe('visionResultToPartDiff', () => {
  it('converts a full result to PartDiff shape', () => {
    const result = parseVisionResponse(JSON.stringify({
      measure_mapping: { '1': 1, '2': 3, '3': null },
      inserted_measures: [2],
      deleted_measures: [3],
      changed_measures: [2],
      change_descriptions: { '2': 'pitch changed' },
      section_labels: [{ label: 'Verse', start_measure: 1, end_measure: 3 }],
      measure_bounds: { '2': { page: 1, x: 0.0, y: 0.5, w: 0.5, h: 0.1 } },
      confidence: { '1': 1.0, '2': 0.85, '3': 0.6 },
      overall_confidence: 0.82,
    }), 'model', 500);

    const diff = visionResultToPartDiff(result);

    expect(diff.changedMeasures).toEqual([2]);
    expect(diff.changeDescriptions[2]).toBe('pitch changed');
    expect(diff.structuralChanges.insertedMeasures).toEqual([2]);
    expect(diff.structuralChanges.deletedMeasures).toEqual([3]);
    expect(diff.structuralChanges.sectionLabelChanges).toEqual(['Section "Verse" at m.1–3']);
    expect(diff.measureMapping).toEqual({ 1: 1, 2: 3, 3: null });
    expect(diff.changedMeasureBounds![2]).toEqual({ page: 1, x: 0.0, y: 0.5, w: 0.5, h: 0.1 });
  });

  it('omits changedMeasureBounds when measureBounds is empty', () => {
    const result = parseVisionResponse(JSON.stringify({
      measure_mapping: { '1': 1 },
      overall_confidence: 0.9,
    }), 'model', 100);
    const diff = visionResultToPartDiff(result);
    expect(diff.changedMeasureBounds).toBeUndefined();
  });
});

// ── ConcurrencyPool unit tests ────────────────────────────────────────────────

describe('ConcurrencyPool', () => {
  it('limits concurrent executions', async () => {
    const pool = new ConcurrencyPool(2);
    let running = 0;
    let maxRunning = 0;

    const task = () => pool.run(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(r => setTimeout(r, 10));
      running--;
    });

    await Promise.all([task(), task(), task(), task()]);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('runs tasks sequentially when limit=1', async () => {
    const pool = new ConcurrencyPool(1);
    const order: number[] = [];

    await Promise.all([
      pool.run(async () => { await new Promise(r => setTimeout(r, 20)); order.push(1); }),
      pool.run(async () => { await new Promise(r => setTimeout(r, 5));  order.push(2); }),
      pool.run(async () => { order.push(3); }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });
});

// ── Live fixture integration tests ────────────────────────────────────────────
// These run only when:
//   1. ANTHROPIC_API_KEY is set in the environment
//   2. The fixture PDF pairs exist on disk

const FIXTURES_ROOT = path.resolve(__dirname, '../../../test-fixtures/diff-pairs');

interface FixturePair {
  name: string;
  dir: string;
  instrument: string;
  /** Minimum overall_confidence we expect from Claude */
  minConfidence: number;
  /** Measures we expect to appear in changedMeasures or insertedMeasures */
  expectChangesNear?: number[];
  /** Measures we expect to be stable (in measureMapping with a non-null target) */
  expectStable?: number[];
}

const FIXTURE_PAIRS: FixturePair[] = [
  {
    name: '01-disposition-v1-v2',
    dir: path.join(FIXTURES_ROOT, '01-disposition-v1-v2'),
    instrument: 'Bass',
    minConfidence: 0.7,
  },
  {
    name: '02-disposition-v2-v3',
    dir: path.join(FIXTURES_ROOT, '02-disposition-v2-v3'),
    instrument: 'Bass',
    minConfidence: 0.7,
  },
  {
    name: '03-cello-small-change',
    dir: path.join(FIXTURES_ROOT, '03-cello-small-change'),
    instrument: 'Cello',
    minConfidence: 0.8,
    expectChangesNear: [],   // fill in after first run
    expectStable: [],
  },
];

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const itLive = hasApiKey ? it : it.skip;

describe('Vision diff — live fixture tests', () => {
  // Import lazily so the module's env-var checks don't fire in unit-only runs
  let computeMeasureMapping: typeof import('./vision-diff').computeMeasureMapping;

  beforeEach(async () => {
    if (hasApiKey) {
      ({ computeMeasureMapping } = await import('./vision-diff'));
    }
  });

  for (const fixture of FIXTURE_PAIRS) {
    const v1Path = path.join(fixture.dir, 'v1.pdf');
    const v2Path = path.join(fixture.dir, 'v2.pdf');
    const fixtureExists = fs.existsSync(v1Path) && fs.existsSync(v2Path);

    const runTest = hasApiKey && fixtureExists ? it : it.skip;

    runTest(`${fixture.name}: overall confidence ≥ ${fixture.minConfidence}`, async () => {
      const oldPdf = fs.readFileSync(v1Path);
      const newPdf = fs.readFileSync(v2Path);

      const result = await computeMeasureMapping(oldPdf, newPdf, fixture.instrument, {
        fromVersionId: `fixture-${fixture.name}-v1`,
        toVersionId:   `fixture-${fixture.name}-v2`,
      });

      console.log(`[${fixture.name}] confidence=${result.overallConfidence.toFixed(3)}, ` +
        `changed=${result.changedMeasures.length}, inserted=${result.insertedMeasures.length}, ` +
        `deleted=${result.deletedMeasures.length}, latency=${result.processingMs}ms`);

      // Log full result for building expected.json
      console.log(`[${fixture.name}] measureMapping:`, JSON.stringify(result.measureMapping, null, 2));

      expect(result.overallConfidence).toBeGreaterThanOrEqual(fixture.minConfidence);
      expect(Object.keys(result.measureMapping).length).toBeGreaterThan(0);

      if (fixture.expectStable?.length) {
        for (const m of fixture.expectStable) {
          expect(result.measureMapping[m]).not.toBeNull();
        }
      }
    }, 120_000); // 2 min timeout for live API call
  }
});
