import { useState } from 'react';

export type AnnotationMode = 'read' | 'ink' | 'text' | 'highlight' | 'select' | 'erase';

export function useAnnotationMode() {
  const [mode, setMode] = useState<AnnotationMode>('read');
  const [inkColor, setInkColor] = useState('#000000');
  const [textColor, setTextColor] = useState('#000000');
  const [highlightColor, setHighlightColor] = useState('rgba(253, 224, 71, 0.3)');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  return {
    mode, setMode,
    inkColor, setInkColor,
    textColor, setTextColor,
    highlightColor, setHighlightColor,
    selectedAnnotationId, setSelectedAnnotationId,
  };
}
