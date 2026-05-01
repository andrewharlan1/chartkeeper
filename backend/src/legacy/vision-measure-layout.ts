import Anthropic from '@anthropic-ai/sdk';
import type { OmrJson, OmrMeasure } from '../lib/diff';
import { annotatePdfWithMeasures } from '../lib/annotate-pdf';

const MODEL = process.env.VISION_MODEL_PRIMARY ?? 'claude-sonnet-4-6';
const MAX_RETRIES = 3;
const PDF_MAX_BYTES = 25 * 1024 * 1024;

// Padding above and below the staff as a fraction of the staff height
const STAFF_PADDING_FACTOR = 0.4;

const SYSTEM_PROMPT = `You are a music score layout analyzer. You identify the physical structure of sheet music: where each system (row of music) sits on the page, and where every barline falls within each system. You always respond with valid JSON and nothing else.`;

const USER_PROMPT = `Analyze this single-instrument music part. Your job is to find the PHYSICAL LAYOUT — systems and barlines — so I can compute measure bounding boxes from your output.

## Definitions

- **System**: One horizontal row of music on the page. A single-staff instrument has one staff per system. A piano part has two staves per system grouped by a brace.
- **Barline**: A thin VERTICAL line spanning the height of the staff that separates one measure from the next. Do NOT confuse with the 5 horizontal staff lines.

## What to report

### Per page: staff_height

Report ONE value per page: **staff_height** — the distance from the TOP (1st) staff line to the BOTTOM (5th) staff line of any system on that page, as a fraction of page height. On printed music, all staves on a page have the same height (same rastral size), so this only needs to be measured once per page. Be precise — measure from line 1 to line 5, not including any space above or below. Typical values are 0.03–0.06 depending on page size and number of systems.

### Per system: y_center and barlines

For each system on each page:

1. **y_center**: The y-coordinate of the MIDDLE (3rd) line of the 5 horizontal staff lines, as a fraction of page height (0.0 = top edge, 1.0 = bottom edge). This is the single most important vertical reference point. Be precise — find the actual 3rd line, not an approximation.

2. **barlines_x**: An array of x-positions (fractions of page width, 0.0 = left, 1.0 = right) for every barline in the system, in left-to-right order. Include:
   - The LEFT EDGE of the first measure (where music notation begins, after the clef/key/time signature)
   - Every internal barline separating measures
   - The RIGHT EDGE of the last measure (the final barline of the system)

   So if a system contains 4 measures, you should report 5 barline_x values (4 measures = 5 boundaries).

3. **start_measure**: The measure number at the beginning of this system. It is often printed above or to the left of the first barline. If the very first system has no printed number, start at 1. For subsequent systems, the printed number tells you where counting resumes.

## CRITICAL: Cross-validation with printed measure numbers

Follow this process for EVERY system:

1. FIRST, scan the ENTIRE SCORE and note the printed measure number at the start of EACH system on EVERY page. These numbers are typically printed above or to the left of the first barline. Record them ALL before counting any barlines.

2. THEN, compute the expected measure count for each system:
   - expected_measures = next_system_start_measure - this_system_start_measure
   - For the last system on a page, use the first system's start_measure on the NEXT page.
   - For the very last system of the score, count barlines directly.
   - expected barlines_x entries = expected_measures + 1

3. FINALLY, find barlines within each system. Scan LEFT TO RIGHT SLOWLY and mark EVERY thin vertical line that crosses the staff.
   - If your barline count does NOT match the expected count from step 2, you MUST RE-EXAMINE the system more carefully. You are DEFINITELY missing barlines.
   - COMMON MISTAKE: In fast/dense passages (sixteenth notes, runs, trills), measures can be VERY narrow (as little as 2-3% of page width). Barlines are close together but they ARE there. Zoom in mentally and find every one.
   - COMMON MISTAKE: Barlines near beam groups or dense notes are easy to overlook. Every barline spans the full staff height — look for any vertical line crossing all 5 staff lines.
   - A system with 12 measures has 13 barlines_x entries. A system with 4 measures has 5.
   - NEVER report fewer barlines than the printed measure numbers imply. If printed numbers say there should be 12 measures but you only see 7 barlines, you are wrong — look again.

## Other counting rules

- Double barlines (two thin lines close together), repeat signs (dots + thick+thin barlines), and final barlines (thin+thick) each count as ONE barline position.
- A pickup bar (anacrusis) at the start counts as measure 1 unless a later printed number indicates otherwise.
- If a measure number is printed at the start of a system, USE THAT NUMBER as start_measure. Do not try to infer it.

## Multi-measure rests

A multi-measure rest is a single wide bar containing a thick horizontal line across the staff with a number above it (e.g., "7"). This represents multiple consecutive measures of rest compressed into one visual space. When you encounter one:
- Report the barlines on either side of it normally in barlines_x
- Add a "multi_rests" entry specifying which barline span contains the multi-rest and how many measures it represents

## Output format

Respond with ONLY this JSON:

{
  "pages": [
    {
      "page": 1,
      "staff_height": 0.038,
      "systems": [
        {
          "y_center": 0.12,
          "start_measure": 1,
          "barlines_x": [0.08, 0.15, 0.22, 0.29, 0.37, 0.44, 0.53, 0.61, 0.69, 0.77, 0.85, 0.91, 0.97]
        },
        {
          "y_center": 0.55,
          "start_measure": 35,
          "barlines_x": [0.06, 0.30, 0.97],
          "multi_rests": [{"barline_left": 1, "count": 7}]
        }
      ]
    }
  ],
  "sections": [
    { "label": "A", "measure_number": 1 }
  ]
}

In the multi_rests example: barline_left=1 means the span between barlines_x[1] and barlines_x[2] contains 7 measures of rest, not just 1.

Include ALL pages, ALL systems, and ALL barlines. The sections array captures rehearsal marks or section labels (leave empty if none).`;

