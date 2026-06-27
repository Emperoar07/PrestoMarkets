/**
 * Server-side agent wallet — signs Arc transactions using AGENT_PRIVATE_KEY.
 * Bypasses the browser wallet entirely so the agent acts autonomously.
 */
import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  isAddress,
  parseEventLogs,
  parseUnits,
  type Address,
  type AbiEvent,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getArcConfig } from './arcConfig';
import { createArcChain } from './arcClient';
import { erc20Abi, prestoMarketFactoryAbi, prestoMarketAbi, prestoMultiOutcomeMarketFactoryAbi, prestoLmsrMarketFactoryAbi, prestoLmsrMarketAbi } from './contracts';
import { buildMarketMetadataURI } from './marketMetadata';
import { logger } from './logger';
import type { CreateLiveMarketInput } from './liveActions';

// Request validation helpers
function validateMarketCreationRequest(input: CreateLiveMarketInput): { ok: boolean; error?: string } {
  if (!input.title || input.title.length === 0) return { ok: false, error: 'Market title is required' };
  if (input.title.length > 200) return { ok: false, error: 'Title exceeds 200 characters' };

  const outcomeOptions = (input.outcomeOptions ?? []).map((option) => option.trim()).filter(Boolean);
  const outcomes = outcomeOptions.length >= 2 ? outcomeOptions : ['YES', 'NO'];
  if (outcomes.length < 2) return { ok: false, error: 'Market must have at least 2 outcomes' };
  if (outcomes.length > 12) return { ok: false, error: 'Market cannot have more than 12 outcomes' };

  if (!input.closeDate) return { ok: false, error: 'Close date is required' };
  const closeTime = new Date(input.closeDate).getTime();
  const nowTime = Date.now();
  if (closeTime <= nowTime) return { ok: false, error: 'Close date must be in the future' };
  if (closeTime - nowTime < 3600000) return { ok: false, error: 'Market must close at least 1 hour from now' };

  // The on-chain resolver is always the agent wallet (account.address), set inside
  // agentCreateMarket below. input.resolver is only a display label (e.g. "Presto
  // Agent"), so it is intentionally NOT required to be an address — requiring that
  // here previously rejected every agent market with "Invalid resolver address".
  // The agent-vs-configured-resolver match is still enforced via agentResolverAddress.

  return { ok: true };
}

function getMarketKind(type: string) {
  if (type === 'Opinion') return 1;
  return 0;
}

function getCloseTimestamp(closeDate: string) {
  const t = Math.floor(new Date(closeDate).getTime() / 1000);
  if (!Number.isFinite(t) || t <= Math.floor(Date.now() / 1000)) {
    throw new Error('Close date must be in the future.');
  }
  return BigInt(t);
}

