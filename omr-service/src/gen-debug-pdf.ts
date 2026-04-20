/**
 * Generate a debug PDF with measure boxes drawn over the original.
 * Usage: npx ts-node src/gen-debug-pdf.ts <input.pdf> <output.pdf>
 */
import fs from 'fs';
import path from 'path';
import { runAudiveris } from './audiveris';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const input = process.argv[2];
const output = process.argv[3] ?? input.replace(/\.pdf$/i, '_debug.pdf');

if (!input) {
  console.error('Usage: npx ts-node src/gen-debug-pdf.ts <input.pdf> [output.pdf]');
  process.exit(1);
}

async function main() {
  console.log(`Processing: ${input}`);
  const result = await runAudiveris(input, 'test-part');
  const { measures, sections } = result.omrJson;
  console.log(`Parsed ${measures.length} measures, ${sections.length} sections`);

  // Load original PDF
  const pdfBuffer = fs.readFileSync(input);
  const doc = await PDFDocument.load(pdfBuffer);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();

  const colors = [
    rgb(0.85, 0.15, 0.15),
    rgb(0.15, 0.50, 0.85),
    rgb(0.15, 0.70, 0.25),
    rgb(0.75, 0.40, 0.00),
    rgb(0.55, 0.15, 0.75),
  ];

  // Build multi-rest skip set
  const multiRestSkip = new Set<number>();
  for (const m of measures) {
    if (m.multiRestCount && m.multiRestCount > 1) {
      for (let k = 1; k < m.multiRestCount; k++) {
        multiRestSkip.add(m.number + k);
      }
    }
  }

  // Group by page
  const byPage = new Map<number, typeof measures>();
  for (const m of measures) {
    if (!m.bounds) continue;
    const pg = m.bounds.page;
    if (!byPage.has(pg)) byPage.set(pg, []);
    byPage.get(pg)!.push(m);
  }

  for (const [pageNum, pageMeasures] of byPage) {
    const pageIdx = pageNum - 1;
    if (pageIdx < 0 || pageIdx >= pages.length) continue;
    const page = pages[pageIdx];
    const { width: pw, height: ph } = page.getSize();

    let colorIdx = 0;
    for (const m of pageMeasures) {
      if (multiRestSkip.has(m.number)) continue;

      const b = m.bounds!;
      const color = colors[colorIdx++ % colors.length];

      const x = b.x * pw;
      const y = ph - (b.y + b.h) * ph;
      const w = b.w * pw;
      const h = b.h * ph;

      page.drawRectangle({
        x, y, width: w, height: h,
        borderColor: color, borderWidth: 2,
        opacity: 0, borderOpacity: 0.85,
      });

      const label = m.multiRestCount && m.multiRestCount > 1
        ? `mm.${m.number}-${m.number + m.multiRestCount - 1}`
        : `m.${m.number}`;
      const fontSize = Math.min(10, h * 0.35);
      page.drawText(label, {
        x: x + 2, y: y + h - font.heightAtSize(fontSize) - 2,
        size: fontSize, font, color,
      });
    }
  }

  const annotatedBytes = await doc.save();
  fs.writeFileSync(output, annotatedBytes);
  console.log(`Debug PDF written to: ${output}`);
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
