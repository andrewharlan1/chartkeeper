import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  pgEnum,
  unique,
  index,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
};

// ── Enums ──────────────────────────────────────────────────────────────────

export const partKindEnum = pgEnum('part_kind', ['part', 'score', 'chart', 'link', 'audio', 'other']);
export const annotationScopeEnum = pgEnum('annotation_scope', [
  'self',
  'ensemble',
  'section',
  'role',
  'shared',
]);
export const annotationKindEnum = pgEnum('annotation_kind', [
  'ink',
  'text',
  'highlight',
  'shape',  // schema only; not creatable through v1 UI
]);
export const workspaceRoleEnum = pgEnum('workspace_role', [
  'owner',
  'admin',
  'member',
  'viewer',
]);

// ── Users ──────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  ...timestamps,
});

// ── Workspaces ─────────────────────────────────────────────────────────────

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

// ── Workspace Members ──────────────────────────────────────────────────────

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRoleEnum('role').notNull().default('member'),
    ...timestamps,
  },
  (t) => ({
    uniqMembership: unique().on(t.workspaceId, t.userId),
    userIdx: index('workspace_members_user_idx').on(t.userId),
  }),
);

// ── Ensembles ──────────────────────────────────────────────────────────────

export const ensembles = pgTable(
  'ensembles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    workspaceIdx: index('ensembles_workspace_idx').on(t.workspaceId),
  }),
);

// ── Charts ────────────────────────────────────────────────────────────────

export const charts = pgTable(
  'charts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ensembleId: uuid('ensemble_id').notNull().references(() => ensembles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    composer: text('composer'),
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    ensembleIdx: index('charts_ensemble_idx').on(t.ensembleId),
  }),
);

// ── Instrument Slots ───────────────────────────────────────────────────────

export const instrumentSlots = pgTable(
  'instrument_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ensembleId: uuid('ensemble_id').notNull().references(() => ensembles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    section: text('section'),
    sortOrder: integer('sort_order').notNull().default(0),
    // Auto-detected from OMR. User override takes precedence when set.
    // TODO(propagation): consult this for multi-staff grouping decisions.
    staffGroupingOverride: jsonb('staff_grouping_override').$type<{ mode: 'single' | 'grand-staff' | 'custom'; staves?: number }>(),
    ...timestamps,
  },
  (t) => ({
    ensembleIdx: index('instrument_slots_ensemble_idx').on(t.ensembleId),
  }),
);

// ── Versions ───────────────────────────────────────────────────────────────

export const versions = pgTable(
  'versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chartId: uuid('chart_id').notNull().references(() => charts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    seededFromVersionId: uuid('seeded_from_version_id').references((): any => versions.id),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    chartIdx: index('versions_chart_idx').on(t.chartId),
  }),
);

// ── Parts ──────────────────────────────────────────────────────────────────

export const parts = pgTable(
  'parts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionId: uuid('version_id').notNull().references(() => versions.id, { onDelete: 'cascade' }),
    kind: partKindEnum('kind').notNull().default('part'),
    name: text('name').notNull(),
    pdfS3Key: text('pdf_s3_key'),
    audiverisMxlS3Key: text('audiveris_mxl_s3_key'),
    omrJson: jsonb('omr_json'),
    omrStatus: text('omr_status').notNull().default('pending'),
    omrEngine: text('omr_engine'),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id),

    // Kind-specific fields
    linkUrl: text('link_url'),                            // 'link' kind
    audioDurationSeconds: integer('audio_duration_seconds'), // 'audio' kind
    audioMimeType: text('audio_mime_type'),                // 'audio' kind

    ...timestamps,
  },
  (t) => ({
    versionIdx: index('parts_version_idx').on(t.versionId),
  }),
);

// ── Part–Slot Assignments (many-to-many) ──────────────────────────────────

export const partSlotAssignments = pgTable(
  'part_slot_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partId: uuid('part_id').notNull().references(() => parts.id, { onDelete: 'cascade' }),
    instrumentSlotId: uuid('instrument_slot_id').notNull().references(() => instrumentSlots.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => ({
    uniq: unique('part_slot_uniq').on(t.partId, t.instrumentSlotId),
    partIdx: index('part_slot_assignments_part_idx').on(t.partId),
    slotIdx: index('part_slot_assignments_slot_idx').on(t.instrumentSlotId),
  }),
);

// ── Annotation Layers ──────────────────────────────────────────────────────

export const annotationLayers = pgTable(
  'annotation_layers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ensembleId: uuid('ensemble_id').notNull().references(() => ensembles.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
);

// ── Annotations ────────────────────────────────────────────────────────────

export const annotations = pgTable(
  'annotations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partId: uuid('part_id').notNull().references(() => parts.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),

    // Anchoring
    anchorType: text('anchor_type').notNull(),
    anchorJson: jsonb('anchor_json').notNull(),

    // Content
    kind: annotationKindEnum('kind').notNull(),
    contentJson: jsonb('content_json').notNull(),

    // v1: always 'self' and null. Schema commitments preserved for future.
    scope: annotationScopeEnum('scope').notNull().default('self'),
    layerId: uuid('layer_id').references(() => annotationLayers.id),

    // Propagation (deferred UI, schema ready)
    sourceAnnotationId: uuid('source_annotation_id').references((): any => annotations.id),
    sourceVersionId: uuid('source_version_id').references(() => versions.id),

    // Migration metadata
    migratedFromAnnotationId: uuid('migrated_from_annotation_id').references((): any => annotations.id),

    ...timestamps,
  },
  (t) => ({
    partIdx: index('annotations_part_idx').on(t.partId),
    ownerIdx: index('annotations_owner_idx').on(t.ownerUserId),
    activeIdx: index('annotations_active_idx').on(t.partId, t.deletedAt),
  }),
);

// ── Version Diffs ──────────────────────────────────────────────────────────

export const versionDiffs = pgTable(
  'version_diffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromPartId: uuid('from_part_id').notNull().references(() => parts.id, { onDelete: 'cascade' }),
    toPartId: uuid('to_part_id').notNull().references(() => parts.id, { onDelete: 'cascade' }),
    diffJson: jsonb('diff_json').notNull(),
    ...timestamps,
  },
  (t) => ({
    fromToIdx: index('version_diffs_from_to_idx').on(t.fromPartId, t.toPartId),
    uniq: unique('version_diffs_uniq').on(t.fromPartId, t.toPartId),
  }),
);
