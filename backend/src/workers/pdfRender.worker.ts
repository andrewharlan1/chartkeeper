/**
 * PDF Render Worker — converts MusicXML to PDF via MuseScore CLI.
 *
 * Polls for pending render jobs, invokes MuseScore, uploads the resulting PDF.
 * If MuseScore is not installed, jobs fail gracefully and the frontend
 * falls back to Verovio SVG rendering.
 */
import { eq } from 'drizzle-orm';
import { dz } from '../db';
import { versions } from '../schema';
import { claimNextJob, completeJob, failJob } from '../lib/queue';
import { uploadFile } from '../lib/s3';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 5_000;

// Try common MuseScore binary paths
const MUSESCORE_PATHS = [
  'musescore',
  '/Applications/MuseScore 4.app/Contents/MacOS/mscore',
  '/usr/bin/musescore',
  '/usr/local/bin/musescore',
];

async function findMuseScore(): Promise<string | null> {
  for (const path of MUSESCORE_PATHS) {
    try {
      await execFileAsync(path, ['--version']);
      return path;
    } catch {
      continue;
    }
  }
  return null;
}

async function processJob(job: { versionId: string }): Promise<void> {
  const { versionId } = job;

  await dz.update(versions)
    .set({ pdfRenderStatus: 'rendering', updatedAt: new Date() })
    .where(eq(versions.id, versionId));

  const [version] = await dz.select({ musicxmlBlob: versions.musicxmlBlob, chartId: versions.chartId })
    .from(versions)
    .where(eq(versions.id, versionId));

  if (!version?.musicxmlBlob) {
    console.error(`[pdf-render] No MusicXML blob for version ${versionId}`);
    await dz.update(versions)
      .set({ pdfRenderStatus: 'failed', updatedAt: new Date() })
      .where(eq(versions.id, versionId));
    return;
  }

  const musescorePath = await findMuseScore();
  if (!musescorePath) {
    console.warn('[pdf-render] MuseScore CLI not found. Marking as failed. Install MuseScore for PDF generation.');
    await dz.update(versions)
      .set({ pdfRenderStatus: 'failed', updatedAt: new Date() })
      .where(eq(versions.id, versionId));
    return;
  }

  const tmpXml = join(tmpdir(), `${versionId}.musicxml`);
  const tmpPdf = join(tmpdir(), `${versionId}.pdf`);

  try {
    await writeFile(tmpXml, version.musicxmlBlob, 'utf-8');
    await execFileAsync(musescorePath, ['-o', tmpPdf, tmpXml]);

    const pdfBuffer = await readFile(tmpPdf);
    const s3Key = `versions/${versionId}/rendered.pdf`;
    await uploadFile(s3Key, pdfBuffer, 'application/pdf');

    await dz.update(versions)
      .set({ pdfRenderStatus: 'complete', updatedAt: new Date() })
      .where(eq(versions.id, versionId));

    console.log(`[pdf-render] Rendered PDF for version ${versionId}`);
  } catch (err) {
    console.error(`[pdf-render] Render failed for ${versionId}:`, err);
    await dz.update(versions)
      .set({ pdfRenderStatus: 'failed', updatedAt: new Date() })
      .where(eq(versions.id, versionId));
  } finally {
    await unlink(tmpXml).catch(() => {});
    await unlink(tmpPdf).catch(() => {});
  }
}

async function poll(): Promise<void> {
  const job = await claimNextJob('pdf_render');
  if (job) {
    try {
      await processJob(job.payload as { versionId: string });
      await completeJob(job.id);
    } catch (err) {
      await failJob(job.id, String(err), 3);
    }
  }
}

// Main loop
async function main(): Promise<void> {
  console.log('[pdf-render] Worker started, polling every', POLL_INTERVAL_MS, 'ms');
  const musescore = await findMuseScore();
  if (musescore) {
    console.log(`[pdf-render] MuseScore found at: ${musescore}`);
  } else {
    console.warn('[pdf-render] MuseScore NOT found. PDF renders will fail until installed.');
  }

  setInterval(poll, POLL_INTERVAL_MS);
}

main().catch(console.error);
