import { api, multipartRequest } from './client';
import { Part, PartKind, MeasureLayoutItem, PlayerPart } from '../types';

export function getParts(versionId: string): Promise<{ parts: Part[] }> {
  return api.get(`/parts?versionId=${versionId}`);
}

export function getPart(id: string): Promise<{ part: Part }> {
  return api.get(`/parts/${id}`);
}

export function uploadPart(data: {
  versionId: string;
  name: string;
  file: File;
  kind?: PartKind;
  slotIds?: string[];
}): Promise<{ part: Part }> {
  const form = new FormData();
  form.append('versionId', data.versionId);
  form.append('name', data.name);
  form.append('file', data.file);
  if (data.kind) form.append('kind', data.kind);
  if (data.slotIds?.length) form.append('slotIds', JSON.stringify(data.slotIds));
  return multipartRequest('/parts', form);
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