function getOutcomeOptions(input: CreateLiveMarketInput) {
  const options = (input.outcomeOptions ?? []).map((option) => option.trim()).filter(Boolean);
  return options.length >= 2 ? options : ['YES', 'NO'];
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fn(); } catch (e) {
      if (attempt === retries) throw e;
      await new Promise<void>((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error('unreachable');
}

function getClients() {
  // Accept both names so existing Vercel configs with PRESTO_AGENT_PRIVATE_KEY still work
  const pk = process.env.AGENT_PRIVATE_KEY ?? process.env.PRESTO_AGENT_PRIVATE_KEY;
  if (!pk) throw new Error('AGENT_PRIVATE_KEY is not set — agent wallet unavailable.');

  const config = getArcConfig();
  if (!isAddress(config.factoryAddress ?? '')) throw new Error('NEXT_PUBLIC_MARKET_FACTORY_ADDRESS not set.');

  const account = privateKeyToAccount(pk as Hex);
  const chain = createArcChain(config.rpcUrls);
  // Fallback across all configured Arc RPCs (dRPC -> QuikNode -> public). The agent's writes were
  // failing whenever the primary provider was down/throttled because it used a single endpoint;
  // viem's fallback advances to the next on error so a dead provider no longer blocks creation.
  const transport = config.rpcUrls.length > 0
    ? fallback(config.rpcUrls.map((url) => http(url)))
    : http();
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  return {
    account,
    publicClient,
    walletClient,
    factoryAddress: config.factoryAddress as Address,
    multiOutcomeFactoryAddress: isAddress(config.multiOutcomeFactoryAddress)
      ? config.multiOutcomeFactoryAddress as Address
      : undefined,
    // V3 LMSR factory (USDC). When set, the agent creates LMSR markets seeded with a subsidy
    // instead of the V1/V2 parimutuel markets.
    lmsrFactoryAddress: isAddress(config.lmsrFactoryAddress)
      ? config.lmsrFactoryAddress as Address
      : undefined,
  };
}

// USDC subsidy the agent seeds into each LMSR market. This becomes the liquidity parameter
// b = S / ln(n), so the maximum maker loss equals the seed. Override with PRESTO_AGENT_LMSR_SEED_USDC.
const AGENT_LMSR_SEED_USDC = (() => {
  const v = Number(process.env.PRESTO_AGENT_LMSR_SEED_USDC);
  const chosen = Number.isFinite(v) && v > 0 ? v : 2; // default $2 subsidy per market
  return Math.min(chosen, 3); // hard cap $3 so the agent never overspends one market's seed
})();

// Create a market onchain from the agent wallet
export async function agentCreateMarket(input: CreateLiveMarketInput & { agentResolverAddress?: string }) {
  try {
    // Validate request before writing onchain
    const validation = validateMarketCreationRequest(input);
    if (!validation.ok) {
      logger.error('agent-wallet', 'Market creation validation failed', { error: validation.error, title: input.title });
      return { ok: false, error: validation.error };
    }

    const { account, publicClient, walletClient, factoryAddress, multiOutcomeFactoryAddress, lmsrFactoryAddress } = getClients();
    if (input.agentResolverAddress && input.agentResolverAddress.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error('Configured agent resolver address must match the agent wallet that signs resolution transactions.');
    }
    const resolver = account.address;
    const outcomeOptions = getOutcomeOptions(input);
    const metadataURI = buildMarketMetadataURI({ ...input, outcomeOptions, agent: { createdByType: 'agent', ...input.agent } });

    // V3 path: when the LMSR factory is configured, create a seeded LMSR market (live pricing,
    // sellable positions) instead of the parimutuel V1/V2 market. The single factory handles both
    // binary and multi-outcome via outcomeCount, so there is no separate multi factory here.
    if (lmsrFactoryAddress) {
      // No-fee policy: never list a market that doesn't charge a protocol fee. If the factory's
      // fee is 0, skip creation entirely (turn on fees with scripts/set-fees.cjs first).
      const factoryFeeBps = await publicClient.readContract({
        address: lmsrFactoryAddress,
        abi: [{ type: 'function', name: 'protocolFeeBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16' }] }] as const,
        functionName: 'protocolFeeBps',
      }).catch(() => 0);
      if (!factoryFeeBps || Number(factoryFeeBps) === 0) {
        return { ok: false, error: 'LMSR factory protocol fee is 0; skipped creation (no-fee policy). Enable fees first.' };
      }

      const seed6 = parseUnits(String(AGENT_LMSR_SEED_USDC), 6);
      const config = getArcConfig();
      const usdc = config.usdcAddress as Address;
      // Gate on funds BEFORE creating: an LMSR market is unbuyable (buy reverts NotSeeded) until the
      // subsidy is seeded, so never create one we cannot afford to seed. Top up from the faucet if
      // low, then skip creation if still short rather than leaving a broken Open market.
      let bal = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }).catch(() => BigInt(0)) as bigint;
      if (bal < seed6) {
        await ensureAgentFunded({ force: true }).catch(() => undefined);
        bal = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }).catch(() => bal) as bigint;
      }
      if (bal < seed6) {
        return { ok: false, error: `Agent USDC ${(Number(bal) / 1e6).toFixed(2)} is below the LMSR seed of ${AGENT_LMSR_SEED_USDC}; skipped to avoid creating an unseedable market.` };
      }

      const createHash = await walletClient.writeContract({
        account,
        address: lmsrFactoryAddress,
        abi: prestoLmsrMarketFactoryAbi,
        functionName: 'createMarket',
        args: [resolver, getCloseTimestamp(input.closeDate), metadataURI, getMarketKind(input.type), outcomeOptions.length, seed6],
      });
      const receipt = await withRetry(() => publicClient.waitForTransactionReceipt({ hash: createHash }));
      const created = parseEventLogs({ abi: prestoLmsrMarketFactoryAbi, eventName: 'MarketCreated', logs: receipt.logs })[0] as { args?: { market?: unknown } } | undefined;
      const marketAddress = typeof created?.args?.market === 'string' && isAddress(created.args.market) ? created.args.market : undefined;

      // Fund the subsidy: approve, then seed(). Verify it landed; if not, CANCEL the market so we
      // never leave an Open-but-unbuyable market that reverts NotSeeded on every buy.
      if (marketAddress) {
        let seeded = false;
        try {
          const allowance = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: 'allowance', args: [account.address, marketAddress as Address] }) as bigint;
          if (allowance < seed6) {
            const approveHash = await walletClient.writeContract({ account, address: usdc, abi: erc20Abi, functionName: 'approve', args: [marketAddress as Address, seed6] });
            await withRetry(() => publicClient.waitForTransactionReceipt({ hash: approveHash }));
          }
          const seedHash = await walletClient.writeContract({ account, address: marketAddress as Address, abi: prestoLmsrMarketAbi, functionName: 'seed' });
          await withRetry(() => publicClient.waitForTransactionReceipt({ hash: seedHash }));
          seeded = await publicClient.readContract({ address: marketAddress as Address, abi: prestoLmsrMarketAbi, functionName: 'seeded' }).catch(() => false) as boolean;
        } catch (err) {
          logger.error('agent-wallet', 'LMSR seed failed after create', { marketAddress, error: err instanceof Error ? err.message : String(err) });
        }
        if (!seeded) {
          logger.error('agent-wallet', 'LMSR seed did not land — canceling the unseeded market to avoid unbuyable reverts', { marketAddress });
          await agentCancelMarket(marketAddress).catch(() => undefined);
          return { ok: false, error: 'LMSR market created but could not be seeded; canceled to avoid an unbuyable market.', marketAddress };
        }
      }
      return { ok: true, txHash: createHash, marketAddress, resolverAddress: resolver };
    }

    const useMultiOutcome = outcomeOptions.length > 2;
    const selectedFactory = useMultiOutcome ? multiOutcomeFactoryAddress : factoryAddress;

    if (!selectedFactory) {
      throw new Error('NEXT_PUBLIC_MULTI_OUTCOME_MARKET_FACTORY_ADDRESS not set for poll market creation.');
    }

    const hash = await walletClient.writeContract({
      account,
      address: selectedFactory,
      abi: useMultiOutcome ? prestoMultiOutcomeMarketFactoryAbi : prestoMarketFactoryAbi,
      functionName: 'createMarket',
      args: useMultiOutcome ? [
        resolver,
        getCloseTimestamp(input.closeDate),
        metadataURI,
        getMarketKind(input.type),
        outcomeOptions.length,
      ] : [
        resolver,
        getCloseTimestamp(input.closeDate),
        metadataURI,
        getMarketKind(input.type),
      ],
    });

    const receipt = await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    const created = parseEventLogs({
      abi: useMultiOutcome ? prestoMultiOutcomeMarketFactoryAbi : prestoMarketFactoryAbi,
      eventName: 'MarketCreated',
      logs: receipt.logs,
    })[0] as { args?: { market?: unknown } } | undefined;
    const marketAddress = typeof created?.args?.market === 'string' && isAddress(created.args.market)
      ? created.args.market
      : undefined;

    // Seed balanced initial liquidity so EVERY outcome has shares. Without this, a market the
    // resolver settles to an un-backed outcome must cancel (the contract reverts NoWinningShares),
    // which is why agent markets were canceling instead of paying out. Non-fatal: a failed seed
    // never blocks market creation.
    if (marketAddress) {
      await seedMarketLiquidity(marketAddress, outcomeOptions.length).catch((err) =>
        logger.warn('agent-wallet', 'Initial liquidity seed failed (non-fatal)', {
          marketAddress,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    return { ok: true, txHash: hash, marketAddress, resolverAddress: resolver };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Agent market creation failed.' };
  }
}

// Resolve a market onchain from the agent wallet
export async function agentResolveMarket(marketAddress: string, outcomeIndex: number, resolutionURI: string) {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    const { account, publicClient, walletClient } = getClients();

    const hash = await walletClient.writeContract({
      account,
      address: marketAddress as Address,
      abi: prestoMarketAbi,
      functionName: 'resolve',
      args: [outcomeIndex, resolutionURI],
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true, txHash: hash };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Agent resolution failed.' };
  }
}

// Optimistic resolution (V2 markets): publish a proposed outcome that anyone may dispute for
// 2 hours before it can settle. V1 markets lack the function and revert — callers fall back
// to the direct resolve() path.
export async function agentProposeResolution(marketAddress: string, outcomeIndex: number, resolutionURI: string) {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    const { account, publicClient, walletClient } = getClients();

    const hash = await walletClient.writeContract({
      account,
      address: marketAddress as Address,
      abi: prestoMarketAbi,
      functionName: 'proposeResolution',
      args: [outcomeIndex, resolutionURI],
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true as const, txHash: hash };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Agent proposal failed.' };
  }
}

// Settles an unchallenged proposal after its dispute window. Permissionless on-chain; the agent
// calls it on the tick after it proposed.
export async function agentSettleProposedResolution(marketAddress: string) {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    const { account, publicClient, walletClient } = getClients();

    const hash = await walletClient.writeContract({
      account,
      address: marketAddress as Address,
      abi: prestoMarketAbi,
      functionName: 'settleProposedResolution',
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true as const, txHash: hash };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Proposal settlement failed.' };
  }
}

// ---- V3 LMSR resolution + payout ----

// Propose the winning outcome on a V3 market (resolver only). Posts the market's bond if one is
// configured (approve first). Starts the 30-minute challenge window.
export async function agentProposeV3(marketAddress: string, outcomeIndex: number, evidenceURI: string) {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    const { account, publicClient, walletClient } = getClients();
    const config = getArcConfig();
    const market = marketAddress as Address;

    // If the market requires a proposer bond, approve it from the agent wallet first.
    const bond6 = await publicClient.readContract({ address: market, abi: prestoLmsrMarketAbi, functionName: 'bond6' }).catch(() => BigInt(0)) as bigint;
    if (bond6 > BigInt(0) && config.usdcAddress && isAddress(config.usdcAddress)) {
      const usdc = config.usdcAddress as Address;
      const allowance = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: 'allowance', args: [account.address, market] }) as bigint;
      if (allowance < bond6) {
        const approveHash = await walletClient.writeContract({ account, address: usdc, abi: erc20Abi, functionName: 'approve', args: [market, bond6] });
        await withRetry(() => publicClient.waitForTransactionReceipt({ hash: approveHash }));
      }
    }

    const hash = await walletClient.writeContract({
      account, address: market, abi: prestoLmsrMarketAbi, functionName: 'propose', args: [outcomeIndex, evidenceURI],
    });
    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true as const, txHash: hash };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'V3 proposal failed.' };
  }
}

