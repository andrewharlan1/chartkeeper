import {
  inkContentSchema,
  textContentSchema,
  highlightContentSchema,
  shapeContentSchema,
  annotationContentSchema,
} from './annotation-content';

// ── Ink ──────────────────────────────────────────────────────────────────────

describe('inkContentSchema', () => {
  const validInk = {
    strokes: [{
      points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
      color: '#000000',
      width: 0.02,
    }],
    boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
  };

  it('accepts valid ink content', () => {
    expect(inkContentSchema.safeParse(validInk).success).toBe(true);
  });

  it('accepts strokes with pressure', () => {
    const withPressure = {
      ...validInk,
      strokes: [{ ...validInk.strokes[0], points: [{ x: 0.1, y: 0.2, pressure: 0.8 }] }],
    };
    expect(inkContentSchema.safeParse(withPressure).success).toBe(true);
  });

  it('rejects empty strokes array', () => {
    expect(inkContentSchema.safeParse({ ...validInk, strokes: [] }).success).toBe(false);
  });

  it('rejects missing boundingBox', () => {
    const { boundingBox, ...noBbox } = validInk;
    expect(inkContentSchema.safeParse(noBbox).success).toBe(false);
  });

  it('rejects boundingBox coordinates outside 0-1', () => {
    expect(inkContentSchema.safeParse({
      ...validInk,
      boundingBox: { x: -0.1, y: 0, width: 0.5, height: 0.5 },
    }).success).toBe(false);

    expect(inkContentSchema.safeParse({
      ...validInk,
      boundingBox: { x: 0, y: 0, width: 1.5, height: 0.5 },
    }).success).toBe(false);
  });

  it('rejects invalid hex color', () => {
    expect(inkContentSchema.safeParse({
      ...validInk,
      strokes: [{ ...validInk.strokes[0], color: 'red' }],
    }).success).toBe(false);
  });

  it('rejects non-positive stroke width', () => {
    expect(inkContentSchema.safeParse({
      ...validInk,
      strokes: [{ ...validInk.strokes[0], width: 0 }],
    }).success).toBe(false);
  });
});

// ── Text ─────────────────────────────────────────────────────────────────────

describe('textContentSchema', () => {
  const validText = {
    text: 'breathe',
    fontSize: 0.15,
    color: '#333333',
    fontWeight: 'normal' as const,
    fontStyle: 'normal' as const,
    boundingBox: { x: 0.5, y: 0.1, widthPageUnits: 0.08, heightPageUnits: 0.02 },
  };

  it('accepts valid text content', () => {
    expect(textContentSchema.safeParse(validText).success).toBe(true);
  });

  it('accepts bold italic text', () => {
    expect(textContentSchema.safeParse({
      ...validText,
      fontWeight: 'bold',
      fontStyle: 'italic',
    }).success).toBe(true);
  });

  it('rejects empty text', () => {
    expect(textContentSchema.safeParse({ ...validText, text: '' }).success).toBe(false);
  });

  it('rejects text over 1000 chars', () => {
    expect(textContentSchema.safeParse({ ...validText, text: 'a'.repeat(1001) }).success).toBe(false);
  });

  it('rejects non-positive fontSize', () => {
    expect(textContentSchema.safeParse({ ...validText, fontSize: 0 }).success).toBe(false);
  });

  it('rejects invalid fontWeight', () => {
    expect(textContentSchema.safeParse({ ...validText, fontWeight: 'heavy' }).success).toBe(false);
  });

  it('rejects missing widthPageUnits in boundingBox', () => {
    expect(textContentSchema.safeParse({
      ...validText,
      boundingBox: { x: 0.5, y: 0.1, width: 0.3, height: 0.2 },
    }).success).toBe(false);
  });
});

// ── Highlight ────────────────────────────────────────────────────────────────

describe('highlightContentSchema', () => {
  const validHighlight = {
    color: '#FFFF00',
    opacity: 0.3,
    boundingBox: { x: 0, y: 0, width: 1, height: 1 },
  };

  it('accepts valid highlight content', () => {
    expect(highlightContentSchema.safeParse(validHighlight).success).toBe(true);
  });

  it('accepts edge-case opacity values', () => {
    expect(highlightContentSchema.safeParse({ ...validHighlight, opacity: 0 }).success).toBe(true);
    expect(highlightContentSchema.safeParse({ ...validHighlight, opacity: 1 }).success).toBe(true);
  });

  it('rejects opacity outside 0-1', () => {
    expect(highlightContentSchema.safeParse({ ...validHighlight, opacity: 1.1 }).success).toBe(false);
    expect(highlightContentSchema.safeParse({ ...validHighlight, opacity: -0.1 }).success).toBe(false);
  });

  it('rejects missing color', () => {
    const { color, ...noColor } = validHighlight;
    expect(highlightContentSchema.safeParse(noColor).success).toBe(false);
  });
});

// ── Shape ────────────────────────────────────────────────────────────────────

describe('shapeContentSchema', () => {
  const validShape = {
    shapeType: 'circle' as const,
    strokeColor: '#FF0000',
    strokeWidth: 0.01,
    boundingBox: { x: 0.2, y: 0.3, width: 0.4, height: 0.4 },
  };

  it('accepts valid shape content', () => {
    expect(shapeContentSchema.safeParse(validShape).success).toBe(true);
  });

  it('accepts shape with fillColor and endpoints', () => {
    expect(shapeContentSchema.safeParse({
      ...validShape,
      shapeType: 'arrow',
      fillColor: '#00FF00',
      endpoints: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }],
    }).success).toBe(true);
  });

  it('rejects invalid shapeType', () => {
    expect(shapeContentSchema.safeParse({ ...validShape, shapeType: 'hexagon' }).success).toBe(false);
  });

  it('rejects non-positive strokeWidth', () => {
    expect(shapeContentSchema.safeParse({ ...validShape, strokeWidth: 0 }).success).toBe(false);
  });
});

// ── Discriminated union ──────────────────────────────────────────────────────

describe('annotationContentSchema (discriminated union)', () => {
  it('accepts ink with kind tag', () => {
    const result = annotationContentSchema.safeParse({
      kind: 'ink',
      strokes: [{ points: [{ x: 0.1, y: 0.2 }], color: '#000000', width: 0.02 }],
      boundingBox: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts text with kind tag', () => {
    const result = annotationContentSchema.safeParse({
      kind: 'text',
      text: 'hello',
      fontSize: 0.15,
      color: '#000000',
      fontWeight: 'normal',
      fontStyle: 'normal',
      boundingBox: { x: 0.5, y: 0.1, widthPageUnits: 0.08, heightPageUnits: 0.02 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts highlight with kind tag', () => {
    const result = annotationContentSchema.safeParse({
      kind: 'highlight',
      color: '#FFFF00',
      opacity: 0.3,
      boundingBox: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts shape with kind tag', () => {
    const result = annotationContentSchema.safeParse({
      kind: 'shape',
      shapeType: 'rectangle',
      strokeColor: '#FF0000',
      strokeWidth: 0.01,
      boundingBox: { x: 0, y: 0, width: 0.5, height: 0.5 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown kind', () => {
    const result = annotationContentSchema.safeParse({
      kind: 'stamp',
      data: 'foo',
    });
    expect(result.success).toBe(false);
  });

  it('rejects ink content when kind is text', () => {
    const result = annotationContentSchema.safeParse({
      kind: 'text',
      strokes: [{ points: [{ x: 0, y: 0 }], color: '#000000', width: 0.02 }],
      boundingBox: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(result.success).toBe(false);
  });
});
