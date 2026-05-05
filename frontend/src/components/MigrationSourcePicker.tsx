import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { getMigrationCandidates, MigrationCandidate } from '../api/versions';

export interface SelectedSource {
  sourcePartId: string;
  sourceVersionId: string;
  partName: string;
  versionLabel: string;
  isSameInstrument: boolean;
  annotationCount: number;
}

interface Props {
  ensembleId: string;
  targetPartId: string;
  alreadySelected: SelectedSource[];
  onSelect: (source: SelectedSource) => void;
  onClose: () => void;
}

export function MigrationSourcePicker({ ensembleId, targetPartId, alreadySelected, onSelect, onClose }: Props) {
  const [candidates, setCandidates] = useState<MigrationCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedPart, setExpandedPart] = useState<string | null>(null);

  useEffect(() => {
    getMigrationCandidates(ensembleId, targetPartId)
      .then(res => setCandidates(res.candidates))
      .catch(err => setError(err.message || 'Failed to load candidates'))
      .finally(() => setLoading(false));
  }, [ensembleId, targetPartId]);

  const alreadySelectedKeys = new Set(
    alreadySelected.map(s => `${s.sourcePartId}::${s.sourceVersionId}`),
  );

  function handleVersionClick(candidate: MigrationCandidate, version: MigrationCandidate['versions'][0]) {
    onSelect({
      sourcePartId: candidate.partId,
      sourceVersionId: version.versionId,
      partName: candidate.partName,
      versionLabel: version.versionLabel,
      isSameInstrument: candidate.isSameInstrument,
      annotationCount: version.annotationCount,
    });
    onClose();
  }

  return (
    <Modal title="Add migration source" onClose={onClose}>
      {loading && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading candidates...</p>}
      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

      {!loading && candidates.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No parts with migratable annotations found.</p>
      )}

      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {candidates.map(c => {
          const totalCount = c.versions.reduce((sum, v) => sum + v.annotationCount, 0);
          const isExpanded = expandedPart === c.partId;

          return (
            <div key={c.partId} style={{ borderBottom: '1px solid var(--border)' }}>
              <button
                onClick={() => setExpandedPart(isExpanded ? null : c.partId)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '10px 4px', background: 'none', border: 'none',
                  cursor: 'pointer', color: 'var(--text)', fontSize: 13, textAlign: 'left',
                }}
              >
                <span style={{ fontWeight: 500 }}>
                  {c.partName}
                  {c.isSameInstrument && (
                    <span style={{ color: 'var(--accent)', fontSize: 11, marginLeft: 6 }}>same instrument</span>
                  )}
                </span>
                <span style={{ color: totalCount > 0 ? 'var(--text-muted)' : 'var(--text-muted)', opacity: totalCount > 0 ? 1 : 0.5 }}>
                  {totalCount} annotation{totalCount !== 1 ? 's' : ''}
                </span>
              </button>

              {isExpanded && (
                <div style={{ paddingLeft: 16, paddingBottom: 8 }}>
                  {c.versions.map(v => {
                    const isSelected = alreadySelectedKeys.has(`${c.partId}::${v.versionId}`);
                    const isEmpty = v.annotationCount === 0;

                    return (
                      <button
                        key={v.versionId}
                        onClick={() => !isSelected && !isEmpty && handleVersionClick(c, v)}
                        disabled={isSelected || isEmpty}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          width: '100%', padding: '6px 8px', background: 'none', border: 'none',
                          cursor: isSelected || isEmpty ? 'default' : 'pointer',
                          opacity: isSelected || isEmpty ? 0.5 : 1,
                          color: 'var(--text)', fontSize: 12, textAlign: 'left',
                          borderRadius: 4,
                        }}
                      >
                        <span>
                          {v.versionLabel}
                          {v.isMostRecent && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>(latest)</span>}
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}>
                          {isSelected ? 'selected' : `${v.annotationCount} annotations`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}
