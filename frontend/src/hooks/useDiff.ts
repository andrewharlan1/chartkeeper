import { useEffect, useState, useRef } from 'react';
import { getPartDiff, PartDiffData } from '../api/parts';

export interface DiffData {
  changedMeasures: number[];
  changeDescriptions: Record<string, string>;
  changedMeasureBounds: Record<string, { x: number; y: number; w: number; h: number; page: number }>;
  changelog: string;
  comparedToVersionName: string;
}

export function useDiff(partId: string | null): {
  diff: DiffData | null;
  isLoading: boolean;
  error: string | null;
} {
  const [diff, setDiff] = useState<DiffData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef<Record<string, DiffData | null>>({});

  useEffect(() => {
    if (!partId) {
      setDiff(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    if (cache.current[partId] !== undefined) {
      setDiff(cache.current[partId]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getPartDiff(partId)
      .then((data: PartDiffData) => {
        if (cancelled) return;
        const result = data.changedMeasures.length > 0 ? {
          changedMeasures: data.changedMeasures,
          changeDescriptions: data.changeDescriptions,
          changedMeasureBounds: data.changedMeasureBounds,
          changelog: data.changelog,
          comparedToVersionName: data.comparedToVersionName,
        } : null;
        cache.current[partId] = result;
        setDiff(result);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        cache.current[partId] = null;
        setDiff(null);
        setError(err instanceof Error ? err.message : 'Failed to load diff');
        setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [partId]);

  return { diff, isLoading, error };
}
