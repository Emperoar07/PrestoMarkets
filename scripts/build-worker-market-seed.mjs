import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'data', 'markets-seed.json');
const targetPath = path.join(root, 'data', 'markets-worker-seed.json');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const markets = Array.isArray(source) ? source : source.markets;

if (!Array.isArray(markets) || markets.length === 0) {
  throw new Error('data/markets-seed.json does not contain markets');
}

const live = markets.filter((market) => ['Open', 'Closing soon', 'Closed'].includes(market.status));
const resolved = markets
  .filter((market) => market.status === 'Resolved')
  .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
  .slice(0, 17);
const selected = [...live, ...resolved]
  .filter((market, index, list) => list.findIndex((item) => item.id === market.id) === index)
  .slice(0, 50);

fs.writeFileSync(targetPath, `${JSON.stringify({ markets: selected, at: source.at || Date.now() })}\n`);
