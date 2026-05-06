import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq, and, isNull, sql } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import { dz, db } from '../db';
import { versions, parts, charts, editOperations, annotations, workspaceMembers, ensembles } from '../schema';
import { requireAuth } from '../middleware/auth';
import { requireEnsembleMember } from '../lib/ensembleAuth';
import { ValidOperationSchema, SLICE1_OPS } from '../editor/grammar';
import { composeAskPaletteSystemPrompt } from '../editor/llmPrompt';
import { enqueueJob } from '../lib/queue';

export const editsRouter = Router();
editsRouter.use(requireAuth);

const OMR_DIFF_SIDECAR = process.env.OMR_DIFF_SIDECAR_URL || 'http://localhost:8484';

// Hardcoded instrument ranges for Slice 1
const RANGES: Record<string, { absoluteLow: string; absoluteHigh: string }> = {
  flute: { absoluteLow: 'C4', absoluteHigh: 'D7' },
  violin: { absoluteLow: 'G3', absoluteHigh: 'E7' },
  trumpet_in_bb: { absoluteLow: 'F#3', absoluteHigh: 'D6' },
};

function pitchToMidi(pitch: string): number {
  const match = pitch.match(/^([A-G])(#{0,2}|b{0,2}|-{0,2})(\d+)$/);
  if (!match) return -1;
  const [, step, accidental, octaveStr] = match;
  const stepMap: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let midi = stepMap[step] + (parseInt(octaveStr) + 1) * 12;
  if (accidental === '#') midi += 1;
  else if (accidental === '##') midi += 2;
  else if (accidental === 'b' || accidental === '-') midi -= 1;
  else if (accidental === 'bb' || accidental === '--') midi -= 2;
  return midi;
}

function checkRange(
  pitches: Array<{ measure: number; beat: number; pitch: string }>,
  instrumentKey: string | null,
): Array<{ measure: number; pitch: string; reason: string }> {
  if (!instrumentKey || !(instrumentKey in RANGES)) return [];
  const range = RANGES[instrumentKey];
  const lowMidi = pitchToMidi(range.absoluteLow);
  const highMidi = pitchToMidi(range.absoluteHigh);
  const warnings: Array<{ measure: number; pitch: string; reason: string }> = [];

  for (const p of pitches) {
    const midi = pitchToMidi(p.pitch);
    if (midi < 0) continue;
    if (midi < lowMidi) {
      warnings.push({ measure: p.measure, pitch: p.pitch, reason: `below ${range.absoluteLow}` });
    } else if (midi > highMidi) {
      warnings.push({ measure: p.measure, pitch: p.pitch, reason: `above ${range.absoluteHigh}` });
    }
  }
  return warnings;
}

/** Guess the instrument key from a part name */
function guessInstrumentKey(partName: string): string | null {
  const lower = partName.toLowerCase();
  if (lower.includes('flute')) return 'flute';
  if (lower.includes('violin')) return 'violin';
  if (lower.includes('trumpet')) return 'trumpet_in_bb';
  if (lower.includes('horn')) return 'horn_in_f';
  if (lower.includes('alto sax')) return 'alto_saxophone';
  if (lower.includes('tenor sax')) return 'tenor_saxophone';
  if (lower.includes('clarinet')) return 'clarinet_in_bb';
  if (lower.includes('viola')) return 'viola';
  if (lower.includes('cello')) return 'cello';
  return null;
}

// ── POST /edits/parse — LLM natural language → operation JSON ────────────────

editsRouter.post('/parse', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    naturalLanguage: z.string().min(1),
    contextPartId: z.string().uuid(),
    contextVersionId: z.string().uuid(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { naturalLanguage, contextPartId, contextVersionId } = parsed.data;

  // Look up part context
  const [part] = await dz.select({ name: parts.name, omrJson: parts.omrJson })
    .from(parts)
    .where(and(eq(parts.id, contextPartId), isNull(parts.deletedAt)));
  if (!part) { res.status(404).json({ error: 'Part not found' }); return; }

  // Extract measure count from OMR JSON if available
  const omr = part.omrJson as { measures?: unknown[] } | null;
  const measureCount = omr?.measures ? omr.measures.length : null;

  const systemPrompt = composeAskPaletteSystemPrompt(part.name, measureCount);

  // Call Anthropic
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'LLM not configured (ANTHROPIC_API_KEY missing)' });
    return;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-7',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: naturalLanguage }],
    });

    const rawText = response.content[0]?.type === 'text' ? response.content[0].text : '';

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText.trim());
    } catch {
      res.json({ op: 'unknown', reason: "I couldn't understand that command. Try something like 'transpose down a step'." });
      return;
    }

    // Handle explicit 'unknown' from LLM
    if ((parsedJson as Record<string, unknown>).op === 'unknown') {
      res.json(parsedJson);
      return;
    }

    // Validate against grammar
    const result = ValidOperationSchema.safeParse(parsedJson);
    if (!result.success) {
      res.json({ op: 'unknown', reason: "Command produced an invalid operation. Try rephrasing." });
      return;
    }

    res.json({ op: result.data });
  } catch (err) {
    console.error('LLM parse error:', err);
    res.status(502).json({ error: 'LLM call failed' });
  }
});

