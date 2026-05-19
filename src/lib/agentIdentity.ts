/**
 * ERC-8004 agent identity, reputation, and validation on Arc Testnet.
 *
 * Registration: agent wallet calls register() on IdentityRegistry → gets an NFT token ID
 * Reputation:   a separate VALIDATOR_PRIVATE_KEY wallet calls giveFeedback() after each resolution
 *               (ERC-8004 forbids self-attestation — owner cannot score their own agent)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  parseAbiItem,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getArcConfig, getArcChainId } from './arcConfig';

// ── Arc ERC-8004 contract addresses ──────────────────────────────────────────

export const ERC8004_CONTRACTS = {
  IdentityRegistry:   '0x8004A818BFB912233c491871b3d84c89A494BD9e' as Address,
  ReputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713' as Address,
  ValidationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272' as Address,
};

// ── Minimal ABIs ──────────────────────────────────────────────────────────────

const identityAbi = [
  { name: 'register',  type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'metadataURI', type: 'string' }], outputs: [] },
  { name: 'ownerOf',   type: 'function', stateMutability: 'view',       inputs: [{ name: 'tokenId', type: 'uint256' }],   outputs: [{ name: '', type: 'address' }] },
  { name: 'tokenURI',  type: 'function', stateMutability: 'view',       inputs: [{ name: 'tokenId', type: 'uint256' }],   outputs: [{ name: '', type: 'string' }] },
] as const;

const reputationAbi = [
  {
    name: 'giveFeedback',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId',      type: 'uint256' },
      { name: 'score',        type: 'int128'  },
      { name: 'feedbackType', type: 'uint8'   },
      { name: 'tag',          type: 'string'  },
      { name: 'metadataURI',  type: 'string'  },
      { name: 'evidenceURI',  type: 'string'  },
      { name: 'comment',      type: 'string'  },
      { name: 'feedbackHash', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getChain() {
  const config = getArcConfig();
  return {
    id: getArcChainId(),
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
    rpcUrls: { default: { http: [config.rpcUrl || 'https://rpc.testnet.arc.network'] as [string] } },
  };
}

function getAgentClients() {
  const pk = process.env.AGENT_PRIVATE_KEY;
  if (!pk) throw new Error('AGENT_PRIVATE_KEY not set');
  const config = getArcConfig();
  if (!config.rpcUrl) throw new Error('ARC_RPC_URL not set');
  const chain = getChain();
  const account = privateKeyToAccount(pk as Hex);
  const transport = http(config.rpcUrl);
  return {
    account,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account, chain, transport }),
  };
}

function getValidatorClients() {
  const pk = process.env.VALIDATOR_PRIVATE_KEY;
  if (!pk) throw new Error('VALIDATOR_PRIVATE_KEY not set (required for ERC-8004 reputation — agent cannot self-attest)');
  const config = getArcConfig();
  if (!config.rpcUrl) throw new Error('ARC_RPC_URL not set');
  const chain = getChain();
  const account = privateKeyToAccount(pk as Hex);
  const transport = http(config.rpcUrl);
  return {
    account,
    walletClient: createWalletClient({ account, chain, transport }),
  };
}

function buildAgentMetadataURI() {
  const metadata = {
    name: 'Presto Market Agent',
    description: 'Autonomous prediction market creator and resolver on Arc Testnet. Powered by Groq, Gemini Flash, and Claude.',
    agent_type: 'market_resolution',
    capabilities: ['market_creation', 'trend_detection', 'market_resolution', 'oracle_research'],
    model_stack: 'groq-llama3 + gemini-flash + claude-haiku + claude-sonnet',
    platform: 'Presto Markets',
    version: '1.0.0',
  };
  return `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export type AgentIdentityStatus = {
  agentAddress: string;
  registered: boolean;
  agentId: string | null;
  metadataURI: string | null;
};

/**
 * Returns the agent's current ERC-8004 identity status.
 * Reads from AGENT_ERC8004_ID env var (set after first registration) or queries chain.
 */
