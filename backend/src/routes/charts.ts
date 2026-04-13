import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { requireMember, requireOwnerOrEditor } from '../lib/ensembleAuth';
import { uploadFile, getSignedDownloadUrl } from '../lib/s3';

export const chartsRouter = Router();

chartsRouter.use(requireAuth);

const MAX_SIZE_BYTES = parseInt(process.env.PDF_MAX_SIZE_MB ?? '50') * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'));
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

// POST /charts
chartsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    ensembleId: z.string().uuid(),
    title: z.string().optional(),
    composer: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { ensembleId, title, composer, metadata } = parsed.data;

  try {
    await requireOwnerOrEditor(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const result = await db.query<{ id: string; ensemble_id: string; title: string | null; composer: string | null; metadata_json: object | null; created_at: string }>(
    `INSERT INTO charts (ensemble_id, title, composer, metadata_json)
     VALUES ($1, $2, $3, $4)
     RETURNING id, ensemble_id, title, composer, metadata_json, created_at`,
    [ensembleId, title ?? null, composer ?? null, metadata ? JSON.stringify(metadata) : null]
  );

  res.status(201).json({ chart: result.rows[0] });
});

// GET /charts/:id
chartsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const chart = await db.query(
    `SELECT id, ensemble_id, title, composer, metadata_json, created_at FROM charts WHERE id = $1`,
    [req.params.id]
  );
  if (!chart.rows[0]) {
    res.status(404).json({ error: 'Chart not found' });
    return;
  }

  try {
    await requireMember(chart.rows[0].ensemble_id, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const activeVersion = await db.query(
    `SELECT cv.id, cv.version_number, cv.version_name, cv.is_active, cv.created_at,
            COUNT(p.id) AS part_count
     FROM chart_versions cv
     LEFT JOIN parts p ON p.chart_version_id = cv.id
     WHERE cv.chart_id = $1 AND cv.is_active = true
     GROUP BY cv.id`,
    [req.params.id]
  );

  res.json({ chart: chart.rows[0], activeVersion: activeVersion.rows[0] ?? null });
});

