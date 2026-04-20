import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { XMLParser } from 'fast-xml-parser';
import AdmZip from 'adm-zip';

const execFileAsync = promisify(execFile);

const AUDIVERIS_PATH = process.env.AUDIVERIS_PATH ?? 'audiveris';
const WORK_DIR = process.env.OMR_WORK_DIR ?? '/tmp/chartkeeper-omr';
const JAVA_HOME = process.env.JAVA_HOME;

export interface OmrNote {
  pitch: string;
  beat: number;
  duration: string;
}

export interface OmrDynamic {
  type: string;
  beat: number;
}

export interface MeasureBounds {
  x: number;   // normalized 0–1 (fraction of page width)
  y: number;   // normalized 0–1 (fraction of page height)
  w: number;   // normalized 0–1
  h: number;   // normalized 0–1
  page: number; // 1-based
}

export interface OmrMeasure {
  number: number;
  notes: OmrNote[];
  dynamics: OmrDynamic[];
  bounds?: MeasureBounds;
  multiRestCount?: number; // present on first measure of a multi-measure rest span
}

export interface OmrSection {
  label: string;
  measureNumber: number;
}

export interface OmrResult {
  musicxml: string;       // base64-encoded MusicXML
  omrJson: {
    measures: OmrMeasure[];
    sections: OmrSection[];
    partName: string;
  };
}

export async function runAudiveris(pdfPath: string, partName: string): Promise<OmrResult> {
  const jobDir = path.join(WORK_DIR, path.basename(pdfPath, '.pdf') + '-' + Date.now());
  await fs.mkdir(jobDir, { recursive: true });

  try {
    // Run Audiveris: -batch -export exports MusicXML to jobDir
    // JAVA_HOME must be set so the Audiveris shell script finds the right JVM
    const env = JAVA_HOME
      ? { ...process.env, JAVA_HOME, PATH: `${JAVA_HOME}/bin:${process.env.PATH ?? ''}` }
      : process.env;
    await execFileAsync(AUDIVERIS_PATH, [
      '-batch',
      '-export',
      '-output', jobDir,
      pdfPath,
    ], { env });

    // Audiveris outputs <basename>.mxl (compressed) or <basename>.xml
    const files = await fs.readdir(jobDir);
    const outputFile = files.find((f) => f.endsWith('.mxl')) ?? files.find((f) => f.endsWith('.xml'));
    if (!outputFile) {
      throw new Error('Audiveris produced no MusicXML output');
    }

    const outputPath = path.join(jobDir, outputFile);
    const rawBuffer = await fs.readFile(outputPath);

    // .mxl is a zip archive containing the actual .xml file
    let xmlString: string;
    if (outputFile.endsWith('.mxl')) {
      const zip = new AdmZip(rawBuffer);
      const xmlEntry = zip.getEntries().find((e) => e.entryName.endsWith('.xml') && !e.entryName.startsWith('META-INF'));
      if (!xmlEntry) {
        throw new Error('No XML found inside .mxl archive');
      }
      xmlString = xmlEntry.getData().toString('utf8');
    } else {
      xmlString = rawBuffer.toString('utf8');
    }

    const musicxml = Buffer.from(xmlString, 'utf8').toString('base64');
    const omrJson = parseMusicXml(xmlString, partName);

    return { musicxml, omrJson };
  } finally {
    await fs.rm(jobDir, { recursive: true, force: true });
  }
}

// ── XML helpers ───────────────────────────────────────────────────────────────

/** Ensures a value is always an array (handles fast-xml-parser's single-item coercion). */
function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

// ── MusicXML parser ───────────────────────────────────────────────────────────

/**
 * Parses MusicXML into the structured omrJson format.
 *
 * Key notes on Audiveris MusicXML:
 *  - Measure width is the `width` attribute on <measure> (not inside <print>)
 *  - <print> contains system-layout for page/system breaks
 *  - Multi-measure rests: <attributes><measure-style><multiple-rest>N</multiple-rest>
 *    collapses N measures into one visual block; we synthesise entries for all N measures
 */