// Settle an unchallenged V3 proposal once its challenge window closes (permissionless).
export async function agentSettleV3(marketAddress: string) {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    const { account, publicClient, walletClient } = getClients();
    const hash = await walletClient.writeContract({
      account, address: marketAddress as Address, abi: prestoLmsrMarketAbi, functionName: 'settle',
    });
    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true as const, txHash: hash };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'V3 settle failed.' };
  }
}

// Accrued (un-withdrawn) protocol fees on a V3 market, in USDC 6-decimals. null on a read failure.
export async function agentReadLmsrAccruedFees(marketAddress: string): Promise<bigint | null> {
  try {
    if (!isAddress(marketAddress)) return null;
    const { publicClient } = getClients();
    return await publicClient.readContract({
      address: marketAddress as Address, abi: prestoLmsrMarketAbi, functionName: 'accruedFees6',
    }) as bigint;
  } catch {
    return null;
  }
}

// Sweep a V3 market's accrued fees to its protocolFeeRecipient (the treasury, set at creation).
// withdrawFees() is permissionless and always pays the recipient, so the caller only triggers it.
export async function agentWithdrawLmsrFees(marketAddress: string) {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    const { account, publicClient, walletClient } = getClients();
    const hash = await walletClient.writeContract({
      account, address: marketAddress as Address, abi: prestoLmsrMarketAbi, functionName: 'withdrawFees',
    });
    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true as const, txHash: hash };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'withdrawFees failed.' };
  }
}

