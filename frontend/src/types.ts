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

export interface Chart {
  id: string;
  ensemble_id: string;
  title: string | null;
  composer: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
}

export type OmrStatus = 'pending' | 'processing' | 'complete' | 'failed';

export interface Part {
  id: string;
  chart_version_id: string;
  instrument_name: string;
  omr_status: OmrStatus;
  created_at: string;
  pdfUrl?: string;
}

export interface PartSummary {
  id: string;
  instrumentName: string;
  omrStatus: OmrStatus;
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

export interface PartDiff {
  changedMeasures: number[];
  changeDescriptions: Record<number, string>;
  structuralChanges: {
    insertedMeasures: number[];
    deletedMeasures: number[];
    sectionLabelChanges: string[];
  };
  measureMapping: Record<number, number | null>;
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