const CORRECTION_PROMPT = `I previously analyzed this score and drew colored boxes around each detected measure (the boxes are visible in the image). Some of the boxes are WRONG — they don't align with the actual barlines, or they're missing measures.

SPECIFIC ISSUES DETECTED:
{ISSUES}

Please re-examine the ENTIRE score carefully and provide the COMPLETE corrected result. Pay special attention to the systems listed above — they have the wrong number of measures.

Respond with ONLY this JSON format:

{
  "pages": [
    {
      "page": 1,
      "staff_height": 0.038,
      "systems": [
        {
          "y_center": 0.12,
          "start_measure": 1,
          "barlines_x": [0.08, 0.15, 0.22, 0.29, 0.37, 0.44, 0.53, 0.61, 0.69, 0.77, 0.85, 0.91, 0.97]
        }
      ]
    }
  ],
  "sections": [
    { "label": "A", "measure_number": 1 }
  ]
}

Rules:
- **staff_height**: distance from top to bottom staff line as fraction of page height (one value per page)
- **y_center**: y-coordinate of the MIDDLE (3rd) staff line as fraction of page height
- **barlines_x**: x-positions of ALL barlines (N measures = N+1 barlines_x entries)
- **start_measure**: the printed measure number at the start of the system
- Include ALL pages, ALL systems, ALL barlines
- For multi-measure rests, add "multi_rests": [{"barline_left": index, "count": N}]`;

// ── Raw response types (systems + barlines) ─────────────────────────────────

interface RawMultiRest {
  barline_left: number; // index into barlines_x
  count: number;        // how many measures this span represents
}

interface RawSystem {
  y_center: number;
  start_measure: number;
  barlines_x: number[];
  multi_rests?: RawMultiRest[];
  // Legacy fields from older prompt versions (backwards compat)
  staff_top?: number;
  staff_bottom?: number;
}

interface RawPage {
  page: number;
  staff_height?: number; // distance from line 1 to line 5, fraction of page height
  systems: RawSystem[];
}

interface RawResponse {
  pages: RawPage[];
  sections?: Array<{ label: string; measure_number: number }>;
}

interface ValidationIssue {
  page: number;
  systemIndex: number;
  startMeasure: number;
  actualMeasures: number;
  expectedMeasures: number;
}

// ── Convert systems+barlines → OmrMeasure[] ─────────────────────────────────

// Default staff height if Vision doesn't report one (~3.5% of page for a typical 10-system page)
const DEFAULT_STAFF_HEIGHT = 0.035;

function getStaffBounds(system: RawSystem, pageStaffHeight: number): { yTop: number; h: number } {
  const halfStaff = pageStaffHeight / 2;
  const padding = pageStaffHeight * STAFF_PADDING_FACTOR;

  // Use y_center (3rd staff line) as the anchor
  let center: number;
  if (system.y_center != null) {
    center = clamp01(system.y_center);
  } else if (system.staff_top != null && system.staff_bottom != null) {
    // Legacy: compute center from top/bottom
    center = clamp01((system.staff_top + system.staff_bottom) / 2);
  } else {
    center = 0.5;
  }

  const yTop = clamp01(center - halfStaff - padding);
  const yBottom = clamp01(center + halfStaff + padding);
  const h = yBottom - yTop;

  return { yTop, h };
}

