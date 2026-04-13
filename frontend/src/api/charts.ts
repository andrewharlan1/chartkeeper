import { api, multipartRequest } from './client';
import { Chart, ChartVersion, Part, VersionDiff, UploadEntry } from '../types';

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
  versionName?: string
): Promise<{ version: ChartVersion; parts: Part[] }> {
  const form = new FormData();
  if (versionName) form.append('versionName', versionName);
  const partTypes: Record<string, string> = {};
  for (const entry of entries) {
    form.append(entry.name, entry.file);
    partTypes[entry.name] = entry.type;
  }
  form.append('partTypes', JSON.stringify(partTypes));
  return multipartRequest(`/charts/${chartId}/versions`, form);
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
