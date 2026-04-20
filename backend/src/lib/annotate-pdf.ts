import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { OmrJson, OmrMeasure } from './diff';

/**
 * Takes a PDF buffer and measure layout data, returns a new PDF with
 * colored boxes drawn around each measure and the measure number labeled.
 */
export async function annotatePdfWithMeasures(
  pdfBuffer: Buffer,
  omrJson: OmrJson,
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuffer);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();

  // Group measures by page
  const byPage = new Map<number, typeof omrJson.measures>();
  for (const m of omrJson.measures) {
    if (!m.bounds) continue;
    const pg = m.bounds.page;
    if (!byPage.has(pg)) byPage.set(pg, []);
    byPage.get(pg)!.push(m);
  }

  // Cycle through colors so adjacent measures are visually distinct
  const colors = [
    rgb(0.85, 0.15, 0.15),  // red
    rgb(0.15, 0.50, 0.85),  // blue
    rgb(0.15, 0.70, 0.25),  // green
    rgb(0.75, 0.40, 0.00),  // orange
    rgb(0.55, 0.15, 0.75),  // purple
  ];

  // Build a set of measure numbers that are part of a multi-rest span (non-first)
  // so we can skip drawing duplicate boxes for them
  const multiRestSkip = new Set<number>();
  for (const m of omrJson.measures) {
    if (m.multiRestCount && m.multiRestCount > 1) {
      for (let k = 1; k < m.multiRestCount; k++) {
        multiRestSkip.add(m.number + k);
      }
    }
  }

  for (const [pageNum, measures] of byPage.entries()) {
    const pageIdx = pageNum - 1; // 0-based
    if (pageIdx < 0 || pageIdx >= pages.length) continue;
    const page = pages[pageIdx];
    const { width: pw, height: ph } = page.getSize();

    let colorIdx = 0;
    for (let i = 0; i < measures.length; i++) {
      const m = measures[i];
      if (multiRestSkip.has(m.number)) continue; // skip non-first multi-rest measures

      const b = m.bounds!;
      const color = colors[colorIdx++ % colors.length];

      // Convert 0-1 fractions to PDF coordinates.
      // PDF origin is bottom-left; y in our data is top-down.
      const x = b.x * pw;
      const y = ph - (b.y + b.h) * ph; // flip y
      const w = b.w * pw;
      const h = b.h * ph;

      // Draw box outline (2pt stroke)
      page.drawRectangle({
        x, y, width: w, height: h,
        borderColor: color,
        borderWidth: 2,
        opacity: 0,
        borderOpacity: 0.85,
      });

      // Draw label — "mm.1-14" for multi-rest, "m.39" for normal
      const label = m.multiRestCount && m.multiRestCount > 1
        ? `mm.${m.number}-${m.number + m.multiRestCount - 1}`
        : `m.${m.number}`;
      const fontSize = Math.min(10, h * 0.35);
      const textW = font.widthOfTextAtSize(label, fontSize);
      const textH = font.heightAtSize(fontSize);
      const labelPad = 2;

      // Position label at top-left inside the box
      const labelX = x + labelPad;
      const labelY = y + h - textH - labelPad;

      // White background behind label
      page.drawRectangle({
        x: labelX - 1,
        y: labelY - 1,
        width: textW + labelPad * 2,
        height: textH + labelPad,
        color: rgb(1, 1, 1),
        opacity: 0.85,
      });

      // Draw measure number text
      page.drawText(label, {
        x: labelX,
        y: labelY,
        size: fontSize,
        font,
        color,
      });
    }
  }

  const annotatedBytes = await doc.save();
  return Buffer.from(annotatedBytes);
}
