// Applies a hand-written drizzle SQL migration against the Neon Postgres DB.
//
// Usage:
//   node scripts/apply-migration.cjs drizzle/0009_limit_orders.sql
//   node scripts/apply-migration.cjs           # applies the highest-numbered drizzle/*.sql
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

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL (or POSTGRES_URL) is not set. Put it in .env.local or the environment.');

  let file = process.argv[2];
  if (!file) {
    const dir = path.join(process.cwd(), 'drizzle');
    const sqls = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    if (sqls.length === 0) throw new Error('No drizzle/*.sql migrations found.');
    file = path.join('drizzle', sqls[sqls.length - 1]);
  }
  const full = path.resolve(process.cwd(), file);
  if (!fs.existsSync(full)) throw new Error(`Migration file not found: ${file}`);

  const sqlText = fs.readFileSync(full, 'utf8');
  const statements = splitSqlStatements(sqlText);
  const sql = neon(url);

  console.log(`Applying ${file} (${statements.length} statements)...`);
  for (const [i, stmt] of statements.entries()) {
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 70);
    process.stdout.write(`  [${i + 1}/${statements.length}] ${preview}... `);
    await sql.query(stmt);
    console.log('ok');
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error('Migration failed:', err.message || err);
  process.exitCode = 1;
});
