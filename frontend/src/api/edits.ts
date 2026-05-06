import { api } from './client';

export type ValidOperation =
  | { op: 'transpose'; interval: string; scope: 'whole_part' | { measureRange: [number, number] } }
  | { op: 'octave_displace'; direction: 'up' | 'down'; scope: 'whole_part' | { measureRange: [number, number] } }
  | { op: 'instrument_change'; newInstrument: string };

export type ParseResult =
  | { op: ValidOperation }
  | { op: 'unknown'; reason: string };

export interface ApplyResult {
  transformedMusicxml: string;
  rangeWarnings: Array<{ measure: number; pitch: string; reason: string }>;
}

export interface SavedVersion {
  id: string;
  chartId: string;
  name: string;
  privateOwnerUserId: string | null;
  branchLabel: string | null;
  editOrigin: string;
  pdfRenderStatus: string;
}

export function parseEdit(body: {
  naturalLanguage: string;
  contextPartId: string;
  contextVersionId: string;
}): Promise<ParseResult> {
  return api.post('/edits/parse', body);
}

export function applyEdit(body: {
  partId: string;
  versionId: string;
  operation: ValidOperation;
}): Promise<ApplyResult> {
  return api.post('/edits/apply', body);
}

export function saveEdit(body: {
  partId: string;
  parentVersionId: string;
  transformedMusicXml: string;
  operationJson: ValidOperation;
  naturalLanguageInput?: string;
  saveMode: 'personal' | 'ensemble';
  branchLabel?: string;
  versionLabel?: string;
}): Promise<{ version: SavedVersion }> {
  return api.post('/edits/save', body);
}
