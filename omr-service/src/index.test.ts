import supertest from 'supertest';
import { app } from './index';

// Stub S3 download and Audiveris so tests are self-contained
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      Body: (async function* () {
        yield Buffer.from('%PDF-1.4 fake pdf content');
      })(),
    }),
  })),
  GetObjectCommand: jest.fn(),
}));

jest.mock('./audiveris', () => ({
  runAudiveris: jest.fn().mockResolvedValue({
    musicxml: Buffer.from('<score-partwise/>').toString('base64'),
    omrJson: {
      measures: [{ number: 1, notes: [], dynamics: [] }],
      sections: [],
      partName: 'trumpet',
    },
  }),
}));

const request = supertest(app);

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('POST /process', () => {
  it('returns musicxml and omrJson for valid input', async () => {
    const res = await request.post('/process').send({
      pdfS3Key: 'charts/c1/versions/v1/parts/trumpet.pdf',
      partId: 'part-abc',
    });
    expect(res.status).toBe(200);
    expect(res.body.musicxml).toBeDefined();
    expect(res.body.omrJson.partName).toBe('trumpet');
    expect(res.body.omrJson.measures).toHaveLength(1);
  });

  it('returns 400 when pdfS3Key is missing', async () => {
    const res = await request.post('/process').send({ partId: 'abc' });
    expect(res.status).toBe(400);
  });

  it('returns 500 when audiveris throws', async () => {
    const { runAudiveris } = require('./audiveris');
    runAudiveris.mockRejectedValueOnce(new Error('Audiveris not found'));
    const res = await request.post('/process').send({
      pdfS3Key: 'charts/c1/versions/v1/parts/trumpet.pdf',
      partId: 'part-abc',
    });
    expect(res.status).toBe(500);
  });
});