// ── POST /edits/apply — apply operation to MusicXML via sidecar ──────────────

editsRouter.post('/apply', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    partId: z.string().uuid(),
    versionId: z.string().uuid(),
    operation: ValidOperationSchema,
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { partId, versionId, operation } = parsed.data;

  // Reject unsupported ops
  if (!SLICE1_OPS.has(operation.op)) {
    res.status(400).json({ error: 'Not yet supported in this version of the editor.' });
    return;
  }

  // Get the MusicXML source: check version.musicxml_blob first (editor-created),
  // then fall back to fetching from S3 via part.audiverisMxlS3Key
  const [version] = await dz.select({ musicxmlBlob: versions.musicxmlBlob })
    .from(versions)
    .where(eq(versions.id, versionId));

  let musicxml = version?.musicxmlBlob;

  if (!musicxml) {
    // Try to get from part's OMR S3 key
    const [part] = await dz.select({ audiverisMxlS3Key: parts.audiverisMxlS3Key })
      .from(parts)
      .where(and(eq(parts.id, partId), eq(parts.versionId, versionId)));

    if (part?.audiverisMxlS3Key) {
      // Fetch from S3
      try {
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const { s3, BUCKET } = await import('../lib/s3');
        const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: part.audiverisMxlS3Key }));
        musicxml = (await obj.Body?.transformToString('utf-8')) || null;
      } catch {
        // S3 fetch failed
      }
    }
  }

  if (!musicxml) {
    res.status(404).json({ error: 'Source version MusicXML not available. OMR may not have processed this part yet.' });
    return;
  }

  // Get part name for range checking
  const [partInfo] = await dz.select({ name: parts.name })
    .from(parts)
    .where(eq(parts.id, partId));
  const instrumentKey = partInfo ? guessInstrumentKey(partInfo.name) : null;

  // Forward to music21 sidecar
  let endpoint: string;
  let sidecarPayload: Record<string, unknown>;

  if (operation.op === 'transpose') {
    endpoint = '/transpose';
    sidecarPayload = { musicxml, interval: operation.interval };
  } else if (operation.op === 'octave_displace') {
    endpoint = '/octave-displace';
    sidecarPayload = { musicxml, direction: operation.direction };
  } else if (operation.op === 'instrument_change') {
    endpoint = '/instrument-change';
    sidecarPayload = {
      musicxml,
      sourceInstrument: instrumentKey || 'flute', // fallback
      newInstrument: operation.newInstrument,
    };
  } else {
    res.status(400).json({ error: 'Unsupported operation' });
    return;
  }

  try {
    const sidecarResp = await fetch(`${OMR_DIFF_SIDECAR}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sidecarPayload),
    });

    if (!sidecarResp.ok) {
      const detail = await sidecarResp.text();
      res.status(502).json({ error: `Music transformation failed: ${detail}` });
      return;
    }

    const { transformedMusicxml, pitches } = await sidecarResp.json() as {
      transformedMusicxml: string;
      pitches: Array<{ measure: number; beat: number; pitch: string }>;
    };

    const rangeWarnings = checkRange(pitches, instrumentKey);

    res.json({ transformedMusicxml, rangeWarnings });
  } catch (err) {
    console.error('Sidecar call failed:', err);
    res.status(502).json({ error: 'Could not reach music transformation service.' });
  }
});

// ── POST /edits/save — save edited version (personal or ensemble) ────────────

editsRouter.post('/save', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    partId: z.string().uuid(),
    parentVersionId: z.string().uuid(),
    transformedMusicXml: z.string().min(1),
    operationJson: ValidOperationSchema,
    naturalLanguageInput: z.string().optional(),
    saveMode: z.enum(['personal', 'ensemble']),
    branchLabel: z.string().optional(),
    versionLabel: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { partId, parentVersionId, transformedMusicXml, operationJson, naturalLanguageInput, saveMode, branchLabel, versionLabel } = parsed.data;

  if (saveMode === 'personal' && !branchLabel) {
    res.status(400).json({ error: 'branchLabel required for personal save.' });
    return;
  }
  if (saveMode === 'ensemble' && !versionLabel) {
    res.status(400).json({ error: 'versionLabel required for ensemble save.' });
    return;
  }

  // Look up the parent version to get chartId
  const [parentVersion] = await dz.select({
    chartId: versions.chartId,
    sortOrder: versions.sortOrder,
  })
    .from(versions)
    .where(eq(versions.id, parentVersionId));
  if (!parentVersion) {
    res.status(404).json({ error: 'Parent version not found' });
    return;
  }

  // Permission check: ensemble save requires director (admin/owner) role
  if (saveMode === 'ensemble') {
    const [chart] = await dz.select({ ensembleId: charts.ensembleId })
      .from(charts)
      .where(eq(charts.id, parentVersion.chartId));
    if (!chart) { res.status(404).json({ error: 'Chart not found' }); return; }

    const [ens] = await dz.select({ workspaceId: ensembles.workspaceId })
      .from(ensembles).where(eq(ensembles.id, chart.ensembleId));
    if (!ens) { res.status(404).json({ error: 'Ensemble not found' }); return; }

    const [membership] = await dz.select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(
        eq(workspaceMembers.workspaceId, ens.workspaceId),
        eq(workspaceMembers.userId, req.user!.id),
      ));
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      res.status(403).json({ error: 'Only directors can publish ensemble versions.' });
      return;
    }
  }

  // Compute next sort order
  const [{ next }] = await dz.select({
    next: sql<number>`coalesce(max(${versions.sortOrder}), -1) + 1`,
  }).from(versions).where(eq(versions.chartId, parentVersion.chartId));

  // Create new version row
  const [newVersion] = await dz.insert(versions).values({
    chartId: parentVersion.chartId,
    name: saveMode === 'ensemble' ? versionLabel! : (branchLabel || 'Personal edit'),
    sortOrder: Number(next),
    parentVersionId,
    musicxmlBlob: transformedMusicXml,
    privateOwnerUserId: saveMode === 'personal' ? req.user!.id : null,
    branchLabel: saveMode === 'personal' ? branchLabel : null,
    editOrigin: saveMode === 'personal' ? 'editor_player' : 'editor_director',
    pdfRenderStatus: 'pending',
    isCurrent: saveMode === 'ensemble',
  }).returning();

  // If ensemble save, clear isCurrent on other versions
  if (saveMode === 'ensemble') {
    await dz.update(versions)
      .set({ isCurrent: false, updatedAt: new Date() })
      .where(and(
        eq(versions.chartId, parentVersion.chartId),
        eq(versions.isCurrent, true),
        sql`${versions.id} != ${newVersion.id}`,
      ));
  }

  // Create edit operation audit row
  await dz.insert(editOperations).values({
    versionId: newVersion.id,
    parentVersionId,
    userId: req.user!.id,
    naturalLanguageInput: naturalLanguageInput || null,
    operationJson: operationJson as unknown as Record<string, unknown>,
  });

  // Annotation handling per Decision H
  if (saveMode === 'personal') {
    // Carry forward player's own annotations from parent version
    await carryPersonalAnnotationsForward(parentVersionId, partId, newVersion.id, req.user!.id);
  } else {
    // Enqueue standard cross-version migration job
    await enqueueJob('migration', {
      versionId: newVersion.id,
      userId: req.user!.id,
      sources: [{ sourcePartId: partId, sourceVersionId: parentVersionId, targetPartId: partId }],
    }).catch(() => {});
  }

  // Enqueue PDF render job
  await enqueueJob('pdf_render', { versionId: newVersion.id }).catch(() => {});

  res.status(201).json({ version: newVersion });
});

/**
 * Carry forward a player's own annotations from a parent version/part
 * to a new personal version. Simple copy with same measure anchors.
 */
async function carryPersonalAnnotationsForward(
  parentVersionId: string,
  parentPartId: string,
  newVersionId: string,
  userId: string,
): Promise<void> {
  // Find all annotations owned by this user on the parent part
  const userAnnotations = await dz.select()
    .from(annotations)
    .where(and(
      eq(annotations.partId, parentPartId),
      eq(annotations.ownerUserId, userId),
      isNull(annotations.deletedAt),
    ));

  if (userAnnotations.length === 0) return;

  // For personal versions, we need a part row. Check if one exists for the new version.
  // If not, create one referencing the same content.
  let [newPart] = await dz.select({ id: parts.id })
    .from(parts)
    .where(and(eq(parts.versionId, newVersionId), isNull(parts.deletedAt)));

  if (!newPart) {
    // Copy the part row from the parent (without the file references — the MusicXML is on the version)
    const [parentPart] = await dz.select()
      .from(parts)
      .where(eq(parts.id, parentPartId));
    if (parentPart) {
      [newPart] = await dz.insert(parts).values({
        versionId: newVersionId,
        kind: parentPart.kind,
        name: parentPart.name,
        pdfS3Key: parentPart.pdfS3Key,
        audiverisMxlS3Key: parentPart.audiverisMxlS3Key,
        omrJson: parentPart.omrJson,
        omrStatus: parentPart.omrStatus,
        omrEngine: parentPart.omrEngine,
        uploadedByUserId: parentPart.uploadedByUserId,
      }).returning();
    }
  }

  if (!newPart) return;

  // Copy annotations to the new part
  for (const ann of userAnnotations) {
    await dz.insert(annotations).values({
      partId: newPart.id,
      ownerUserId: ann.ownerUserId,
      layerId: ann.layerId,
      anchorType: ann.anchorType,
      anchorJson: ann.anchorJson,
      kind: ann.kind,
      contentJson: ann.contentJson,
      scope: ann.scope,
      sourceAnnotationId: ann.id,
      needsReview: false,
      migratable: ann.migratable,
    });
  }
}
