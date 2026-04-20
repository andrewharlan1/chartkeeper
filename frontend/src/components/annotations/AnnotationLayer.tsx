import { MeasureLayoutItem } from '../../types';
import { AnnotationMode, Tool } from '../../hooks/useAnnotationMode';

interface Props {
  partId: string;
  currentPage: number;
  measureLayout: MeasureLayoutItem[];
  canvasWidth: number;
  canvasHeight: number;
  mode: AnnotationMode;
  tool: Tool;
  inkColor: string;
  highlightColor: string;
  textColor: string;
}

/**
 * Phase 2 stub — renders an invisible SVG overlay positioned over the PDF canvas.
 * Will be filled in with drawing/rendering logic in later phases.
 */
export function AnnotationLayer({
  canvasWidth,
  canvasHeight,
}: Props) {
  if (canvasWidth === 0 || canvasHeight === 0) return null;

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
      }}
    />
  );
}
