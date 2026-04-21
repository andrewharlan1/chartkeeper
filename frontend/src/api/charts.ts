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

export interface MigrationSourcePart {
  partId: string;
  instrumentName: string;
  instrumentIcon: string;
  annotationCount: number;
  annotationPreview: Array<{ measureNumber: number | null; kind: string; content?: string }>;
}

export interface MigrationSourceVersion {
  versionId: string;
  versionName: string;
  createdAt: string;
  parts: MigrationSourcePart[];
}

export function getChartMigrationSources(chartId: string): Promise<{ versions: MigrationSourceVersion[] }> {
  return api.get(`/charts/${chartId}/migration-sources`);
}

// ── Instrument-centric chart view ────────────────────────────────────────

export interface InstrumentUser {
  userId: string;
  name: string | null;
  isDummy: boolean;
}

export interface InstrumentPart {
  partId: string;
  name: string;
  kind: string;
  annotationCount: number;
  diffStatus: { changedMeasureCount: number } | null;
}

export interface PreviousVersionPart {
  partId: string;
  name: string;
  versionId: string;
  versionName: string;
}

export interface InstrumentRow {
  slotId: string;
  instrumentName: string;
  section: string | null;
  sortOrder: number;
  assignedUsers: InstrumentUser[];
  currentParts: InstrumentPart[];
  previousVersionParts: PreviousVersionPart[];
}

export interface InstrumentViewResponse {
  chart: { id: string; name: string; composer: string | null; ensembleId: string };
  version: { id: string; name: string; isCurrent: boolean };
  instruments: InstrumentRow[];
  scoreParts: InstrumentPart[];
}

export function getChartVersionInstruments(
  chartId: string, versionId: string,
): Promise<InstrumentViewResponse> {
  return api.get(`/charts/${chartId}/versions/${versionId}/instruments`);
}