export async function getAgentIdentityStatus(): Promise<AgentIdentityStatus> {
  const { account, publicClient } = getAgentClients();

  const storedId = process.env.AGENT_ERC8004_ID;
  if (storedId) {
    try {
      const agentId = BigInt(storedId);
      const [owner, metadataURI] = await Promise.all([
        publicClient.readContract({ address: ERC8004_CONTRACTS.IdentityRegistry, abi: identityAbi, functionName: 'ownerOf',  args: [agentId] }),
        publicClient.readContract({ address: ERC8004_CONTRACTS.IdentityRegistry, abi: identityAbi, functionName: 'tokenURI', args: [agentId] }),
      ]);
      if (owner.toLowerCase() === account.address.toLowerCase()) {
        return { agentAddress: account.address, registered: true, agentId: storedId, metadataURI: metadataURI as string };
      }
    } catch {
      // Fall through to chain scan
    }
  }

  // Scan chain for a Transfer event to the agent address
  try {
    const latestBlock = await publicClient.getBlockNumber();
    const fromBlock = latestBlock > BigInt(10000) ? latestBlock - BigInt(10000) : BigInt(0);
    const logs = await publicClient.getLogs({
      address: ERC8004_CONTRACTS.IdentityRegistry,
      event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
      args: { to: account.address },
      fromBlock,
      toBlock: latestBlock,
    });

    if (logs.length > 0) {
      const agentId = logs[logs.length - 1].args.tokenId!;
      const metadataURI = await publicClient.readContract({
        address: ERC8004_CONTRACTS.IdentityRegistry,
        abi: identityAbi,
        functionName: 'tokenURI',
        args: [agentId],
      });
      return { agentAddress: account.address, registered: true, agentId: agentId.toString(), metadataURI: metadataURI as string };
    }
  } catch {
    // RPC may not support getLogs — not registered
  }

  return { agentAddress: account.address, registered: false, agentId: null, metadataURI: null };
}

/**
 * Registers the agent wallet on ERC-8004 IdentityRegistry.
 * Safe to call repeatedly — checks if already registered first.
 */
export async function registerAgentIdentity(): Promise<
  { ok: true; txHash: string; agentId: string } | { ok: false; error: string }
> {
  try {
    const { account, publicClient, walletClient } = getAgentClients();

    // Check if already registered
    const status = await getAgentIdentityStatus();
    if (status.registered && status.agentId) {
      return { ok: true, txHash: '0x0', agentId: status.agentId };
    }

    const hash = await walletClient.writeContract({
      account,
      address: ERC8004_CONTRACTS.IdentityRegistry,
      abi: identityAbi,
      functionName: 'register',
      args: [buildAgentMetadataURI()],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    // Read the minted token ID from the Transfer event in the receipt
    const transferLog = receipt.logs.find((log) =>
      log.address.toLowerCase() === ERC8004_CONTRACTS.IdentityRegistry.toLowerCase(),
    );

    // Parse token ID from the 3rd topic (indexed tokenId)
    const agentId = transferLog?.topics[3] ? BigInt(transferLog.topics[3]).toString() : 'unknown';

    return { ok: true, txHash: hash, agentId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Records a reputation score for the agent after a resolution.
 * Must be called with VALIDATOR_PRIVATE_KEY (not the agent's own key).
 *
 * score: 0–100 (95 = excellent resolution, 60 = marginal, 20 = poor)
 * tag:   e.g. 'successful_resolution', 'cancelled_low_confidence'
 */
export async function recordResolutionReputation(
  agentId: bigint,
  score: number,
  tag: string,
  evidenceURI = '',
): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  try {
    const { account: validator, walletClient } = getValidatorClients();
    const { publicClient } = getAgentClients();

    const feedbackHash = keccak256(toHex(`${tag}_${agentId}_${Date.now()}`));

    const hash = await walletClient.writeContract({
      account: validator,
      address: ERC8004_CONTRACTS.ReputationRegistry,
      abi: reputationAbi,
      functionName: 'giveFeedback',
      args: [agentId, BigInt(Math.round(score)), 0, tag, '', evidenceURI, '', feedbackHash],
    });

    await publicClient.waitForTransactionReceipt({ hash });
    return { ok: true, txHash: hash };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
