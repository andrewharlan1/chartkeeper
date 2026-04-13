import { db } from '../db';

export async function enqueueJob(type: string, payload: object): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO jobs (type, payload) VALUES ($1, $2) RETURNING id`,
    [type, JSON.stringify(payload)]
  );
  return result.rows[0].id;
}

/**
 * Claims and returns the next pending job of the given type using
 * SELECT ... FOR UPDATE SKIP LOCKED so multiple workers never double-process.
 */
export async function claimNextJob(
  type: string
): Promise<{ id: string; payload: unknown } | null> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ id: string; payload: unknown }>(
      `SELECT id, payload FROM jobs
       WHERE type = $1 AND status = 'pending' AND run_at <= NOW()
       ORDER BY run_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [type]
    );

    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    const job = result.rows[0];
    await client.query(
      `UPDATE jobs SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
       WHERE id = $1`,
      [job.id]
    );
    await client.query('COMMIT');
    return job;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function completeJob(id: string): Promise<void> {
  await db.query(
    `UPDATE jobs SET status = 'complete', updated_at = NOW() WHERE id = $1`,
    [id]
  );
}

export async function failJob(
  id: string,
  error: string,
  maxAttempts: number,
  retryDelayMs = 60_000
): Promise<void> {
  await db.query(
    `UPDATE jobs
     SET status = CASE WHEN attempts >= $1 THEN 'failed'::job_status ELSE 'pending'::job_status END,
         last_error = $2,
         run_at = CASE WHEN attempts >= $1 THEN run_at ELSE NOW() + ($3 || ' milliseconds')::interval END,
         updated_at = NOW()
     WHERE id = $4`,
    [maxAttempts, error, retryDelayMs, id]
  );
}