// Adjudicate a disputed V3 proposal (resolver decides the final outcome).
export async function agentResolveDisputedV3(marketAddress: string, finalOutcome: number, evidenceURI: string) {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    const { account, publicClient, walletClient } = getClients();
    const hash = await walletClient.writeContract({
      account, address: marketAddress as Address, abi: prestoLmsrMarketAbi, functionName: 'resolveDisputed', args: [finalOutcome, evidenceURI],
    });
    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true as const, txHash: hash };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'V3 dispute resolution failed.' };
  }
}

// Every address that ever bought shares in a V3 market (from SharesBought logs). payWinners is
// idempotent and skips non-winners, so passing the full buyer set is safe.
export async function agentReadLmsrBuyers(marketAddress: string): Promise<string[]> {
  try {
    if (!isAddress(marketAddress)) return [];
    const { publicClient } = getClients();
    const event = prestoLmsrMarketAbi.find((x) => x.type === 'event' && x.name === 'SharesBought');
    if (!event) return [];
    const logs = await publicClient.getLogs({
      address: marketAddress as Address,
      event: event as AbiEvent,
      fromBlock: 'earliest',
      toBlock: 'latest',
    });
    const buyers = new Set<string>();
    for (const log of logs) {
      const buyer = (log as { args?: { buyer?: unknown } }).args?.buyer;
      if (typeof buyer === 'string' && isAddress(buyer)) buyers.add(buyer.toLowerCase());
    }
    return Array.from(buyers);
  } catch (error) {
    logger.warn('agent-wallet', 'Failed to read LMSR buyers', { marketAddress, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

// Push winner payouts on a settled V3 market in chunks. Idempotent and permissionless.
export async function agentPayWinners(marketAddress: string, winners: string[]) {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    const valid = winners.filter((w) => isAddress(w)) as Address[];
    if (valid.length === 0) return { ok: true as const, paid: 0 };
    const { account, publicClient, walletClient } = getClients();
    const CHUNK = 50;
    let last: Hex | undefined;
    for (let i = 0; i < valid.length; i += CHUNK) {
      const batch = valid.slice(i, i + CHUNK);
      const hash = await walletClient.writeContract({
        account, address: marketAddress as Address, abi: prestoLmsrMarketAbi, functionName: 'payWinners', args: [batch],
      });
      await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
      last = hash;
    }
    return { ok: true as const, paid: valid.length, txHash: last };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'payWinners failed.' };
  }
}

export async function agentCancelMarket(marketAddress: string) {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    const { account, publicClient, walletClient } = getClients();

    const hash = await walletClient.writeContract({
      account,
      address: marketAddress as Address,
      abi: prestoMarketAbi,
      functionName: 'cancel',
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true, txHash: hash };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Agent cancellation failed.' };
  }
}

// Submit a payout or refund for positions owned by the autonomous agent wallet.
export async function agentSettlePosition(marketAddress: string, action: 'claim' | 'refund') {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    const { account, publicClient, walletClient } = getClients();

    const hash = await walletClient.writeContract({
      account,
      address: marketAddress as Address,
      abi: prestoMarketAbi,
      functionName: action,
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true, txHash: hash };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : `Agent ${action} failed.` };
  }
}

// Total USDC the agent seeds across all outcomes when it creates a market. Split evenly per
// outcome. In a parimutuel market, seeding all sides costs ~fees on net (the agent gets the
// winning-side pool back), but guarantees the winning outcome has shares so the market can settle.
// Override with AGENT_SEED_USDC; set AGENT_SEED_LIQUIDITY=false to disable.
// Total USDC seeded per market (split across outcomes), hard-capped at 1 USDC. Enough to put a
// non-zero share on every outcome so the market can always settle.
const AGENT_SEED_TOTAL_USDC = (() => {
  const v = Number(process.env.AGENT_SEED_USDC);
  const chosen = Number.isFinite(v) && v >= 0 ? v : 1;
  return Math.min(chosen, 1);
})();

// If the agent's USDC drops below this, request a Circle faucet top-up before seeding so the
// autonomous agent never runs dry. Best-effort + cooldown-throttled.
const AGENT_MIN_USDC_BALANCE = 1;
const FAUCET_COOLDOWN_MS = 10 * 60 * 1000;
let lastFaucetDripAt = 0;

export async function ensureAgentFunded(opts: { force?: boolean } = {}): Promise<{ ok: boolean; balance?: number; dripped?: boolean; faucetStatus?: number; faucetError?: string; blockchain?: string; error?: string }> {
  try {
    const { account, publicClient } = getClients();
    const config = getArcConfig();
    if (!config.usdcAddress || !isAddress(config.usdcAddress)) return { ok: false, error: 'USDC not configured' };
    const raw = await publicClient.readContract({
      address: config.usdcAddress as Address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }) as bigint;
    const balance = Number(raw) / 1e6;
    if (!opts.force && balance >= AGENT_MIN_USDC_BALANCE) return { ok: true, balance, dripped: false };

    // Low balance — request a Circle faucet drip (throttled so we never spam the faucet).
    if (!opts.force && Date.now() - lastFaucetDripAt < FAUCET_COOLDOWN_MS) return { ok: true, balance, dripped: false };
    const apiKey = process.env.CIRCLE_API_KEY;
    const blockchain = process.env.CIRCLE_WALLET_BLOCKCHAIN;
    const base = process.env.CIRCLE_BASE_URL || 'https://api.circle.com';
    if (!apiKey) return { ok: false, balance, dripped: false, error: 'CIRCLE_API_KEY not set' };
    if (!blockchain) return { ok: false, balance, dripped: false, error: 'CIRCLE_WALLET_BLOCKCHAIN not set' };
    lastFaucetDripAt = Date.now();
    const res = await fetch(`${base.replace(/\/$/, '')}/v1/faucet/drips`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: account.address, blockchain, usdc: true, native: true }),
    });
    const bodyText = await res.text().catch(() => '');
    const dripped = res.ok || res.status === 201;
    logger.info('agent-wallet', 'Faucet top-up requested (agent low on USDC)', { balance, blockchain, status: res.status, dripped });
    return { ok: true, balance, dripped, faucetStatus: res.status, blockchain, faucetError: dripped ? undefined : bodyText.slice(0, 300) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'fund check failed' };
  }
}

