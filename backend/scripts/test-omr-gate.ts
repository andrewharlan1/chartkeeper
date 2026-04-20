/**
 * Step 4 test gate: verify the OMR worker's Drizzle update path
 * can write omr_status='complete' + omr_json into the parts table.
 */
import dotenv from 'dotenv';
dotenv.config();

import { eq } from 'drizzle-orm';
import { dz } from '../src/db';
import { users, workspaces, workspaceMembers, ensembles, versions, parts } from '../src/schema';

async function main() {
  console.log('Step 4 gate: testing OMR worker Drizzle writes...\n');

  // 1. Seed minimal hierarchy: user → workspace → ensemble → version → part
  const [user] = await dz.insert(users).values({
    email: 'omr-gate-test@test.local',
    passwordHash: 'not-real',
    displayName: 'OMR Gate Test',
  }).returning();

  const [ws] = await dz.insert(workspaces).values({ name: 'Gate Test WS' }).returning();
  await dz.insert(workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: 'owner' });

  const [ens] = await dz.insert(ensembles).values({ workspaceId: ws.id, name: 'Gate Ensemble' }).returning();
  const [ver] = await dz.insert(versions).values({ ensembleId: ens.id, name: 'v1', sortOrder: 0 }).returning();

  const [part] = await dz.insert(parts).values({
    versionId: ver.id,
    name: 'Trumpet',
    pdfS3Key: 'test/gate/trumpet.pdf',
    omrStatus: 'pending',
  }).returning();

  console.log(`  Created part ${part.id} with omrStatus=${part.omrStatus}`);

  // 2. Simulate OMR worker Drizzle update (same code pattern as the worker)
  const omrJson = {
    measures: [
      { number: 1, bounds: { x: 50, y: 100, w: 200, h: 80, page: 1 } },
      { number: 2, bounds: { x: 250, y: 100, w: 200, h: 80, page: 1 } },
    ],
    sections: [],
    partName: 'Trumpet',
  };

  await dz.update(parts)
    .set({
      omrStatus: 'complete',
      omrJson: omrJson,
      omrEngine: 'vision',
      updatedAt: new Date(),
    })
    .where(eq(parts.id, part.id));

  // 3. Read back and verify
  const [updated] = await dz.select({
    id: parts.id,
    omrStatus: parts.omrStatus,
    omrJson: parts.omrJson,
    omrEngine: parts.omrEngine,
  }).from(parts).where(eq(parts.id, part.id));

  const ok = updated.omrStatus === 'complete'
    && updated.omrEngine === 'vision'
    && (updated.omrJson as any)?.measures?.length === 2;

  console.log(`  After update: omrStatus=${updated.omrStatus}, omrEngine=${updated.omrEngine}, measures=${(updated.omrJson as any)?.measures?.length}`);

  // 4. Clean up
  await dz.delete(parts).where(eq(parts.id, part.id));
  await dz.delete(versions).where(eq(versions.id, ver.id));
  await dz.delete(ensembles).where(eq(ensembles.id, ens.id));
  await dz.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, ws.id));
  await dz.delete(workspaces).where(eq(workspaces.id, ws.id));
  await dz.delete(users).where(eq(users.id, user.id));

  if (ok) {
    console.log('\n  PASS: OMR worker Drizzle write path works correctly.');
  } else {
    console.error('\n  FAIL: values did not round-trip correctly.');
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
