// One-off diagnostic: read the AegisAI market's real on-chain liquidity/prices.
// Run: node scripts/diag-market.mjs 0x53d45874dd5922cabd5ecb0f2cf5bac2d21ba947
import { createPublicClient, http, formatUnits, erc20Abi } from 'viem';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const address = (process.argv[2] || '0x53d45874dd5922cabd5ecb0f2cf5bac2d21ba947').toLowerCase();
const rpcUrl = env.ARC_RPC_URL || env.NEXT_PUBLIC_ARC_RPC_URL;
const usdc = (env.ARC_USDC_ADDRESS || env.NEXT_PUBLIC_USDC_ADDRESS).toLowerCase();
const chainId = Number(env.NEXT_PUBLIC_ARC_CHAIN_ID || 0);

const client = createPublicClient({
  chain: { id: chainId, name: 'arc', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } },
  transport: http(rpcUrl, { timeout: 15_000 }),
});

const lmsrAbi = [
  { type: 'function', name: 'outcomeCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'price', stateMutability: 'view', inputs: [{ type: 'uint8' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalShares', stateMutability: 'view', inputs: [{ type: 'uint8' }], outputs: [{ type: 'int256' }] },
  { type: 'function', name: 'buyCost', stateMutability: 'view', inputs: [{ type: 'uint8' }, { type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'seeded', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'collateralToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'state', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'closeTime', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'accruedFees6', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

const run = async () => {
  console.log('market  :', address);
  console.log('rpc     :', rpcUrl?.replace(/[?&].*$/, '?<redacted>'));
  console.log('chainId :', chainId);
  console.log('usdc    :', usdc);
  console.log('---');

  let collateralToken = usdc;
  try {
    collateralToken = (await client.readContract({ address, abi: lmsrAbi, functionName: 'collateralToken' })).toLowerCase();
  } catch (e) { console.log('collateralToken read FAILED:', String(e).split('\n')[0]); }
  console.log('collateralToken     :', collateralToken, collateralToken === usdc ? '(== configured USDC)' : '(DIFFERENT from configured USDC!)');

  const [dec, sym] = await Promise.all([
    client.readContract({ address: collateralToken, abi: erc20Abi, functionName: 'decimals' }).catch(() => 'ERR'),
    client.readContract({ address: collateralToken, abi: erc20Abi, functionName: 'symbol' }).catch(() => 'ERR'),
  ]);
  console.log('collateral decimals :', dec, '| symbol:', sym);

  const poolRaw = await client.readContract({ address: collateralToken, abi: erc20Abi, functionName: 'balanceOf', args: [address] }).catch((e) => { console.log('balanceOf FAILED', String(e).split('\n')[0]); return 0n; });
  console.log('pool balanceOf(raw) :', poolRaw.toString());
  console.log('pool @ 6 decimals   : $' + formatUnits(poolRaw, 6));
  if (dec !== 'ERR' && Number(dec) !== 6) console.log('pool @ real decimals: $' + formatUnits(poolRaw, Number(dec)), `  <-- decimals is ${dec}, code hardcodes 6`);

  const count = Number(await client.readContract({ address, abi: lmsrAbi, functionName: 'outcomeCount' }).catch(() => 2n));
  console.log('outcomeCount        :', count);

  const seeded = await client.readContract({ address, abi: lmsrAbi, functionName: 'seeded' }).catch((e) => { console.log('seeded read FAILED', String(e).split('\n')[0]); return 'ERR'; });
  console.log('seeded              :', seeded, seeded === false ? '  <-- NOT SEEDED: price() returns 0, chart is flat 50/50' : '');

  for (let i = 0; i < count; i++) {
    const p = await client.readContract({ address, abi: lmsrAbi, functionName: 'price', args: [i] }).catch(() => 0n);
    const ts = await client.readContract({ address, abi: lmsrAbi, functionName: 'totalShares', args: [i] }).catch(() => 'ERR');
    console.log(`  outcome[${i}]  price raw=${p.toString()} => ${(Number(p) / 1e16).toFixed(2)}%   totalShares=${ts.toString?.() ?? ts}`);
  }

  // Would a 1-USDC buy on outcome 0 succeed, and what does it cost? (mirrors "place a buy" the user tried)
  const oneShare = 1_000_000n;
  const cost0 = await client.readContract({ address, abi: lmsrAbi, functionName: 'buyCost', args: [0, oneShare] }).catch((e) => 'ERR: ' + String(e).split('\n')[0]);
  console.log('buyCost(0, 1.0 share):', typeof cost0 === 'bigint' ? '$' + formatUnits(cost0, 6) : cost0);

  const fees = await client.readContract({ address, abi: lmsrAbi, functionName: 'accruedFees6' }).catch(() => 'ERR');
  console.log('accruedFees6        :', typeof fees === 'bigint' ? '$' + formatUnits(fees, 6) : fees);

  const state = await client.readContract({ address, abi: lmsrAbi, functionName: 'state' }).catch(() => 'ERR');
  const close = await client.readContract({ address, abi: lmsrAbi, functionName: 'closeTime' }).catch(() => 'ERR');
  console.log('state               :', state);
  console.log('closeTime           :', close, close !== 'ERR' ? new Date(Number(close) * 1000).toISOString() : '');
};

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
