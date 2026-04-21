import { useState, useEffect, useRef } from 'react';
import { getChartMigrationSources, MigrationSourceVersion } from '../api/charts';
import { migrateFrom } from '../api/parts';
import { InstrumentIcon } from './InstrumentIcon';

interface Props {
  partId: string;
  partName: string;
  chartId: string;
  annotationCount: number;
  onMigrated: () => void;
}

export function PartMigrationRow({ partId, chartId, annotationCount, onMigrated }: Props) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<MigrationSourceVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [migratingFrom, setMigratingFrom] = useState<string | null>(null);
  const [result, setResult] = useState<{ migrated: number; flagged: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load sources when dropdown opens
  useEffect(() => {
    if (!open || sources.length > 0) return;
    setLoading(true);
    getChartMigrationSources(chartId)
      .then(({ versions }) => setSources(versions))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, chartId, sources.length]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function handleMigrate(sourcePartId: string) {
    setMigratingFrom(sourcePartId);
    try {
      const res = await migrateFrom(partId, sourcePartId);
      setResult({ migrated: res.migratedCount, flagged: res.flaggedCount });
      setOpen(false);
      onMigrated();
    } catch {
      setResult(null);
    } finally {
      setMigratingFrom(null);
    }
  }

  // Filter sources to only show versions with parts that have annotations
  const availableSources = sources.filter(v =>
    v.parts.some(p => p.annotationCount > 0)
  );

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 0', position: 'relative',
    }}>
      <span style={{
        fontSize: 11, color: 'var(--text-muted)',
        background: 'var(--accent-subtle)', border: '1px solid rgba(124,106,245,0.3)',
        borderRadius: 99, padding: '1px 7px',
      }}>
        {annotationCount} annotation{annotationCount !== 1 ? 's' : ''}
      </span>

      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', padding: '3px 10px',
            fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer',
            fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          Migrate annotations
          <span style={{ fontSize: 9 }}>{open ? '\u25B4' : '\u25BE'}</span>
        </button>

        {open && (
          <div style={{
            position: 'absolute', left: 0, top: '100%', marginTop: 4,
            zIndex: 100, background: 'var(--surface-raised, var(--surface))',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-lg, 0 4px 16px rgba(0,0,0,0.15))',
            minWidth: 300, maxHeight: 320, overflowY: 'auto', padding: '8px 0',
          }}>
            <div style={{ padding: '4px 12px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Migrate annotations from
            </div>

            {loading && (
              <p style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>Loading...</p>
            )}

            {!loading && availableSources.length === 0 && (
              <p style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>No sources available.</p>
            )}

            {availableSources.map(v => (
              <div key={v.versionId}>
                <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                  {v.versionName}
                </div>
                {v.parts.filter(p => p.annotationCount > 0).map(p => (
                  <button
                    key={p.partId}
                    onClick={() => handleMigrate(p.partId)}
                    disabled={migratingFrom === p.partId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      padding: '6px 12px 6px 20px', background: 'transparent',
                      border: 'none', cursor: 'pointer', color: 'var(--text)',
                      fontSize: 12, fontFamily: 'inherit', textAlign: 'left',
                    }}
                  >
                    <InstrumentIcon name={p.instrumentIcon} size={16} />
                    <span>{p.instrumentName}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                      {p.annotationCount} ann.
                    </span>
                  </button>
                ))}
              </div>
            ))}

            <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
            <a
              href={`/charts/${chartId}/migration-sources`}
              style={{ display: 'block', padding: '6px 12px', fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}
            >
              View all annotations →
            </a>
          </div>
        )}
      </div>

      {result && (
        <span style={{ fontSize: 11, color: 'var(--accent)' }}>
          Migrated {result.migrated}{result.flagged > 0 ? ` (${result.flagged} flagged)` : ''}
        </span>
      )}
    </div>
  );
}
