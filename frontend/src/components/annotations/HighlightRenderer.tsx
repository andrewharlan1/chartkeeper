import { Annotation, HighlightContent } from '../../types';

interface Props {
  annotation: Annotation;
  canvasWidth: number;
  canvasHeight: number;
}

export function HighlightRenderer({ annotation, canvasWidth, canvasHeight }: Props) {
  const content = annotation.contentJson as HighlightContent;
  const { boundingBox, color, opacity } = content;

  return (
    <rect
      x={boundingBox.x * canvasWidth}
      y={boundingBox.y * canvasHeight}
      width={boundingBox.width * canvasWidth}
      height={boundingBox.height * canvasHeight}
      fill={color}
      opacity={opacity}
      rx={2}
    />
  );
}
