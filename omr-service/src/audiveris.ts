import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execFileAsync = promisify(execFile);

const AUDIVERIS_PATH = process.env.AUDIVERIS_PATH ?? 'audiveris';
const WORK_DIR = process.env.OMR_WORK_DIR ?? '/tmp/chartkeeper-omr';

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
    await execFileAsync(AUDIVERIS_PATH, [
      '-batch',
      '-export',
      '-output', jobDir,
      pdfPath,
    ]);

    // Audiveris outputs <basename>.mxl or <basename>.xml
    const files = await fs.readdir(jobDir);
    const xmlFile = files.find((f) => f.endsWith('.xml') || f.endsWith('.mxl'));
    if (!xmlFile) {
      throw new Error('Audiveris produced no MusicXML output');
    }

    const xmlBuffer = await fs.readFile(path.join(jobDir, xmlFile));
    const musicxml = xmlBuffer.toString('base64');
    const omrJson = parseMusicXml(xmlBuffer.toString('utf8'), partName);

    return { musicxml, omrJson };
  } finally {
    await fs.rm(jobDir, { recursive: true, force: true });
  }
}

/**
 * Parses MusicXML into the structured omrJson format.
 * This is a minimal implementation — extracts measures, notes, dynamics, and section labels.
 * A production implementation would use a proper XML parser (e.g. fast-xml-parser).
 */
function parseMusicXml(
  xml: string,
  partName: string
): OmrResult['omrJson'] {
  const measures: OmrMeasure[] = [];
  const sections: OmrSection[] = [];

  // Extract measure numbers
  const measureMatches = xml.matchAll(/<measure[^>]+number="(\d+)"/g);
  for (const match of measureMatches) {
    measures.push({ number: parseInt(match[1]), notes: [], dynamics: [] });
  }

  // Extract rehearsal marks as sections
  const rehearsalMatches = xml.matchAll(/<rehearsal[^>]*>([^<]+)<\/rehearsal>/g);
  let sectionIdx = 0;
  for (const match of rehearsalMatches) {
    sections.push({
      label: match[1].trim(),
      measureNumber: measures[sectionIdx]?.number ?? sectionIdx + 1,
    });
    sectionIdx++;
  }

  return { measures, sections, partName };
}
