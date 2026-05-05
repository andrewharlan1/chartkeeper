import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getParts, getPartDiffs, SlotDiff, NoteOperation } from '../api/parts';
import { getVersion } from '../api/versions';
import { getChart } from '../api/charts';
import { Part } from '../types';
import { Layout } from '../components/Layout';
import { InstrumentIcon } from '../components/InstrumentIcon';
import { Button } from '../components/Button';
import './PlayerHistory.css';

interface DiffCard {
  part: Part;
  diffs: SlotDiff[];
  totalChanged: number;
}

export function DiffLogPage() {
  const { id: chartId, vId } = useParams<{ id: string; vId: string }>();

  const [chartName, setChartName] = useState('');
  const [versionName, setVersionName] = useState('');
  const [cards, setCards] = useState<DiffCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCollapses, setExpandedCollapses] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!chartId || !vId) return;

    Promise.all([
      getChart(chartId),
      getVersion(vId),
      getParts(vId),
    ]).then(async ([{ chart }, { version }, { parts }]) => {
      setChartName(chart.name);
      setVersionName(version.name);

      const diffCards: DiffCard[] = [];
      for (const part of parts) {
        try {
          const { diffs } = await getPartDiffs(part.id);
          if (diffs.length > 0) {
            const allMeasures = new Set<number>();
            for (const d of diffs) {
              for (const m of d.changedMeasures) allMeasures.add(m);
            }
            diffCards.push({ part, diffs, totalChanged: allMeasures.size });
          }
        } catch {
          // skip parts with no diff data
        }
      }
      setCards(diffCards);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, [chartId, vId]);

  function toggleCollapse(key: string) {
    setExpandedCollapses(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (loading) return <Layout><p style={{ color: 'var(--text-muted)' }}>Loading...</p></Layout>;

  return (
    <Layout
      title={`Diff — ${versionName}`}
      backTo={`/charts/${chartId}/versions/${vId}`}
      breadcrumbs={[
        { label: 'Home', to: '/' },
        ...(chartName ? [{ label: chartName, to: `/charts/${chartId}` }] : []),
        { label: versionName, to: `/charts/${chartId}/versions/${vId}` },
        { label: 'Diff' },
      ]}
    >
      {cards.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '48px 24px',
          color: 'var(--text-muted)', fontSize: 14,
        }}>
          No changes detected in this version.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {cards.map(card => (
            <DiffCardView
              key={card.part.id}
              card={card}
              chartId={chartId!}
              vId={vId!}
              expandedCollapses={expandedCollapses}
              onToggleCollapse={toggleCollapse}
            />
          ))}
        </div>
      )}
    </Layout>
  );
}

