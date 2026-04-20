import { AnnotationMode } from '../../hooks/useAnnotationMode';
import { FontFamily } from '../../types';
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

const FONT_SIZES = [0.012, 0.015, 0.018, 0.022, 0.028, 0.036, 0.048];
const FONT_SIZE_LABELS = ['10', '12', '14', '18', '22', '28', '36'];

const FONT_FAMILIES: { value: FontFamily; label: string }[] = [
  { value: 'sans-serif', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Mono' },
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
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  fontFamily: FontFamily;
  onFontFamilyChange: (family: FontFamily) => void;
  saveStatus: SaveStatus;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
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

const subRowStyle: React.CSSProperties = {
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
};

const smallBtnBase: React.CSSProperties = {
  height: 26,
  padding: '0 8px',
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'inherit',
  borderRadius: 6,
  cursor: 'pointer',
  transition: 'all 0.12s',
  border: 'none',
};

export function AnnotationToolbar({
  mode, onModeChange,
  inkColor, onInkColorChange,
  textColor, onTextColorChange,
  highlightColor, onHighlightColorChange,
  fontSize, onFontSizeChange,
  fontFamily, onFontFamilyChange,
  saveStatus,
  canUndo, canRedo, onUndo, onRedo,
}: Props) {
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

  // Find current font size index for +/- buttons
  const sizeIdx = FONT_SIZES.indexOf(fontSize);
  const sizeLabel = sizeIdx >= 0 ? FONT_SIZE_LABELS[sizeIdx] : Math.round(fontSize * 1000).toString();

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

        {/* Undo / Redo */}
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Cmd+Z)"
          style={{
            width: 30, height: 30, padding: 0, borderRadius: 7,
            border: 'none', cursor: canUndo ? 'pointer' : 'default',
            background: 'transparent', color: canUndo ? '#999' : '#333',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'color 0.12s',
          }}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Cmd+Shift+Z)"
          style={{
            width: 30, height: 30, padding: 0, borderRadius: 7,
            border: 'none', cursor: canRedo ? 'pointer' : 'default',
            background: 'transparent', color: canRedo ? '#999' : '#333',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'color 0.12s',
          }}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
          </svg>
        </button>

        <div style={{ width: 1, height: 20, background: SURFACE_BORDER, margin: '0 4px' }} />
        <SaveStatusIndicator status={saveStatus} />
      </div>

      {/* Color picker row — shown for ink, text, highlight */}
      {showColors && (
        <div style={subRowStyle}>
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

      {/* Font controls row — shown for text mode */}
      {mode === 'text' && (
        <div style={subRowStyle}>
          {/* Font size -/+  */}
          <button
            onClick={() => {
              const idx = Math.max(0, (sizeIdx >= 0 ? sizeIdx : 2) - 1);
              onFontSizeChange(FONT_SIZES[idx]);
            }}
            style={{ ...smallBtnBase, background: 'rgba(255,255,255,0.06)', color: '#999' }}
          >
            −
          </button>
          <span style={{ color: '#bbb', fontSize: 11, fontWeight: 600, minWidth: 24, textAlign: 'center' }}>
            {sizeLabel}
          </span>
          <button
            onClick={() => {
              const idx = Math.min(FONT_SIZES.length - 1, (sizeIdx >= 0 ? sizeIdx : 2) + 1);
              onFontSizeChange(FONT_SIZES[idx]);
            }}
            style={{ ...smallBtnBase, background: 'rgba(255,255,255,0.06)', color: '#999' }}
          >
            +
          </button>

          <div style={{ width: 1, height: 18, background: SURFACE_BORDER }} />

          {/* Font family */}
          {FONT_FAMILIES.map(f => (
            <button
              key={f.value}
              onClick={() => onFontFamilyChange(f.value)}
              style={{
                ...smallBtnBase,
                fontFamily: f.value,
                background: fontFamily === f.value ? ACCENT_BG : 'rgba(255,255,255,0.04)',
                color: fontFamily === f.value ? '#c4bcff' : '#777',
                border: fontFamily === f.value ? `1px solid ${ACCENT_BORDER}` : '1px solid transparent',
              }}
            >
              {f.label}
            </button>
          ))}
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