export function parseMusicXml(xml: string, partName: string): OmrResult['omrJson'] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
    // These elements can appear multiple times — always produce arrays
    isArray: (name) => ['measure', 'part', 'note', 'direction', 'attributes'].includes(name),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: Record<string, any>;
  try {
    doc = parser.parse(xml);
  } catch {
    return { measures: [], sections: [], partName };
  }

  const root = doc['score-partwise'];
  if (!root) return { measures: [], sections: [], partName };

  // ── Page / layout defaults ────────────────────────────────────────────────
  const defaults = root.defaults ?? {};
  const pageLayout = defaults['page-layout'] ?? {};
  const pageWidth  = num(pageLayout['page-width'],  1190);
  const pageHeight = num(pageLayout['page-height'], 1683);

  // Page margins: <page-margins> may be an object or array (different types)
  const pageMargins = Array.isArray(pageLayout['page-margins'])
    ? pageLayout['page-margins'][0]
    : (pageLayout['page-margins'] ?? {});
  const leftPageMargin  = num(pageMargins['left-margin'],   57);
  const rightPageMargin = num(pageMargins['right-margin'],  57);
  const topPageMargin   = num(pageMargins['top-margin'],     0);
  const bottomPageMargin = num(pageMargins['bottom-margin'], 0);

  // MusicXML positions are measured within the margin-based coordinate system,
  // but the printable area maps to the full PDF page. Normalizing by the
  // printable area (page minus margins) gives correct 0–1 fractions.
  // X positions include the left margin offset; Y positions are relative to
  // the top margin (via top-system-distance / system-distance).
  const printableWidth  = pageWidth  - leftPageMargin - rightPageMargin;
  const printableHeight = pageHeight - topPageMargin   - bottomPageMargin;

  // Default system spacing
  const defSysLayout = defaults['system-layout'] ?? {};
  const defaultTopSystemDist = num(defSysLayout['top-system-distance'], 170);
  const defaultSystemDist    = num(defSysLayout['system-distance'],     120);

  // Single staff height in tenths (4 spaces × 10 tenths/space = 40 tenths).
  // We add padding above and below so the bounding box captures notes,
  // articulations, and dynamics near the staff.
  const STAFF_H = 40;
  const PADDING_ABOVE = 28; // tenths above top staff line (~70% of staff height)
  const PADDING_BELOW = 20; // tenths below bottom staff line (~50% of staff height)
  const TOTAL_H = PADDING_ABOVE + STAFF_H + PADDING_BELOW;

  // ── Walk the first part ───────────────────────────────────────────────────
  const parts = toArray(root.part);
  const firstPart = parts[0];
  if (!firstPart) return { measures: [], sections: [], partName };

  // ── Detect sibling staves (grand-staff instruments) ──────────────────────
  // TODO: This auto-detection should eventually consult an
  // InstrumentSlot.staffGrouping field once the data model refactor lands,
  // with user-set overrides taking precedence over auto-detection.
  //
  // Multi-staff instruments (piano, harp, organ) have <staff-layout> with
  // <staff-distance> in their <print> elements — the MusicXML semantic signal
  // for "additional staves belong below in the same system." This appears in
  // two forms depending on whether Audiveris detected the grand-staff bracket:
  //   1. Single part with <staves>2</staves>: staff-layout is in P1's prints
  //   2. Split into separate parts: staff-layout is in the sibling part's prints
  // We scan for both and build a per-measure map of staff distances to expand
  // bounding box heights to cover all staves.
  const staffDistByMeasure = new Map<number, number>();

  // Case 1: P1 itself declares multiple staves (staff-layout within P1)
  let staffDistFromPrimary = false;
  const firstPartMeasures = toArray(firstPart.measure);
  for (const fm of firstPartMeasures) {
    const fPrint = Array.isArray(fm.print) ? fm.print[0] : fm.print;
    if (!fPrint) continue;
    const staffLayouts = toArray(fPrint['staff-layout']);
    for (const sl of staffLayouts) {
      const dist = num(sl?.['staff-distance']);
      if (dist > 0) {
        staffDistFromPrimary = true;
        const mNum = num(fm['@_number'], 0);
        if (mNum > 0) staffDistByMeasure.set(mNum, dist);
      }
    }
  }

  // Case 2: Audiveris split grand staff into separate <part> elements;
  // the sibling part's <print> elements contain the staff-distance
  if (staffDistByMeasure.size === 0) {
    for (let pi = 1; pi < parts.length; pi++) {
      const siblingMeasures = toArray(parts[pi].measure);
      let found = false;
      for (const sm of siblingMeasures) {
        const sPrint = Array.isArray(sm.print) ? sm.print[0] : sm.print;
        if (!sPrint) continue;
        const staffLayouts = toArray(sPrint['staff-layout']);
        for (const sl of staffLayouts) {
          const dist = num(sl?.['staff-distance']);
          if (dist > 0) {
            found = true;
            const mNum = num(sm['@_number'], 0);
            if (mNum > 0) staffDistByMeasure.set(mNum, dist);
          }
        }
      }
      if (found) break; // only use the first sibling part with staff-distance
    }
  }

  const rawMeasures = firstPartMeasures;

  let currentPage         = 1;
  let currentSystemTopY   = defaultTopSystemDist;
  let currentX            = leftPageMargin;
  let isFirstSystem       = true;
  let isFirstSystemOnPage = true;

  const measures: OmrMeasure[] = [];
  // After a multi-rest of N, Audiveris emits N-1 phantom measures (no width).
  // We synthesize our own entries, so we skip the phantoms.
  let phantomsToSkip = 0;
  // Tracks the current staff-distance for multi-staff systems (0 = single staff)
  let currentStaffDist = 0;

  for (const raw of rawMeasures) {
    const measureNum = num(raw['@_number'], 0);
    const isImplicit = raw['@_implicit'] === 'yes' || measureNum === 0;

    // Audiveris puts width as an attribute on visually-present measures.
    // Phantom measures inside a multi-rest have no width attribute.
    const hasWidth = raw['@_width'] !== undefined && raw['@_width'] !== null;
    const mWidth = hasWidth ? num(raw['@_width']) : 0;

    // Skip phantom measures that Audiveris generates inside multi-rest spans
    if (phantomsToSkip > 0 && !hasWidth) {
      phantomsToSkip--;
      continue;
    }

    // If we hit a measure with a width while still expecting phantoms,
    // reset — the rest span ended early or Audiveris didn't emit phantoms
    phantomsToSkip = 0;

    // Fallback width for measures that truly have no width (shouldn't happen
    // after skipping phantoms, but defensive)
    const effectiveWidth = mWidth || (pageWidth - leftPageMargin * 2) / 4;

    // ── Print element: page/system break tracking ──────────────────────────
    const printEl = Array.isArray(raw.print) ? raw.print[0] : raw.print;
    if (printEl || isFirstSystem) {
      const isNewPage   = printEl?.['@_new-page']   === 'yes';
      const isNewSystem = printEl?.['@_new-system'] === 'yes' || isNewPage;
      const startSystem = isFirstSystem || isNewSystem;

      if (isNewPage) {
        currentPage++;
        isFirstSystemOnPage = true;
      }

      if (startSystem) {
        const sysLayout = printEl?.['system-layout'] ?? {};
        if (isFirstSystemOnPage) {
          currentSystemTopY = num(sysLayout['top-system-distance'], defaultTopSystemDist);
          isFirstSystemOnPage = false;
        } else {
          // For single-part multi-staff (Case 1), system-distance is measured
          // from the bottom of the last staff to the next system's first staff,
          // so prevBottom must include all staves in the system.
          // For split parts (Case 2), system-distance is from P1's staff bottom
          // and already spans the full inter-system gap including sibling staves.
          const prevSystemH = staffDistFromPrimary && currentStaffDist > 0
            ? STAFF_H + currentStaffDist + STAFF_H
            : STAFF_H;
          const prevBottom = currentSystemTopY + prevSystemH;
          currentSystemTopY = prevBottom + num(sysLayout['system-distance'], defaultSystemDist);
        }
        const sysMargins   = sysLayout['system-margins'] ?? {};
        currentX = leftPageMargin + num(sysMargins['left-margin'], 0);
        isFirstSystem = false;
      }
    }

    // ── Bounds for this visual block ───────────────────────────────────────
    // X positions include leftPageMargin; subtract it before normalizing.
    // Y positions are relative to the top margin; normalize by printable height.
    const boundsY = Math.max(0, currentSystemTopY - PADDING_ABOVE);

    // Update staff-distance for multi-staff systems (e.g., piano grand staff).
    // The value persists across measures within a system and is updated at
    // system breaks where the sibling part declares a new staff-distance.
    const sdEntry = staffDistByMeasure.get(measureNum);
    if (sdEntry !== undefined) currentStaffDist = sdEntry;

    const totalH = currentStaffDist > 0
      ? PADDING_ABOVE + STAFF_H + currentStaffDist + STAFF_H + PADDING_BELOW
      : TOTAL_H;

    const bounds: MeasureBounds = {
      page: currentPage,
      x: (currentX - leftPageMargin) / printableWidth,
      y: boundsY / printableHeight,
      w: effectiveWidth / printableWidth,
      h: totalH / printableHeight,
    };

    // ── Multi-measure rest detection ───────────────────────────────────────
    let multiRestCount = 1;
    const attrsList = toArray(raw.attributes);
    for (const a of attrsList) {
      const mr = a?.['measure-style']?.['multiple-rest'];
      if (mr) { multiRestCount = num(mr, 1); break; }
    }

    // Push the primary (or only) measure
    if (!isImplicit && measureNum > 0) {
      measures.push({
        number: measureNum, notes: [], dynamics: [], bounds,
        ...(multiRestCount > 1 ? { multiRestCount } : {}),
      });
    }

    // Synthesize entries for the collapsed measures and skip Audiveris phantoms
    if (multiRestCount > 1 && measureNum > 0) {
      for (let i = 1; i < multiRestCount; i++) {
        measures.push({
          number: measureNum + i,
          notes: [], dynamics: [],
          bounds: { ...bounds },
        });
      }
      phantomsToSkip = multiRestCount - 1;
    }

    currentX += effectiveWidth;
  }

  // ── Deduplicate measures ────────────────────────────────────────────────────
  // Audiveris sometimes emits duplicate measure numbers (e.g., m.4 twice with
  // different multi-rest counts). Keep the entry with the larger multiRestCount.
  const deduped: OmrMeasure[] = [];
  const seen = new Map<number, number>(); // measureNumber → index in deduped
  for (const m of measures) {
    const existingIdx = seen.get(m.number);
    if (existingIdx !== undefined) {
      const existing = deduped[existingIdx];
      // Replace if the new one has a larger multi-rest span
      if ((m.multiRestCount ?? 1) > (existing.multiRestCount ?? 1)) {
        deduped[existingIdx] = m;
      }
      // Otherwise skip the duplicate
    } else {
      seen.set(m.number, deduped.length);
      deduped.push(m);
    }
  }

  // ── Section labels (rehearsal marks) ──────────────────────────────────────
  // Walk the first part's measures again to find rehearsal marks in their
  // proper measure context, rather than relying on regex ordering.
  const sections: OmrSection[] = [];
  for (const raw of rawMeasures) {
    const measureNum = num(raw['@_number'], 0);
    if (measureNum === 0) continue;
    const directions = toArray(raw.direction);
    for (const dir of directions) {
      const dirType = dir?.['direction-type'];
      if (!dirType) continue;
      const dirTypes = Array.isArray(dirType) ? dirType : [dirType];
      for (const dt of dirTypes) {
        const rehearsal = dt?.rehearsal;
        if (rehearsal) {
          const label = typeof rehearsal === 'object' ? rehearsal['#text'] : String(rehearsal);
          if (label) {
            sections.push({ label: String(label).trim(), measureNumber: measureNum });
          }
        }
      }
    }
  }

  // Sort by measure number to ensure consistent ordering after dedup
  deduped.sort((a, b) => a.number - b.number);

  return { measures: deduped, sections, partName };
}
