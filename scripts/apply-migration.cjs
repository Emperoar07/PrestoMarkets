// Applies a hand-written drizzle SQL migration against the Neon Postgres DB.
//
// Usage:
//   node scripts/apply-migration.cjs drizzle/0009_limit_orders.sql
//   node scripts/apply-migration.cjs           # applies EVERY unapplied drizzle/*.sql in order (journaled in _migrations)
//
// Reads DATABASE_URL (or POSTGRES_URL) from .env.local / the environment. Statements are split on
// ';' but dollar-quoted blocks ($$ ... $$, e.g. DO/CREATE TYPE guards) are kept intact, and each is
// run over the Neon HTTP driver. Migrations are written idempotently (IF NOT EXISTS / EXCEPTION
// guards), so re-running is safe.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ quiet: true });

const { neon } = require('@neondatabase/serverless');

function splitSqlStatements(sql) {
  const statements = [];
  let buf = '';
  let inDollar = false;
  for (let i = 0; i < sql.length; i++) {
    const two = sql.slice(i, i + 2);
    if (two === '$$') { inDollar = !inDollar; buf += two; i++; continue; }
    const ch = sql[i];
    if (ch === ';' && !inDollar) {
      if (buf.trim()) statements.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) statements.push(buf.trim());
  return statements;
}

async function applyFile(sql, file) {
  const full = path.resolve(process.cwd(), file);
  if (!fs.existsSync(full)) throw new Error(`Migration file not found: ${file}`);
  const statements = splitSqlStatements(fs.readFileSync(full, 'utf8'));
  console.log(`Applying ${file} (${statements.length} statements)...`);
  for (const [i, stmt] of statements.entries()) {
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 70);
    process.stdout.write(`  [${i + 1}/${statements.length}] ${preview}... `);
    await sql.query(stmt);
    console.log('ok');
  }
  await sql.query(
    'INSERT INTO _migrations (name, applied_at) VALUES ($1, now()) ON CONFLICT (name) DO NOTHING',
    [path.basename(file)],
  );
}

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL (or POSTGRES_URL) is not set. Put it in .env.local or the environment.');
  const sql = neon(url);

  // Migration journal: records which files have been applied so the no-arg mode can bring ANY
  // database (fresh or lagging) fully up to date instead of only applying the newest file.
  await sql.query('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');

  const file = process.argv[2];
  // --baseline: record every existing migration file as applied WITHOUT executing it. For
  // databases that were migrated out-of-band before the journal existed (early migrations are not
  // idempotent, so re-running them fails on already-created types/tables).
  if (file === '--baseline') {
    const dirB = path.join(process.cwd(), 'drizzle');
    const files = fs.readdirSync(dirB).filter((f) => f.endsWith('.sql')).sort();
    for (const name of files) {
      await sql.query('INSERT INTO _migrations (name, applied_at) VALUES ($1, now()) ON CONFLICT (name) DO NOTHING', [name]);
    }
    console.log(`Baselined ${files.length} migrations as applied.`);
    return;
  }
  if (file) {
    await applyFile(sql, file);
    console.log('Done.');
    return;
  }

  const dir = path.join(process.cwd(), 'drizzle');
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  if (all.length === 0) throw new Error('No drizzle/*.sql migrations found.');
  const appliedRows = await sql.query('SELECT name FROM _migrations');
  const applied = new Set(appliedRows.map((row) => row.name));
  const pending = all.filter((name) => !applied.has(name));
  if (pending.length === 0) {
    console.log(`Up to date: all ${all.length} migrations already applied.`);
    return;
  }
  console.log(`Pending migrations: ${pending.join(', ')}`);
  for (const name of pending) {
    await applyFile(sql, path.join('drizzle', name));
  }
  console.log(`Done. Applied ${pending.length} migration(s).`);
}

main().catch((err) => {
  console.error('Migration failed:', err.message || err);
  process.exitCode = 1;
});
