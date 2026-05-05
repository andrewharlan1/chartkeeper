import { useEffect, useState } from 'react';
import { Annotation } from '../types';
import { getAnnotations, createAnnotation, deleteAnnotation } from '../api/annotations';

export function NotePanel({
  partId, currentPage, currentUserId,
}: {
  partId: string; currentPage: number; currentUserId?: string;
}) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [measure, setMeasure] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    getAnnotations(partId)
      .then(r => setAnnotations(r.annotations.filter(a => a.kind === 'text')))
      .catch(() => {});
  }, [partId]);

  async function handleAdd() {
    if (!text.trim()) return;
    const m = parseInt(measure);
    setSaving(true);
    try {
      const { annotation } = await createAnnotation(partId, {
        anchorType: m > 0 ? 'measure' : 'page',
        anchorJson: m > 0 ? { measureNumber: m } : { page: currentPage },
        kind: 'text',
        contentJson: { text: text.trim() },
      });
      setAnnotations(prev => [...prev, annotation]);
      setMeasure('');
      setText('');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteAnnotation(id);
      setAnnotations(prev => prev.filter(a => a.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div style={{
      width: 252, flexShrink: 0,
      borderLeft: '1px solid var(--line-2, rgba(255,255,255,0.06))',
      background: 'var(--card-2, #0c0c18)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '11px 14px 9px', borderBottom: '1px solid var(--line-2, rgba(255,255,255,0.06))' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3, #666)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Notes
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {annotations.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ink-4, #444)', padding: '4px 2px' }}>No notes yet.</p>
        ) : (
          annotations.map(a => {
            const measureNum = (a.anchorJson as { measureNumber?: number }).measureNumber;
            const pageNum = (a.anchorJson as { page?: number }).page;
            return (
              <div key={a.id} style={{
                padding: '7px 9px', marginBottom: 5,
                background: 'var(--card, rgba(255,255,255,0.03))',
                border: `1px solid ${(a.contentJson as Record<string, unknown>)._needsReview ? 'rgba(245,166,35,0.2)' : 'var(--line, rgba(255,255,255,0.06))'}`,
                borderRadius: 6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    {(measureNum || pageNum) && (
                      <span style={{
                        display: 'inline-block', fontSize: 10, fontWeight: 700,
                        background: 'rgba(200,83,28,0.12)', border: '1px solid rgba(200,83,28,0.2)',
                        borderRadius: 3, padding: '1px 5px', color: 'var(--accent, #e0763f)', marginBottom: 4,
                      }}>
                        {measureNum ? `m.${measureNum}` : `p.${pageNum}`}
                      </span>
                    )}
                    {(a.contentJson as Record<string, unknown>)._needsReview === true && (
                      <p style={{ fontSize: 10, color: '#f5a623', marginBottom: 3 }}>Measure removed</p>
                    )}
                    <p style={{ fontSize: 12, color: 'var(--ink, #ddd)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                      {(a.contentJson as { text?: string }).text}
                    </p>
                    <p style={{ fontSize: 10, color: 'var(--ink-4, #555)', marginTop: 3 }}>{a.ownerName}</p>
                  </div>
                  {a.ownerUserId === currentUserId && (
                    <button
                      onClick={() => handleDelete(a.id)}
                      disabled={deleting === a.id}
                      style={{ background: 'none', border: 'none', color: 'var(--ink-4, #444)', cursor: 'pointer', fontSize: 15, padding: 0, lineHeight: 1 }}
                    >×</button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ padding: '8px 10px 12px', borderTop: '1px solid var(--line-2, rgba(255,255,255,0.06))' }}>
        <div style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
          <input
            type="number"
            value={measure}
            onChange={e => setMeasure(e.target.value)}
            placeholder="m."
            min={1}
            style={{
              width: 44, padding: '5px 6px', fontSize: 11,
              background: 'var(--card, rgba(255,255,255,0.05))', border: '1px solid var(--line, rgba(255,255,255,0.09))',
              borderRadius: 5, color: 'var(--ink, #ccc)', flexShrink: 0, boxShadow: 'none',
            }}
          />
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Add a note..."
            rows={2}
            style={{
              flex: 1, padding: '5px 8px', fontSize: 12, resize: 'none',
              background: 'var(--card, rgba(255,255,255,0.05))', border: '1px solid var(--line, rgba(255,255,255,0.09))',
              borderRadius: 5, color: 'var(--ink, #ccc)', boxShadow: 'none',
            }}
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={saving || !text.trim()}
          style={{
            width: '100%', padding: '6px 0', fontSize: 12, fontWeight: 600,
            background: text.trim() ? 'var(--accent)' : 'var(--card, rgba(255,255,255,0.05))',
            border: 'none', borderRadius: 5, color: text.trim() ? '#fff' : 'var(--ink-4, #555)',
            cursor: text.trim() ? 'pointer' : 'default', fontFamily: 'inherit',
          }}
        >
          {saving ? '...' : 'Add note'}
        </button>
      </div>
    </div>
  );
}