function DiffCardView({
  card, chartId, vId, expandedCollapses, onToggleCollapse,
}: {
  card: DiffCard;
  chartId: string;
  vId: string;
  expandedCollapses: Set<string>;
  onToggleCollapse: (key: string) => void;
}) {
  const { part, diffs, totalChanged } = card;

  // Merge all diffs into a unified measure-level changelog
  const allDescriptions: Record<string, string> = {};
  const changedSet = new Set<number>();
  let sourceLabel = '';
  const noteOps: NoteOperation[] = [];

  for (const d of diffs) {
    for (const m of d.changedMeasures) changedSet.add(m);
    Object.assign(allDescriptions, d.changeDescriptions);
    if (!sourceLabel && d.sourceVersionName) {
      sourceLabel = d.sourceVersionName;
    }
    if (d.noteOperations) {
      noteOps.push(...d.noteOperations);
    }
  }

  // Group note operations by measure
  const noteOpsByMeasure = new Map<number, NoteOperation[]>();
  for (const op of noteOps) {
    const arr = noteOpsByMeasure.get(op.measure) || [];
    arr.push(op);
    noteOpsByMeasure.set(op.measure, arr);
  }

  const changedMeasures = [...changedSet].sort((a, b) => a - b);

  // Build display rows: show changed measures with context
  // Find the range of measures referenced
  const allMeasureNums = Object.keys(allDescriptions).map(Number).filter(n => !isNaN(n));
  const minMeasure = Math.min(...allMeasureNums, ...changedMeasures);
  const maxMeasure = Math.max(...allMeasureNums, ...changedMeasures);

  type Row = {
    type: 'change' | 'unchanged' | 'collapse';
    measure?: number;
    sigil?: string;
    text?: string;
    kind?: string;
    collapsedCount?: number;
    collapseKey?: string;
  };

  const rows: Row[] = [];
  let unchangedRun: number[] = [];

  function flushUnchanged() {
    if (unchangedRun.length === 0) return;
    if (unchangedRun.length <= 2) {
      for (const m of unchangedRun) {
        rows.push({ type: 'unchanged', measure: m, sigil: '', text: 'unchanged', kind: '' });
      }
    } else {
      // Show first, collapse middle, show last
      rows.push({ type: 'unchanged', measure: unchangedRun[0], sigil: '', text: 'unchanged', kind: '' });
      const collapseKey = `${part.id}-${unchangedRun[1]}`;
      rows.push({
        type: 'collapse',
        collapsedCount: unchangedRun.length - 2,
        collapseKey,
      });
      rows.push({ type: 'unchanged', measure: unchangedRun[unchangedRun.length - 1], sigil: '', text: 'unchanged', kind: '' });
    }
    unchangedRun = [];
  }

  for (let m = minMeasure; m <= maxMeasure; m++) {
    if (changedSet.has(m)) {
      flushUnchanged();
      const desc = allDescriptions[String(m)] || 'modified';
      // Determine sigil from description
      let sigil = '~';
      let kind = 'dr-mod';
      const lower = desc.toLowerCase();
      if (lower.includes('added') || lower.includes('insert')) {
        sigil = '+';
        kind = 'dr-add';
      } else if (lower.includes('removed') || lower.includes('delet')) {
        sigil = '\u2212';
        kind = 'dr-rem';
      }
      rows.push({ type: 'change', measure: m, sigil, text: desc, kind });
    } else {
      unchangedRun.push(m);
    }
  }
  flushUnchanged();

  return (
    <div className="diff-card">
      <div className="dc-head">
        <InstrumentIcon name={part.name} size={18} />
        <span className="dc-title">{part.name}</span>
        <span className="dc-summary">
          &middot; <strong>{totalChanged} measure{totalChanged !== 1 ? 's' : ''} changed</strong>
          {sourceLabel && <> from {sourceLabel}</>}
        </span>
        <div className="dc-anchors">
          {changedMeasures.slice(0, 6).map(m => (
            <span className="dc-anchor" key={m}>m.{m}</span>
          ))}
          {changedMeasures.length > 6 && (
            <span className="dc-anchor">+{changedMeasures.length - 6}</span>
          )}
        </div>
      </div>

      <div>
        {rows.map((row, i) => {
          if (row.type === 'collapse') {
            const isExpanded = expandedCollapses.has(row.collapseKey!);
            if (isExpanded) {
              // When expanded, render nothing — the unchanged rows are inline
              return null;
            }
            return (
              <div
                key={i}
                className="diff-row dr-collapse"
                onClick={() => onToggleCollapse(row.collapseKey!)}
              >
                &hellip; {row.collapsedCount} unchanged measures collapsed &middot;{' '}
                <span style={{ color: 'var(--accent)', marginLeft: 4 }}>show all &rsaquo;</span>
              </div>
            );
          }

          const measureNoteOps = row.measure !== undefined ? noteOpsByMeasure.get(row.measure) : undefined;
          return (
            <div key={i}>
              <div className={`diff-row ${row.kind || ''}`}>
                <span className="dr-measure">
                  {row.measure !== undefined ? `m.${row.measure}` : ''}
                </span>
                <span className="dr-sigil">{row.sigil}</span>
                <span>{row.text}</span>
              </div>
              {measureNoteOps && measureNoteOps.length > 0 && (
                <div style={{ padding: '2px 18px 6px 86px' }}>
                  {measureNoteOps.map((op, j) => (
                    <div key={j} style={{
                      fontSize: 11,
                      fontFamily: 'var(--mono)',
                      color: 'var(--ink-3)',
                      padding: '1px 0',
                    }}>
                      <span style={{ color: op.operation.includes('del') ? 'var(--rem)' : op.operation.includes('ins') ? 'var(--add)' : 'var(--mod)', marginRight: 6 }}>
                        {op.operation}
                      </span>
                      {op.description}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Link to part view */}
      <div style={{
        padding: '10px 18px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}>
        <Link to={`/charts/${chartId}/versions/${vId}/parts/${part.id}`}>
          <Button size="sm" variant="secondary">Open part</Button>
        </Link>
      </div>
    </div>
  );
}
