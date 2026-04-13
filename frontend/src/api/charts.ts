import { api, multipartRequest } from './client';
import { Chart, ChartVersion, Part, VersionDiff } from '../types';

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
  files: Record<string, File>,
  versionName?: string
): Promise<{ version: ChartVersion; parts: Part[] }> {
  const form = new FormData();
  if (versionName) form.append('versionName', versionName);
  for (const [instrument, file] of Object.entries(files)) {
    form.append(instrument, file);
  }
  return multipartRequest(`/charts/${chartId}/versions`, form);
}

export function restoreVersion(
  chartId: string,
  versionId: string
): Promise<{ restoredVersionId: string }> {
  return api.post(`/charts/${chartId}/versions/${versionId}/restore`);
}
