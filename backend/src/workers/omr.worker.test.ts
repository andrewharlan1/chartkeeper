import { db } from '../db';
import { enqueueJob, claimNextJob, completeJob } from '../lib/queue';

// Stub S3 and fetch
jest.mock('../lib/s3', () => ({
  uploadFile: jest.fn().mockResolvedValue('mocked-key'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://example.com/signed'),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

async function clearJobs() {
  await db.query(`DELETE FROM jobs`);
}

beforeAll(clearJobs);
afterEach(clearJobs);
afterAll(async () => { await db.end(); });

describe('queue primitives', () => {
  it('enqueues and claims a job', async () => {
    await enqueueJob('omr', { partId: 'abc', pdfS3Key: 'some/key.pdf' });
    const job = await claimNextJob('omr');
    expect(job).not.toBeNull();
    expect((job!.payload as any).partId).toBe('abc');
  });

  it('claimed job is not returned again', async () => {
    await enqueueJob('omr', { partId: 'xyz', pdfS3Key: 'some/key.pdf' });
    await claimNextJob('omr');
    const second = await claimNextJob('omr');
    expect(second).toBeNull();
  });

  it('completes a job', async () => {
    await enqueueJob('omr', { partId: 'done', pdfS3Key: 'key.pdf' });
    const job = await claimNextJob('omr');
    await completeJob(job!.id);
    const row = await db.query(`SELECT status FROM jobs WHERE id = $1`, [job!.id]);
    expect(row.rows[0].status).toBe('complete');
  });
});

describe('omr worker processing', () => {
  // Import worker logic as a function so we can call tick() directly in tests
  // The worker module runs on import, so we test the queue interaction instead
  it('enqueued jobs have correct payload shape', async () => {
    await enqueueJob('omr', {
      partId: 'part-123',
      pdfS3Key: 'charts/c1/versions/v1/parts/trumpet.pdf',
      chartId: 'c1',
      versionId: 'v1',
      instrument: 'trumpet',
    });
    const job = await claimNextJob('omr');
    const payload = job!.payload as any;
    expect(payload.instrument).toBe('trumpet');
    expect(payload.chartId).toBe('c1');
  });
});
