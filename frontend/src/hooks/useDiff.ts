import { useEffect, useState, useRef } from 'react';
import { getPartDiffs, SlotDiff } from '../api/parts';

export interface DiffData {
  changedMeasures: number[];
  changeDescriptions: Record<string, string>;
  changedMeasureBounds: Record<string, { x: number; y: number; w: number; h: number; page: number }>;
  changelog: string;
  comparedToVersionName: string;
}

/**
 * Fetch per-slot diffs for a part. Returns array of SlotDiff objects.
 * For the common case (single slot), the array has one element.
 * For multi-slot parts, multiple elements. Empty array = no diffs.
 */
export function useDiffs(partId: string | null): {
  diffs: SlotDiff[];
  isLoading: boolean;
  error: string | null;
} {
  const [diffs, setDiffs] = useState<SlotDiff[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef<Record<string, SlotDiff[]>>({});

  useEffect(() => {
    if (!partId) {
      setDiffs([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    if (cache.current[partId] !== undefined) {
      setDiffs(cache.current[partId]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getPartDiffs(partId)
      .then((data) => {
        if (cancelled) return;
        cache.current[partId] = data.diffs;
        setDiffs(data.diffs);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        cache.current[partId] = [];
        setDiffs([]);
        setError(err instanceof Error ? err.message : 'Failed to load diff');
        setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [partId]);

  return { diffs, isLoading, error };
}

/**
 * Legacy hook — unions all slot diffs into a single DiffData.
 * Retained for backward compatibility with existing diff highlight layers.
 */
export function useDiff(partId: string | null): {
  diff: DiffData | null;
  isLoading: boolean;
  error: string | null;
} {
  const { diffs, isLoading, error } = useDiffs(partId);

  if (diffs.length === 0) {
    return { diff: null, isLoading, error };
  }

  // Union all slot diffs into one
  const allChanged = new Set<number>();
  const allDescriptions: Record<string, string> = {};
  const allBounds: Record<string, { x: number; y: number; w: number; h: number; page: number }> = {};
  const changelogs: string[] = [];
  let comparedToVersionName = '';

  for (const d of diffs) {
    for (const m of d.changedMeasures) allChanged.add(m);
    Object.assign(allDescriptions, d.changeDescriptions);
    Object.assign(allBounds, d.changedMeasureBounds);
    if (d.changelog) changelogs.push(d.changelog);
    comparedToVersionName = d.sourceVersionName;
  }

  const hasMeaningfulDiff = allChanged.size > 0;

  return {
    diff: hasMeaningfulDiff ? {
      changedMeasures: [...allChanged].sort((a, b) => a - b),
      changeDescriptions: allDescriptions,
      changedMeasureBounds: allBounds,
      changelog: changelogs.join('\n'),
      comparedToVersionName,
    } : null,
    isLoading,
    error,
  };
}
