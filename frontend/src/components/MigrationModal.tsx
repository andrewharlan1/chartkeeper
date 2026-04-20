import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { InstrumentIcon } from './InstrumentIcon';
import { useMigration, MigrationPart } from '../hooks/useMigration';
import { MigrationResult } from '../api/versions';

interface Props {
  versionId: string;
  versionName: string;
  onClose: () => void;
  onComplete: (results: MigrationResult[]) => void;
}

function PartRow({
  part,
  onSelectionChange,
}: {
  part: MigrationPart;
  onSelectionChange: (sourcePartId: string | null) => void;
}) {
  const hasSources = part.sources.length > 0;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '28px 1fr 1fr',
      gap: 12,
      alignItems: 'center',
      padding: '8px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <InstrumentIcon name={part.name} size={22} />
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
        {part.name}
      </span>
      {hasSources ? (
        <select
          value={part.selectedSourcePartId ?? '__none__'}
          onChange={e => onSelectionChange(e.target.value === '__none__' ? null : e.target.value)}
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '5px 8px',
            color: 'var(--text)',
            fontSize: 12,
            height: 30,
            width: '100%',
          }}
        >
          {part.sources.map(s => (
            <option key={s.partId} value={s.partId}>
              From {s.versionName} ({s.annotationCount} annotation{s.annotationCount !== 1 ? 's' : ''})
            </option>
          ))}
          <option value="__none__">None (start fresh)</option>
        </select>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          New part — no previous annotations
        </span>
      )}
    </div>
  );
}

function ResultsSummary({ results }: { results: MigrationResult[] }) {
  const totalMigrated = results.reduce((s, r) => s + r.migrated, 0);
  const totalFlagged = results.reduce((s, r) => s + r.flagged, 0);

  return (
    <div style={{ padding: '12px 0' }}>
      <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 8 }}>
        Migration complete — {totalMigrated} annotation{totalMigrated !== 1 ? 's' : ''} migrated
        {totalFlagged > 0 && (
          <span style={{ color: 'var(--warning, #eab308)' }}>
            , {totalFlagged} flagged for review
          </span>
        )}
      </p>
      {results.filter(r => r.total > 0).map((r, i) => (
        <div key={i} style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          padding: '2px 0',
        }}>
          {r.instrument}: {r.migrated} migrated
          {r.flagged > 0 && `, ${r.flagged} need review`}
          {r.skipped > 0 && `, ${r.skipped} already existed`}
        </div>
      ))}
    </div>
  );
}

export function MigrationModal({ versionId, versionName, onClose, onComplete }: Props) {
  const migration = useMigration(versionId);
  const [showResults, setShowResults] = useState(false);

  async function handleConfirm() {
    try {
      const results = await migration.runMigration();
      if (results.length === 0) {
        // Nothing to migrate — all set to "None"
        onComplete([]);
        return;
      }
      setShowResults(true);
      // Auto-close after brief display
      setTimeout(() => onComplete(results), 1500);
    } catch {
      // Error is shown via migration.error
    }
  }

  const allNone = migration.parts.every(p => p.selectedSourcePartId === null);
  const omrPending = false; // TODO: wire to actual OMR status if modal appears before OMR completes

  return (
    <Modal title={`Migrate annotations to ${versionName}?`} onClose={onClose}>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8, marginBottom: 16 }}>
        Choose which annotations to carry forward for each part.
        Annotations stay on the previous version regardless of what you choose here.
      </p>

      {migration.loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>
          Loading annotation sources...
        </p>
      ) : migration.migrating ? (
        <div style={{ padding: '20px 0', textAlign: 'center' }}>
          <p style={{ color: 'var(--accent)', fontSize: 13 }}>
            Migrating annotations...
          </p>
        </div>
      ) : showResults && migration.results ? (
        <ResultsSummary results={migration.results} />
      ) : (
        <>
          {/* Per-part rows */}
          <div style={{ marginBottom: 16, maxHeight: 320, overflowY: 'auto' }}>
            {migration.parts.map(p => (
              <PartRow
                key={p.id}
                part={p}
                onSelectionChange={sourceId => migration.setSelection(p.id, sourceId)}
              />
            ))}
          </div>

          {migration.error && (
            <p style={{ color: 'var(--danger, #ef4444)', fontSize: 12, marginBottom: 12 }}>
              {migration.error}
            </p>
          )}

          {/* Footer buttons */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={migration.setAllFromPrevious}
              disabled={!migration.hasAnySources}
            >
              Migrate all from previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { migration.setAllNone(); }}
            >
              Skip — start fresh
            </Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={omrPending}
            >
              {allNone ? 'Skip migration' : 'Confirm'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
