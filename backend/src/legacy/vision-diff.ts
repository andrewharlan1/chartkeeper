import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db';
import { VISION_DIFF_PROMPT_V1, VISION_DIFF_PROMPT_VERSION, VISION_DIFF_SYSTEM_PROMPT } from './vision-prompt';
import type { PartDiff, MeasureBounds } from '../lib/diff';

// ── Config ────────────────────────────────────────────────────────────────────

const VISION_PROVIDER  = (process.env.VISION_PROVIDER  ?? 'claude') as 'claude' | 'openai';
const MODEL_PRIMARY    = process.env.VISION_MODEL_PRIMARY ?? 'claude-sonnet-4-6';
const MODEL_FAST       = process.env.VISION_MODEL_FAST    ?? 'claude-haiku-4-5-20251001';
const MAX_CONCURRENCY  = parseInt(process.env.VISION_MAX_CONCURRENCY ?? '5');
const MAX_RETRIES      = parseInt(process.env.VISION_MAX_RETRIES     ?? '3');
const PDF_MAX_BYTES    = 25 * 1024 * 1024; // 25 MB

// ── Circuit breaker ───────────────────────────────────────────────────────────
// Simple in-process counter. If 5 consecutive calls fail, trips to open state.
// Resets after 5 minutes.

let circuitFailures    = 0;
let circuitOpenUntil   = 0;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_RESET_MS  = 5 * 60 * 1000;

function circuitIsOpen(): boolean {
  if (circuitOpenUntil > Date.now()) return true;
  if (circuitOpenUntil > 0) {
    // Reset after cooldown
    circuitFailures  = 0;
    circuitOpenUntil = 0;
  }
  return false;
}

