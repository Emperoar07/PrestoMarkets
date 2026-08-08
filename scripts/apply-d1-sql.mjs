// Apply a .sql file to the D1 database via the raw CF REST API (wrangler d1 execute hits a
// preflight account-membership call the Workers-scoped token can't satisfy). Secrets are read
// from .env.local and never printed.
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const account = env.CF_ACCOUNT_ID;
const dbId = '20b734c5-71f3-46b0-97ec-578fd203c112';
const sqlPath = process.argv[2] || 'drizzle-d1/0000_d1_init.sql';
const sql = fs.readFileSync(sqlPath, 'utf8');

console.log(`account : ${account ? account.slice(0, 6) + '…' : '<MISSING>'}`);
console.log(`db      : ${dbId}`);
console.log(`sql     : ${sqlPath} (${(sql.match(/CREATE (TABLE|INDEX)/gi) || []).length} DDL statements)`);

const tokens = [['CLOUDFLARE_API_TOKEN', env.CLOUDFLARE_API_TOKEN], ['CF_API_TOKEN', env.CF_API_TOKEN]].filter(([, v]) => v);

async function runQuery(token, sql) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  return res.json();
}

const run = async () => {
  // Pick the first token that can talk to this DB (a cheap read probe).
  let token = null;
  for (const [name, value] of tokens) {
    const probe = await runQuery(value, 'SELECT name FROM sqlite_master WHERE type=\'table\' LIMIT 1;');
    if (probe.success) { token = value; console.log(`token   : ${name} ✓`); break; }
    console.log(`token   : ${name} ✗ (${probe.errors?.[0]?.message || 'auth failed'})`);
  }
  if (!token) { console.error('No usable CF token for D1 query.'); process.exit(1); }

  // Send the whole DDL in one request — D1 /query executes multiple ;-separated statements.
  // The drizzle `--> statement-breakpoint` markers are valid SQL line comments, so the raw file
  // is accepted as-is.
  const result = await runQuery(token, sql);
  if (!result.success) {
    console.error('DDL apply FAILED:');
    console.error(JSON.stringify(result.errors, null, 2));
    process.exit(1);
  }
  console.log('DDL applied ✓');

  // Verify: list tables.
  const check = await runQuery(token, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name;");
  const names = (check.result?.[0]?.results || []).map((r) => r.name);
  console.log(`tables  : ${names.length} → ${names.join(', ')}`);
};

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