// Random, unequal seed amounts per outcome so opening odds look organic (not a flat 50/50 or
// 33/33/33). Each outcome still gets a non-zero floor so every side is backed and the market is
// always resolvable. The per-market total is also randomized within the cap.
function randomSeedAmounts(count: number): string[] {
  const cap = AGENT_SEED_TOTAL_USDC;
  if (!(cap > 0) || count < 2) return [];
  const total = cap * (0.4 + Math.random() * 0.6); // 40%–100% of the cap, varies per market
  const floor = Math.min(0.02, total / count); // guarantees a non-zero share on every outcome
  const remaining = Math.max(0, total - floor * count);
  const weights = Array.from({ length: count }, () => Math.random());
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => Math.max(0.000001, floor + (w / wsum) * remaining).toFixed(6));
}

async function seedMarketLiquidity(marketAddress: string, outcomeCount: number): Promise<void> {
  if (process.env.AGENT_SEED_LIQUIDITY === 'false') return;
  if (!Number.isInteger(outcomeCount) || outcomeCount < 2) return;
  // Top up from the faucet first if the agent is running low.
  await ensureAgentFunded().catch(() => undefined);
  const amounts = randomSeedAmounts(outcomeCount);
  if (amounts.length === 0) return;
  for (let i = 0; i < outcomeCount; i++) {
    const result = await agentBuyShares(marketAddress, i, amounts[i]);
    if (!result.ok) {
      logger.warn('agent-wallet', 'Seed buy failed for outcome (continuing)', {
        marketAddress, outcome: i, amount: amounts[i], error: result.error,
      });
    }
  }
}

