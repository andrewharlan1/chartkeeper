import { AnnotationMode } from '../../hooks/useAnnotationMode';
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
  { value: 'ink', label: 'Ink' },
  { value: 'text', label: 'Text' },
  { value: 'highlight', label: 'Highlight' },
  { value: 'select', label: 'Select' },
  { value: 'erase', label: 'Erase' },
];

const ACCENT = '#7c6ff7';
const ACCENT_BG = 'rgba(124, 111, 247, 0.22)';
const ACCENT_BORDER = 'rgba(124, 111, 247, 0.4)';
const SURFACE = '#16152a';
const SURFACE_BORDER = 'rgba(255,255,255,0.08)';

export function AnnotationToolbar({
  mode, onModeChange,
  inkColor, onInkColorChange,
  textColor, onTextColorChange,
  highlightColor, onHighlightColorChange,
  saveStatus,
}: Props) {
  // Determine which color palette and handler to show
  const showColors = mode === 'ink' || mode === 'text' || mode === 'highlight';
  const activeColors = mode === 'highlight' ? HIGHLIGHT_COLORS : INK_COLORS;
  const activeColor =
    mode === 'ink' ? inkColor :
    mode === 'text' ? textColor :
    highlightColor;
  const onColorChange =
    mode === 'ink' ? onInkColorChange :
    mode === 'text' ? onTextColorChange :
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
        background: SURFACE,
        border: `1px solid ${SURFACE_BORDER}`,
        borderRadius: 12,
        padding: 3,
        boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
        pointerEvents: 'auto',
      }}>
        {MODES.map(m => (
          <button
            key={m.value}
            onClick={() => onModeChange(m.value)}
            style={{
              height: 34,
              padding: '0 14px',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'inherit',
              border: mode === m.value ? `1px solid ${ACCENT_BORDER}` : '1px solid transparent',
              borderRadius: 9,
              cursor: 'pointer',
              transition: 'all 0.12s',
              background: mode === m.value ? ACCENT_BG : 'transparent',
              color: mode === m.value ? '#c4bcff' : '#777',
            }}
          >
            {m.label}
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: SURFACE_BORDER, margin: '0 4px' }} />
        <SaveStatusIndicator status={saveStatus} />
      </div>

      {/* Color picker row — shown for ink, text, highlight */}
      {showColors && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: SURFACE,
          border: `1px solid ${SURFACE_BORDER}`,
          borderRadius: 10,
          padding: '5px 12px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          marginTop: 4,
          pointerEvents: 'auto',
          animation: 'toolRowSlideIn 0.15s ease-out',
        }}>
          {activeColors.map(c => {
            const isActive = c === activeColor;
            return (
              <button
                key={c}
                onClick={() => onColorChange(c)}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 99,
                  border: 'none',
                  outline: isActive ? `2px solid ${ACCENT}` : '2px solid transparent',
                  outlineOffset: 2,
                  background: c,
                  cursor: 'pointer',
                  padding: 0,
                  boxSizing: 'border-box',
                  transition: 'outline-color 0.1s',
                  flexShrink: 0,
                  boxShadow: isActive ? `0 0 8px ${ACCENT}44` : 'none',
                }}
              />
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes toolRowSlideIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
