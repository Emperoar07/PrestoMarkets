// Verify the harvest landed: row counts + the AegisAI market's stored liquidity/odds/volume,
// and whether it got a snapshot point. Reads secrets from .env.local; prints no secrets.
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const account = env.CF_ACCOUNT_ID;
const token = env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN;
const dbId = '20b734c5-71f3-46b0-97ec-578fd203c112';
const target = (process.argv[2] || '0x53d45874dd5922cabd5ecb0f2cf5bac2d21ba947').toLowerCase();

async function q(sql, params) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params: params ?? [] }),
      });
      return await res.json();
    } catch (e) {
      lastErr = e; // transient CF TLS socket close (UND_ERR_SOCKET) — brief backoff and retry
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

const run = async () => {
  const c1 = await q('SELECT COUNT(*) n FROM market_list_cache;');
  const c2 = await q('SELECT COUNT(*) n FROM market_snapshots;');
  console.log(`market_list_cache : ${c1.result?.[0]?.results?.[0]?.n} rows`);
  console.log(`market_snapshots  : ${c2.result?.[0]?.results?.[0]?.n} rows`);

  const row = await q("SELECT updated_at, payload FROM market_list_cache WHERE key='latest';");
  const r = row.result?.[0]?.results?.[0];
  if (!r) { console.log('no latest row!'); return; }
  console.log(`latest updated_at : ${new Date(r.updated_at * 1000).toISOString()}`);
  const markets = JSON.parse(r.payload);
  console.log(`payload markets   : ${markets.length}`);
  const m = markets.find((x) => (x.id || '').toLowerCase() === target);
  if (!m) { console.log(`market ${target} NOT in payload`); return; }
  console.log('--- AegisAI market ---');
  console.log('title     :', m.title);
  console.log('status    :', m.status);
  console.log('liquidity :', m.liquidity);
  console.log('volume    :', m.volume);
  console.log('outcomes  :', JSON.stringify(m.outcomes?.map((o) => ({ label: o.label, odds: o.odds }))));

  const snap = await q('SELECT captured_at, probabilities FROM market_snapshots WHERE market_id=? ORDER BY captured_at;', [target]);
  const snaps = snap.result?.[0]?.results ?? [];
  console.log(`snapshots for it  : ${snaps.length}`);
  for (const s of snaps) console.log('  @', new Date(s.captured_at * 1000).toISOString(), '=>', s.probabilities);
};
run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
