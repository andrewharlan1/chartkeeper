import { useEffect, useRef, useState } from 'react';
import { MeasureLayoutItem } from '../../types';
import { useDiff } from '../../hooks/useDiff';
import { useDiffSeen } from '../../hooks/useDiffSeen';

interface Props {
  partId: string;
  versionId: string;
  currentPage: number;
  measureLayout: MeasureLayoutItem[];
  canvasWidth: number;
  canvasHeight: number;
  enabled: boolean;
  onDiffInfo?: (info: { count: number; comparedToVersionName: string; changelog: string } | null) => void;
}

const HIGHLIGHT_COLOR = 'rgba(253, 224, 71, 0.35)';
const FADE_DURATION_MS = 1000;

export function DiffHighlightLayer({
  partId, versionId, currentPage, measureLayout,
  canvasWidth, canvasHeight, enabled, onDiffInfo,
}: Props) {
  const { diff } = useDiff(partId);
  const { hasSeen, markSeen } = useDiffSeen(partId, versionId);
  const [opacity, setOpacity] = useState(hasSeen ? 1 : 0);
  const fadeStarted = useRef(false);

  // Report diff info to parent
  useEffect(() => {
    if (diff) {
      onDiffInfo?.({
        count: diff.changedMeasures.length,
        comparedToVersionName: diff.comparedToVersionName,
        changelog: diff.changelog,
      });
    } else {
      onDiffInfo?.(null);
    }
  }, [diff, onDiffInfo]);

  // Fade-in animation on first view
  useEffect(() => {
    if (!diff || !enabled || hasSeen || fadeStarted.current) return;
    fadeStarted.current = true;
    // Start fade-in
    const start = performance.now();
    let raf: number;
    function animate(now: number) {
      const progress = Math.min(1, (now - start) / FADE_DURATION_MS);
      setOpacity(progress);
      if (progress < 1) {
        raf = requestAnimationFrame(animate);
      } else {
        markSeen();
      }
    }
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [diff, enabled, hasSeen, markSeen]);

  // If already seen, show at full opacity
  useEffect(() => {
    if (hasSeen) setOpacity(1);
  }, [hasSeen]);

  if (!diff || !enabled || canvasWidth === 0) return null;

  // Build measure number → bounding box lookup from measureLayout
  const measureBounds = new Map<number, MeasureLayoutItem>();
  for (const m of measureLayout) {
    if (m.page === currentPage && !measureBounds.has(m.measureNumber)) {
      measureBounds.set(m.measureNumber, m);
    }
  }

  // Also use changedMeasureBounds from diff data as fallback
  const changedBounds = diff.changedMeasureBounds ?? {};

  return (
    <svg
      width={canvasWidth}
      height={canvasHeight}
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        opacity,
      }}
    >
      {diff.changedMeasures.map(measureNum => {
        // Try measureLayout first, then diff bounds
        const ml = measureBounds.get(measureNum);
        const db = changedBounds[String(measureNum)];

        let x: number, y: number, w: number, h: number;
        if (ml) {
          x = ml.x; y = ml.y; w = ml.w; h = ml.h;
        } else if (db && db.page === currentPage) {
          x = db.x; y = db.y; w = db.w; h = db.h;
        } else {
          // Measure not on this page or no bounds available
          return null;
        }

        return (
          <rect
            key={measureNum}
            x={x * canvasWidth}
            y={y * canvasHeight}
            width={w * canvasWidth}
            height={h * canvasHeight}
            fill={HIGHLIGHT_COLOR}
            rx={2}
          />
        );
      })}
    </svg>
  );
}
