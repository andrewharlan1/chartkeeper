import { Annotation } from '../types';

interface Props {
  annotation: Annotation;
  style?: React.CSSProperties;
}

/**
 * Displays migration provenance info for an annotation.
 * Shows source part name, version, and author (for cross-instrument only).
 */
export function AnnotationProvenancePopover({ annotation, style }: Props) {
  if (!annotation.migrationSourceKind) return null;

  const isCross = annotation.migrationSourceKind === 'cross_instrument';

  return (
    <div style={{
      background: 'var(--surface-raised, #fff)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm, 6px)',
      padding: '8px 10px',
      fontSize: 11,
      color: 'var(--text-muted)',
      boxShadow: 'var(--shadow-sm)',
      maxWidth: 240,
      ...style,
    }}>
      <div style={{ fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>
        {isCross ? 'Cross-instrument migration' : 'Same-instrument migration'}
      </div>
      {annotation.sourcePartName && (
        <div>
          From: {annotation.sourcePartName}
          {annotation.sourceVersionLabel && ` (${annotation.sourceVersionLabel})`}
        </div>
      )}
      {isCross && annotation.sourceAuthorName && (
        <div>Author: {annotation.sourceAuthorName}</div>
      )}
      {annotation.needsReview && (
        <div style={{ color: 'var(--warning, #eab308)', marginTop: 4 }}>
          Flagged for review
        </div>
      )}
    </div>
  );
}
