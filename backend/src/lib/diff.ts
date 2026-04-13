export interface OmrNote {
  pitch: string;
  beat: number;
  duration: string;
}

export interface OmrDynamic {
  type: string;
  beat: number;
}

export interface OmrMeasure {
  number: number;
  notes: OmrNote[];
  dynamics: OmrDynamic[];
}

export interface OmrSection {
  label: string;
  measureNumber: number;
}

export interface OmrJson {
  measures: OmrMeasure[];
  sections: OmrSection[];
  partName: string;
}

export interface PartDiff {
  changedMeasures: number[];
  changeDescriptions: Record<number, string>;
  structuralChanges: {
    insertedMeasures: number[];
    deletedMeasures: number[];
    sectionLabelChanges: string[];
  };
  measureMapping: Record<number, number | null>;
}

export interface VersionDiffJson {
  parts: Record<string, PartDiff>;
}

// ── Fingerprinting ───────────────────────────────────────────────────────────

function fingerprintMeasure(m: OmrMeasure): string {
  const notes = m.notes.map((n) => `${n.pitch}:${n.beat}:${n.duration}`).join(',');
  const dynamics = m.dynamics.map((d) => `${d.type}:${d.beat}`).join(',');
  return `${notes}|${dynamics}`;
}

// ── LCS-based measure mapping ────────────────────────────────────────────────

/**
 * Returns the LCS table for two fingerprint arrays.
 * lcs[i][j] = length of LCS of oldFps[0..i-1] and newFps[0..j-1]
 */
function buildLcsTable(oldFps: string[], newFps: string[]): number[][] {
  const m = oldFps.length;
  const n = newFps.length;
  const table: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldFps[i - 1] === newFps[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }
  return table;
}

interface Alignment {
  /** old index → new index (undefined = deleted) */
  oldToNew: Map<number, number | undefined>;
  /** new indices that have no corresponding old measure (inserted) */
  insertedNewIndices: Set<number>;
}

function alignMeasures(oldFps: string[], newFps: string[]): Alignment {
  const table = buildLcsTable(oldFps, newFps);
  const oldToNew = new Map<number, number | undefined>();
  const insertedNewIndices = new Set<number>();

  // Backtrack through the LCS table
  let i = oldFps.length;
  let j = newFps.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldFps[i - 1] === newFps[j - 1]) {
      oldToNew.set(i - 1, j - 1);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      insertedNewIndices.add(j - 1);
      j--;
    } else {
      oldToNew.set(i - 1, undefined); // deleted
      i--;
    }
  }

  return { oldToNew, insertedNewIndices };
}

// ── Change description generation ────────────────────────────────────────────

function describeNoteChanges(oldM: OmrMeasure, newM: OmrMeasure): string {
  const parts: string[] = [];

  const oldPitches = oldM.notes.map((n) => n.pitch);
  const newPitches = newM.notes.map((n) => n.pitch);

  // Removed notes
  const removed = oldPitches.filter((p) => !newPitches.includes(p));
  const added = newPitches.filter((p) => !oldPitches.includes(p));

  if (removed.length === 1 && added.length === 1) {
    parts.push(`${added[0]} replaces ${removed[0]}`);
  } else {
    if (removed.length > 0) parts.push(`removed: ${removed.join(', ')}`);
    if (added.length > 0) parts.push(`added: ${added.join(', ')}`);
  }

  // Dynamic changes
  const oldDyns = oldM.dynamics.map((d) => d.type);
  const newDyns = newM.dynamics.map((d) => d.type);
  const addedDyns = newDyns.filter((d) => !oldDyns.includes(d));
  const removedDyns = oldDyns.filter((d) => !newDyns.includes(d));
  if (addedDyns.length > 0) parts.push(`${addedDyns.join(', ')} added`);
  if (removedDyns.length > 0) parts.push(`${removedDyns.join(', ')} removed`);

  if (parts.length === 0) parts.push('content changed');
  return parts.join('; ');
}

function describeSectionChanges(oldSections: OmrSection[], newSections: OmrSection[]): string[] {
  const changes: string[] = [];
  const oldMap = new Map(oldSections.map((s) => [s.label, s.measureNumber]));
  const newMap = new Map(newSections.map((s) => [s.label, s.measureNumber]));

  for (const [label, oldMeasure] of oldMap) {
    if (!newMap.has(label)) {
      changes.push(`Section "${label}" removed`);
    } else if (newMap.get(label) !== oldMeasure) {
      changes.push(`Section "${label}" moved from m.${oldMeasure} to m.${newMap.get(label)}`);
    }
  }
  for (const [label] of newMap) {
    if (!oldMap.has(label)) {
      changes.push(`Section "${label}" added`);
    }
  }
  return changes;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function diffPart(oldOmr: OmrJson, newOmr: OmrJson): PartDiff {
  const oldFps = oldOmr.measures.map(fingerprintMeasure);
  const newFps = newOmr.measures.map(fingerprintMeasure);
  const { oldToNew, insertedNewIndices } = alignMeasures(oldFps, newFps);

  const changedMeasures: number[] = [];
  const changeDescriptions: Record<number, string> = {};
  const measureMapping: Record<number, number | null> = {};
  const insertedMeasures: number[] = [];
  const deletedMeasures: number[] = [];

  // Build measureMapping (1-based measure numbers)
  for (const [oldIdx, newIdx] of oldToNew) {
    const oldMeasureNum = oldOmr.measures[oldIdx].number;
    if (newIdx === undefined) {
      measureMapping[oldMeasureNum] = null;
      deletedMeasures.push(oldMeasureNum);
    } else {
      const newMeasureNum = newOmr.measures[newIdx].number;
      measureMapping[oldMeasureNum] = newMeasureNum;

      // Matched but fingerprints differ → changed
      if (oldFps[oldIdx] !== newFps[newIdx]) {
        changedMeasures.push(newMeasureNum);
        changeDescriptions[newMeasureNum] =
          `m.${newMeasureNum}: ${describeNoteChanges(oldOmr.measures[oldIdx], newOmr.measures[newIdx])}`;
      }
    }
  }

  for (const newIdx of insertedNewIndices) {
    insertedMeasures.push(newOmr.measures[newIdx].number);
  }

  const sectionLabelChanges = describeSectionChanges(oldOmr.sections, newOmr.sections);

  return {
    changedMeasures,
    changeDescriptions,
    structuralChanges: { insertedMeasures, deletedMeasures, sectionLabelChanges },
    measureMapping,
  };
}

export function diffVersion(
  partOmrPairs: Array<{ instrument: string; oldOmr: OmrJson; newOmr: OmrJson }>
): VersionDiffJson {
  const parts: Record<string, PartDiff> = {};
  for (const { instrument, oldOmr, newOmr } of partOmrPairs) {
    parts[instrument] = diffPart(oldOmr, newOmr);
  }
  return { parts };
}
