// Quick probe: count rows in market_list_cache and market_snapshots to confirm D1 is empty.
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const account = env.CF_ACCOUNT_ID;
const dbId = '20b734c5-71f3-46b0-97ec-578fd203c112';
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
  let token = null;
  for (const [name, value] of tokens) {
    const probe = await runQuery(value, 'SELECT 1;');
    if (probe.success) { token = value; console.log(`token   : ${name} ✓`); break; }
  }
  if (!token) { console.error('No usable CF token.'); process.exit(1); }

  const cacheCount = await runQuery(token, "SELECT COUNT(*) as n FROM market_list_cache;");
  const snapshotCount = await runQuery(token, "SELECT COUNT(*) as n FROM market_snapshots;");

  console.log(`market_list_cache  : ${cacheCount.result?.[0]?.results?.[0]?.n ?? '?'} rows`);
  console.log(`market_snapshots   : ${snapshotCount.result?.[0]?.results?.[0]?.n ?? '?'} rows`);
};

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
