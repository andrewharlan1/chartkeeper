import { api, multipartRequest } from './client';
import { Chart, ChartVersion, Part, VersionDiff, UploadEntry, PartAssignment, PlayerPart } from '../types';

export function createChart(data: {
  ensembleId: string;
  title?: string;
  composer?: string;
}): Promise<{ chart: Chart }> {
  return api.post('/charts', data);
}

export function getChart(id: string): Promise<{ chart: Chart; activeVersion: ChartVersion | null }> {
  return api.get(`/charts/${id}`);
}

export function getVersions(chartId: string): Promise<{ versions: ChartVersion[] }> {
  return api.get(`/charts/${chartId}/versions`);
}

export function getVersion(
  chartId: string,
  versionId: string
): Promise<{ version: ChartVersion; parts: Part[]; diff: VersionDiff | null }> {
  return api.get(`/charts/${chartId}/versions/${versionId}`);
}

export function uploadVersion(
  chartId: string,
  entries: UploadEntry[],
  versionName?: string,
  inheritedPartNames?: string[]
): Promise<{ version: ChartVersion; parts: Part[] }> {
  const form = new FormData();
  if (versionName) form.append('versionName', versionName);

  const partTypes: Record<string, string> = {};
  const linkEntries: Array<{ name: string; url: string }> = [];

  for (const entry of entries) {
    partTypes[entry.name] = entry.type;
    if (entry.type === 'link') {
      if (entry.url) linkEntries.push({ name: entry.name, url: entry.url });
    } else if (entry.file) {
      form.append(entry.name, entry.file);
    }
  }
  form.append('partTypes', JSON.stringify(partTypes));
  if (linkEntries.length > 0) form.append('linkEntries', JSON.stringify(linkEntries));
  if (inheritedPartNames) form.append('inheritedPartNames', JSON.stringify(inheritedPartNames));

  return multipartRequest(`/charts/${chartId}/versions`, form);
}

export function getAssignments(chartId: string): Promise<{ assignments: PartAssignment[] }> {
  return api.get(`/charts/${chartId}/assignments`);
}

export function assignPart(
  chartId: string,
  instrumentName: string,
  userId: string
): Promise<{ assignment: PartAssignment }> {
  return api.post(`/charts/${chartId}/assignments`, { instrumentName, userId });
}

export function unassignPart(chartId: string, assignmentId: string): Promise<{ deleted: boolean }> {
  return api.delete(`/charts/${chartId}/assignments/${assignmentId}`);
}

export function getPlayerParts(): Promise<{ parts: PlayerPart[] }> {
  return api.get('/player/parts');
}

export function restoreVersion(
  chartId: string,
  versionId: string
): Promise<{ restoredVersionId: string }> {
  return api.post(`/charts/${chartId}/versions/${versionId}/restore`);
}

export function deleteChart(chartId: string): Promise<{ deleted: boolean }> {
  return api.delete(`/charts/${chartId}`);
}

export function deleteVersion(chartId: string, versionId: string): Promise<{ deleted: boolean }> {
  return api.delete(`/charts/${chartId}/versions/${versionId}`);
}

export function deletePart(partId: string): Promise<{ deleted: boolean }> {
  return api.delete(`/parts/${partId}`);
}
