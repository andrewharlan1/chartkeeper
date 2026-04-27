import { useState, useEffect, useRef, useCallback } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { getPart, getPartDiffs, SlotDiff, MigrateFromResult } from '../api/parts';
import { PartKind, OmrStatus, ANNOTATABLE_KINDS } from '../types';

export interface UploadedPartInfo {
  partId: string;
  name: string;
  kind: PartKind;
}

interface Props {
  chartId: string;
  versionId: string;
  versionName: string;
  parts: UploadedPartInfo[];
  migrationResults: MigrateFromResult[];
  onGoToChart: () => void;
}

type Phase = 'processing' | 'loading-diffs' | 'done';

const OMR_POLL_INTERVAL = 3000;

export function PostUploadModal({
  versionName,
  parts,
  migrationResults,
  onGoToChart,
}: Props) {
  const annotatableParts = parts.filter(p => ANNOTATABLE_KINDS.includes(p.kind));
  const hasAnnotatable = annotatableParts.length > 0;

  const [phase, setPhase] = useState<Phase>(hasAnnotatable ? 'processing' : 'done');
  const [omrStatuses, setOmrStatuses] = useState<Record<string, OmrStatus>>(() => {
    const initial: Record<string, OmrStatus> = {};
    for (const p of annotatableParts) initial[p.partId] = 'pending';
    return initial;
  });
  const [diffs, setDiffs] = useState<Record<string, SlotDiff[]>>({});
  const [expandedPart, setExpandedPart] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  // OMR polling
  useEffect(() => {
    if (!hasAnnotatable || phase !== 'processing') return;

    async function poll() {
      const updates: Record<string, OmrStatus> = {};
      for (const p of annotatableParts) {
        try {
          const { part } = await getPart(p.partId);
          updates[p.partId] = part.omrStatus;
        } catch {
          // Keep existing status on error
        }
      }
      if (!mountedRef.current) return;
      setOmrStatuses(prev => ({ ...prev, ...updates }));
    }

    // Initial poll
    poll();
    pollRef.current = setInterval(poll, OMR_POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Transition from processing → loading-diffs when all OMR done
  useEffect(() => {
    if (phase !== 'processing') return;
    const allDone = annotatableParts.every(p => {
      const s = omrStatuses[p.partId];
      return s === 'complete' || s === 'failed';
    });
    if (allDone) {
      if (pollRef.current) clearInterval(pollRef.current);
      setPhase('loading-diffs');
    }
  }, [omrStatuses, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch diffs
  const fetchDiffs = useCallback(async () => {
    const completedParts = annotatableParts.filter(p => omrStatuses[p.partId] === 'complete');
    const results: Record<string, SlotDiff[]> = {};
    for (const p of completedParts) {
      try {
        const { diffs: d } = await getPartDiffs(p.partId);
        results[p.partId] = d;
      } catch {
        results[p.partId] = [];
      }
    }
    if (mountedRef.current) {
      setDiffs(results);
      setPhase('done');
    }
  }, [annotatableParts, omrStatuses]);

  useEffect(() => {
    if (phase === 'loading-diffs') fetchDiffs();
  }, [phase, fetchDiffs]);

  // Compute summary stats
  const totalMigrated = migrationResults.reduce((s, r) => s + r.migratedCount, 0);
  const totalFlagged = migrationResults.reduce((s, r) => s + r.flaggedCount, 0);

  const completedCount = annotatableParts.filter(p => omrStatuses[p.partId] === 'complete').length;
  const failedParts = annotatableParts.filter(p => omrStatuses[p.partId] === 'failed');

  return (
    <Modal
      title="Upload complete"
      onClose={phase === 'processing' ? () => {} : onGoToChart}
    >
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -8, marginBottom: 20 }}>
        {versionName}
      </p>

      {/* OMR processing phase */}
      {phase === 'processing' && (
        <div style={{ padding: '16px 0' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
          }}>
            <Spinner />
            <span style={{ fontSize: 13, color: 'var(--text)' }}>
              Processing {completedCount} of {annotatableParts.length} part{annotatableParts.length !== 1 ? 's' : ''}...
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {annotatableParts.map(p => (
              <div key={p.partId} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 12, color: 'var(--text-muted)',
              }}>
                <OmrStatusDot status={omrStatuses[p.partId]} />
                <span>{p.name}</span>
                <span style={{ color: 'var(--text-faint)' }}>
                  {omrStatuses[p.partId] === 'complete' ? 'done' :
                   omrStatuses[p.partId] === 'failed' ? 'failed' :
                   omrStatuses[p.partId] === 'processing' ? 'processing...' : 'waiting...'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading diffs phase */}
      {phase === 'loading-diffs' && (
        <div style={{ padding: '16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Spinner />
          <span style={{ fontSize: 13, color: 'var(--text)' }}>Loading changes...</span>
        </div>
      )}

      {/* Results phase */}
      {phase === 'done' && (
        <>
          {/* Diff results */}
          {hasAnnotatable && (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{
                fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10,
              }}>
                What changed
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {annotatableParts.map(p => {
                  const partDiffs = diffs[p.partId] || [];
                  const totalChanged = partDiffs.reduce((s, d) => s + d.changedMeasures.length, 0);
                  const changelog = partDiffs.map(d => d.changelog).filter(Boolean).join('\n');
                  const sourceVersion = partDiffs[0]?.sourceVersionName;
                  const isFailed = omrStatuses[p.partId] === 'failed';
                  const isExpanded = expandedPart === p.partId;

                  return (
                    <div key={p.partId} style={{
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      overflow: 'hidden',
                    }}>
                      <button
                        onClick={() => setExpandedPart(isExpanded ? null : p.partId)}
                        disabled={isFailed || totalChanged === 0}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          width: '100%', padding: '8px 12px',
                          background: 'none', border: 'none',
                          cursor: (isFailed || totalChanged === 0) ? 'default' : 'pointer',
                          color: 'var(--text)', fontSize: 13, fontFamily: 'inherit',
                          textAlign: 'left',
                        }}
                      >
                        <span style={{ fontWeight: 500, flex: 1 }}>{p.name}</span>
                        {isFailed ? (
                          <span style={{ fontSize: 11, color: 'var(--danger, #ef4444)' }}>
                            processing failed
                          </span>
                        ) : totalChanged > 0 ? (
                          <span style={{ fontSize: 11, color: '#fde047' }}>
                            {totalChanged} measure{totalChanged !== 1 ? 's' : ''} changed
                            {sourceVersion && ` from ${sourceVersion}`}
                          </span>
                        ) : partDiffs.length > 0 ? (
                          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                            no changes detected
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                            first version
                          </span>
                        )}
                      </button>
                      {isExpanded && changelog && (
                        <div style={{
                          padding: '8px 12px', borderTop: '1px solid var(--border)',
                          fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6,
                        }}>
                          {changelog.split('\n').map((line, i) => (
                            <div key={i}>{line}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {failedParts.length > 0 && (
                <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>
                  Parts that failed processing were still uploaded successfully.
                </p>
              )}
            </div>
          )}

          {/* Migration results */}
          {migrationResults.length > 0 ? (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{
                fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
              }}>
                Annotations migrated
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 6 }}>
                {totalMigrated} annotation{totalMigrated !== 1 ? 's' : ''} migrated
                {totalFlagged > 0 && (
                  <span style={{ color: 'var(--warning, #eab308)' }}>
                    , {totalFlagged} flagged for review
                  </span>
                )}
              </p>
              {migrationResults.filter(r => r.total > 0).map((r, i) => (
                <div key={i} style={{
                  fontSize: 12, color: 'var(--text-muted)', padding: '2px 0',
                }}>
                  {r.instrument}: {r.migratedCount} migrated
                  {r.flaggedCount > 0 && `, ${r.flaggedCount} need review`}
                  {r.skippedCount > 0 && `, ${r.skippedCount} already existed`}
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 20 }}>
              No annotations were migrated. You can migrate annotations later from the chart page.
            </p>
          )}

          {/* Go to chart button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={onGoToChart}>
              Go to chart
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Spinner() {
  return (
    <div style={{
      width: 16, height: 16, border: '2px solid var(--border)',
      borderTopColor: 'var(--accent)', borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }} />
  );
}

function OmrStatusDot({ status }: { status: OmrStatus }) {
  const color =
    status === 'complete' ? '#22c55e' :
    status === 'failed' ? '#ef4444' :
    status === 'processing' ? '#fde047' :
    'var(--text-faint)';

  return (
    <div style={{
      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: color,
    }} />
  );
}
