import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

type PrestoDb = NeonHttpDatabase<typeof schema>;

let cachedDb: PrestoDb | null = null;

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
}

export function getDb(): PrestoDb {
  if (cachedDb) return cachedDb;
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL or POSTGRES_URL is required for Phase 3 social features.');
  }
  cachedDb = drizzle(neon(connectionString), { schema });
  return cachedDb;
}
