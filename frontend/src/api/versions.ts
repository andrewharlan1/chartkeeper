import { api } from './client';
import { Version } from '../types';

export function getVersions(chartId: string): Promise<{ versions: Version[] }> {
  return api.get(`/versions?chartId=${chartId}`);
}

export function getVersion(id: string): Promise<{ version: Version }> {
  return api.get(`/versions/${id}`);
}

export function createVersion(data: {
  chartId: string;
  name: string;
  notes?: string;
  seededFromVersionId?: string;
  migrationSources?: { sourcePartId: string; sourceVersionId: string; targetPartId: string }[];
}): Promise<{ version: Version }> {
  return api.post('/versions', data);
}

export function updateVersion(id: string, data: {
  name?: string;
  notes?: string | null;
  isCurrent?: boolean;
}): Promise<{ version: Version }> {
  return api.patch(`/versions/${id}`, data);
}

export function setCurrentVersion(id: string): Promise<{ version: Version }> {
  return api.patch(`/versions/${id}`, { isCurrent: true });
}

export function deleteVersion(id: string): Promise<{ deleted: boolean }> {
  return api.delete(`/versions/${id}`);
}

export interface AnnotationSource {
  versionId: string;
  versionName: string;
  partId: string;
  partName: string;
  annotationCount: number;
}

export interface AnnotationSourcesResponse {
  parts: { id: string; name: string; kind: string }[];
  sources: Record<string, AnnotationSource[]>;
}

export interface MigrationResult {
  instrument: string;
  total: number;
  migrated: number;
  flagged: number;
  skipped: number;
}

export function getAnnotationSources(versionId: string): Promise<AnnotationSourcesResponse> {
  return api.get(`/versions/${versionId}/annotation-sources`);
}

export function getFlaggedCount(versionId: string): Promise<{ flaggedCount: number }> {
  return api.get(`/versions/${versionId}/flagged-count`);
}

export function migrateAnnotations(
  versionId: string,
  migrations: { targetPartId: string; sourcePartId: string }[],
): Promise<{ results: MigrationResult[] }> {
  return api.post(`/versions/${versionId}/migrate`, { migrations });
}

// ── Cross-instrument migration ──────────────────────────────────────────

export interface MigrationCandidate {
  partId: string;
  partName: string;
  instrumentSlotIds: string[];
  isSameInstrument: boolean;
  versions: {
    versionId: string;
    versionLabel: string;
    annotationCount: number;
    isMostRecent: boolean;
  }[];
}

export function getMigrationCandidates(
  ensembleId: string,
  partId: string,
): Promise<{ candidates: MigrationCandidate[] }> {
  return api.get(`/ensembles/${ensembleId}/migration-candidates?partId=${partId}`);
}

export interface MigrationStatusJob {
  id: string;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  sources: { sourcePartId: string; sourceVersionId: string; targetPartId: string }[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MigrationStatusResponse {
  status: 'none' | 'pending' | 'processing' | 'complete' | 'partial' | 'failed';
  jobs: MigrationStatusJob[];
}

export function getMigrationStatus(versionId: string): Promise<MigrationStatusResponse> {
  return api.get(`/versions/${versionId}/migration-status`);
}

export function enqueueCrossMigration(
  versionId: string,
  sources: { sourcePartId: string; sourceVersionId: string; targetPartId: string }[],
): Promise<{ jobId: string }> {
  return api.post(`/versions/${versionId}/enqueue-cross-migration`, { sources });
}
