import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { requireMember, requireOwnerOrEditor } from '../lib/ensembleAuth';
import { uploadFile } from '../lib/s3';
import { enqueueJob } from '../lib/queue';
import { notifyRestore } from '../lib/notifications';

export const chartsRouter = Router();

chartsRouter.use(requireAuth);

const MAX_SIZE_BYTES = parseInt(process.env.PDF_MAX_SIZE_MB ?? '50') * 1024 * 1024;

const ACCEPTED_MIMETYPES = new Set([
  'application/pdf',
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
  'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/ogg',
  'audio/flac', 'audio/x-flac',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_MIMETYPES.has(file.mimetype) || file.mimetype.startsWith('audio/')) {
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
    `SELECT id, ensemble_id, title, composer, metadata_json, created_at FROM charts WHERE id = $1 AND deleted_at IS NULL`,
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
     WHERE cv.chart_id = $1 AND cv.is_active = true AND cv.deleted_at IS NULL
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

  const files = (req.files as Express.Multer.File[]) ?? [];

  const versionName: string | undefined = typeof req.body.versionName === 'string'
    ? req.body.versionName
    : undefined;

  // Per-file type metadata: { [instrumentName]: 'score' | 'part' | 'audio' | 'chart' | 'link' | 'other' }
  let partTypes: Record<string, string> = {};
  if (typeof req.body.partTypes === 'string') {
    try { partTypes = JSON.parse(req.body.partTypes); } catch { /* ignore */ }
  }

  // Link-type entries: [{ name, url }] — no file upload, just store the URL
  let linkEntries: Array<{ name: string; url: string }> = [];
  if (typeof req.body.linkEntries === 'string') {
    try { linkEntries = JSON.parse(req.body.linkEntries); } catch { /* ignore */ }
  }

  // Carry-forward checklist: if present, only inherit the named parts
  let inheritedPartNames: Set<string> | null = null;
  if (typeof req.body.inheritedPartNames === 'string') {
    try { inheritedPartNames = new Set(JSON.parse(req.body.inheritedPartNames)); } catch { /* ignore */ }
  }

  // Explicit replaces map: newInstrumentName → oldInstrumentName (for annotation migration)
  let replacesMap: Record<string, string> = {};
  if (typeof req.body.replacesMap === 'string') {
    try { replacesMap = JSON.parse(req.body.replacesMap); } catch { /* ignore */ }
  }

  if (files.length === 0 && linkEntries.length === 0) {
    res.status(400).json({ error: 'At least one file or link is required' });
    return;
  }

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

    // Find the current active version's visible parts before deactivating
    const prevActiveResult = await client.query<{ id: string }>(
      `SELECT id FROM chart_versions WHERE chart_id = $1 AND is_active = true`,
      [req.params.id]
    );
    const prevVersionId = prevActiveResult.rows[0]?.id ?? null;

    let prevParts: Array<{
      id: string;
      instrument_name: string;
      part_type: string;
      pdf_s3_key: string;
      musicxml_s3_key: string | null;
      omr_status: string;
      omr_json: unknown;
    }> = [];
    if (prevVersionId) {
      const prevPartsResult = await client.query(
        `SELECT id, instrument_name, part_type, pdf_s3_key, musicxml_s3_key, omr_status, omr_json
         FROM parts WHERE chart_version_id = $1 AND deleted_at IS NULL`,
        [prevVersionId]
      );
      prevParts = prevPartsResult.rows;
    }

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

    // Upload each file to S3 and create a part row
    const uploadedInstruments = new Set([
      ...files.map(f => f.fieldname),
      ...linkEntries.map(l => l.name),
    ]);

    // S3 uploads can run concurrently — DB inserts must be sequential on the same client
    const s3Uploads = await Promise.all(files.map(async (file) => {
      const instrument = file.fieldname;
      const partType = ['score', 'part', 'audio', 'chart', 'other'].includes(partTypes[instrument]) ? partTypes[instrument] : 'part';
      const s3SafeName = instrument.replace(/[^a-zA-Z0-9._-]/g, '_');
      const ext = file.mimetype.startsWith('audio/') ? '.audio' : '.pdf';
      const s3Key = `charts/${req.params.id}/versions/${versionId}/parts/${s3SafeName}${ext}`;
      await uploadFile(s3Key, file.buffer, file.mimetype);
      return { instrument, partType, s3Key, mimetype: file.mimetype };
    }));

    const newParts: Array<{ id: string; instrument_name: string; omr_status: string; created_at: string }> = [];
    for (const { instrument, partType, s3Key, mimetype } of s3Uploads) {
      const partResult = await client.query<{ id: string; instrument_name: string; omr_status: string; created_at: string }>(
        `INSERT INTO parts (chart_version_id, instrument_name, part_type, pdf_s3_key, omr_status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING id, instrument_name, omr_status, created_at`,
        [versionId, instrument, partType, s3Key]
      );
      const part = partResult.rows[0];
      if (!mimetype.startsWith('audio/')) {
        await enqueueJob('omr', { partId: part.id, pdfS3Key: s3Key, chartId: req.params.id, versionId, instrument });
      }
      newParts.push(part);
    }

    // Create link-type parts sequentially
    const linkParts: Array<{ id: string; instrument_name: string; omr_status: string; created_at: string }> = [];
    for (const entry of linkEntries) {
      const partResult = await client.query<{ id: string; instrument_name: string; omr_status: string; created_at: string }>(
        `INSERT INTO parts (chart_version_id, instrument_name, part_type, url, omr_status)
         VALUES ($1, $2, 'link', $3, 'complete')
         RETURNING id, instrument_name, omr_status, created_at`,
        [versionId, entry.name, entry.url]
      );
      linkParts.push(partResult.rows[0]);
    }

    // Inherit unchanged parts from the previous active version (sequential DB inserts)
    const inheritedParts: Array<{ id: string; instrument_name: string; omr_status: string; created_at: string }> = [];
    for (const p of prevParts
        .filter(p => !uploadedInstruments.has(p.instrument_name))
        .filter(p => inheritedPartNames === null || inheritedPartNames.has(p.instrument_name))) {
      const inheritedResult = await client.query<{
        id: string; instrument_name: string; omr_status: string; created_at: string;
      }>(
        `INSERT INTO parts
           (chart_version_id, instrument_name, part_type, pdf_s3_key, musicxml_s3_key, omr_status, omr_json, inherited_from_part_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, instrument_name, omr_status, created_at`,
        [versionId, p.instrument_name, p.part_type ?? 'part', p.pdf_s3_key, p.musicxml_s3_key, p.omr_status, p.omr_json ? JSON.stringify(p.omr_json) : null, p.id]
      );
      inheritedParts.push(inheritedResult.rows[0]);
    }

    const parts = [...newParts, ...linkParts, ...inheritedParts];

    // ── Migrate annotations from previous version ──────────────────────────
    // Build a reverse replaces map: oldInstrumentName → newInstrumentName
    const oldToNewName: Record<string, string> = {};
    for (const [newName, oldName] of Object.entries(replacesMap)) {
      oldToNewName[oldName] = newName;
    }

    // Build a map from old part id → new part id
    // Priority: (1) explicit replacesMap, (2) case-insensitive name match
    const oldToNewPartId: Record<string, string> = {};
    for (const oldPart of prevParts) {
      const explicitNewName = oldToNewName[oldPart.instrument_name];
      if (explicitNewName) {
        const newPart = parts.find(p => p.instrument_name === explicitNewName);
        if (newPart) { oldToNewPartId[oldPart.id] = newPart.id; continue; }
      }
      // Case-insensitive + trimmed fallback
      const normalizedOld = oldPart.instrument_name.trim().toLowerCase();
      const newPart = parts.find(p => p.instrument_name.trim().toLowerCase() === normalizedOld);
      if (newPart) oldToNewPartId[oldPart.id] = newPart.id;
    }

    // Get the measure mapping from the version diff (if it exists yet)
    const diffResult = await client.query<{ diff_json: { parts: Record<string, { measureMapping?: Record<string, number | null> }> } }>(
      `SELECT diff_json FROM version_diffs WHERE to_version_id = $1`,
      [versionId]
    );
    const diffJson = diffResult.rows[0]?.diff_json;

    for (const [oldPartId, newPartId] of Object.entries(oldToNewPartId)) {
      const annotations = await client.query(
        `SELECT id, anchor_type, anchor_json, content_type, content_json
         FROM annotations
         WHERE part_id = $1 AND deleted_at IS NULL`,
        [oldPartId]
      );

      for (const ann of annotations.rows) {
        let newAnchorJson = ann.anchor_json;
        let isUnresolved = false;

        if (ann.anchor_type === 'measure' || ann.anchor_type === 'beat' || ann.anchor_type === 'note') {
          const oldMeasure = ann.anchor_json.measureNumber;
          const partDiff = diffJson?.parts[annotations.rows[0]?.instrument_name];
          if (partDiff?.measureMapping) {
            const newMeasure = partDiff.measureMapping[String(oldMeasure)];
            if (newMeasure === null) {
              isUnresolved = true;
            } else if (newMeasure !== undefined) {
              newAnchorJson = { ...ann.anchor_json, measureNumber: newMeasure };
            }
          }
        }
        // page and section anchors are copied as-is

        await client.query(
          `INSERT INTO annotations (part_id, user_id, anchor_type, anchor_json, content_type, content_json,
                                    migrated_from_annotation_id, is_unresolved)
           SELECT $1, user_id, $2, $3, $4, $5, $6, $7
           FROM annotations WHERE id = $8`,
          [newPartId, ann.anchor_type, JSON.stringify(newAnchorJson), ann.content_type,
           JSON.stringify(ann.content_json), ann.id, isUnresolved, ann.id]
        );
      }
    }

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
    `SELECT id, ensemble_id FROM charts WHERE id = $1 AND deleted_at IS NULL`,
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
            COALESCE(
              json_agg(json_build_object(
                'id', p.id,
                'instrumentName', p.instrument_name,
                'partType', p.part_type,
                'omrStatus', p.omr_status,
                'inheritedFromPartId', p.inherited_from_part_id
              ) ORDER BY p.instrument_name) FILTER (WHERE p.id IS NOT NULL),
              '[]'::json
            ) AS parts
     FROM chart_versions cv
     JOIN users u ON u.id = cv.created_by
     LEFT JOIN parts p ON p.chart_version_id = cv.id AND p.deleted_at IS NULL
     WHERE cv.chart_id = $1 AND cv.deleted_at IS NULL
     GROUP BY cv.id, u.name
     ORDER BY cv.version_number DESC`,
    [req.params.id]
  );

  res.json({ versions: versions.rows });
});

// POST /charts/:id/versions/:vId/parts  — add a single file/link to an existing version
chartsRouter.post('/:id/versions/:vId/parts', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  const chart = await db.query(
    `SELECT id, ensemble_id FROM charts WHERE id = $1 AND deleted_at IS NULL`,
    [req.params.id]
  );
  if (!chart.rows[0]) { res.status(404).json({ error: 'Chart not found' }); return; }

  try { await requireOwnerOrEditor(chart.rows[0].ensemble_id, req.user!.id); }
  catch (err) { handleError(err, res); return; }

  const version = await db.query(
    `SELECT id FROM chart_versions WHERE id = $1 AND chart_id = $2 AND deleted_at IS NULL`,
    [req.params.vId, req.params.id]
  );
  if (!version.rows[0]) { res.status(404).json({ error: 'Version not found' }); return; }

  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }

  const partType = ['score', 'part', 'audio', 'chart', 'link', 'other'].includes(req.body.partType)
    ? req.body.partType : 'part';

  let partRow: { id: string; instrument_name: string; omr_status: string; created_at: string };

  if (partType === 'link') {
    const url = typeof req.body.url === 'string' ? req.body.url.trim() : '';
    if (!url) { res.status(400).json({ error: 'url is required for link type' }); return; }
    const r = await db.query<typeof partRow>(
      `INSERT INTO parts (chart_version_id, instrument_name, part_type, url, omr_status)
       VALUES ($1, $2, 'link', $3, 'complete')
       RETURNING id, instrument_name, omr_status, created_at`,
      [req.params.vId, name, url]
    );
    partRow = r.rows[0];
  } else {
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'file is required' }); return; }
    const s3SafeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = file.mimetype.startsWith('audio/') ? '.audio' : '.pdf';
    const s3Key = `charts/${req.params.id}/versions/${req.params.vId}/parts/${s3SafeName}${ext}`;
    await uploadFile(s3Key, file.buffer, file.mimetype);
    const r = await db.query<typeof partRow>(
      `INSERT INTO parts (chart_version_id, instrument_name, part_type, pdf_s3_key, omr_status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id, instrument_name, omr_status, created_at`,
      [req.params.vId, name, partType, s3Key]
    );
    partRow = r.rows[0];
    if (!file.mimetype.startsWith('audio/')) {
      await enqueueJob('omr', { partId: partRow.id, pdfS3Key: s3Key, chartId: req.params.id, versionId: req.params.vId, instrument: name });
    }
  }

  res.status(201).json({ part: { ...partRow, pdfUrl: partType !== 'link' ? `/parts/${partRow.id}/pdf` : undefined } });
});

// GET /charts/:id/versions/:vId
chartsRouter.get('/:id/versions/:vId', async (req: Request, res: Response): Promise<void> => {
  const chart = await db.query(
    `SELECT id, ensemble_id FROM charts WHERE id = $1 AND deleted_at IS NULL`,
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
     WHERE cv.id = $1 AND cv.chart_id = $2 AND cv.deleted_at IS NULL`,
    [req.params.vId, req.params.id]
  );
  if (!version.rows[0]) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }

  const parts = await db.query(
    `SELECT p.id, p.instrument_name, p.part_type, p.omr_status, p.pdf_s3_key, p.url, p.created_at,
            p.inherited_from_part_id,
            src_cv.version_number AS inherited_from_version_number,
            src_cv.version_name AS inherited_from_version_name
     FROM parts p
     LEFT JOIN parts src_p ON src_p.id = p.inherited_from_part_id
     LEFT JOIN chart_versions src_cv ON src_cv.id = src_p.chart_version_id
     WHERE p.chart_version_id = $1 AND p.deleted_at IS NULL
     ORDER BY p.part_type, p.instrument_name`,
    [req.params.vId]
  );

  const partsWithUrls = parts.rows.map((part) => ({
    ...part,
    pdfUrl: `/parts/${part.id}/pdf`,
  }));

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

// DELETE /charts/:id  (owner only, soft delete)
chartsRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const chart = await db.query(
    `SELECT id, ensemble_id FROM charts WHERE id = $1 AND deleted_at IS NULL`,
    [req.params.id]
  );
  if (!chart.rows[0]) {
    res.status(404).json({ error: 'Chart not found' });
    return;
  }

  const role = await (async () => {
    try { return await requireMember(chart.rows[0].ensemble_id, req.user!.id); }
    catch (err) { handleError(err, res); return null; }
  })();
  if (!role) return;
  if (role !== 'owner') {
    res.status(403).json({ error: 'Only the ensemble owner can delete charts' });
    return;
  }

  await db.query(
    `UPDATE charts SET deleted_at = NOW() WHERE id = $1`,
    [req.params.id]
  );
  res.json({ deleted: true });
});