function circuitRecordSuccess() { circuitFailures = 0; }
function circuitRecordFailure() {
  circuitFailures++;
  if (circuitFailures >= CIRCUIT_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_RESET_MS;
    console.error(`[vision-diff] Circuit breaker OPEN — ${circuitFailures} consecutive failures. Reopens at ${new Date(circuitOpenUntil).toISOString()}`);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VisionDiffResult {
  measureMapping:    Record<number, number | null>;
  insertedMeasures:  number[];
  deletedMeasures:   number[];
  changedMeasures:   number[];
  changeDescriptions: Record<number, string>;
  sectionLabels:     Array<{ label: string; startMeasure: number; endMeasure: number }>;
  measureBounds?:    Record<number, MeasureBounds>;
  confidence:        Record<number, number>;
  overallConfidence: number;
  modelUsed:         string;
  processingMs:      number;
}

interface RawVisionResponse {
  measure_mapping:    Record<string, number | null>;
  inserted_measures:  number[];
  deleted_measures:   number[];
  changed_measures:   number[];
  change_descriptions: Record<string, string>;
  section_labels:     Array<{ label: string; start_measure: number; end_measure: number }>;
  measure_bounds?:    Record<string, { page: number; x: number; y: number; w: number; h: number }>;
  confidence:         Record<string, number>;
  overall_confidence: number;
}

// ── Concurrency pool ──────────────────────────────────────────────────────────

export class ConcurrencyPool {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const globalPool = new ConcurrencyPool(MAX_CONCURRENCY);

// ── Parse raw Vision API response ────────────────────────────────────────────

export function parseVisionResponse(raw: unknown, modelUsed: string, processingMs: number): VisionDiffResult {
  let text = typeof raw === 'string' ? raw : JSON.stringify(raw);

  // Strip markdown code fences if model wrapped the JSON
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  let parsed: RawVisionResponse | undefined;

  // Try direct parse first
  try {
    parsed = JSON.parse(text);
  } catch {
    // Model output prose before/after the JSON — extract the first top-level object
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(text.slice(start, end + 1));
      } catch {
        // fall through to error below
      }
    }
  }

  if (!parsed) {
    throw new Error(`Vision API returned non-JSON: ${text.slice(0, 200)}`);
  }

  // Convert string keys to number keys, normalise nulls
  const measureMapping: Record<number, number | null> = {};
  for (const [k, v] of Object.entries(parsed.measure_mapping ?? {})) {
    const key = parseInt(k);
    if (!isNaN(key)) measureMapping[key] = typeof v === 'number' ? v : null;
  }

  const confidence: Record<number, number> = {};
  for (const [k, v] of Object.entries(parsed.confidence ?? {})) {
    const key = parseInt(k);
    if (!isNaN(key)) confidence[key] = typeof v === 'number' ? Math.min(1, Math.max(0, v)) : 0.5;
  }

  const changeDescriptions: Record<number, string> = {};
  for (const [k, v] of Object.entries(parsed.change_descriptions ?? {})) {
    const key = parseInt(k);
    if (!isNaN(key) && typeof v === 'string') changeDescriptions[key] = v;
  }

  const measureBounds: Record<number, MeasureBounds> = {};
  for (const [k, v] of Object.entries(parsed.measure_bounds ?? {})) {
    const key = parseInt(k);
    if (!isNaN(key) && v && typeof v === 'object') {
      measureBounds[key] = {
        page: Number(v.page) || 1,
        x: Number(v.x) || 0,
        y: Number(v.y) || 0,
        w: Number(v.w) || 0,
        h: Number(v.h) || 0,
      };
    }
  }

  return {
    measureMapping,
    insertedMeasures:   (parsed.inserted_measures  ?? []).map(Number).filter(n => !isNaN(n)),
    deletedMeasures:    (parsed.deleted_measures   ?? []).map(Number).filter(n => !isNaN(n)),
    changedMeasures:    (parsed.changed_measures   ?? []).map(Number).filter(n => !isNaN(n)),
    changeDescriptions,
    sectionLabels: (parsed.section_labels ?? []).map(s => ({
      label:        String(s.label ?? ''),
      startMeasure: Number(s.start_measure) || 0,
      endMeasure:   Number(s.end_measure)   || 0,
    })),
    measureBounds: Object.keys(measureBounds).length > 0 ? measureBounds : undefined,
    confidence,
    overallConfidence: typeof parsed.overall_confidence === 'number'
      ? Math.min(1, Math.max(0, parsed.overall_confidence)) : 0.5,
    modelUsed,
    processingMs,
  };
}

// ── Convert VisionDiffResult → PartDiff ──────────────────────────────────────

export function visionResultToPartDiff(result: VisionDiffResult): PartDiff {
  const changedMeasureBounds: Record<number, MeasureBounds> = {};
  if (result.measureBounds) {
    for (const [measureStr, bounds] of Object.entries(result.measureBounds)) {
      changedMeasureBounds[Number(measureStr)] = bounds;
    }
  }

  return {
    changedMeasures:    result.changedMeasures,
    changeDescriptions: result.changeDescriptions,
    structuralChanges: {
      insertedMeasures:   result.insertedMeasures,
      deletedMeasures:    result.deletedMeasures,
      sectionLabelChanges: result.sectionLabels.map(s =>
        `Section "${s.label}" at m.${s.startMeasure}–${s.endMeasure}`
      ),
    },
    measureMapping:     result.measureMapping,
    measureConfidence:  result.confidence,
    overallConfidence:  result.overallConfidence,
    ...(Object.keys(changedMeasureBounds).length > 0 ? { changedMeasureBounds } : {}),
  };
}

// ── Core Vision call (Claude) ─────────────────────────────────────────────────

async function callClaude(
  oldPdfBase64: string,
  newPdfBase64: string,
  model: string,
  directorHint?: string,
): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const prompt = directorHint
    ? `${VISION_DIFF_PROMPT_V1}\n\nComposer note: "${directorHint}". Use this as a hint for the mapping.`
    : VISION_DIFF_PROMPT_V1;

  const message = await client.messages.create({
    model,
    max_tokens: 8192,
    temperature: 0,
    system: VISION_DIFF_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: oldPdfBase64 },
            title: 'VERSION 1',
          },
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: newPdfBase64 },
            title: 'VERSION 2',
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const textBlock = message.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
  return {
    text:         textBlock?.text ?? '',
    inputTokens:  message.usage?.input_tokens,
    outputTokens: message.usage?.output_tokens,
  };
}

// ── Log Vision call ───────────────────────────────────────────────────────────