function systemsToMeasures(raw: RawResponse, instrument: string): OmrJson {
  const measures: OmrMeasure[] = [];

  for (const page of raw.pages) {
    // Use page-level staff_height, or fall back to default
    const staffHeight = page.staff_height && page.staff_height > 0.005 && page.staff_height < 0.2
      ? page.staff_height
      : DEFAULT_STAFF_HEIGHT;

    for (const system of page.systems) {
      // Sort barlines left-to-right and clamp
      const barlines = system.barlines_x
        .map(x => clamp01(x))
        .sort((a, b) => a - b);

      if (barlines.length < 2) continue; // need at least 2 boundaries to form a measure

      const { yTop, h } = getStaffBounds(system, staffHeight);
      if (h <= 0) continue;

      // Build map of multi-rest spans: barline index → rest count
      const multiRestMap = new Map<number, number>();
      for (const mr of system.multi_rests ?? []) {
        if (mr.count > 1) multiRestMap.set(mr.barline_left, mr.count);
      }

      let measureNumber = system.start_measure;
      for (let i = 0; i < barlines.length - 1; i++) {
        const spanX = barlines[i];
        const spanW = barlines[i + 1] - barlines[i];
        if (spanW <= 0) continue;

        const restCount = multiRestMap.get(i);
        if (restCount) {
          // All measures in a multi-rest span share the SAME full-span bounds.
          // The first measure gets multiRestCount so the UI can render one box
          // labeled "mm.X-Y" instead of N tiny boxes.
          const sharedBounds = {
            page: page.page,
            x: spanX,
            y: yTop,
            w: spanW,
            h,
          };
          for (let j = 0; j < restCount; j++) {
            measures.push({
              number: measureNumber++,
              notes: [],
              dynamics: [],
              bounds: sharedBounds,
              ...(j === 0 ? { multiRestCount: restCount } : {}),
            });
          }
        } else {
          measures.push({
            number: measureNumber++,
            notes: [],
            dynamics: [],
            bounds: {
              page: page.page,
              x: spanX,
              y: yTop,
              w: spanW,
              h,
            },
          });
        }
      }
    }
  }

  const sections = (raw.sections ?? []).map(s => ({
    label: String(s.label),
    measureNumber: Number(s.measure_number),
  }));

  return { measures, sections, partName: instrument };
}

// ── Validation ──────────────────────────────────────────────────────────────

function validateBarlineCounts(parsed: RawResponse): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const allSystems: { system: RawSystem; page: number; index: number }[] = [];

  for (const page of parsed.pages) {
    for (let si = 0; si < page.systems.length; si++) {
      allSystems.push({ system: page.systems[si], page: page.page, index: si });
    }
  }

  for (let i = 0; i < allSystems.length - 1; i++) {
    const { system: sys, page, index } = allSystems[i];
    const next = allSystems[i + 1].system;

    const expectedMeasures = next.start_measure - sys.start_measure;
    const multiRestExtra = (sys.multi_rests ?? []).reduce(
      (acc, mr) => acc + (mr.count > 1 ? mr.count - 1 : 0), 0
    );
    const actualMeasures = (sys.barlines_x.length - 1) + multiRestExtra;

    if (expectedMeasures > 0 && actualMeasures !== expectedMeasures) {
      issues.push({
        page,
        systemIndex: index,
        startMeasure: sys.start_measure,
        actualMeasures,
        expectedMeasures,
      });
    }
  }

  return issues;
}

// ── Vision API call helper ──────────────────────────────────────────────────

async function callVision(
  client: Anthropic,
  pdfBase64: string,
  mediaType: 'application/pdf' | 'image/png',
  prompt: string,
  instrument: string,
): Promise<RawResponse> {
  const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [
    {
      type: 'document',
      source: { type: 'base64', media_type: mediaType as 'application/pdf', data: pdfBase64 },
      title: instrument,
    },
    { type: 'text', text: prompt },
  ];

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 32768,
    thinking: { type: 'enabled', budget_tokens: 16000 },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });
  const message = await stream.finalMessage();

  const textBlock = message.content.find(b => b.type === 'text') as { text: string } | undefined;
  return parseResponse(textBlock?.text ?? '');
}

// ── Self-correction pass ────────────────────────────────────────────────────

async function selfCorrect(
  client: Anthropic,
  pdfBuffer: Buffer,
  instrument: string,
  initialParsed: RawResponse,
  issues: ValidationIssue[],
): Promise<RawResponse> {
  // Generate annotated PDF with the initial (incorrect) boxes
  const initialOmr = systemsToMeasures(initialParsed, instrument);
  const annotatedPdf = await annotatePdfWithMeasures(pdfBuffer, initialOmr);
  const annotatedBase64 = annotatedPdf.toString('base64');

  // Build the issues description
  const issueLines = issues.map(issue =>
    `- Page ${issue.page}, system starting at m.${issue.startMeasure}: ` +
    `detected ${issue.actualMeasures} measures but should be ${issue.expectedMeasures} ` +
    `(need ${issue.expectedMeasures + 1} barlines_x entries)`
  ).join('\n');

  const prompt = CORRECTION_PROMPT.replace('{ISSUES}', issueLines);

  console.log(
    `[vision-measure-layout] ${instrument}: Running self-correction pass for ${issues.length} system(s) with wrong barline counts`
  );

  return callVision(client, annotatedBase64, 'application/pdf', prompt, instrument);
}