// Buy outcome shares onchain from the agent wallet (approve USDC → call buy)
// Used by the liquidity bot to properly mint shares, not just transfer USDC
export async function agentBuyShares(
  marketAddress: string,
  outcomeIndex: number,
  amountUsdc: string,
) {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0 || outcomeIndex > 11) {
      throw new Error('Outcome index must be between 0 and 11.');
    }
    const amountNum = Number(amountUsdc);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new Error('Buy amount must be a positive USDC number.');
    }
    const { account, publicClient, walletClient } = getClients();
    const config = getArcConfig();
    if (!config.usdcAddress || !isAddress(config.usdcAddress)) throw new Error('USDC address not configured.');

    const amount = parseUnits(amountUsdc, 6);
    const usdcAddress = config.usdcAddress as Address;
    const market = marketAddress as Address;

    // Check current allowance — only approve if needed
    const allowance = await publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account.address, market],
    }) as bigint;

    if (allowance < amount) {
      const approveHash = await walletClient.writeContract({
        account,
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [market, amount],
      });
      await withRetry(() => publicClient.waitForTransactionReceipt({ hash: approveHash }));
    }

    const hash = await walletClient.writeContract({
      account,
      address: market,
      abi: prestoMarketAbi,
      functionName: 'buy',
      args: [outcomeIndex, amount],
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true, txHash: hash };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Liquidity buy failed.' };
  }
}

