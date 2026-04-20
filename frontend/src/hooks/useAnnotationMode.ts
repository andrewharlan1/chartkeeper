import { useState, useCallback } from 'react';
import { FontFamily } from '../types';

export type AnnotationMode = 'read' | 'ink' | 'text' | 'highlight' | 'select' | 'erase';

export function useAnnotationMode() {
  const [mode, setModeRaw] = useState<AnnotationMode>('read');
  const [inkColor, setInkColor] = useState('#000000');
  const [textColor, setTextColor] = useState('#000000');
  const [highlightColor, setHighlightColor] = useState('rgba(253, 224, 71, 0.3)');
  const [fontSize, setFontSize] = useState(0.018); // normalized to page height
  const [fontFamily, setFontFamily] = useState<FontFamily>('sans-serif');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  const setMode = useCallback((newMode: AnnotationMode) => {
    setModeRaw(newMode);
    if (newMode !== 'select') setSelectedAnnotationId(null);
  }, []);

  return {
    mode, setMode,
    inkColor, setInkColor,
    textColor, setTextColor,
    highlightColor, setHighlightColor,
    fontSize, setFontSize,
    fontFamily, setFontFamily,
    selectedAnnotationId, setSelectedAnnotationId,
  };
}
