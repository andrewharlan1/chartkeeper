import { z } from 'zod';

// ── Interval and scope enums ──────────────────────────────────────────────────

export const intervalEnum = z.enum([
  'up_half_step', 'down_half_step', 'up_whole_step', 'down_whole_step',
  'up_minor_third', 'down_minor_third', 'up_major_third', 'down_major_third',
  'up_perfect_fourth', 'down_perfect_fourth', 'up_perfect_fifth', 'down_perfect_fifth',
  'up_octave', 'down_octave',
]);

export const scopeSchema = z.union([
  z.literal('whole_part'),
  z.object({ measureRange: z.tuple([z.number().int().positive(), z.number().int().positive()]) }),
]);

export const instrumentEnum = z.enum([
  'flute', 'trumpet_in_bb', 'horn_in_f', 'alto_saxophone',
  'tenor_saxophone', 'clarinet_in_bb', 'violin', 'viola', 'cello',
]);

// ── Slice 1 operations (active) ──────────────────────────────────────────────

export const TransposeOpSchema = z.object({
  op: z.literal('transpose'),
  interval: intervalEnum,
  scope: scopeSchema,
});

export const OctaveDisplaceOpSchema = z.object({
  op: z.literal('octave_displace'),
  direction: z.enum(['up', 'down']),
  scope: scopeSchema,
});

export const InstrumentChangeOpSchema = z.object({
  op: z.literal('instrument_change'),
  newInstrument: instrumentEnum,
});

// ── Slice 2+ operations (parsed but rejected at apply time) ──────────────────

export const PitchFixOpSchema = z.object({
  op: z.literal('pitch_fix'),
  measure: z.number().int().positive(),
  beat: z.number().positive(),
  voiceIndex: z.number().int().optional(),
  oldPitch: z.string().optional(),
  newPitch: z.string(),
});

export const RhythmFixOpSchema = z.object({
  op: z.literal('rhythm_fix'),
  measure: z.number().int().positive(),
  beat: z.number().positive(),
  voiceIndex: z.number().int().optional(),
  newDuration: z.enum([
    'whole', 'half', 'quarter', 'eighth', 'sixteenth',
    'dotted_half', 'dotted_quarter', 'dotted_eighth',
  ]),
});

export const AccidentalFixOpSchema = z.object({
  op: z.literal('accidental_fix'),
  measure: z.number().int().positive(),
  beat: z.number().positive(),
  voiceIndex: z.number().int().optional(),
  newAccidental: z.enum(['natural', 'sharp', 'flat', 'double_sharp', 'double_flat']),
});

// ── Combined discriminated union ─────────────────────────────────────────────

export const ValidOperationSchema = z.discriminatedUnion('op', [
  TransposeOpSchema,
  OctaveDisplaceOpSchema,
  InstrumentChangeOpSchema,
  PitchFixOpSchema,
  RhythmFixOpSchema,
  AccidentalFixOpSchema,
]);

export type ValidOperation = z.infer<typeof ValidOperationSchema>;
export type TransposeOp = z.infer<typeof TransposeOpSchema>;
export type OctaveDisplaceOp = z.infer<typeof OctaveDisplaceOpSchema>;
export type InstrumentChangeOp = z.infer<typeof InstrumentChangeOpSchema>;

// Operations that are supported in Slice 1
export const SLICE1_OPS = new Set(['transpose', 'octave_displace', 'instrument_change']);
