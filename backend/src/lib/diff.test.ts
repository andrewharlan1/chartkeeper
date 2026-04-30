import { diffPart, diffVersion, OmrJson, OmrSection } from './diff';

function makeMeasure(number: number, pitches: string[], dynamics: string[] = []) {
  return {
    number,
    notes: pitches.map((pitch, i) => ({ pitch, beat: i + 1, duration: 'q' })),
    dynamics: dynamics.map((type, i) => ({ type, beat: i + 1 })),
  };
}

function makeOmr(measures: ReturnType<typeof makeMeasure>[], sections: OmrSection[] = []): OmrJson {
  return { measures, sections, partName: 'trumpet' };
}

describe('diffPart — unchanged', () => {
  it('returns empty diff for identical versions', () => {
    const omr = makeOmr([
      makeMeasure(1, ['C4', 'D4']),
      makeMeasure(2, ['E4', 'F4']),
    ]);
    const result = diffPart(omr, omr);
    expect(result.changedMeasures).toHaveLength(0);
    expect(result.structuralChanges.insertedMeasures).toHaveLength(0);
    expect(result.structuralChanges.deletedMeasures).toHaveLength(0);
    expect(result.measureMapping[1]).toBe(1);
    expect(result.measureMapping[2]).toBe(2);
  });
});

describe('diffPart — note change', () => {
  it('detects a single note change', () => {
    const oldOmr = makeOmr([makeMeasure(1, ['C4', 'D4']), makeMeasure(2, ['E4'])]);
    const newOmr = makeOmr([makeMeasure(1, ['C4', 'Eb4']), makeMeasure(2, ['E4'])]);
    const result = diffPart(oldOmr, newOmr);
    expect(result.changedMeasures).toContain(1);
    expect(result.changedMeasures).not.toContain(2);
    expect(result.changeDescriptions[1]).toContain('Eb4 replaces D4');
    expect(result.measureMapping[1]).toBe(1);
    expect(result.measureMapping[2]).toBe(2);
  });

  it('detects dynamic changes', () => {
    const oldOmr = makeOmr([makeMeasure(1, ['C4'], [])]);
    const newOmr = makeOmr([makeMeasure(1, ['C4'], ['mf'])]);
    const result = diffPart(oldOmr, newOmr);
    expect(result.changedMeasures).toContain(1);
    expect(result.changeDescriptions[1]).toContain('mf added');
  });
});

describe('diffPart — structural changes', () => {
  it('detects inserted measure', () => {
    const oldOmr = makeOmr([makeMeasure(1, ['C4']), makeMeasure(2, ['D4'])]);
    const newOmr = makeOmr([makeMeasure(1, ['C4']), makeMeasure(2, ['X4']), makeMeasure(3, ['D4'])]);
    const result = diffPart(oldOmr, newOmr);
    expect(result.structuralChanges.insertedMeasures).toContain(2);
    expect(result.measureMapping[2]).toBe(3); // old m.2 → new m.3
  });

  it('detects deleted measure', () => {
    const oldOmr = makeOmr([makeMeasure(1, ['C4']), makeMeasure(2, ['D4']), makeMeasure(3, ['E4'])]);
    const newOmr = makeOmr([makeMeasure(1, ['C4']), makeMeasure(2, ['E4'])]);
    const result = diffPart(oldOmr, newOmr);
    expect(result.structuralChanges.deletedMeasures).toContain(2);
    expect(result.measureMapping[2]).toBeNull();
    expect(result.measureMapping[3]).toBe(2); // old m.3 shifts to new m.2
  });

  it('handles measure inserted at beginning', () => {
    const oldOmr = makeOmr([makeMeasure(1, ['C4']), makeMeasure(2, ['D4'])]);
    const newOmr = makeOmr([makeMeasure(1, ['X4']), makeMeasure(2, ['C4']), makeMeasure(3, ['D4'])]);
    const result = diffPart(oldOmr, newOmr);
    expect(result.structuralChanges.insertedMeasures).toContain(1);
    expect(result.measureMapping[1]).toBe(2);
    expect(result.measureMapping[2]).toBe(3);
  });
});

describe('diffPart — section label changes', () => {
  it('detects added section', () => {
    const oldOmr = makeOmr([makeMeasure(1, ['C4'])], []);
    const newOmr = makeOmr([makeMeasure(1, ['C4'])], [{ label: 'A', measureNumber: 1 }]);
    const result = diffPart(oldOmr, newOmr);
    expect(result.structuralChanges.sectionLabelChanges[0]).toContain('"A" added');
  });

  it('detects removed section', () => {
    const oldOmr = makeOmr([makeMeasure(1, ['C4'])], [{ label: 'Coda', measureNumber: 1 }]);
    const newOmr = makeOmr([makeMeasure(1, ['C4'])], []);
    const result = diffPart(oldOmr, newOmr);
    expect(result.structuralChanges.sectionLabelChanges[0]).toContain('"Coda" removed');
  });

  it('detects moved section', () => {
    const oldOmr = makeOmr(
      [makeMeasure(1, ['C4']), makeMeasure(2, ['D4'])],
      [{ label: 'B', measureNumber: 1 }]
    );
    const newOmr = makeOmr(
      [makeMeasure(1, ['C4']), makeMeasure(2, ['D4'])],
      [{ label: 'B', measureNumber: 2 }]
    );
    const result = diffPart(oldOmr, newOmr);
    expect(result.structuralChanges.sectionLabelChanges[0]).toContain('"B" moved');
  });
});

describe('diffVersion', () => {
  it('diffs multiple parts', () => {
    const oldTrumpet = makeOmr([makeMeasure(1, ['C4'])]);
    const newTrumpet = makeOmr([makeMeasure(1, ['D4'])]);
    const oldTrombone = makeOmr([makeMeasure(1, ['G3'])]);
    const newTrombone = makeOmr([makeMeasure(1, ['G3'])]);

    const result = diffVersion([
      { instrument: 'trumpet', oldOmr: oldTrumpet, newOmr: newTrumpet },
      { instrument: 'trombone', oldOmr: oldTrombone, newOmr: newTrombone },
    ]);

    expect(result.parts.trumpet.changedMeasures).toContain(1);
    expect(result.parts.trombone.changedMeasures).toHaveLength(0);
  });
});
