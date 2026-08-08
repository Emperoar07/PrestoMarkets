import { defineConfig } from 'drizzle-kit';

// D1 (SQLite). The app migrated off Neon/Postgres to Cloudflare D1 — the schema is sqlite-core and
// the runtime driver is drizzle-orm/d1. Generated DDL lands in ./drizzle-d1 (the old ./drizzle pg
// migrations are retained only as history and are no longer applied).
export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle-d1',
  dialect: 'sqlite',
});
