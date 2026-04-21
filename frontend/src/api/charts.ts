import { api } from './client';
import { Chart } from '../types';

export function getCharts(ensembleId: string): Promise<{ charts: Chart[] }> {
  return api.get(`/charts?ensembleId=${ensembleId}`);
}

export function getChart(id: string): Promise<{ chart: Chart }> {
  return api.get(`/charts/${id}`);
}

export function createChart(data: {
  ensembleId: string;
  name: string;
  composer?: string;
  notes?: string;
}): Promise<{ chart: Chart }> {
  return api.post('/charts', data);
}

export function updateChart(id: string, data: {
  name?: string;
  composer?: string | null;
  notes?: string | null;
}): Promise<{ chart: Chart }> {
  return api.patch(`/charts/${id}`, data);
}

export function deleteChart(id: string): Promise<{ deleted: boolean }> {
  return api.delete(`/charts/${id}`);
}

export interface AnnotationSourcePart {
  partId: string;
  partName: string;
  kind: string;
  annotationCount: number;
  slotIds: string[];
}

export interface AnnotationSourceVersion {
  versionId: string;
  versionName: string;
  sortOrder: number;
  parts: AnnotationSourcePart[];
}

export function getChartAnnotationSources(chartId: string): Promise<{ sources: AnnotationSourceVersion[] }> {
  return api.get(`/charts/${chartId}/annotation-sources`);
}
