import { Annotation, InkContent, MeasureLayoutItem } from '../../types';

interface Props {
  annotation: Annotation;
  measureLayout: MeasureLayoutItem[];
  currentPage: number;
  canvasWidth: number;
  canvasHeight: number;
}

function strokeToPath(points: { x: number; y: number }[], cw: number, ch: number): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return `M ${first.x * cw} ${first.y * ch} ${rest.map(p => `L ${p.x * cw} ${p.y * ch}`).join(' ')}`;
}

export function InkRenderer({ annotation, canvasWidth, canvasHeight }: Props) {
  const content = annotation.contentJson as InkContent;
  if (!content.strokes || content.strokes.length === 0) return null;

  return (
    <g>
      {content.strokes.map((stroke, i) => (
        <path
          key={i}
          d={strokeToPath(stroke.points, canvasWidth, canvasHeight)}
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
