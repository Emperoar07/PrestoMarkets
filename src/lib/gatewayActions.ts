/**
 * UBK Phase 2 — move USDC from another chain into Arc via Circle Gateway.
 *
 * TWO-STEP, RESUMABLE design (deposit and transfer are separate) because Gateway deposit
 * finality on Sepolia-class testnets is up to ~20 minutes (Circle docs). A single blocking
 * browser call can't hold that long, so:
 *   Step 1 — depositToGateway: USDC.approve -> GatewayWallet.deposit() on the source chain.
 *            Funds leave the wallet into the user's Gateway unified balance immediately, but
 *            don't become *available* until source-chain finality. We persist a pending record.
 *   Step 2 — transferGatewayToArc: once the unified balance reflects the deposit, sign an
 *            EIP-712 BurnIntent, POST to the Gateway API for an attestation, then
 *            GatewayMinter.gatewayMint() on Arc. This runs against ANY available unified
 *            balance, so it both completes fresh deposits and RECOVERS funds from an
 *            earlier deposit whose transfer never finished.
 *
 * NOTE: a plain ERC-20 transfer to the GatewayWallet permanently burns funds — we only ever
 * call deposit(). The GatewayWallet address is never surfaced as a "send here" target.
 */

import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  http,
  pad,
  formatUnits,
  parseUnits,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { baseSepolia, sepolia, avalancheFuji, arbitrumSepolia, arcTestnet } from 'viem/chains';

const GATEWAY_API_TESTNET = 'https://gateway-api-testnet.circle.com/v1';
const GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as Address;
const GATEWAY_MINTER = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B' as Address;
const ARC_DOMAIN = 26;
const ARC_USDC = '0x3600000000000000000000000000000000000000' as Address;
// Per-source max Gateway fee (6-decimal base units). The Gateway API enforces value + maxFee <=
// available AND a per-chain MINIMUM maxFee (Ethereum/Base Sepolia require >= 1 USDC; Arbitrum/
// Avalanche accept ~0.10). We reserve this out of the moved amount, so the source's minimum fee
// also sets the smallest balance that can be completed.
const SOURCE_MAX_FEE: Record<GatewaySourceKey, bigint> = {
  sepolia: BigInt('1000000'),        // Ethereum Sepolia — API min 1 USDC
  baseSepolia: BigInt('1000000'),    // Base Sepolia — same slow-finality class, min 1 USDC
  arbitrumSepolia: BigInt('100000'), // 0.10 USDC
  avalancheFuji: BigInt('100000'),   // 0.10 USDC
};
/** Smallest balance (USDC) that can be completed from a source = its max fee + a little margin. */
export function minCompletableUsdc(source: GatewaySourceKey): number {
  return Number(SOURCE_MAX_FEE[source]) / 1e6 + 0.05;
}
const MAX_UINT64 = BigInt('18446744073709551615');

export type GatewaySourceKey = 'baseSepolia' | 'sepolia' | 'avalancheFuji' | 'arbitrumSepolia';

type SourceChain = { key: GatewaySourceKey; label: string; domain: number; chain: Chain; usdc: Address };