// ── Main extraction function ─────────────────────────────────────────────────

/**
 * Send a PDF to Claude Vision and extract a complete measure layout
 * using a barline-detection approach: identify systems and barlines,
 * then compute measure bounding boxes from the barline positions.
 *
 * Two-pass pipeline:
 *   Pass 1 — extract systems + barlines from the raw PDF
 *   Validate — check barline counts against printed measure numbers
 *   Pass 2 — if issues found, send annotated PDF back for self-correction
 */
export async function extractMeasureLayout(
  pdfBuffer: Buffer,
  instrument: string,
): Promise<OmrJson> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }
  if (pdfBuffer.length > PDF_MAX_BYTES) {
    throw new Error(`PDF exceeds 25 MB limit for ${instrument}`);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const pdfBase64 = pdfBuffer.toString('base64');

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // ── Pass 1: Initial extraction ──────────────────────────────────────
      const parsed = await callVision(client, pdfBase64, 'application/pdf', USER_PROMPT, instrument);

      // Log staff_height per page for debugging
      for (const page of parsed.pages) {
        console.log(
          `[vision-measure-layout] ${instrument}: page ${page.page} staff_height=${page.staff_height ?? 'not reported (using default)'}`
        );
      }

      // ── Validate barline counts ─────────────────────────────────────────
      const issues = validateBarlineCounts(parsed);

      for (const issue of issues) {
        console.warn(
          `[vision-measure-layout] ${instrument}: system at m.${issue.startMeasure} (page ${issue.page}) ` +
          `has ${issue.actualMeasures} measures but expected ${issue.expectedMeasures}`
        );
      }

      // ── Pass 2: Self-correction if needed ───────────────────────────────
      let finalParsed = parsed;

      if (issues.length > 0) {
        try {
          const corrected = await selfCorrect(client, pdfBuffer, instrument, parsed, issues);

          // Safety check: corrected result must produce at least as many measures as original
          const originalMeasureCount = systemsToMeasures(parsed, instrument).measures.length;
          const correctedMeasureCount = systemsToMeasures(corrected, instrument).measures.length;

          if (correctedMeasureCount < originalMeasureCount * 0.8) {
            console.warn(
              `[vision-measure-layout] ${instrument}: Self-correction rejected — ` +
              `produced ${correctedMeasureCount} measures vs original ${originalMeasureCount}`
            );
          } else {
            // Verify the correction actually improved barline count validation
            const newIssues = validateBarlineCounts(corrected);
            if (newIssues.length < issues.length) {
              finalParsed = corrected;
              console.log(
                `[vision-measure-layout] ${instrument}: Self-correction improved results ` +
                `(${issues.length} → ${newIssues.length} issues), ` +
                `measures: ${originalMeasureCount} → ${correctedMeasureCount}`
              );
            } else {
              console.log(
                `[vision-measure-layout] ${instrument}: Self-correction did not improve ` +
                `(${issues.length} → ${newIssues.length} issues), keeping initial results`
              );
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[vision-measure-layout] ${instrument}: Self-correction failed: ${msg}`);
        }
      }

      const omrJson = systemsToMeasures(finalParsed, instrument);

      // Log summary
      const totalSystems = finalParsed.pages.reduce((s, p) => s + p.systems.length, 0);
      const pageCount = new Set(finalParsed.pages.map(p => p.page)).size;
      console.log(
        `[vision-measure-layout] ${instrument}: ${omrJson.measures.length} measures ` +
        `across ${pageCount} page(s), ${totalSystems} system(s)`
      );

      return omrJson;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[vision-measure-layout] Attempt ${attempt}/${MAX_RETRIES} failed for ${instrument}:`,
        lastError.message
      );
      if (attempt < MAX_RETRIES) {
        const isRateLimit = lastError.message.includes('429') || lastError.message.includes('rate_limit');
        const delay = isRateLimit ? 60_000 : 1000 * attempt;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error('Vision measure layout extraction failed');
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function parseResponse(raw: string): RawResponse {
  let text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch { /* fall through */ }
    }
  }

  throw new Error(`Vision API returned non-JSON: ${text.slice(0, 200)}`);
}