// DELETE /charts/:id/versions/:vId  (owner only, soft delete; if active, promotes previous)
chartsRouter.delete('/:id/versions/:vId', async (req: Request, res: Response): Promise<void> => {
  const chart = await db.query(
    `SELECT id, ensemble_id FROM charts WHERE id = $1 AND deleted_at IS NULL`,
    [req.params.id]
  );
  if (!chart.rows[0]) {
    res.status(404).json({ error: 'Chart not found' });
    return;
  }

  const role = await (async () => {
    try { return await requireMember(chart.rows[0].ensemble_id, req.user!.id); }
    catch (err) { handleError(err, res); return null; }
  })();
  if (!role) return;
  if (role !== 'owner') {
    res.status(403).json({ error: 'Only the ensemble owner can delete versions' });
    return;
  }

  const version = await db.query(
    `SELECT id, is_active FROM chart_versions WHERE id = $1 AND chart_id = $2 AND deleted_at IS NULL`,
    [req.params.vId, req.params.id]
  );
  if (!version.rows[0]) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }
  await db.query(
    `UPDATE chart_versions SET deleted_at = NOW(), is_active = false WHERE id = $1`,
    [req.params.vId]
  );

  // If we just deleted the active version, promote the most recent remaining version
  if (version.rows[0].is_active) {
    const fallback = await db.query(
      `SELECT id FROM chart_versions
       WHERE chart_id = $1 AND deleted_at IS NULL
       ORDER BY version_number DESC LIMIT 1`,
      [req.params.id]
    );
    if (fallback.rows[0]) {
      await db.query(
        `UPDATE chart_versions SET is_active = true WHERE id = $1`,
        [fallback.rows[0].id]
      );
    }
  }

  res.json({ deleted: true });
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

  notifyRestore(req.params.id, req.params.vId).catch((err) =>
    console.error('[charts] Restore notification failed:', err)
  );

  res.json({ restoredVersionId: req.params.vId });
});

