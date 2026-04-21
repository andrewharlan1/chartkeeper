import { useCallback, useMemo } from 'react';

export function useDiffSeen(partId: string | null, versionId: string | null): {
  hasSeen: boolean;
  markSeen: () => void;
} {
  const key = partId && versionId ? `scorva:diff-seen:${partId}:${versionId}` : null;

  const hasSeen = useMemo(() => {
    if (!key) return true; // no key → treat as seen (no animation)
    try {
      return sessionStorage.getItem(key) === 'true';
    } catch {
      return false;
    }
  }, [key]);

  const markSeen = useCallback(() => {
    if (!key) return;
    try {
      sessionStorage.setItem(key, 'true');
    } catch {
      // sessionStorage unavailable
    }
  }, [key]);

  return { hasSeen, markSeen };
}
