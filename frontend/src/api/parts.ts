import { api, multipartRequest } from './client';
import { Part, PartKind, MeasureLayoutItem, PlayerPart } from '../types';

export function getParts(versionId: string): Promise<{ parts: Part[] }> {
  return api.get(`/parts?versionId=${versionId}`);
}

export function getPart(id: string): Promise<{ part: Part }> {
  return api.get(`/parts/${id}`);
}

export type InstrumentAssignment =
  | { existingSlotId: string }
  | { newInstrumentName: string };

export function uploadPart(data: {
  versionId: string;
  name: string;
  file: File | null;
  kind?: PartKind;
  slotIds?: string[];
  instrumentAssignments?: InstrumentAssignment[];
  linkUrl?: string;
  audioDurationSeconds?: number;
}): Promise<{ part: Part }> {
  const form = new FormData();
  form.append('versionId', data.versionId);
  form.append('name', data.name);
  if (data.file) form.append('file', data.file);
  if (data.kind) form.append('kind', data.kind);
  // Prefer instrumentAssignments if available, fall back to slotIds
  if (data.instrumentAssignments?.length) {
    form.append('instrumentAssignments', JSON.stringify(data.instrumentAssignments));
  } else if (data.slotIds?.length) {
    form.append('slotIds', JSON.stringify(data.slotIds));
  }
  if (data.linkUrl) form.append('linkUrl', data.linkUrl);
  if (data.audioDurationSeconds) form.append('audioDurationSeconds', String(data.audioDurationSeconds));
  return multipartRequest('/parts', form);
}

export function updatePart(id: string, data: {
  name?: string;
  slotIds?: string[];
  instrumentAssignments?: InstrumentAssignment[];
}): Promise<{ part: Part }> {
  return api.patch(`/parts/${id}`, data);
}

export function deletePart(id: string): Promise<{ deleted: boolean }> {
  return api.delete(`/parts/${id}`);
}

export function getMeasureLayout(partId: string): Promise<{ measureLayout: MeasureLayoutItem[] }> {
  return api.get(`/parts/${partId}/measure-layout`);
}

export function getMyParts(): Promise<{ parts: PlayerPart[] }> {
  return api.get('/player/my-parts');
}

export interface NoteOperation {
  measure: number;
  operation: string;
  description: string;
}

export interface SlotDiff {
  slotId: string | null;
  instrumentName: string;
  sourcePartId: string;
  sourceVersionId: string | null;
  sourceVersionName: string;
  changedMeasures: number[];
  changeDescriptions: Record<string, string>;
  changedMeasureBounds: Record<string, { x: number; y: number; w: number; h: number; page: number }>;
  changelog: string;
  computedAt: string | null;
  noteOperations?: NoteOperation[];
}

export interface PartDiffResponse {
  diffs: SlotDiff[];
}

// Legacy single-diff shape for backward compat in useDiff consumers
export interface PartDiffData {
  changedMeasures: number[];
  changeDescriptions: Record<string, string>;
  changedMeasureBounds: Record<string, { x: number; y: number; w: number; h: number; page: number }>;
  changelog: string;
  comparedToVersionId: string | null;
  comparedToVersionName: string;
}

export function getPartDiffs(partId: string): Promise<PartDiffResponse> {
  return api.get(`/parts/${partId}/diff`);
}

export function getPartDiff(partId: string): Promise<PartDiffData> {
  return (api.get(`/parts/${partId}/diff`) as Promise<PartDiffResponse>).then((res) => {
    if (res.diffs.length === 0) {
      return {
        changedMeasures: [],
        changeDescriptions: {},
        changedMeasureBounds: {},
        changelog: '',
        comparedToVersionId: null,
        comparedToVersionName: '',
      };
    }
    // Union all diffs into a single legacy-shaped response
    const allChanged = new Set<number>();
    const allDescriptions: Record<string, string> = {};
    const allBounds: Record<string, { x: number; y: number; w: number; h: number; page: number }> = {};
    const changelogs: string[] = [];
    let sourceVersionId: string | null = null;
    let sourceVersionName = '';

    for (const d of res.diffs) {
      for (const m of d.changedMeasures) allChanged.add(m);
      Object.assign(allDescriptions, d.changeDescriptions);
      Object.assign(allBounds, d.changedMeasureBounds);
      if (d.changelog) changelogs.push(d.changelog);
      sourceVersionId = d.sourceVersionId;
      sourceVersionName = d.sourceVersionName;
    }

    return {
      changedMeasures: [...allChanged].sort((a, b) => a - b),
      changeDescriptions: allDescriptions,
      changedMeasureBounds: allBounds,
      changelog: changelogs.join('\n'),
      comparedToVersionId: sourceVersionId,
      comparedToVersionName: sourceVersionName,
    };
  });
}

export interface MigrateFromResult {
  migratedCount: number;
  flaggedCount: number;
  skippedCount: number;
  total: number;
  instrument: string;
}

export function migrateFrom(targetPartId: string, sourcePartId: string): Promise<MigrateFromResult> {
  return api.post(`/parts/${targetPartId}/migrate-from`, { sourcePartId });
}