// Hard ceiling on any single agent-initiated USDC transfer. The autonomous
// agent moves funds without human review (e.g. paying x402 challenges), so an
// upper bound caps the blast radius if an upstream is compromised or misbehaves.
// Override with PRESTO_AGENT_MAX_TRANSFER_USDC; defaults to 5 USDC.
function getMaxTransferUsdc(): number {
  const parsed = Number(process.env.PRESTO_AGENT_MAX_TRANSFER_USDC);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

export async function agentTransferUsdc(toAddress: string, amountUsdc: string) {
  try {
    if (!isAddress(toAddress)) throw new Error('Invalid destination address.');

    // Validate the amount is a sane, positive, bounded number before it ever
    // reaches parseUnits or the chain. Rejects NaN, <=0, and over-cap requests.
    const amountNum = Number(amountUsdc);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new Error('Transfer amount must be a positive number.');
    }
    const maxTransfer = getMaxTransferUsdc();
    if (amountNum > maxTransfer) {
      throw new Error(`Transfer amount ${amountNum} USDC exceeds the agent per-transfer cap of ${maxTransfer} USDC.`);
    }

    const { account, publicClient, walletClient } = getClients();
    const config = getArcConfig();
    if (!config.usdcAddress || !isAddress(config.usdcAddress)) throw new Error('USDC address not configured.');

    const amount = parseUnits(amountUsdc, 6);
    const usdcAddress = config.usdcAddress as Address;

    const hash = await walletClient.writeContract({
      account,
      address: usdcAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [toAddress as Address, amount],
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true, txHash: hash };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'USDC transfer failed.' };
  }
}