// POST /charts/:id/versions  (multipart)
chartsRouter.post('/:id/versions', upload.any(), async (req: Request, res: Response): Promise<void> => {
  const chart = await db.query(
    `SELECT id, ensemble_id FROM charts WHERE id = $1`,
    [req.params.id]
  );
  if (!chart.rows[0]) {
    res.status(404).json({ error: 'Chart not found' });
    return;
  }

  try {
    await requireOwnerOrEditor(chart.rows[0].ensemble_id, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'At least one PDF file is required' });
    return;
  }

  const versionName: string | undefined = typeof req.body.versionName === 'string'
    ? req.body.versionName
    : undefined;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Derive next version number
    const numResult = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM chart_versions WHERE chart_id = $1`,
      [req.params.id]
    );
    const versionNumber: number = numResult.rows[0].next;
    const resolvedName = versionName ?? `Version ${versionNumber}`;

    // Deactivate current active version
    await client.query(
      `UPDATE chart_versions SET is_active = false WHERE chart_id = $1 AND is_active = true`,
      [req.params.id]
    );

    // Create the new version
    const versionResult = await client.query<{ id: string }>(
      `INSERT INTO chart_versions (chart_id, version_number, version_name, is_active, created_by)
       VALUES ($1, $2, $3, true, $4)
       RETURNING id`,
      [req.params.id, versionNumber, resolvedName, req.user!.id]
    );
    const versionId: string = versionResult.rows[0].id;

    // Upload each PDF to S3 and create a part row
    const parts = await Promise.all(files.map(async (file) => {
      const instrument = file.fieldname;
      const s3Key = `charts/${req.params.id}/versions/${versionId}/parts/${instrument}.pdf`;
      await uploadFile(s3Key, file.buffer, 'application/pdf');

      const partResult = await client.query(
        `INSERT INTO parts (chart_version_id, instrument_name, pdf_s3_key, omr_status)
         VALUES ($1, $2, $3, 'pending')
         RETURNING id, instrument_name, omr_status, created_at`,
        [versionId, instrument, s3Key]
      );
      return partResult.rows[0];
    }));

    await client.query('COMMIT');

    res.status(201).json({
      version: {
        id: versionId,
        chartId: req.params.id,
        versionNumber,
        versionName: resolvedName,
        isActive: true,
        createdBy: req.user!.id,
      },
      parts,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// GET /charts/:id/versions
chartsRouter.get('/:id/versions', async (req: Request, res: Response): Promise<void> => {
  const chart = await db.query(
    `SELECT id, ensemble_id FROM charts WHERE id = $1`,
    [req.params.id]
  );
  if (!chart.rows[0]) {
    res.status(404).json({ error: 'Chart not found' });
    return;
  }

  try {
    await requireMember(chart.rows[0].ensemble_id, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const versions = await db.query(
    `SELECT cv.id, cv.version_number, cv.version_name, cv.is_active, cv.created_at,
            u.name AS created_by_name,
            json_agg(json_build_object(
              'id', p.id,
              'instrumentName', p.instrument_name,
              'omrStatus', p.omr_status
            ) ORDER BY p.instrument_name) AS parts
     FROM chart_versions cv
     JOIN users u ON u.id = cv.created_by
     LEFT JOIN parts p ON p.chart_version_id = cv.id
     WHERE cv.chart_id = $1
     GROUP BY cv.id, u.name
     ORDER BY cv.version_number DESC`,
    [req.params.id]
  );

  res.json({ versions: versions.rows });
});

// GET /charts/:id/versions/:vId
chartsRouter.get('/:id/versions/:vId', async (req: Request, res: Response): Promise<void> => {
  const chart = await db.query(
    `SELECT id, ensemble_id FROM charts WHERE id = $1`,
    [req.params.id]
  );
  if (!chart.rows[0]) {
    res.status(404).json({ error: 'Chart not found' });
    return;
  }

  try {
    await requireMember(chart.rows[0].ensemble_id, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const version = await db.query(
    `SELECT cv.id, cv.version_number, cv.version_name, cv.is_active, cv.created_at,
            u.name AS created_by_name
     FROM chart_versions cv
     JOIN users u ON u.id = cv.created_by
     WHERE cv.id = $1 AND cv.chart_id = $2`,
    [req.params.vId, req.params.id]
  );
  if (!version.rows[0]) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }

  const parts = await db.query(
    `SELECT id, instrument_name, omr_status, pdf_s3_key, created_at FROM parts
     WHERE chart_version_id = $1
     ORDER BY instrument_name`,
    [req.params.vId]
  );

  // Generate signed download URLs for each part's PDF
  const partsWithUrls = await Promise.all(
    parts.rows.map(async (part) => {
      const pdfUrl = await getSignedDownloadUrl(part.pdf_s3_key);
      return { ...part, pdfUrl };
    })
  );

  // Include diff from previous version if it exists
  const diff = await db.query(
    `SELECT id, from_version_id, to_version_id, diff_json, created_at
     FROM version_diffs
     WHERE to_version_id = $1`,
    [req.params.vId]
  );

  res.json({
    version: version.rows[0],
    parts: partsWithUrls,
    diff: diff.rows[0] ?? null,
  });
});

// POST /charts/:id/versions/:vId/restore
chartsRouter.post('/:id/versions/:vId/restore', async (req: Request, res: Response): Promise<void> => {
  const chart = await db.query(
    `SELECT id, ensemble_id FROM charts WHERE id = $1`,
    [req.params.id]
  );
  if (!chart.rows[0]) {
    res.status(404).json({ error: 'Chart not found' });
    return;
  }

  // Only owners can restore
  const role = await (async () => {
    try {
      return await requireMember(chart.rows[0].ensemble_id, req.user!.id);
    } catch (err) {
      handleError(err, res);
      return null;
    }
  })();
  if (!role) return;

  if (role !== 'owner') {
    res.status(403).json({ error: 'Only the ensemble owner can restore versions' });
    return;
  }

  const version = await db.query(
    `SELECT id FROM chart_versions WHERE id = $1 AND chart_id = $2`,
    [req.params.vId, req.params.id]
  );
  if (!version.rows[0]) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }

  await db.query(
    `UPDATE chart_versions SET is_active = (id = $1) WHERE chart_id = $2`,
    [req.params.vId, req.params.id]
  );

  res.json({ restoredVersionId: req.params.vId });
});
