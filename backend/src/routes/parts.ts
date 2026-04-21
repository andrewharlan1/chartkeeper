import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import multer from 'multer';
import { dz, db } from '../db';
import { parts, versions, charts, ensembles, partSlotAssignments, instrumentSlots, versionDiffs } from '../schema';
import { requireAuth } from '../middleware/auth';
import { requireEnsembleMember, requireEnsembleAdmin } from '../lib/ensembleAuth';
import { s3, BUCKET, uploadFile } from '../lib/s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { enqueueJob } from '../lib/queue';
import { migratePartAnnotations } from '../lib/annotation-migration';

export const partsRouter = Router();
partsRouter.use(requireAuth);

const MAX_SIZE_BYTES = parseInt(process.env.PDF_MAX_SIZE_MB ?? '50') * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'application/pdf' ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype === 'application/vnd.recordare.musicxml+xml' ||
      file.mimetype === 'application/xml' ||
      file.mimetype === 'text/xml'
    ) {
      cb(null, true);
    } else {
      // Allow any file for 'other' kind — mime check is advisory, kind validation is authoritative
      cb(null, true);
    }
  },
});

function isHttpError(err: unknown): err is { status: number; message: string } {
  return typeof err === 'object' && err !== null && 'status' in err && 'message' in err;
}

function handleError(err: unknown, res: Response): void {
  if (isHttpError(err)) {
    res.status(err.status).json({ error: err.message });
  } else {
    throw err;
  }
}

/** Resolve a part to its ensemble for auth. Returns null if part not found. */
async function getPartWithEnsemble(partId: string) {
  const rows = await dz.select({
    id: parts.id,
    versionId: parts.versionId,
    kind: parts.kind,
    name: parts.name,
    pdfS3Key: parts.pdfS3Key,
    audiverisMxlS3Key: parts.audiverisMxlS3Key,
    omrStatus: parts.omrStatus,
    omrJson: parts.omrJson,
    omrEngine: parts.omrEngine,
    createdAt: parts.createdAt,
    ensembleId: charts.ensembleId,
    linkUrl: parts.linkUrl,
    audioDurationSeconds: parts.audioDurationSeconds,
    audioMimeType: parts.audioMimeType,
  })
    .from(parts)
    .innerJoin(versions, eq(versions.id, parts.versionId))
    .innerJoin(charts, eq(charts.id, versions.chartId))
    .where(and(eq(parts.id, partId), isNull(parts.deletedAt)));

  return rows[0] ?? null;
}

/** Resolve a version to its ensemble. */
async function getVersionWithEnsemble(versionId: string) {
  const rows = await dz.select({
    id: versions.id,
    chartId: versions.chartId,
    ensembleId: charts.ensembleId,
  })
    .from(versions)
    .innerJoin(charts, eq(charts.id, versions.chartId))
    .where(eq(versions.id, versionId));
  return rows[0] ?? null;
}

// GET /parts?versionId=...
partsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const versionId = req.query.versionId as string | undefined;
  if (!versionId) {
    res.status(400).json({ error: 'versionId query parameter is required' });
    return;
  }

  const ver = await getVersionWithEnsemble(versionId);
  if (!ver) { res.status(404).json({ error: 'Version not found' }); return; }

  try {
    await requireEnsembleMember(ver.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const rows = await dz.select()
    .from(parts)
    .where(and(eq(parts.versionId, versionId), isNull(parts.deletedAt)))
    .orderBy(parts.kind, parts.name);

  res.json({ parts: rows });
});

/**
 * Title-case a string: "french horn" → "French Horn"
 */