// Read the onchain total shares staked on a given outcome index for a market.
// Used by auto-resolve to detect outcomes with no winning shares (which the
// contract refuses to resolve) so it can cancel-and-refund instead of locking funds.
// Read whether a V3 LMSR market has been seeded (buys revert NotSeeded until it is).
export async function agentReadLmsrSeeded(marketAddress: string): Promise<boolean | null> {
  try {
    if (!isAddress(marketAddress)) return null;
    const { publicClient } = getClients();
    return await publicClient.readContract({ address: marketAddress as Address, abi: prestoLmsrMarketAbi, functionName: 'seeded' }) as boolean;
  } catch {
    return null;
  }
}

// Seed an existing unseeded V3 LMSR market (approve + seed). Used by the repair cron to fix markets
// whose seed didn't land at creation. Returns ok:false (e.g. insufficient USDC) so the caller can
// cancel an unbuyable market instead.
export async function agentSeedLmsrMarket(marketAddress: string) {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    const { account, publicClient, walletClient } = getClients();
    const config = getArcConfig();
    const usdc = config.usdcAddress as Address;
    const seed6 = parseUnits(String(AGENT_LMSR_SEED_USDC), 6);
    const bal = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }) as bigint;
    if (bal < seed6) return { ok: false as const, error: `insufficient USDC (${(Number(bal) / 1e6).toFixed(2)}) for seed ${AGENT_LMSR_SEED_USDC}` };
    const allowance = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: 'allowance', args: [account.address, marketAddress as Address] }) as bigint;
    if (allowance < seed6) {
      const approveHash = await walletClient.writeContract({ account, address: usdc, abi: erc20Abi, functionName: 'approve', args: [marketAddress as Address, seed6] });
      await withRetry(() => publicClient.waitForTransactionReceipt({ hash: approveHash }));
    }
    const seedHash = await walletClient.writeContract({ account, address: marketAddress as Address, abi: prestoLmsrMarketAbi, functionName: 'seed' });
    await withRetry(() => publicClient.waitForTransactionReceipt({ hash: seedHash }));
    return { ok: true as const, txHash: seedHash };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'seed failed' };
  }
}

export async function agentReadTotalShares(marketAddress: string, outcomeIndex: number): Promise<bigint | null> {
  try {
    if (!isAddress(marketAddress)) return null;
    if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0 || outcomeIndex > 11) return null;
    const { publicClient } = getClients();
    const shares = await publicClient.readContract({
      address: marketAddress as Address,
      abi: prestoMarketAbi,
      functionName: 'totalShares',
      args: [outcomeIndex],
    });
    return typeof shares === 'bigint' ? shares : BigInt(shares as number | string);
  } catch (error) {
    logger.warn('agent-wallet', 'Failed to read total shares', {
      marketAddress,
      outcomeIndex,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function getAgentAddress(): string | null {
  const pk = process.env.AGENT_PRIVATE_KEY ?? process.env.PRESTO_AGENT_PRIVATE_KEY;
  if (!pk) return null;
  try {
    return privateKeyToAccount(pk as Hex).address;
  } catch {
    return null;
  }
}
