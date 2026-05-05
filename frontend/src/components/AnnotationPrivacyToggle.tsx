import { useState } from 'react';
import { setAnnotationMigratable } from '../api/annotations';

interface Props {
  annotationId: string;
  currentMigratable: boolean;
  isOwner: boolean;
  onToggled?: (newValue: boolean) => void;
}

/**
 * Per-annotation "private — do not migrate" toggle.
 * Visible only to the annotation's owner.
 */
export function AnnotationPrivacyToggle({ annotationId, currentMigratable, isOwner, onToggled }: Props) {
  const [migratable, setMigratable] = useState(currentMigratable);
  const [loading, setLoading] = useState(false);

  if (!isOwner) return null;

  async function handleToggle() {
    setLoading(true);
    try {
      const newVal = !migratable;
      await setAnnotationMigratable(annotationId, newVal);
      setMigratable(newVal);
      onToggled?.(newVal);
    } catch {
      // Revert on failure
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', background: 'none', border: 'none',
        cursor: loading ? 'wait' : 'pointer',
        fontSize: 12, color: migratable ? 'var(--text-muted)' : 'var(--warning, #eab308)',
        width: '100%', textAlign: 'left',
      }}
      title={migratable ? 'Mark as private (exclude from migration)' : 'Make migratable'}
    >
      <span style={{ width: 14, textAlign: 'center' }}>
        {migratable ? '\u{1F513}' : '\u{1F512}'}
      </span>
      {migratable ? 'Migratable' : 'Private (not migratable)'}
    </button>
  );
}
