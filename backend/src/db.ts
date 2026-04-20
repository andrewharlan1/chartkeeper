import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import dotenv from 'dotenv';
import * as schema from './schema';

dotenv.config();

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Drizzle instance reuses the same pool.
export const dz = drizzle(db, { schema });
