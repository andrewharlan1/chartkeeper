import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getChart, deleteChart, getChartVersionInstruments, InstrumentPart, InstrumentViewResponse } from '../api/charts';
import { getVersions, createVersion } from '../api/versions';
import { updatePart, deletePart } from '../api/parts';
import { getEnsemble } from '../api/ensembles';
import { getInstrumentSlots } from '../api/instrumentSlots';
import { Chart as ChartType, Version, InstrumentSlot } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ContentKindIcon, KIND_LABELS } from '../components/ContentKindIcon';
import { InstrumentIcon } from '../components/InstrumentIcon';
import { SlotAssignmentPicker, InstrumentAssignment } from '../components/SlotAssignmentPicker';
import { ApiError } from '../api/client';
import './ChartDetail.css';

type LayoutMode = 'B' | 'C' | 'D';

function getStoredLayout(): LayoutMode {
  const v = localStorage.getItem('scorva-chart-layout');
  if (v === 'B' || v === 'C' || v === 'D') return v;
  return 'B';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface PartView {
  instrumentName: string;
  part: InstrumentPart | null;
  fileName: string;
  isScore: boolean;
  isChanged: boolean;
  isRemoved: boolean;
  isUnassigned: boolean;
  statusText: string;
  removedVersionName: string | null;
}

function buildPartViews(data: InstrumentViewResponse): PartView[] {
  const views: PartView[] = [];

  // Score parts first
  for (const sp of data.scoreParts) {
    const changed = sp.diffStatus ? sp.diffStatus.changedMeasureCount > 0 : false;
    const statusText = sp.diffStatus
      ? changed
        ? `${data.version.name} \u00b7 ${sp.diffStatus.changedMeasureCount} measure${sp.diffStatus.changedMeasureCount !== 1 ? 's' : ''}`
        : 'carried forward'
      : data.version.name;
    views.push({
      instrumentName: sp.name,
      part: sp,
      fileName: sp.name,
      isScore: true,
      isChanged: changed,
      isRemoved: false,
      isUnassigned: false,
      statusText,
      removedVersionName: null,
    });
  }

  // Active instruments (have current parts)
  for (const inst of data.instruments) {
    if (inst.currentParts.length > 0) {
      const cp = inst.currentParts[0];
      const changed = cp.diffStatus ? cp.diffStatus.changedMeasureCount > 0 : false;
      const statusText = cp.diffStatus
        ? changed
          ? `${data.version.name} \u00b7 ${cp.diffStatus.changedMeasureCount} measure${cp.diffStatus.changedMeasureCount !== 1 ? 's' : ''}`
          : 'carried forward'
        : data.version.name;
      views.push({
        instrumentName: inst.instrumentName,
        part: cp,
        fileName: cp.name,
        isScore: false,
        isChanged: changed,
        isRemoved: false,
        isUnassigned: false,
        statusText,
        removedVersionName: null,
      });
    }
  }

  // Unassigned parts (uploaded without slot assignment)
  for (const up of data.unassignedParts || []) {
    const changed = up.diffStatus ? up.diffStatus.changedMeasureCount > 0 : false;
    views.push({
      instrumentName: up.name,
      part: up,
      fileName: up.name,
      isScore: false,
      isChanged: changed,
      isRemoved: false,
      isUnassigned: true,
      statusText: 'unassigned',
      removedVersionName: null,
    });
  }

  // Removed instruments (no current parts, had previous) — auto-sink to bottom
  for (const inst of data.instruments) {
    if (inst.currentParts.length === 0 && inst.previousVersionParts.length > 0) {
      views.push({
        instrumentName: inst.instrumentName,
        part: null,
        fileName: '\u2014',
        isScore: false,
        isChanged: false,
        isRemoved: true,
        isUnassigned: false,
        statusText: `removed in ${data.version.name}`,
        removedVersionName: data.version.name,
      });
    }
  }

  return views;
}

// ── Mini score thumbnail ─────────────────────────────────────────────────────

function MiniScoreThumb({ kind = 'part', changed = false }: { kind?: string; changed?: boolean }) {
  const isScore = kind === 'score';
  const systems = [0, 1, 2];
  const lines = isScore ? 4 : 1;
  return (
    <div className="mini-thumb">
      {systems.map((_, si) => (
        <div className="mt-system" key={si}>
          {Array.from({ length: lines }).map((__, li) => (
            <div className="mt-staff" key={li}>
              {[0, 1, 2, 3, 4].map(k => <div className="mt-line" key={k} />)}
              {changed && si === 1 && li === (isScore ? 2 : 0) && <div className="mt-mark" />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Unassigned part tile ─────────────────────────────────────────────────────

function UnassignedPartTile({ partView, slots, onAssign, onDelete }: {
  partView: PartView;
  slots: InstrumentSlot[];
  onAssign: (partId: string, slotIds: string[], assignments: InstrumentAssignment[]) => void;
  onDelete: (partId: string, partName: string) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<InstrumentAssignment[]>([]);
  const partId = partView.part!.partId;
  const hasSelection = selectedIds.length > 0 || assignments.some(a => 'newInstrumentName' in a);

  // Derive preview name from first selected slot
  const previewName = (() => {
    if (assignments.length > 0) {
      const first = assignments[0];
      if ('newInstrumentName' in first) return first.newInstrumentName;
      const slot = slots.find(s => s.id === first.existingSlotId);
      if (slot) return slot.name;
    }
    if (selectedIds.length > 0) {
      const slot = slots.find(s => s.id === selectedIds[0]);
      if (slot) return slot.name;
    }
    return null;
  })();

  return (
    <article className="part-tile" style={{ borderStyle: 'dashed', borderColor: 'var(--accent)' }}>
      <header className="pt-head">
        <span className="pt-icn" style={{ opacity: 0.4 }}>
          {previewName ? <InstrumentIcon name={previewName} size={20} /> : '?'}
        </span>
        <span className="pt-name" style={{ color: hasSelection ? 'var(--text)' : 'var(--text-muted)' }}>
          {previewName || 'Unassigned'}
        </span>
        <button
          className="pt-edit-btn pt-delete-btn"
          title="Delete part"
          onClick={(e) => { e.stopPropagation(); onDelete(partId, partView.fileName); }}
        >×</button>
        <span className="pt-status" style={{ color: 'var(--accent)' }}>unassigned</span>
      </header>
      <div style={{ padding: '10px 12px' }}>
        <SlotAssignmentPicker
          slots={slots}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
          onAssignmentsChange={setAssignments}
        />
      </div>
      <footer className="pt-foot">
        <span className="pt-file" title={partView.fileName}>{partView.fileName}</span>
        {hasSelection && (
          <Button size="sm" onClick={() => onAssign(partId, selectedIds, assignments)}>
            Assign
          </Button>
        )}
      </footer>
    </article>
  );
}

// ── Rename modal ────────────────────────────────────────────────────────────

function RenameModal({ currentName, onSave, onClose }: {
  currentName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(currentName);
  return (
    <Modal title="Rename part" onClose={onClose}>
      <div className="form-group">
        <label>Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()); }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => name.trim() && onSave(name.trim())} disabled={!name.trim()}>Save</Button>
      </div>
    </Modal>
  );
}

// ── Layout B: Score hero + parts tiles ───────────────────────────────────────

function LayoutB({ parts, chartId, versionId, slots, onAssign, onRename, onDelete }: {
  parts: PartView[];
  chartId: string;
  versionId: string;
  slots: InstrumentSlot[];
  onAssign: (partId: string, slotIds: string[], assignments: InstrumentAssignment[]) => void;
  onRename: (partId: string, newName: string) => void;
  onDelete: (partId: string, partName: string) => void;
}) {
  const [renamingPartId, setRenamingPartId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState('');

  const score = parts.find(p => p.isScore);
  const instruments = parts.filter(p => !p.isScore);
  const assignedParts = instruments.filter(p => !p.isRemoved && !p.isUnassigned);
  const unassignedParts = instruments.filter(p => p.isUnassigned);
  const activeParts = instruments.filter(p => !p.isRemoved);
  const removedParts = instruments.filter(p => p.isRemoved);
  const changedCount = activeParts.filter(p => p.isChanged).length;

  return (
    <>
      {/* Hero: score card */}
      {score && (
        <article className="score-hero" tabIndex={0}>
          <div className="sh-thumb">
            <MiniScoreThumb kind="score" changed={score.isChanged} />
            {score.isChanged && <span className="sh-flag">{score.statusText}</span>}
          </div>
          <div className="sh-body">
            <div className="sh-eyebrow">Conductor's Score</div>
            <h2 className="sh-title">{score.fileName}</h2>
            <div className="sh-meta">
              {score.part && (
                <>
                  <span>{KIND_LABELS[score.part.kind as keyof typeof KIND_LABELS] || score.part.kind}</span>
                  <span className="dot">·</span>
                </>
              )}
              <span>{score.statusText}</span>
            </div>
          </div>
          <div className="sh-actions">
            <Link to={score.part ? `/charts/${chartId}/versions/${versionId}/parts/${score.part.partId}` : `/charts/${chartId}/versions/${versionId}`}>
              <Button size="sm" variant="secondary">Open score</Button>
            </Link>
          </div>
        </article>
      )}

      {/* Parts tiles */}
      <div className="parts-tiles-head">
        <h3 className="ps-title">Parts</h3>
        <span className="ps-meta">
          {activeParts.length} active{changedCount > 0 && ` \u00b7 ${changedCount} changed`}
        </span>
      </div>

      <div className="parts-tiles">
        {assignedParts.map(p => (
          <article className={'part-tile' + (p.isChanged ? ' changed' : '')} key={p.instrumentName} tabIndex={0}>
            <header className="pt-head">
              <span className="pt-icn"><InstrumentIcon name={p.instrumentName} size={20} /></span>
              <span className="pt-name">{p.instrumentName}</span>
              <button
                className="pt-edit-btn"
                title="Rename part"
                onClick={(e) => {
                  e.stopPropagation();
                  if (p.part) {
                    setRenamingPartId(p.part.partId);
                    setRenamingName(p.instrumentName);
                  }
                }}
              >&#9998;</button>
              <button
                className="pt-edit-btn pt-delete-btn"
                title="Delete part"
                onClick={(e) => {
                  e.stopPropagation();
                  if (p.part) onDelete(p.part.partId, p.instrumentName);
                }}
              >×</button>
              <span className={'pt-status ' + (p.isChanged ? 'is-changed' : '')}>
                {p.statusText}
              </span>
            </header>
            <div className="pt-thumb">
              <MiniScoreThumb kind="part" changed={p.isChanged} />
            </div>
            <footer className="pt-foot">
              <span className="pt-file">{p.fileName}</span>
              <Link to={`/charts/${chartId}/versions/${versionId}/parts/${p.part!.partId}`}>
                <Button size="sm" variant="secondary">Open</Button>
              </Link>
            </footer>
          </article>
        ))}

        {/* Unassigned parts — need instrument assignment */}
        {unassignedParts.map(p => p.part && (
          <UnassignedPartTile
            key={p.part.partId}
            partView={p}
            slots={slots}
            onAssign={onAssign}
            onDelete={onDelete}
          />
        ))}

        {/* Removed parts — auto-sunk to bottom */}
        {removedParts.map(p => (
          <article className="part-tile removed" key={p.instrumentName}>
            <header className="pt-head">
              <span className="pt-icn"><InstrumentIcon name={p.instrumentName} size={20} /></span>
              <span className="pt-name">{p.instrumentName}</span>
              <span className="pt-removed-tag">{p.statusText}</span>
            </header>
            <div className="pt-thumb">
              <MiniScoreThumb kind="part" />
            </div>
            <footer className="pt-foot">
              <span className="pt-file">{p.fileName}</span>
            </footer>
          </article>
        ))}

        {/* Add parts card */}
        <Link to={`/charts/${chartId}/upload`} className="part-tile add-part-tile" style={{ textDecoration: 'none' }}>
          <div className="add-part-inner">
            <span className="add-part-icon">+</span>
            <span className="add-part-label">Add parts</span>
          </div>
        </Link>
      </div>

      {/* Rename modal */}
      {renamingPartId && (
        <RenameModal
          currentName={renamingName}
          onClose={() => setRenamingPartId(null)}
          onSave={(name) => {
            onRename(renamingPartId, name);
            setRenamingPartId(null);
          }}
        />
      )}
    </>
  );
}

// ── Layout C: Score-led ──────────────────────────────────────────────────────

function LayoutC({ parts, chartId, versionId, slots: _slots, onAssign: _onAssign }: {
  parts: PartView[];
  chartId: string;
  versionId: string;
  slots: InstrumentSlot[];
  onAssign: (partId: string, slotIds: string[], assignments: InstrumentAssignment[]) => void;
}) {
  return (
    <div className="score-led">
      {/* Full page score area */}
      <div className="score-led-hero">
        <div className="sl-bar">
          <span className="l">Score · Conductor's view</span>
          <Link to={(() => { const s = parts.find(p => p.isScore && p.part); return s?.part ? `/charts/${chartId}/versions/${versionId}/parts/${s.part.partId}` : `/charts/${chartId}/versions/${versionId}`; })()} style={{ fontSize: 12, color: 'var(--accent)' }}>
            Open
          </Link>
          <span className="pn">
            {parts.filter(p => !p.isRemoved).length} parts
          </span>
        </div>
        <div className="sl-page">
          {[0, 1, 2].map(si => (
            <div className="sl-system" key={si}>
              {[0, 1, 2, 3, 4].map(i => <div className="sl-line" key={i} />)}
            </div>
          ))}
        </div>
      </div>

      {/* Horizontal parts strip */}
      <div className="parts-strip">
        {parts.filter(p => !p.isRemoved).map(p => (
          <Link
            className={'part-strip-item' + (p.isChanged ? ' has-change' : '')}
            to={p.part ? `/charts/${chartId}/versions/${versionId}/parts/${p.part.partId}` : `/charts/${chartId}/versions/${versionId}`}
            key={p.instrumentName}
            style={{ textDecoration: 'none' }}
          >
            <div className="top">
              <span className="icn">
                {p.isScore
                  ? <ContentKindIcon kind="score" size={20} />
                  : <InstrumentIcon name={p.instrumentName} size={20} />
                }
              </span>
              <span className="name">{p.instrumentName}</span>
            </div>
            <div className="meta">
              <span style={{ color: p.isChanged ? 'var(--accent)' : undefined }}>
                {p.statusText}
              </span>
            </div>
          </Link>
        ))}

        {/* Removed parts at end of strip */}
        {parts.filter(p => p.isRemoved).map(p => (
          <div className="part-strip-item" key={p.instrumentName} style={{ opacity: 0.5 }}>
            <div className="top">
              <span className="icn"><InstrumentIcon name={p.instrumentName} size={20} /></span>
              <span className="name" style={{ textDecoration: 'line-through' }}>{p.instrumentName}</span>
            </div>
            <div className="meta">
              <span>{p.statusText}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Layout D: Compact list ───────────────────────────────────────────────────

function LayoutD({ parts, chartId, versionId, slots: _slots, onAssign: _onAssign }: {
  parts: PartView[];
  chartId: string;
  versionId: string;
  slots: InstrumentSlot[];
  onAssign: (partId: string, slotIds: string[], assignments: InstrumentAssignment[]) => void;
}) {
  return (
    <div className="compact-list">
      {parts.filter(p => !p.isRemoved).map(p => (
        <Link
          className="compact-row"
          to={p.part ? `/charts/${chartId}/versions/${versionId}/parts/${p.part.partId}` : `/charts/${chartId}/versions/${versionId}`}
          key={p.instrumentName}
          style={{ textDecoration: 'none' }}
        >
          <span className="icn">
            {p.isScore
              ? <ContentKindIcon kind="score" size={20} />
              : <InstrumentIcon name={p.instrumentName} size={20} />
            }
          </span>
          <span>
            <div className="nm">
              {p.instrumentName}
              {p.isScore && <span className="score-tag">SCORE</span>}
            </div>
            <div className="filename">{p.fileName}</div>
          </span>
          <span className="right">
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 11,
              color: p.isChanged ? 'var(--accent)' : 'var(--text-muted)',
            }}>
              {p.statusText}
            </span>
          </span>
        </Link>
      ))}

      {/* Removed parts — auto-sunk to bottom */}
      {parts.filter(p => p.isRemoved).map(p => (
        <div className="compact-row" key={p.instrumentName} style={{ opacity: 0.5 }}>
          <span className="icn">
            <InstrumentIcon name={p.instrumentName} size={20} />
          </span>
          <span>
            <div className="nm" style={{ textDecoration: 'line-through' }}>{p.instrumentName}</div>
            <div className="filename">{p.fileName}</div>
          </span>
          <span className="right">
            <span className="pt-removed-tag">{p.statusText}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── ChartPage ────────────────────────────────────────────────────────────────

export function ChartPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [chart, setChart] = useState<ChartType | null>(null);
  const [ensembleName, setEnsembleName] = useState('');
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [instrumentData, setInstrumentData] = useState<InstrumentViewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingInstruments, setLoadingInstruments] = useState(false);

  const [showCreateVersion, setShowCreateVersion] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [versionError, setVersionError] = useState('');
  const [deletingChart, setDeletingChart] = useState(false);

  const [slots, setSlots] = useState<InstrumentSlot[]>([]);
  const [layout, setLayout] = useState<LayoutMode>(getStoredLayout);

  function handleLayoutChange(mode: LayoutMode) {
    setLayout(mode);
    localStorage.setItem('scorva-chart-layout', mode);
  }

  // Load chart and versions
  useEffect(() => {
    if (!id) return;
    Promise.all([
      getChart(id),
      getVersions(id),
    ]).then(async ([chartRes, versRes]) => {
      setChart(chartRes.chart);
      setVersions(versRes.versions);
      const current = versRes.versions.find(v => v.isCurrent);
      const sorted = [...versRes.versions].sort((a, b) => b.sortOrder - a.sortOrder);
      setSelectedVersionId(current?.id ?? sorted[0]?.id ?? null);
      try {
        const [{ ensemble }, { instrumentSlots: sl }] = await Promise.all([
          getEnsemble(chartRes.chart.ensembleId),
          getInstrumentSlots(chartRes.chart.ensembleId),
        ]);
        setEnsembleName(ensemble.name);
        setSlots(sl);
      } catch { /* breadcrumb will just be missing ensemble name */ }
    }).catch(() => navigate('/'))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  // Load instrument data when selected version changes
  const loadInstruments = useCallback(async (chartId: string, versionId: string) => {
    setLoadingInstruments(true);
    try {
      const data = await getChartVersionInstruments(chartId, versionId);
      setInstrumentData(data);
    } catch {
      setInstrumentData(null);
    } finally {
      setLoadingInstruments(false);
    }
  }, []);

  useEffect(() => {
    if (!id || !selectedVersionId) return;
    loadInstruments(id, selectedVersionId);
  }, [id, selectedVersionId, loadInstruments]);

  async function handleCreateVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setVersionError('');
    setCreatingVersion(true);
    try {
      const { version } = await createVersion({ chartId: id, name: versionName.trim() || 'New Version' });
      setVersions(prev => [version, ...prev]);
      setSelectedVersionId(version.id);
      setShowCreateVersion(false);
      setVersionName('');
    } catch (err) {
      setVersionError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setCreatingVersion(false);
    }
  }

  async function handleDeleteChart() {
    if (!id || !chart) return;
    if (!confirm(`Delete "${chart.name}"? All versions and parts will be deleted.`)) return;
    setDeletingChart(true);
    try {
      await deleteChart(id);
      navigate(`/ensembles/${chart.ensembleId}`);
    } catch {
      alert('Failed to delete chart.');
      setDeletingChart(false);
    }
  }

  async function handleDeletePart(partId: string, partName: string) {
    if (!confirm(`Delete "${partName}"? This cannot be undone.`)) return;
    try {
      await deletePart(partId);
      if (id && selectedVersionId) {
        loadInstruments(id, selectedVersionId);
      }
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete part');
    }
  }

  async function handleRenamePart(partId: string, newName: string) {
    try {
      await updatePart(partId, { name: newName });
      if (id && selectedVersionId) {
        loadInstruments(id, selectedVersionId);
      }
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to rename part');
    }
  }

  async function handleAssignPart(partId: string, slotIds: string[], assignments: InstrumentAssignment[]) {
    // Determine the display name from the slot or new instrument
    let newName: string | undefined;
    if (assignments.length > 0) {
      const first = assignments[0];
      if ('newInstrumentName' in first) {
        newName = first.newInstrumentName;
      } else {
        const slot = slots.find(s => s.id === first.existingSlotId);
        if (slot) newName = slot.name;
      }
    } else if (slotIds.length > 0) {
      const slot = slots.find(s => s.id === slotIds[0]);
      if (slot) newName = slot.name;
    }

    try {
      await updatePart(partId, {
        name: newName,
        slotIds: assignments.some(a => 'newInstrumentName' in a) ? undefined : slotIds,
        instrumentAssignments: assignments.some(a => 'newInstrumentName' in a) ? assignments : undefined,
      });
      // Reload instrument data to reflect the change
      if (id && selectedVersionId) {
        loadInstruments(id, selectedVersionId);
        // Reload slots in case new instruments were created
        if (chart) {
          getInstrumentSlots(chart.ensembleId).then(r => setSlots(r.instrumentSlots)).catch(() => {});
        }
      }
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to assign part');
    }
  }

  const sortedVersions = [...versions].sort((a, b) => b.sortOrder - a.sortOrder);
  const selectedVersion = versions.find(v => v.id === selectedVersionId);
  const partViews = instrumentData ? buildPartViews(instrumentData) : [];

  if (loading) return <Layout><p style={{ color: 'var(--text-muted)' }}>Loading...</p></Layout>;
  if (!chart) return null;

  return (
    <Layout
      title={chart.name}
      backTo={`/ensembles/${chart.ensembleId}`}
      breadcrumbs={[
        { label: 'Home', to: '/' },
        ...(ensembleName ? [{ label: ensembleName, to: `/ensembles/${chart.ensembleId}` }] : []),
        { label: chart.name },
      ]}
      actions={
        <>
          {/* Layout toggle */}
          <div className="layout-toggle">
            {(['B', 'C', 'D'] as LayoutMode[]).map(m => (
              <button
                key={m}
                className={layout === m ? 'active' : ''}
                onClick={() => handleLayoutChange(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <Button size="sm" variant="secondary" onClick={() => setShowCreateVersion(true)}>+ New version</Button>
          <Link to={`/charts/${id}/upload`}>
            <Button variant="secondary" size="sm">Upload parts</Button>
          </Link>
          <Button variant="danger" size="sm" loading={deletingChart} onClick={handleDeleteChart}>
            Delete chart
          </Button>
        </>
      }
    >
      {chart.composer && <p style={{ color: 'var(--text-muted)', marginTop: -20, marginBottom: 24 }}>by {chart.composer}</p>}

      {/* Version selector */}
      {versions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
          <p style={{ marginBottom: 8 }}>No versions yet.</p>
          <p style={{ fontSize: 13, marginBottom: 20 }}>Upload PDFs to create the first version of this chart.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <Link to={`/charts/${id}/upload`}>
              <Button>Upload parts</Button>
            </Link>
            <Button variant="secondary" onClick={() => setShowCreateVersion(true)}>Create empty version</Button>
          </div>
        </div>
      ) : (
        <>
          {/* Chart head: version selector row */}
          <div className="chart-head">
            <select
              className="ch-version"
              value={selectedVersionId || ''}
              onChange={e => setSelectedVersionId(e.target.value)}
            >
              {sortedVersions.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name}{v.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </select>
            <span className="ch-meta">
              {partViews.filter(p => !p.isRemoved).length} parts
              {partViews.some(p => p.isRemoved) && ` \u00b7 ${partViews.filter(p => p.isRemoved).length} removed`}
            </span>
            {selectedVersion && (
              <Link to={`/charts/${id}/versions/${selectedVersion.id}`} style={{ fontSize: 13 }}>
                Open version detail
              </Link>
            )}
          </div>

          {/* Layout content */}
          {loadingInstruments ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading instruments...</p>
          ) : instrumentData ? (
            partViews.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                <p style={{ marginBottom: 8 }}>No instruments defined yet.</p>
                <Link to={`/ensembles/${chart.ensembleId}`}>
                  <Button variant="secondary">Add instruments to this ensemble</Button>
                </Link>
              </div>
            ) : (
              <>
                {layout === 'B' && <LayoutB parts={partViews} chartId={id!} versionId={selectedVersionId!} slots={slots} onAssign={handleAssignPart} onRename={handleRenamePart} onDelete={handleDeletePart} />}
                {layout === 'C' && <LayoutC parts={partViews} chartId={id!} versionId={selectedVersionId!} slots={slots} onAssign={handleAssignPart} />}
                {layout === 'D' && <LayoutD parts={partViews} chartId={id!} versionId={selectedVersionId!} slots={slots} onAssign={handleAssignPart} />}
              </>
            )
          ) : null}
        </>
      )}

      {/* Create version modal */}
      {showCreateVersion && (
        <Modal title="New Version" onClose={() => setShowCreateVersion(false)}>
          <form onSubmit={handleCreateVersion}>
            <div className="form-group">
              <label>Version Name</label>
              <input value={versionName} onChange={e => setVersionName(e.target.value)} autoFocus placeholder="e.g. v2, Revised, March rehearsal" />
            </div>
            {versionError && <p className="form-error">{versionError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <Button variant="secondary" type="button" onClick={() => setShowCreateVersion(false)}>Cancel</Button>
              <Button type="submit" loading={creatingVersion}>Create</Button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}
