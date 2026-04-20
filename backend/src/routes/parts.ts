import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import multer from 'multer';
import { dz } from '../db';
import { parts, versions, charts, ensembles, partSlotAssignments, instrumentSlots } from '../schema';
import { requireAuth } from '../middleware/auth';
import { requireEnsembleMember, requireEnsembleAdmin } from '../lib/ensembleAuth';
import { s3, BUCKET, uploadFile } from '../lib/s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { enqueueJob } from '../lib/queue';

export const partsRouter = Router();
partsRouter.use(requireAuth);

const MAX_SIZE_BYTES = parseInt(process.env.PDF_MAX_SIZE_MB ?? '50') * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and audio files are accepted'));
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

  const file = req.file;
  if (!file) { res.status(400).json({ error: 'file is required' }); return; }

  const kind = req.body.kind === 'score' ? 'score' as const : 'part' as const;

  // Parse optional slot_ids for assignment
  let slotIds: string[] = [];
  if (typeof req.body.slotIds === 'string') {
    try { slotIds = JSON.parse(req.body.slotIds); } catch { /* ignore */ }
  }

  const s3SafeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = file.mimetype.startsWith('audio/') ? '.audio' : '.pdf';
  const s3Key = `ensembles/${ver.ensembleId}/versions/${versionId}/parts/${s3SafeName}${ext}`;
  await uploadFile(s3Key, file.buffer, file.mimetype);

  const [part] = await dz.insert(parts).values({
    versionId,
    kind,
    name,
    pdfS3Key: s3Key,
    omrStatus: 'pending',
    uploadedByUserId: req.user!.id,
  }).returning();

  // Create slot assignments if provided
  if (slotIds.length > 0) {
    await dz.insert(partSlotAssignments).values(
      slotIds.map(slotId => ({ partId: part.id, instrumentSlotId: slotId }))
    );
  }

  // Enqueue OMR if it's a PDF
  if (!file.mimetype.startsWith('audio/')) {
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
  res.json({ part: { ...safePart, pdfUrl: `/parts/${part.id}/pdf` } });
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

// GET /parts/:id/pdf — proxies PDF from S3 through the backend
partsRouter.get('/:id/pdf', async (req: Request, res: Response): Promise<void> => {
  const part = await getPartWithEnsemble(req.params.id);
  if (!part) { res.status(404).end(); return; }

  try {
    await requireEnsembleMember(part.ensembleId, req.user!.id);
  } catch (err) {
    if (isHttpError(err)) { res.status(err.status).end(); return; }
    throw err;
  }

  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: part.pdfS3Key });
    const s3Res = await s3.send(command);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${part.name}.pdf"`);
    if (s3Res.ContentLength) res.setHeader('Content-Length', s3Res.ContentLength);
    (s3Res.Body as Readable).pipe(res);
  } catch (err) {
    console.error(`[pdf] S3 error:`, err);
    res.status(500).end();
  }
});

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
