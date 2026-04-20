import { AnnotationMode, Tool } from '../../hooks/useAnnotationMode';
import { ColorPicker } from './ColorPicker';
import { SaveStatusIndicator, SaveStatus } from './SaveStatusIndicator';

const INK_COLORS = [
  '#000000', '#DC2626', '#2563EB', '#16A34A', '#EA580C', '#9333EA', '#DB2777',
];

const HIGHLIGHT_COLORS = [
  'rgba(253, 224, 71, 0.3)',
  'rgba(251, 207, 232, 0.5)',
  'rgba(187, 247, 208, 0.4)',
  'rgba(191, 219, 254, 0.4)',
  'rgba(233, 213, 255, 0.4)',
  'rgba(254, 215, 170, 0.4)',
  'rgba(229, 231, 235, 0.5)',
];

interface Props {
  mode: AnnotationMode;
  onModeChange: (mode: AnnotationMode) => void;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  inkColor: string;
  onInkColorChange: (color: string) => void;
  textColor: string;
  onTextColorChange: (color: string) => void;
  highlightColor: string;
  onHighlightColorChange: (color: string) => void;
  saveStatus: SaveStatus;
}

const MODES: { value: AnnotationMode; label: string }[] = [
  { value: 'read', label: 'Read' },
  { value: 'draw', label: 'Draw' },
  { value: 'select', label: 'Select' },
  { value: 'erase', label: 'Erase' },
];

const TOOLS: { value: Tool; label: string }[] = [
  { value: 'ink', label: 'Ink' },
  { value: 'text', label: 'Text' },
  { value: 'highlight', label: 'Highlight' },
];

export function AnnotationToolbar({
  mode, onModeChange,
  tool, onToolChange,
  inkColor, onInkColorChange,
  textColor, onTextColorChange,
  highlightColor, onHighlightColorChange,
  saveStatus,
}: Props) {
  const activeColors =
    tool === 'ink' ? INK_COLORS :
    tool === 'text' ? INK_COLORS :
    HIGHLIGHT_COLORS;

  const activeColor =
    tool === 'ink' ? inkColor :
    tool === 'text' ? textColor :
    highlightColor;

  const onColorChange =
    tool === 'ink' ? onInkColorChange :
    tool === 'text' ? onTextColorChange :
    onHighlightColorChange;

  return (
    <div style={{
      position: 'sticky',
      top: 8,
      zIndex: 50,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 0,
      marginBottom: 12,
      pointerEvents: 'none',
    }}>
      {/* Mode row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        background: '#fff',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 3,
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        pointerEvents: 'auto',
      }}>
        {MODES.map(m => (
          <button
            key={m.value}
            onClick={() => onModeChange(m.value)}
            style={{
              height: 36,
              padding: '0 16px',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: 'inherit',
              border: 'none',
              borderRadius: 9,
              cursor: 'pointer',
              transition: 'all 0.12s',
              background: mode === m.value ? '#1f2937' : 'transparent',
              color: mode === m.value ? '#fff' : '#374151',
            }}
          >
            {m.label}
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
        <SaveStatusIndicator status={saveStatus} />
      </div>

      {/* Tool row — only when Draw mode */}
      {mode === 'draw' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: '#fff',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '4px 10px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          marginTop: 4,
          pointerEvents: 'auto',
          animation: 'toolRowSlideIn 0.15s ease-out',
        }}>
          {/* Tool buttons */}
          {TOOLS.map(t => (
            <button
              key={t.value}
              onClick={() => onToolChange(t.value)}
              style={{
                height: 30,
                padding: '0 12px',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'inherit',
                border: 'none',
                borderRadius: 7,
                cursor: 'pointer',
                transition: 'all 0.12s',
                background: tool === t.value ? '#e5e7eb' : 'transparent',
                color: tool === t.value ? '#111827' : '#6b7280',
              }}
            >
              {t.label}
            </button>
          ))}

          {/* Separator */}
          <div style={{ width: 1, height: 18, background: 'var(--border)' }} />

          {/* Color picker */}
          <ColorPicker
            colors={activeColors}
            selected={activeColor}
            onChange={onColorChange}
          />
        </div>
      )}

      {/* Keyframe for slide-in animation */}
      <style>{`
        @keyframes toolRowSlideIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
