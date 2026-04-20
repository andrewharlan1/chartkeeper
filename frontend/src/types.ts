// ── Core entities ────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Workspace {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: string;
}

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface Ensemble {
  id: string;
  workspaceId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Chart {
  id: string;
  ensembleId: string;
  name: string;
  composer: string | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Version {
  id: string;
  chartId: string;
  name: string;
  sortOrder: number;
  seededFromVersionId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  partCount?: number;
}

export type PartKind = 'part' | 'score';
export type OmrStatus = 'pending' | 'processing' | 'complete' | 'failed';

export interface Part {
  id: string;
  versionId: string;
  kind: PartKind;
  name: string;
  pdfS3Key: string;
  omrStatus: OmrStatus;
  omrEngine: string | null;
  createdAt: string;
  pdfUrl?: string;
}

export interface InstrumentSlot {
  id: string;
  ensembleId: string;
  name: string;
  section: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PartSlotAssignment {
  id: string;
  partId: string;
  instrumentSlotId: string;
  createdAt: string;
}

// ── Annotations ──────────────────────────────────────────────────────────

export type AnchorType = 'measure' | 'beat' | 'note' | 'section' | 'page';
export type AnnotationKind = 'ink' | 'text' | 'highlight' | 'shape';
export type AnnotationScope = 'self' | 'ensemble' | 'section' | 'role' | 'shared';

export interface MeasureAnchor { measureNumber: number; pageHint?: number }
export interface BeatAnchor { measureNumber: number; beat: number; pageHint?: number }
export interface NoteAnchor { measureNumber: number; beat: number; pitch: string; duration: string }
export interface SectionAnchor { sectionLabel: string; measureOffset?: number }
export interface PageAnchor { page: number; measureHint?: number }
export type AnchorJson = MeasureAnchor | BeatAnchor | NoteAnchor | SectionAnchor | PageAnchor;

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AbsoluteSizeBoundingBox {
  x: number;
  y: number;
  widthPageUnits: number;
  heightPageUnits: number;
}

export interface StrokePoint { x: number; y: number }
export interface Stroke {
  points: StrokePoint[];
  color: string;
  width: number;
}

export interface InkContent {
  strokes: Stroke[];
  boundingBox: BoundingBox;
}

export interface TextContent {
  text: string;
  fontSize: number;
  color: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  boundingBox: AbsoluteSizeBoundingBox;
}

export interface HighlightContent {
  color: string;
  opacity: number;
  boundingBox: BoundingBox;
}

export type ContentJson = InkContent | TextContent | HighlightContent | Record<string, unknown>;

export interface Annotation {
  id: string;
  partId: string;
  ownerUserId: string;
  ownerName?: string;
  anchorType: AnchorType;
  anchorJson: AnchorJson;
  kind: AnnotationKind;
  contentJson: ContentJson;
  scope: AnnotationScope;
  layerId: string | null;
  migratedFromAnnotationId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Measure layout / diffs ───────────────────────────────────────────────

export interface MeasureBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  page: number;
}

export interface MeasureLayoutItem extends MeasureBounds {
  measureNumber: number;
  multiRestCount?: number;
}

export interface PartDiff {
  changedMeasures: number[];
  changeDescriptions: Record<number, string>;
  structuralChanges: {
    insertedMeasures: number[];
    deletedMeasures: number[];
    sectionLabelChanges: string[];
  };
  measureMapping: Record<number, number | null>;
  changedMeasureBounds?: Record<number, MeasureBounds>;
}

export interface VersionDiff {
  id: string;
  fromPartId: string;
  toPartId: string;
  diffJson: PartDiff;
  createdAt: string;
}

// ── Player parts (my-parts endpoint) ─────────────────────────────────────

export interface PlayerPart {
  partId: string;
  partName: string;
  kind: PartKind;
  omrStatus: OmrStatus;
  versionId: string;
  versionName: string;
  chartId: string;
  chartName: string;
  ensembleId: string;
  ensembleName: string;
}

// ── Upload helpers (client-only) ─────────────────────────────────────────

export interface UploadEntry {
  id: string;
  file: File;
  name: string;
  kind: PartKind;
  slotIds: string[];
}
