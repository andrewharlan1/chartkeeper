import { z } from 'zod';

// ── Shared primitives ────────────────────────────────────────────────────────

const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

/** Measure-relative bounding box (all values 0-1 within the measure). */
const measureRelativeBBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

/**
 * Text/shape bounding box: position is measure-relative (0-1),
 * size is in absolute page-height units so text stays the same visual
 * size even when a measure changes width across versions.
 */
const absoluteSizeBBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  widthPageUnits: z.number().positive(),
  heightPageUnits: z.number().positive(),
});

// ── Per-kind content schemas ─────────────────────────────────────────────────

const strokePointSchema = z.object({
  x: z.number(),
  y: z.number(),
  pressure: z.number().optional(),
});

const strokeSchema = z.object({
  points: z.array(strokePointSchema).min(1),
  color: hexColorSchema,
  width: z.number().positive(),
});

export const inkContentSchema = z.object({
  strokes: z.array(strokeSchema).min(1),
  boundingBox: measureRelativeBBoxSchema,
});

export const textContentSchema = z.object({
  text: z.string().min(1).max(1000),
  fontSize: z.number().positive(),
  color: hexColorSchema,
  fontWeight: z.enum(['normal', 'bold']),
  fontStyle: z.enum(['normal', 'italic']),
  boundingBox: absoluteSizeBBoxSchema,
});

export const highlightContentSchema = z.object({
  color: hexColorSchema,
  opacity: z.number().min(0).max(1),
  boundingBox: measureRelativeBBoxSchema,
});

export const shapeContentSchema = z.object({
  shapeType: z.enum(['circle', 'rectangle', 'arrow']),
  strokeColor: hexColorSchema,
  fillColor: hexColorSchema.optional(),
  strokeWidth: z.number().positive(),
  endpoints: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  boundingBox: measureRelativeBBoxSchema,
});

// ── Discriminated union (content + kind tag) ─────────────────────────────────

export const annotationContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ink'), ...inkContentSchema.shape }),
  z.object({ kind: z.literal('text'), ...textContentSchema.shape }),
  z.object({ kind: z.literal('highlight'), ...highlightContentSchema.shape }),
  z.object({ kind: z.literal('shape'), ...shapeContentSchema.shape }),
]);

// ── Re-export bounding box schemas for tests ─────────────────────────────────

export { measureRelativeBBoxSchema, absoluteSizeBBoxSchema };
