/**
 * UBK Phase 2 — move USDC from another chain into Arc via Circle Gateway.
 *
 * Flow (EOA / external wallet, per Circle's Gateway reference):
 *   1. deposit on the source chain:  USDC.approve(GatewayWallet) -> GatewayWallet.deposit()
 *   2. wait for source-chain finality (unified balance updates)
 *   3. sign an EIP-712 BurnIntent, POST it to the Gateway API for an attestation
 *   4. on Arc, GatewayMinter.gatewayMint(attestation, signature) credits Arc USDC
 *
 * Every step is explicit and surfaced to the UI via the onStep callback — no invisible magic
 * while money is moving (docs/UBK_SPIKE.md). USDC is 6 decimals everywhere here.
 *
 * NOTE: a plain ERC-20 transfer to the GatewayWallet permanently burns funds — we only ever call
 * deposit(). The GatewayWallet address is never surfaced as a "send here" target in the UI.
 */

import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  http,
  pad,
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
// Max fee the burn intent will pay the Gateway (2.01 USDC), matching Circle's reference.
const MAX_FEE = BigInt('2010000');
const MAX_UINT64 = BigInt('18446744073709551615');

export type GatewaySourceKey = 'baseSepolia' | 'sepolia' | 'avalancheFuji' | 'arbitrumSepolia';

type SourceChain = {
  key: GatewaySourceKey;
  label: string;
  domain: number;
  chain: Chain;
  usdc: Address;
};