function titleCase(s: string): string {
  return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Resolve instrument assignments: existing slot IDs are used directly,
 * new instrument names get matched case-insensitively to existing slots
 * or auto-created in the ensemble roster.
 */
async function resolveInstrumentAssignments(
  ensembleId: string,
  raw: Array<{ existingSlotId?: string; newInstrumentName?: string }>,
): Promise<string[]> {
  const resolvedIds: string[] = [];

  // Pre-fetch existing slots for case-insensitive matching
  const existingSlots = await dz.select({ id: instrumentSlots.id, name: instrumentSlots.name })
    .from(instrumentSlots)
    .where(and(eq(instrumentSlots.ensembleId, ensembleId), isNull(instrumentSlots.deletedAt)));

  const slotNameMap = new Map(existingSlots.map(s => [s.name.toLowerCase().trim(), s.id]));

  for (const assignment of raw) {
    if (assignment.existingSlotId) {
      resolvedIds.push(assignment.existingSlotId);
    } else if (assignment.newInstrumentName) {
      const normalized = assignment.newInstrumentName.trim();
      if (!normalized) continue;
      const lowerName = normalized.toLowerCase();

      // Check for case-insensitive match to existing slot
      const existingId = slotNameMap.get(lowerName);
      if (existingId) {
        resolvedIds.push(existingId);
        continue;
      }

      // Create new instrument slot
      const displayName = titleCase(normalized);
      const [{ next }] = await dz.select({
        next: sql<number>`coalesce(max(${instrumentSlots.sortOrder}), -1) + 1`,
      }).from(instrumentSlots).where(eq(instrumentSlots.ensembleId, ensembleId));

      const [slot] = await dz.insert(instrumentSlots).values({
        ensembleId,
        name: displayName,
        sortOrder: Number(next),
      }).returning();

      resolvedIds.push(slot.id);
      // Update the map so duplicate names in the same upload don't create duplicates
      slotNameMap.set(lowerName, slot.id);
    }
  }

  return [...new Set(resolvedIds)]; // deduplicate
}

// Valid part kinds
const VALID_KINDS = ['part', 'score', 'chart', 'link', 'audio', 'other'] as const;
type ValidKind = typeof VALID_KINDS[number];

// Kinds that go through OMR
const OMR_KINDS: ValidKind[] = ['part', 'score', 'chart'];

// POST /parts  (multipart upload)
partsRouter.post('/', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  const versionId = typeof req.body.versionId === 'string' ? req.body.versionId : undefined;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';

  if (!versionId || !name) {
    res.status(400).json({ error: 'versionId and name are required' });
    return;
  }

  const ver = await getVersionWithEnsemble(versionId);
  if (!ver) { res.status(404).json({ error: 'Version not found' }); return; }

  try {
    await requireEnsembleAdmin(ver.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const rawKind = typeof req.body.kind === 'string' ? req.body.kind : 'part';
  const kind: ValidKind = VALID_KINDS.includes(rawKind as ValidKind) ? rawKind as ValidKind : 'part';

  // Parse instrument assignments — supports both old slotIds and new instrumentAssignments
  let slotIds: string[] = [];
  if (typeof req.body.instrumentAssignments === 'string') {
    try {
      const raw = JSON.parse(req.body.instrumentAssignments);
      if (Array.isArray(raw) && raw.length > 0) {
        slotIds = await resolveInstrumentAssignments(ver.ensembleId, raw);
      }
    } catch { /* ignore */ }
  }
  // Backward-compatible: plain slotIds array
  if (slotIds.length === 0 && typeof req.body.slotIds === 'string') {
    try { slotIds = JSON.parse(req.body.slotIds); } catch { /* ignore */ }
  }

  // Handle 'link' kind — no file required
  if (kind === 'link') {
    const linkUrl = typeof req.body.linkUrl === 'string' ? req.body.linkUrl.trim() : '';
    if (!linkUrl) {
      res.status(400).json({ error: 'linkUrl is required for link kind' });
      return;
    }

    const [part] = await dz.insert(parts).values({
      versionId,
      kind,
      name,
      pdfS3Key: null,
      linkUrl,
      omrStatus: 'complete', // no OMR for links
      uploadedByUserId: req.user!.id,
    }).returning();

    if (slotIds.length > 0) {
      await dz.insert(partSlotAssignments).values(
        slotIds.map(slotId => ({ partId: part.id, instrumentSlotId: slotId }))
      );
    }

    res.status(201).json({ part });
    return;
  }

  // All other kinds require a file
  const file = req.file;
  if (!file) { res.status(400).json({ error: 'file is required' }); return; }

  const s3SafeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const extMap: Record<string, string> = {
    'application/pdf': '.pdf',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/ogg': '.ogg',
    'audio/flac': '.flac',
  };
  const ext = extMap[file.mimetype] ?? (file.mimetype.startsWith('audio/') ? '.audio' : '.bin');
  const s3Key = `ensembles/${ver.ensembleId}/versions/${versionId}/parts/${s3SafeName}${ext}`;
  await uploadFile(s3Key, file.buffer, file.mimetype);

  // Parse optional audio metadata
  const audioDurationSeconds = kind === 'audio' && req.body.audioDurationSeconds
    ? parseInt(req.body.audioDurationSeconds) || null
    : null;
  const audioMimeType = kind === 'audio' ? file.mimetype : null;

  // Determine OMR status: notation kinds start pending, others are immediately complete
  const omrStatus = OMR_KINDS.includes(kind) ? 'pending' : 'complete';

  const [part] = await dz.insert(parts).values({
    versionId,
    kind,
    name,
    pdfS3Key: s3Key,
    omrStatus,
    uploadedByUserId: req.user!.id,
    audioDurationSeconds,
    audioMimeType,
  }).returning();

  // Create slot assignments if provided
  if (slotIds.length > 0) {
    await dz.insert(partSlotAssignments).values(
      slotIds.map(slotId => ({ partId: part.id, instrumentSlotId: slotId }))
    );
  }

  // Enqueue OMR only for notation kinds with PDF files
  if (OMR_KINDS.includes(kind) && file.mimetype === 'application/pdf') {
    await enqueueJob('omr', {
      partId: part.id,
      pdfS3Key: s3Key,
      ensembleId: ver.ensembleId,
      versionId,
      instrument: name,
    });
  }

  res.status(201).json({ part });
});

// GET /parts/:id
partsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const part = await getPartWithEnsemble(req.params.id);
  if (!part) { res.status(404).json({ error: 'Part not found' }); return; }

  try {
    await requireEnsembleMember(part.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const { omrJson: _, ensembleId: __, ...safePart } = part;
  res.json({ part: { ...safePart, pdfUrl: part.pdfS3Key ? `/parts/${part.id}/pdf` : undefined } });
});

// GET /parts/:id/measure-layout — returns per-measure bounding boxes from omr_json
partsRouter.get('/:id/measure-layout', async (req: Request, res: Response): Promise<void> => {
  const part = await getPartWithEnsemble(req.params.id);
  if (!part) { res.status(404).json({ error: 'Part not found' }); return; }

  try {
    await requireEnsembleMember(part.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  interface OmrMeasureRow { number: number; bounds?: { x: number; y: number; w: number; h: number; page: number }; multiRestCount?: number }
  const omrJson = part.omrJson as { measures?: OmrMeasureRow[] } | null;
  if (!omrJson?.measures) {
    res.json({ measureLayout: [] });
    return;
  }

  const measureLayout = omrJson.measures
    .filter((m) => m.bounds)
    .map((m) => ({
      measureNumber: m.number,
      ...m.bounds!,
      ...(m.multiRestCount ? { multiRestCount: m.multiRestCount } : {}),
    }));

  res.json({ measureLayout });
});

// GET /parts/:id/file — proxies file (PDF or audio) from S3 through the backend
// Also mounted at /parts/:id/pdf for backwards compatibility
partsRouter.get('/:id/pdf', servePart);
partsRouter.get('/:id/file', servePart);

async function servePart(req: Request, res: Response): Promise<void> {
  const part = await getPartWithEnsemble(req.params.id);
  if (!part) { res.status(404).end(); return; }

  try {
    await requireEnsembleMember(part.ensembleId, req.user!.id);
  } catch (err) {
    if (isHttpError(err)) { res.status(err.status).end(); return; }
    throw err;
  }

  if (!part.pdfS3Key) { res.status(404).json({ error: 'No file for this part' }); return; }

  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: part.pdfS3Key });
    const s3Res = await s3.send(command);
    const contentType = part.kind === 'audio' && (part as any).audioMimeType
      ? (part as any).audioMimeType
      : 'application/pdf';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${part.name}"`);
    if (s3Res.ContentLength) res.setHeader('Content-Length', s3Res.ContentLength);
    (s3Res.Body as Readable).pipe(res);
  } catch (err) {
    console.error(`[file] S3 error:`, err);
    res.status(500).end();
  }
}

// GET /parts/:id/debug-pdf — serves the annotated PDF with measure bounding boxes
partsRouter.get('/:id/debug-pdf', async (req: Request, res: Response): Promise<void> => {
  const part = await getPartWithEnsemble(req.params.id);
  if (!part) { res.status(404).end(); return; }

  try {
    await requireEnsembleMember(part.ensembleId, req.user!.id);
  } catch (err) {
    if (isHttpError(err)) { res.status(err.status).end(); return; }
    throw err;
  }

  const debugKey = part.pdfS3Key?.replace(/\.pdf$/i, '_measures.pdf');
  if (!debugKey) { res.status(404).json({ error: 'No PDF key for this part' }); return; }

  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: debugKey });
    const s3Res = await s3.send(command);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${part.name}_measures.pdf"`);
    if (s3Res.ContentLength) res.setHeader('Content-Length', s3Res.ContentLength);
    (s3Res.Body as Readable).pipe(res);
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
      res.status(404).json({ error: 'Annotated PDF not yet generated. OMR may still be processing.' });
    } else {
      console.error(`[debug-pdf] S3 error:`, err);
      res.status(500).end();
    }
  }
});

