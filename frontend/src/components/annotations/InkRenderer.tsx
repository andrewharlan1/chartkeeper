import { Annotation, InkContent, MeasureLayoutItem } from '../../types';

interface Props {
  annotation: Annotation;
  measureLayout: MeasureLayoutItem[];
  currentPage: number;
  canvasWidth: number;
  canvasHeight: number;
}

/** Build a Catmull-Rom smoothed SVG path from normalized points, scaled to canvas. */
export function smoothPath(points: { x: number; y: number }[], cw: number, ch: number): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x * cw} ${points[0].y * ch}`;
  if (points.length === 2) {
    return `M ${points[0].x * cw} ${points[0].y * ch} L ${points[1].x * cw} ${points[1].y * ch}`;
  }

  let d = `M ${points[0].x * cw} ${points[0].y * ch}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Catmull-Rom to cubic bezier control points
    const cp1x = (p1.x + (p2.x - p0.x) / 6) * cw;
    const cp1y = (p1.y + (p2.y - p0.y) / 6) * ch;
    const cp2x = (p2.x - (p3.x - p1.x) / 6) * cw;
    const cp2y = (p2.y - (p3.y - p1.y) / 6) * ch;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x * cw} ${p2.y * ch}`;
  }

  return d;
}

export function InkRenderer({ annotation, canvasWidth, canvasHeight }: Props) {
  const content = annotation.contentJson as InkContent;
  if (!content.strokes || content.strokes.length === 0) return null;

  return (
    <g>
      {content.strokes.map((stroke, i) => (
        <path
          key={i}
          d={smoothPath(stroke.points, canvasWidth, canvasHeight)}
          stroke={stroke.color}
          strokeWidth={stroke.width * canvasWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
}