export const GATEWAY_SOURCES: Record<GatewaySourceKey, SourceChain> = {
  baseSepolia: { key: 'baseSepolia', label: 'Base Sepolia', domain: 6, chain: baseSepolia, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
  sepolia: { key: 'sepolia', label: 'Ethereum Sepolia', domain: 0, chain: sepolia, usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
  avalancheFuji: { key: 'avalancheFuji', label: 'Avalanche Fuji', domain: 1, chain: avalancheFuji, usdc: '0x5425890298aed601595a70AB815c96711a31Bc65' },
  arbitrumSepolia: { key: 'arbitrumSepolia', label: 'Arbitrum Sepolia', domain: 3, chain: arbitrumSepolia, usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' },
};

// Canonical EIP-3085 add-chain params. Arc's are taken from Arc docs (viem's chain object can
// lack a usable explorer/rpc for wallet add). Source chains build from their viem object.
const ARC_ADD_PARAMS = {
  chainId: '0x4cf4b2', // 5042002
  chainName: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: ['https://rpc.testnet.arc.network'],
  blockExplorerUrls: ['https://testnet.arcscan.app'],
} as const;

export type MoveStep =
  | 'switching-source' | 'approving' | 'depositing'
  | 'signing' | 'attesting' | 'switching-arc' | 'minting' | 'done';

export type StepResult<T> = { ok: true; txHash: Hex; data?: T } | { ok: false; error: string; atStep: MoveStep };

const gatewayWalletAbi = [{
  type: 'function', name: 'deposit',
  inputs: [{ name: 'token', type: 'address' }, { name: 'value', type: 'uint256' }],
  outputs: [], stateMutability: 'nonpayable',
}] as const;

const gatewayMinterAbi = [{
  type: 'function', name: 'gatewayMint',
  inputs: [{ name: 'attestationPayload', type: 'bytes' }, { name: 'signature', type: 'bytes' }],
  outputs: [], stateMutability: 'nonpayable',
}] as const;

const EIP712_DOMAIN = { name: 'GatewayWallet', version: '1' } as const;
const EIP712_TYPES = {
  TransferSpec: [
    { name: 'version', type: 'uint32' }, { name: 'sourceDomain', type: 'uint32' },
    { name: 'destinationDomain', type: 'uint32' }, { name: 'sourceContract', type: 'bytes32' },
    { name: 'destinationContract', type: 'bytes32' }, { name: 'sourceToken', type: 'bytes32' },
    { name: 'destinationToken', type: 'bytes32' }, { name: 'sourceDepositor', type: 'bytes32' },
    { name: 'destinationRecipient', type: 'bytes32' }, { name: 'sourceSigner', type: 'bytes32' },
    { name: 'destinationCaller', type: 'bytes32' }, { name: 'value', type: 'uint256' },
    { name: 'salt', type: 'bytes32' }, { name: 'hookData', type: 'bytes' },
  ],
  BurnIntent: [
    { name: 'maxBlockHeight', type: 'uint256' }, { name: 'maxFee', type: 'uint256' },
    { name: 'spec', type: 'TransferSpec' },
  ],
} as const;

function toBytes32(address: Address): Hex { return pad(address.toLowerCase() as Hex, { size: 32 }); }
function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

type Ethereum = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
function getEthereum(): Ethereum {
  const ethereum = (globalThis as { ethereum?: Ethereum }).ethereum;
  if (!ethereum) throw new Error('No external wallet found. Connect an external wallet to move USDC.');
  return ethereum;
}

// Robustly detect the EIP-1193 "chain not added" error (4902), including the nested shapes some
// wallets wrap it in.
function isUnrecognizedChain(error: unknown): boolean {
  const e = error as { code?: number; data?: { originalError?: { code?: number } } };
  return e?.code === 4902 || e?.data?.originalError?.code === 4902;
}

// Switch the wallet to `chain`; if unknown (4902) add it first (using canonical params for Arc)
// then switch. Tolerates the wallet auto-switching after an add.
async function ensureWalletChain(ethereum: Ethereum, chain: Chain): Promise<void> {
  const chainIdHex = `0x${chain.id.toString(16)}`;
  try {
    await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
    return;
  } catch (error) {
    if (!isUnrecognizedChain(error)) throw error;
  }
  const addParams = chain.id === arcTestnet.id ? ARC_ADD_PARAMS : {
    chainId: chainIdHex,
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: chain.rpcUrls.default.http,
    blockExplorerUrls: chain.blockExplorers?.default?.url ? [chain.blockExplorers.default.url] : undefined,
  };
  await ethereum.request({ method: 'wallet_addEthereumChain', params: [addParams] });
  // Most wallets auto-switch after adding; a follow-up switch is belt-and-suspenders and the
  // wallet may already be on-chain, so ignore a benign error here.
  try {
    await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
  } catch { /* already switched by the add */ }
}

/** Unified USDC balance available in Gateway across all source domains (finalized deposits). */
export type GatewaySourceBalance = { source: GatewaySourceKey; domain: number; amount: number };

/** Per-source-domain Gateway balances for the address (so the UI knows which chain to move from). */
export async function getGatewayBalancesBySource(address: Address): Promise<GatewaySourceBalance[]> {
  const entries = Object.values(GATEWAY_SOURCES);
  const res = await fetch(`${GATEWAY_API_TESTNET}/balances`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'USDC', sources: entries.map((s) => ({ domain: s.domain, depositor: address })) }),
  });
  if (!res.ok) return [];
  const data = await res.json() as { balances?: Array<{ domain: number; balance: string }> };
  const byDomain = new Map<number, number>();
  for (const b of data.balances ?? []) byDomain.set(b.domain, (byDomain.get(b.domain) ?? 0) + (Number(b.balance) || 0));
  return entries
    .map((s) => ({ source: s.key, domain: s.domain, amount: byDomain.get(s.domain) ?? 0 }))
    .filter((s) => s.amount > 0);
}