// DELETE /parts/:id (soft delete)
partsRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const part = await getPartWithEnsemble(req.params.id);
  if (!part) { res.status(404).json({ error: 'Part not found' }); return; }

  try {
    await requireEnsembleAdmin(part.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  await dz.update(parts)
    .set({ deletedAt: new Date() })
    .where(eq(parts.id, req.params.id));

  res.json({ deleted: true });
});

// POST /parts/:id/migrate-from
// Migrate annotations from a source part to this target part
partsRouter.post('/:id/migrate-from', async (req: Request, res: Response): Promise<void> => {
  const part = await getPartWithEnsemble(req.params.id);
  if (!part) { res.status(404).json({ error: 'Part not found' }); return; }

  try {
    await requireEnsembleAdmin(part.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const parsed = z.object({
    sourcePartId: z.string().uuid(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  // Verify the source part exists
  const sourcePart = await getPartWithEnsemble(parsed.data.sourcePartId);
  if (!sourcePart) {
    res.status(400).json({ error: 'Source part not found' });
    return;
  }

  try {
    const result = await migratePartAnnotations(parsed.data.sourcePartId, req.params.id);
    res.json({
      migratedCount: result.migrated,
      flaggedCount: result.flagged,
      skippedCount: result.skipped,
      total: result.total,
      instrument: result.instrument,
    });
  } catch (err) {
    console.error('[migrate-from] Migration failed:', err);
    res.status(500).json({ error: 'Migration failed' });
  }
});

// GET /parts/:id/diff — returns diff data for this part compared to the previous version
partsRouter.get('/:id/diff', async (req: Request, res: Response): Promise<void> => {
  const part = await getPartWithEnsemble(req.params.id);
  if (!part) { res.status(404).json({ error: 'Part not found' }); return; }

  try {
    await requireEnsembleMember(part.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  // Look up diff where this part is the target (toPartId)
  const diffRows = await dz.select({
    diffJson: versionDiffs.diffJson,
    fromPartId: versionDiffs.fromPartId,
  })
    .from(versionDiffs)
    .where(eq(versionDiffs.toPartId, req.params.id))
    .limit(1);

  if (diffRows.length === 0) {
    // No diff available — normal case for first versions
    res.json({ changedMeasures: [], changeDescriptions: {}, changelog: '', comparedToVersionId: null, comparedToVersionName: '' });
    return;
  }

  const diff = diffRows[0].diffJson as {
    changedMeasures?: number[];
    changeDescriptions?: Record<string, string>;
    changedMeasureBounds?: Record<string, { x: number; y: number; w: number; h: number; page: number }>;
    structuralChanges?: { insertedMeasures?: number[]; deletedMeasures?: number[] };
  };

  // Get the source part's version info for the "compared to" label
  const fromPartRows = await dz.select({
    versionId: versions.id,
    versionName: versions.name,
  })
    .from(parts)
    .innerJoin(versions, eq(versions.id, parts.versionId))
    .where(eq(parts.id, diffRows[0].fromPartId))
    .limit(1);

  const comparedTo = fromPartRows[0] ?? null;

  // Build changelog string from change descriptions
  const descriptions = diff.changeDescriptions ?? {};
  const changelog = Object.values(descriptions).join('\n');

  // Merge inserted measures into changedMeasures for highlighting
  const changed = new Set(diff.changedMeasures ?? []);
  for (const m of diff.structuralChanges?.insertedMeasures ?? []) changed.add(m);

  res.json({
    changedMeasures: [...changed].sort((a, b) => a - b),
    changeDescriptions: descriptions,
    changedMeasureBounds: diff.changedMeasureBounds ?? {},
    changelog,
    comparedToVersionId: comparedTo?.versionId ?? null,
    comparedToVersionName: comparedTo?.versionName ?? '',
  });
});

// ── Player router (mounted at /player) ───────────────────────────────────────

export const playerRouter = Router();
playerRouter.use(requireAuth);

// GET /player/my-parts — parts assigned to the current user's slots
playerRouter.get('/my-parts', async (req: Request, res: Response): Promise<void> => {
  const rows = await dz.select({
    partId: parts.id,
    partName: parts.name,
    kind: parts.kind,
    omrStatus: parts.omrStatus,
    versionId: versions.id,
    versionName: versions.name,
    chartId: charts.id,
    chartName: charts.name,
    ensembleId: ensembles.id,
    ensembleName: ensembles.name,
  })
    .from(parts)
    .innerJoin(versions, eq(versions.id, parts.versionId))
    .innerJoin(charts, eq(charts.id, versions.chartId))
    .innerJoin(ensembles, eq(ensembles.id, charts.ensembleId))
    .where(and(eq(parts.uploadedByUserId, req.user!.id), isNull(parts.deletedAt)));

  res.json({ parts: rows });
});
