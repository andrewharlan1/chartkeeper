import { useState, useEffect, useCallback } from 'react';
import {
  getAnnotationSources,
  migrateAnnotations,
  AnnotationSource,
  MigrationResult,
} from '../api/versions';

export interface MigrationPart {
  id: string;
  name: string;
  kind: string;
  sources: AnnotationSource[];
  /** Currently selected source part ID, or null for "None (start fresh)" */
  selectedSourcePartId: string | null;
}

interface UseMigrationReturn {
  parts: MigrationPart[];
  loading: boolean;
  migrating: boolean;
  error: string | null;
  results: MigrationResult[] | null;
  hasAnySources: boolean;
  setSelection: (targetPartId: string, sourcePartId: string | null) => void;
  setAllFromPrevious: () => void;
  setAllNone: () => void;
  runMigration: () => Promise<MigrationResult[]>;
}

export function useMigration(versionId: string | null): UseMigrationReturn {
  const [parts, setParts] = useState<MigrationPart[]>([]);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<MigrationResult[] | null>(null);

  useEffect(() => {
    if (!versionId) return;
    setLoading(true);
    setError(null);
    getAnnotationSources(versionId)
      .then(({ parts: partList, sources }) => {
        const migrationParts: MigrationPart[] = partList.map(p => {
          const partSources = sources[p.id] ?? [];
          // Default: most recent version with annotations, or null
          const defaultSource = partSources.length > 0 ? partSources[0].partId : null;
          return {
            id: p.id,
            name: p.name,
            kind: p.kind,
            sources: partSources,
            selectedSourcePartId: defaultSource,
          };
        });
        setParts(migrationParts);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load annotation sources'))
      .finally(() => setLoading(false));
  }, [versionId]);

  const hasAnySources = parts.some(p => p.sources.length > 0);

  const setSelection = useCallback((targetPartId: string, sourcePartId: string | null) => {
    setParts(prev => prev.map(p =>
      p.id === targetPartId ? { ...p, selectedSourcePartId: sourcePartId } : p,
    ));
  }, []);

  const setAllFromPrevious = useCallback(() => {
    setParts(prev => prev.map(p => ({
      ...p,
      selectedSourcePartId: p.sources.length > 0 ? p.sources[0].partId : null,
    })));
  }, []);

  const setAllNone = useCallback(() => {
    setParts(prev => prev.map(p => ({ ...p, selectedSourcePartId: null })));
  }, []);

  const runMigration = useCallback(async (): Promise<MigrationResult[]> => {
    if (!versionId) throw new Error('No version ID');
    const migrations = parts
      .filter(p => p.selectedSourcePartId != null)
      .map(p => ({ targetPartId: p.id, sourcePartId: p.selectedSourcePartId! }));

    if (migrations.length === 0) return [];

    setMigrating(true);
    setError(null);
    try {
      const { results: r } = await migrateAnnotations(versionId, migrations);
      setResults(r);
      return r;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Migration failed';
      setError(msg);
      throw err;
    } finally {
      setMigrating(false);
    }
  }, [versionId, parts]);

  return {
    parts,
    loading,
    migrating,
    error,
    results,
    hasAnySources,
    setSelection,
    setAllFromPrevious,
    setAllNone,
    runMigration,
  };
}