export async function getGatewayUnifiedBalance(address: Address): Promise<number> {
  const bySource = await getGatewayBalancesBySource(address);
  return bySource.reduce((sum, s) => sum + s.amount, 0);
}

// ── Pending-deposit persistence (so a long finality wait survives reloads) ──
export type PendingMove = { source: GatewaySourceKey; amountUsdc: number; recipient: string; depositedAt: number; depositTx: string };
const PENDING_KEY = 'presto:pending-gateway-moves';

export function readPendingMoves(recipient: string): PendingMove[] {
  if (typeof window === 'undefined') return [];
  try {
    const all = JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? '[]') as PendingMove[];
    return all.filter((m) => m.recipient.toLowerCase() === recipient.toLowerCase());
  } catch { return []; }
}
function writePendingMoves(all: PendingMove[]) {
  try { window.localStorage.setItem(PENDING_KEY, JSON.stringify(all)); } catch { /* storage off */ }
}
function addPendingMove(move: PendingMove) {
  if (typeof window === 'undefined') return;
  try {
    const all = JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? '[]') as PendingMove[];
    writePendingMoves([...all, move]);
  } catch { /* storage off */ }
}
export function clearPendingMove(recipient: string, depositTx: string) {
  if (typeof window === 'undefined') return;
  try {
    const all = JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? '[]') as PendingMove[];
    writePendingMoves(all.filter((m) => !(m.recipient.toLowerCase() === recipient.toLowerCase() && m.depositTx === depositTx)));
  } catch { /* storage off */ }
}

/**
 * Step 1: deposit USDC from a source chain into the Gateway unified balance. Funds leave the
 * wallet immediately but only become available to move after source-chain finality (up to ~20
 * min on Sepolia-class chains). Records a pending move so it can be completed later.
 */
export async function depositToGateway(input: {
  source: GatewaySourceKey; amountUsdc: number; recipient: Address; onStep?: (s: MoveStep) => void;
}): Promise<StepResult<void>> {
  const src = GATEWAY_SOURCES[input.source];
  const value = parseUnits(String(input.amountUsdc), 6);
  let current: MoveStep = 'switching-source';
  try {
    const ethereum = getEthereum();
    const wallet = createWalletClient({ account: input.recipient, chain: src.chain, transport: custom(ethereum) });
    const pub = createPublicClient({ chain: src.chain, transport: http() });

    current = 'switching-source'; input.onStep?.(current);
    await ensureWalletChain(ethereum, src.chain);

    const allowance = await pub.readContract({ address: src.usdc, abi: erc20Abi, functionName: 'allowance', args: [input.recipient, GATEWAY_WALLET] }) as bigint;
    if (allowance < value) {
      current = 'approving'; input.onStep?.(current);
      const approveHash = await wallet.writeContract({ address: src.usdc, abi: erc20Abi, functionName: 'approve', args: [GATEWAY_WALLET, value], chain: src.chain, account: input.recipient });
      await pub.waitForTransactionReceipt({ hash: approveHash });
    }

    current = 'depositing'; input.onStep?.(current);
    const depositHash = await wallet.writeContract({ address: GATEWAY_WALLET, abi: gatewayWalletAbi, functionName: 'deposit', args: [src.usdc, value], chain: src.chain, account: input.recipient });
    await pub.waitForTransactionReceipt({ hash: depositHash });

    addPendingMove({ source: input.source, amountUsdc: input.amountUsdc, recipient: input.recipient, depositedAt: Date.now(), depositTx: depositHash });
    return { ok: true, txHash: depositHash };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Deposit failed.', atStep: current };
  }
}

/**
 * Step 2: move available Gateway balance to Arc. Signs a BurnIntent against the source domain,
 * gets an attestation from the Gateway API, then mints on Arc. Works on any AVAILABLE unified
 * balance — completing a fresh deposit or recovering one whose transfer never finished.
 * The Gateway API rejects this if the deposit hasn't finalized yet (returns a clear message).
 */
