import { Annotation, TextContent } from '../../types';

interface Props {
  annotation: Annotation;
  canvasWidth: number;
  canvasHeight: number;
}

export function TextRenderer({ annotation, canvasWidth, canvasHeight }: Props) {
  const content = annotation.contentJson as TextContent;
  const { text, fontSize, color, fontWeight, fontStyle, boundingBox } = content;
  const x = boundingBox.x * canvasWidth;
  const y = boundingBox.y * canvasHeight;
  const size = fontSize * canvasHeight;
  const lines = text.split('\n');

  return (
    <text
      x={x}
      y={y}
      fill={color}
      fontSize={size}
      fontWeight={fontWeight}
      fontStyle={fontStyle}
      dominantBaseline="hanging"
      style={{ pointerEvents: 'none' }}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : size * 1.3}>
          {line}
        </tspan>
      ))}
    </text>
  );
}