export const GATEWAY_SOURCES: Record<GatewaySourceKey, SourceChain> = {
  baseSepolia: { key: 'baseSepolia', label: 'Base Sepolia', domain: 6, chain: baseSepolia, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
  sepolia: { key: 'sepolia', label: 'Ethereum Sepolia', domain: 0, chain: sepolia, usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
  avalancheFuji: { key: 'avalancheFuji', label: 'Avalanche Fuji', domain: 1, chain: avalancheFuji, usdc: '0x5425890298aed601595a70AB815c96711a31Bc65' },
  arbitrumSepolia: { key: 'arbitrumSepolia', label: 'Arbitrum Sepolia', domain: 3, chain: arbitrumSepolia, usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' },
};

export type MoveStep =
  | 'switching-source' | 'approving' | 'depositing' | 'awaiting-finality'
  | 'signing' | 'attesting' | 'switching-arc' | 'minting' | 'done';

export type MoveResult = { ok: true; txHash: Hex } | { ok: false; error: string; atStep: MoveStep };

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

function toBytes32(address: Address): Hex {
  return pad(address.toLowerCase() as Hex, { size: 32 });
}

function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

/** Unified USDC balance held in Gateway across the given source domains. */
export async function getGatewayUnifiedBalance(address: Address): Promise<number> {
  const sources = Object.values(GATEWAY_SOURCES).map((s) => ({ domain: s.domain, depositor: address }));
  const res = await fetch(`${GATEWAY_API_TESTNET}/balances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'USDC', sources }),
  });
  if (!res.ok) return 0;
  const data = await res.json() as { balances?: Array<{ balance: string }> };
  return (data.balances ?? []).reduce((sum, b) => sum + (Number(b.balance) || 0), 0);
}

type Ethereum = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

function getEthereum(): Ethereum {
  const ethereum = (globalThis as { ethereum?: Ethereum }).ethereum;
  if (!ethereum) throw new Error('No external wallet found. Connect an external wallet to move USDC.');
  return ethereum;
}

// Switch the wallet to `chain`; if the wallet doesn't know it yet (EIP-1193 error 4902), add it
// first then switch. This lets users move from chains their wallet hasn't been configured for.
async function ensureWalletChain(ethereum: Ethereum, chain: Chain): Promise<void> {
  const chainIdHex = `0x${chain.id.toString(16)}`;
  try {
    await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code !== 4902) throw error;
    await ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: chainIdHex,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: chain.rpcUrls.default.http,
        blockExplorerUrls: chain.blockExplorers?.default?.url ? [chain.blockExplorers.default.url] : undefined,
      }],
    });
    await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
  }
}

/**
 * Move `amountUsdc` of USDC from a source chain into Arc. Drives the full deposit → attest → mint
 * flow, reporting each step through onStep. EOA / external wallet only (the wallet must be able to
 * switch chains). Returns the Arc mint tx hash on success.
 */
export async function moveUsdcToArc(input: {
  source: GatewaySourceKey;
  amountUsdc: number;
  recipient: Address;
  onStep?: (step: MoveStep) => void;
}): Promise<MoveResult> {
  const src = GATEWAY_SOURCES[input.source];
  const ethereum = getEthereum();
  const value = parseUnits(String(input.amountUsdc), 6);
  const recipient = input.recipient;
  const step = (s: MoveStep) => input.onStep?.(s);
  let current: MoveStep = 'switching-source';

  try {
    const wallet = createWalletClient({ account: recipient, chain: src.chain, transport: custom(ethereum) });
    const sourcePublic = createPublicClient({ chain: src.chain, transport: http() });

    // 1. ensure the wallet is on the source chain (adds it to the wallet if unknown)
    current = 'switching-source'; step(current);
    await ensureWalletChain(ethereum, src.chain);

    // 2. approve (skip if allowance already covers it)
    const allowance = await sourcePublic.readContract({ address: src.usdc, abi: erc20Abi, functionName: 'allowance', args: [recipient, GATEWAY_WALLET] }) as bigint;
    if (allowance < value) {
      current = 'approving'; step(current);
      const approveHash = await wallet.writeContract({ address: src.usdc, abi: erc20Abi, functionName: 'approve', args: [GATEWAY_WALLET, value], chain: src.chain, account: recipient });
      await sourcePublic.waitForTransactionReceipt({ hash: approveHash });
    }

    // 3. deposit into the Gateway wallet on the source chain
    current = 'depositing'; step(current);
    const depositHash = await wallet.writeContract({ address: GATEWAY_WALLET, abi: gatewayWalletAbi, functionName: 'deposit', args: [src.usdc, value], chain: src.chain, account: recipient });
    await sourcePublic.waitForTransactionReceipt({ hash: depositHash });

    // 4. wait for the deposit to count toward the unified balance (source-chain finality)
    current = 'awaiting-finality'; step(current);
    await waitForUnifiedBalance(recipient, input.amountUsdc);

    // 5. sign the burn intent
    current = 'signing'; step(current);
    const burnIntent = {
      maxBlockHeight: MAX_UINT64.toString(),
      maxFee: MAX_FEE.toString(),
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
    const signature = await wallet.signTypedData({
      account: recipient,
      domain: EIP712_DOMAIN,
      primaryType: 'BurnIntent',
      types: EIP712_TYPES,
      message: burnIntent as never,
    });

    // 6. submit to the Gateway API for an attestation
    current = 'attesting'; step(current);
    const transferRes = await fetch(`${GATEWAY_API_TESTNET}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ burnIntent, signature }]),
    });
    if (!transferRes.ok) {
      const body = await transferRes.text();
      throw new Error(`Gateway attestation failed: ${transferRes.status} ${body.slice(0, 160)}`);
    }
    const { attestation, signature: apiSignature } = await transferRes.json() as { attestation: Hex; signature: Hex };

    // 7. switch to Arc and mint (adds Arc to the wallet if unknown)
    current = 'switching-arc'; step(current);
    await ensureWalletChain(ethereum, arcTestnet);

    current = 'minting'; step(current);
    const arcWallet = createWalletClient({ account: recipient, chain: arcTestnet, transport: custom(ethereum) });
    const arcPublic = createPublicClient({ chain: arcTestnet, transport: http() });
    const mintHash = await arcWallet.writeContract({ address: GATEWAY_MINTER, abi: gatewayMinterAbi, functionName: 'gatewayMint', args: [attestation, apiSignature], chain: arcTestnet, account: recipient });
    await arcPublic.waitForTransactionReceipt({ hash: mintHash });

    current = 'done'; step(current);
    return { ok: true, txHash: mintHash };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Move to Arc failed.', atStep: current };
  }
}

// Poll the unified balance until the just-made deposit is reflected (source-chain finality),
// capped so a slow chain can't hang the flow forever.
async function waitForUnifiedBalance(address: Address, expectedAtLeast: number, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const balance = await getGatewayUnifiedBalance(address).catch(() => 0);
    if (balance >= expectedAtLeast) return;
    await new Promise((resolve) => { setTimeout(resolve, 6_000); });
  }
  // Don't hard-fail: finality may simply be slow. The attestation step will reject if the
  // balance truly isn't there, surfacing a precise error.
}
