import { useState, useCallback } from 'react';

interface DiffInfo {
  count: number;
  comparedToVersionName: string;
  changelog: string;
}

interface Props {
  info: DiffInfo;
  highlightsEnabled: boolean;
  onToggleHighlights: () => void;
}

export function DiffBadge({ info, highlightsEnabled, onToggleHighlights }: Props) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => setExpanded(v => !v), []);

  if (info.count === 0) return null;

  return (
    <div style={{
      position: 'absolute',
      top: 56,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 40,
      maxWidth: 420,
      width: 'max-content',
    }}>
      {/* Collapsed badge */}
      <button
        onClick={toggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 12px',
          background: 'rgba(253, 224, 71, 0.15)',
          border: '1px solid rgba(253, 224, 71, 0.35)',
          borderRadius: expanded ? '8px 8px 0 0' : 8,
          color: '#fde047',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: 10 }}>{expanded ? '\u25BE' : '\u25B8'}</span>
        {info.count} measure{info.count !== 1 ? 's' : ''} changed
        {info.comparedToVersionName && ` from ${info.comparedToVersionName}`}
      </button>

      {/* Expanded changelog */}
      {expanded && (
        <div style={{
          background: 'rgba(22, 21, 42, 0.95)',
          border: '1px solid rgba(253, 224, 71, 0.25)',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          padding: '10px 14px',
          maxHeight: 200,
          overflowY: 'auto',
        }}>
          {info.changelog ? (
            <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.6 }}>
              {info.changelog.split('\n').map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: '#666' }}>No detailed changelog available.</p>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); onToggleHighlights(); }}
            style={{
              marginTop: 10,
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'inherit',
              background: highlightsEnabled ? 'rgba(253, 224, 71, 0.15)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${highlightsEnabled ? 'rgba(253, 224, 71, 0.35)' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 6,
              color: highlightsEnabled ? '#fde047' : '#888',
              cursor: 'pointer',
            }}
          >
            {highlightsEnabled ? 'Hide highlights' : 'Show highlights'}
          </button>
        </div>
      )}
    </div>
  );
}
