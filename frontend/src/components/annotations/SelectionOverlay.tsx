import { PointerEvent as ReactPointerEvent } from 'react';
import { Annotation, InkContent, HighlightContent, TextContent } from '../../types';

export type HandlePosition = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_SIZE = 6;
const ACCENT = '#7c6ff7';
const PAD = 4;

/** Returns normalized (0-1) bounding box for any annotation type. */
export function getAnnotationBounds(a: Annotation): { x: number; y: number; w: number; h: number } | null {
  if (a.kind === 'ink') {
    const c = a.contentJson as InkContent;
    if (!c.boundingBox) return null;
    return { x: c.boundingBox.x, y: c.boundingBox.y, w: c.boundingBox.width, h: c.boundingBox.height };
  }
  if (a.kind === 'highlight') {
    const c = a.contentJson as HighlightContent;
    return { x: c.boundingBox.x, y: c.boundingBox.y, w: c.boundingBox.width, h: c.boundingBox.height };
  }
  if (a.kind === 'text') {
    const c = a.contentJson as TextContent;
    return { x: c.boundingBox.x, y: c.boundingBox.y, w: c.boundingBox.widthPageUnits, h: c.boundingBox.heightPageUnits };
  }
  return null;
}

const HANDLE_CURSORS: Record<HandlePosition, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
};

interface Props {
  annotation: Annotation;
  canvasWidth: number;
  canvasHeight: number;
  dragOffset?: { dx: number; dy: number } | null;
  resizeBounds?: { x: number; y: number; w: number; h: number } | null;
  onBodyPointerDown: (e: ReactPointerEvent) => void;
  onHandlePointerDown: (e: ReactPointerEvent, handle: HandlePosition) => void;
}

export function SelectionOverlay({
  annotation, canvasWidth, canvasHeight,
  dragOffset, resizeBounds,
  onBodyPointerDown, onHandlePointerDown,
}: Props) {
  const rawBounds = getAnnotationBounds(annotation);
  if (!rawBounds) return null;

  let bx: number, by: number, bw: number, bh: number;
  if (resizeBounds) {
    bx = resizeBounds.x; by = resizeBounds.y; bw = resizeBounds.w; bh = resizeBounds.h;
  } else {
    bx = rawBounds.x; by = rawBounds.y; bw = rawBounds.w; bh = rawBounds.h;
    if (dragOffset) { bx += dragOffset.dx; by += dragOffset.dy; }
  }

  const x = bx * canvasWidth;
  const y = by * canvasHeight;
  const w = bw * canvasWidth;
  const h = bh * canvasHeight;

  const rx = x - PAD;
  const ry = y - PAD;
  const rw = w + PAD * 2;
  const rh = h + PAD * 2;

  const handlePositions: { pos: HandlePosition; cx: number; cy: number }[] = [
    { pos: 'nw', cx: rx, cy: ry },
    { pos: 'n', cx: rx + rw / 2, cy: ry },
    { pos: 'ne', cx: rx + rw, cy: ry },
    { pos: 'e', cx: rx + rw, cy: ry + rh / 2 },
    { pos: 'se', cx: rx + rw, cy: ry + rh },
    { pos: 's', cx: rx + rw / 2, cy: ry + rh },
    { pos: 'sw', cx: rx, cy: ry + rh },
    { pos: 'w', cx: rx, cy: ry + rh / 2 },
  ];

  return (
    <g style={{ animation: 'selectionFadeIn 0.1s ease-out' }}>
      {/* Dashed bounding box */}
      <rect
        x={rx} y={ry} width={Math.max(rw, 0)} height={Math.max(rh, 0)}
        fill="none" stroke={ACCENT} strokeWidth={1.5}
        strokeDasharray="4 3"
        style={{ pointerEvents: 'none' }}
      />

      {/* Invisible body area for move dragging */}
      <rect
        x={x} y={y} width={Math.max(w, 1)} height={Math.max(h, 1)}
        fill="transparent"
        style={{ cursor: 'grab' }}
        onPointerDown={e => { e.stopPropagation(); onBodyPointerDown(e); }}
      />

      {/* 8 resize handles */}
      {handlePositions.map(hp => (
        <rect
          key={hp.pos}
          x={hp.cx - HANDLE_SIZE / 2}
          y={hp.cy - HANDLE_SIZE / 2}
          width={HANDLE_SIZE}
          height={HANDLE_SIZE}
          fill="white"
          stroke={ACCENT}
          strokeWidth={1.5}
          rx={1}
          style={{ cursor: HANDLE_CURSORS[hp.pos] }}
          onPointerDown={e => { e.stopPropagation(); onHandlePointerDown(e, hp.pos); }}
        />
      ))}
    </g>
  );
}