// ── Part Assignments ──────────────────────────────────────────────────────────

// GET /charts/:id/assignments
chartsRouter.get('/:id/assignments', async (req: Request, res: Response): Promise<void> => {
  const chart = await db.query(
    `SELECT id, ensemble_id FROM charts WHERE id = $1 AND deleted_at IS NULL`,
    [req.params.id]
  );
  if (!chart.rows[0]) { res.status(404).json({ error: 'Chart not found' }); return; }
  try { await requireMember(chart.rows[0].ensemble_id, req.user!.id); }
  catch (err) { handleError(err, res); return; }

  const result = await db.query(
    `SELECT a.id, a.chart_id, a.instrument_name, a.user_id, a.assigned_by, a.created_at,
            u.name AS user_name, u.email AS user_email
     FROM chart_part_assignments a
     JOIN users u ON u.id = a.user_id
     WHERE a.chart_id = $1
     ORDER BY a.instrument_name, u.name`,
    [req.params.id]
  );
  res.json({ assignments: result.rows });
});

// POST /charts/:id/assignments
chartsRouter.post('/:id/assignments', async (req: Request, res: Response): Promise<void> => {
  const chart = await db.query(
    `SELECT id, ensemble_id FROM charts WHERE id = $1 AND deleted_at IS NULL`,
    [req.params.id]
  );
  if (!chart.rows[0]) { res.status(404).json({ error: 'Chart not found' }); return; }

  let role: string | null = null;
  try { role = await requireMember(chart.rows[0].ensemble_id, req.user!.id); }
  catch (err) { handleError(err, res); return; }
  if (role !== 'owner' && role !== 'editor') {
    res.status(403).json({ error: 'Only owners and editors can assign parts' });
    return;
  }

  const parsed = z.object({
    instrumentName: z.string().min(1),
    userId: z.string().uuid(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  // Verify the target user is a member of the ensemble
  const member = await db.query(
    `SELECT id FROM ensemble_members WHERE ensemble_id = $1 AND user_id = $2`,
    [chart.rows[0].ensemble_id, parsed.data.userId]
  );
  if (!member.rows[0]) { res.status(400).json({ error: 'User is not a member of this ensemble' }); return; }

  const result = await db.query(
    `INSERT INTO chart_part_assignments (chart_id, instrument_name, user_id, assigned_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (chart_id, instrument_name, user_id) DO UPDATE SET assigned_by = EXCLUDED.assigned_by
     RETURNING id, chart_id, instrument_name, user_id, assigned_by, created_at`,
    [req.params.id, parsed.data.instrumentName, parsed.data.userId, req.user!.id]
  );
  const u = await db.query(`SELECT name, email FROM users WHERE id = $1`, [parsed.data.userId]);
  res.status(201).json({ assignment: { ...result.rows[0], user_name: u.rows[0].name, user_email: u.rows[0].email } });
});

// DELETE /charts/:id/assignments/:assignmentId
chartsRouter.delete('/:id/assignments/:assignmentId', async (req: Request, res: Response): Promise<void> => {
  const chart = await db.query(
    `SELECT id, ensemble_id FROM charts WHERE id = $1 AND deleted_at IS NULL`,
    [req.params.id]
  );
  if (!chart.rows[0]) { res.status(404).json({ error: 'Chart not found' }); return; }

  let role: string | null = null;
  try { role = await requireMember(chart.rows[0].ensemble_id, req.user!.id); }
  catch (err) { handleError(err, res); return; }
  if (role !== 'owner' && role !== 'editor') {
    res.status(403).json({ error: 'Only owners and editors can remove assignments' });
    return;
  }

  await db.query(
    `DELETE FROM chart_part_assignments WHERE id = $1 AND chart_id = $2`,
    [req.params.assignmentId, req.params.id]
  );
  res.json({ deleted: true });
});
