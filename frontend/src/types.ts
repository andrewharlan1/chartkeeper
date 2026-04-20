export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Ensemble {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface EnsembleMember {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'editor' | 'player';
  joined_at: string;
}

export interface EnsembleInstrument {
  id: string;
  name: string;
  display_order: number;
  created_at: string;
}

export interface EnsembleInstrumentAssignment {
  id: string;
  ensemble_instrument_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  assigned_by: string;
  created_at: string;
}

export type AnchorType = 'measure' | 'beat' | 'note' | 'section' | 'page';
export type ContentType = 'text' | 'ink' | 'highlight';

export interface MeasureAnchor { measureNumber: number; pageHint?: number; measureBounds?: { x: number; y: number; w: number; h: number }; }
export interface BeatAnchor { measureNumber: number; beat: number; pageHint?: number; }
export interface NoteAnchor { measureNumber: number; beat: number; pitch: string; duration: string; }
export interface SectionAnchor { sectionLabel: string; measureOffset?: number; }
export interface PageAnchor { page: number; measureHint?: number; }
export type AnchorJson = MeasureAnchor | BeatAnchor | NoteAnchor | SectionAnchor | PageAnchor;

export interface Annotation {
  id: string;
  part_id: string;
  user_id: string;
  user_name: string;
  anchor_type: AnchorType;
  anchor_json: AnchorJson;
  content_type: ContentType;
  content_json: { text?: string; color?: string };
  is_unresolved: boolean;
  migrated_from_annotation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Chart {
  id: string;
  ensemble_id: string;
  title: string | null;
  composer: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
}

export type OmrStatus = 'pending' | 'processing' | 'complete' | 'failed';
export type PartType = 'score' | 'part' | 'audio' | 'chart' | 'link' | 'other';

export interface Part {
  id: string;
  chart_version_id: string;
  instrument_name: string;
  part_type: PartType;
  omr_status: OmrStatus;
  created_at: string;
  pdfUrl?: string;
  url?: string | null;           // for link-type parts
  inherited_from_part_id?: string | null;
  inherited_from_version_number?: number | null;
  inherited_from_version_name?: string | null;
}

export interface PartSummary {
  id: string;
  instrumentName: string;
  partType: PartType;
  omrStatus: OmrStatus;
  inheritedFromPartId?: string | null;
}

export interface UploadEntry {
  id: string;       // client-only stable key
  file?: File;      // undefined for link type
  url?: string;     // for link type
  name: string;     // user-provided display name, used as instrument_name
  type: PartType;
  replaces?: string; // optional: instrument_name of the old part this replaces (for annotation migration)
}

export interface PartAssignment {
  id: string;
  chart_id: string;
  instrument_name: string;
  user_id: string;
  user_name: string;
  user_email: string;
  assigned_by: string;
  created_at: string;
}

export interface PlayerPart {
  assignment_id: string;
  chart_id: string;
  chart_title: string | null;
  ensemble_id: string;
  ensemble_name: string;
  instrument_name: string;
  part_type: PartType;
  part_id: string;
  pdf_url: string | null;
  url: string | null;
  omr_status: OmrStatus;
  version_id: string;
  version_number: number;
  version_name: string;
}

export interface ChartVersion {
  id: string;
  chart_id?: string;
  version_number: number;
  version_name: string;
  is_active: boolean;
  created_at: string;
  created_by_name?: string;
  parts: PartSummary[];
}

export interface MeasureBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  page: number;
}

export interface MeasureLayoutItem extends MeasureBounds {
  measureNumber: number;
  multiRestCount?: number; // present on first measure of a multi-measure rest span
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
  from_version_id: string;
  to_version_id: string;
  diff_json: { parts: Record<string, PartDiff> };
  created_at: string;
}

export interface Notification {
  id: string;
  ensemble_id: string;
  chart_version_id: string | null;
  type: string;
  message: string;
  read_at: string | null;
  created_at: string;
}