export async function transferGatewayToArc(input: {
  source: GatewaySourceKey; amountUsdc: number; recipient: Address; onStep?: (s: MoveStep) => void;
}): Promise<StepResult<void>> {
  const src = GATEWAY_SOURCES[input.source];
  const maxFee = SOURCE_MAX_FEE[input.source];
  // The caller passes the full available Gateway balance. The Gateway API enforces
  // value + maxFee <= available AND maxFee >= the source's per-chain minimum, so we transfer
  // (available - maxFee). Otherwise moving the whole balance fails "insufficient balance" or the
  // fee is rejected as below the minimum (Ethereum/Base Sepolia require >= 1 USDC).
  const requested = parseUnits(String(input.amountUsdc), 6);
  const value = requested > maxFee ? requested - maxFee : BigInt(0);
  const recipient = input.recipient;
  let current: MoveStep = 'switching-source';
  if (value <= BigInt(0)) {
    return { ok: false, error: `Amount too small — needs to exceed the ~${formatUnits(maxFee, 6)} USDC ${src.label} Gateway fee.`, atStep: 'signing' };
  }
  try {
    const ethereum = getEthereum();

    // Switch to the source chain BEFORE signing. The Gateway burn-intent EIP-712 domain is
    // chainless (no chainId), so the signature is valid regardless of the wallet's current
    // network — but signing while the wallet sits on, say, Ethereum mainnet is alarming and
    // wrong UX. Switching first makes the wallet show the correct source testnet.
    current = 'switching-source'; input.onStep?.(current);
    await ensureWalletChain(ethereum, src.chain);

    current = 'signing'; input.onStep?.(current);
    const burnIntent = {
      maxBlockHeight: MAX_UINT64.toString(),
      maxFee: maxFee.toString(),
      spec: {
        version: 1,
        sourceDomain: src.domain,
        destinationDomain: ARC_DOMAIN,
        sourceContract: toBytes32(GATEWAY_WALLET),
        destinationContract: toBytes32(GATEWAY_MINTER),
        sourceToken: toBytes32(src.usdc),
        destinationToken: toBytes32(ARC_USDC),
        sourceDepositor: toBytes32(recipient),
        destinationRecipient: toBytes32(recipient),
        sourceSigner: toBytes32(recipient),
        destinationCaller: toBytes32(zeroAddress as Address),
        value: value.toString(),
        salt: randomSalt(),
        hookData: '0x' as Hex,
      },
    };
    // Sign on the source chain context (the signer is the depositor). Wallet need not switch to
    // sign typed data, but ensure we're on a sane chain for the signature request.
    const signWallet = createWalletClient({ account: recipient, chain: src.chain, transport: custom(ethereum) });
    const signature = await signWallet.signTypedData({ account: recipient, domain: EIP712_DOMAIN, primaryType: 'BurnIntent', types: EIP712_TYPES, message: burnIntent as never });

    current = 'attesting'; input.onStep?.(current);
    const transferRes = await fetch(`${GATEWAY_API_TESTNET}/transfer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ burnIntent, signature }]),
    });
    if (!transferRes.ok) {
      const body = await transferRes.text();
      // The most common reason here is the deposit hasn't finalized yet.
      throw new Error(`Transfer not ready: ${transferRes.status}. ${body.slice(0, 140)}`);
    }
    const { attestation, signature: apiSignature } = await transferRes.json() as { attestation: Hex; signature: Hex };

    current = 'switching-arc'; input.onStep?.(current);
    await ensureWalletChain(ethereum, arcTestnet);

    current = 'minting'; input.onStep?.(current);
    const arcWallet = createWalletClient({ account: recipient, chain: arcTestnet, transport: custom(ethereum) });
    const arcPublic = createPublicClient({ chain: arcTestnet, transport: http() });
    const mintHash = await arcWallet.writeContract({ address: GATEWAY_MINTER, abi: gatewayMinterAbi, functionName: 'gatewayMint', args: [attestation, apiSignature], chain: arcTestnet, account: recipient });
    await arcPublic.waitForTransactionReceipt({ hash: mintHash });

    current = 'done'; input.onStep?.(current);
    return { ok: true, txHash: mintHash };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Move to Arc failed.', atStep: current };
  }
}