async function logVisionCall(params: {
  partId?: string;
  fromVersionId?: string;
  toVersionId?: string;
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  overallConfidence?: number;
  success: boolean;
  errorMessage?: string;
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO vision_call_logs
         (part_id, from_version_id, to_version_id, provider, model, prompt_version,
          input_tokens, output_tokens, latency_ms, overall_confidence, success, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        params.partId ?? null,
        params.fromVersionId ?? null,
        params.toVersionId ?? null,
        params.provider,
        params.model,
        VISION_DIFF_PROMPT_VERSION,
        params.inputTokens ?? null,
        params.outputTokens ?? null,
        params.latencyMs,
        params.overallConfidence ?? null,
        params.success,
        params.errorMessage ?? null,
      ]
    );
  } catch (err) {
    // Never let logging crash the pipeline
    console.error('[vision-diff] Failed to log call:', err);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ComputeMappingOptions {
  provider?:      'claude' | 'openai';
  model?:         string;
  directorHint?:  string;
  partId?:        string;
  fromVersionId?: string;
  toVersionId?:   string;
  /** Use fast (cheaper) model. True when part ≤ 2 pages and directorHint provided. */
  useFastModel?:  boolean;
}

export async function computeMeasureMapping(
  oldPdfBuffer: Buffer,
  newPdfBuffer: Buffer,
  instrument: string,
  opts: ComputeMappingOptions = {},
): Promise<VisionDiffResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  // PDF size guard
  if (oldPdfBuffer.length > PDF_MAX_BYTES || newPdfBuffer.length > PDF_MAX_BYTES) {
    throw new Error(`PDF exceeds 25 MB size limit for instrument ${instrument}`);
  }

  if (circuitIsOpen()) {
    throw new Error('Vision circuit breaker is open — too many consecutive failures');
  }

  const provider = opts.provider ?? VISION_PROVIDER;
  const model    = opts.model ?? (opts.useFastModel ? MODEL_FAST : MODEL_PRIMARY);
  const oldBase64 = oldPdfBuffer.toString('base64');
  const newBase64 = newPdfBuffer.toString('base64');

  const start = Date.now();
  let lastError: Error | null = null;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await globalPool.run(async () => {
        if (provider === 'claude') {
          return callClaude(oldBase64, newBase64, model, opts.directorHint);
        }
        // OpenAI stub — requires `npm install openai` and image rendering
        throw new Error('OpenAI provider not yet implemented. Set VISION_PROVIDER=claude.');
      });

      inputTokens  = result.inputTokens;
      outputTokens = result.outputTokens;
      const processingMs = Date.now() - start;
      const parsed = parseVisionResponse(result.text, model, processingMs);

      circuitRecordSuccess();
      await logVisionCall({
        partId: opts.partId, fromVersionId: opts.fromVersionId, toVersionId: opts.toVersionId,
        provider, model, latencyMs: processingMs,
        inputTokens, outputTokens,
        overallConfidence: parsed.overallConfidence,
        success: true,
      });

      if (parsed.overallConfidence < 0.6) {
        console.warn(`[vision-diff] Low confidence ${parsed.overallConfidence.toFixed(2)} for ${instrument} (${opts.fromVersionId} → ${opts.toVersionId})`);
      }

      return parsed;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[vision-diff] Attempt ${attempt}/${MAX_RETRIES} failed for ${instrument}:`, lastError.message);
      if (attempt < MAX_RETRIES) {
        // Back off longer for rate limit errors
        const isRateLimit = lastError.message.includes('429') || lastError.message.includes('rate_limit');
        const delay = isRateLimit ? 60_000 : 1000 * attempt;
        if (isRateLimit) console.warn(`[vision-diff] Rate limited — waiting ${delay / 1000}s before retry`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  circuitRecordFailure();
  await logVisionCall({
    partId: opts.partId, fromVersionId: opts.fromVersionId, toVersionId: opts.toVersionId,
    provider, model, latencyMs: Date.now() - start,
    inputTokens, outputTokens,
    success: false,
    errorMessage: lastError?.message,
  });

  throw lastError ?? new Error('Vision diff failed after all retries');
}

export { PartDiff };
