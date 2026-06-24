import { decodeFunctionData, isAddress, toFunctionSelector, type Address } from 'viem';
import { createArcReadClient } from './arcClient';
import { getArcConfig } from './arcConfig';
import { fetchOnchainMarkets } from './onchainMarkets';
import { erc20Abi, prestoLmsrMarketFactoryAbi, prestoMarketFactoryAbi, prestoMultiOutcomeMarketFactoryAbi } from './contracts';

export type CircleContractExecutionPolicyInput = {
  contractAddress?: string;
  abiFunctionSignature?: string;
  abiParameters?: unknown[];
};

const allowedMarketSignatures = new Set([
  'buy(uint8,uint256)',
  'resolve(uint8,string)',
  'disputeResolution(string)',
  'cancel()',
  'claim()',
  'refund()',
  // V3 LMSR markets: share-denominated buy/sell + bonded optimistic resolution.
  'buy(uint8,uint256,uint256)',
  'sell(uint8,uint256,uint256)',
  'propose(uint8,string)',
  'dispute(string)',
  'settle()',
  'resolveDisputed(uint8,string)',
  'payWinners(address[])',
  'timeoutCancel()',
]);

const DEFAULT_MAX_USDC_TRANSFER_BASE_UNITS = BigInt(5_000_000);
const ZERO = BigInt(0);

// Circle Gateway Minter (testnet). A Circle UCW may call gatewayMint here to RECEIVE a
// cross-chain Move-to-Arc into its own Arc balance, so the external EOA that signed the burn
// intent doesn't need Arc gas to submit the mint. Safe to allow with no param checks: the mint
// is fully gated by the Gateway API's attestation + operator signature (bound to a specific
// recipient/value), so whoever submits it can't mint anything that wasn't already attested.
const GATEWAY_MINTER_ADDRESS = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B'.toLowerCase();
const GATEWAY_MINT_SIGNATURE = 'gatewayMint(bytes,bytes)';

async function isFactoryDeployedMarket(marketAddress: Address, config: ReturnType<typeof getArcConfig>): Promise<boolean> {
  try {
    const publicClient = createArcReadClient();
    if (!publicClient) return false;

    if (config.factoryAddress) {
      try {
        const logs = await publicClient.getLogs({
          address: config.factoryAddress as Address,
          event: prestoMarketFactoryAbi.find((x) => x.type === 'event' && x.name === 'MarketCreated') as any,
          args: { market: marketAddress },
          fromBlock: 'earliest',
        });
        if (logs.length > 0) return true;
      } catch (err) {
        console.error('[circle-security] Failed standard factory logs read:', err);
      }
    }

    if (config.multiOutcomeFactoryAddress) {
      try {
        const logs = await publicClient.getLogs({
          address: config.multiOutcomeFactoryAddress as Address,
          event: prestoMultiOutcomeMarketFactoryAbi.find((x) => x.type === 'event' && x.name === 'MarketCreated') as any,
          args: { market: marketAddress },
          fromBlock: 'earliest',
        });
        if (logs.length > 0) return true;
      } catch (err) {
        console.error('[circle-security] Failed multi-outcome factory logs read:', err);
      }
    }

    // EURC-collateral factories, V3 LMSR factories, and legacy factories: their markets are also tradable.
    for (const legacy of [
      ...(config.eurcFactoryAddress ? [{ address: config.eurcFactoryAddress, abi: prestoMarketFactoryAbi }] : []),
      ...(config.eurcMultiOutcomeFactoryAddress ? [{ address: config.eurcMultiOutcomeFactoryAddress, abi: prestoMultiOutcomeMarketFactoryAbi }] : []),
      ...(config.lmsrFactoryAddress ? [{ address: config.lmsrFactoryAddress, abi: prestoLmsrMarketFactoryAbi }] : []),
      ...(config.eurcLmsrFactoryAddress ? [{ address: config.eurcLmsrFactoryAddress, abi: prestoLmsrMarketFactoryAbi }] : []),
      ...config.legacyFactoryAddresses.map((address) => ({ address, abi: prestoMarketFactoryAbi })),
      ...config.legacyMultiOutcomeFactoryAddresses.map((address) => ({ address, abi: prestoMultiOutcomeMarketFactoryAbi })),
    ]) {
      try {
        const logs = await publicClient.getLogs({
          address: legacy.address as Address,
          event: legacy.abi.find((x) => x.type === 'event' && x.name === 'MarketCreated') as any,
          args: { market: marketAddress },
          fromBlock: 'earliest',
        });
        if (logs.length > 0) return true;
      } catch (err) {
        console.error('[circle-security] Failed legacy factory logs read:', err);
      }
    }

    return false;
  } catch (error) {
    console.error('[circle-security] Failed to verify market provenance:', error);
    return false;
  }
}

function parseBaseUnitAmount(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  try {
    return BigInt(text);
  } catch {
    return null;
  }
}

function getMaxUsdcTransferBaseUnits(): bigint {
  const configured = parseBaseUnitAmount(process.env.PRESTO_CIRCLE_MAX_USDC_TRANSFER_BASE_UNITS);
  return configured && configured > ZERO ? configured : DEFAULT_MAX_USDC_TRANSFER_BASE_UNITS;
}

function configuredTrustedRecipients(): Set<string> {
  return new Set([
    process.env.PRESTO_AGENT_RESOLVER_ADDRESS,
    process.env.NEXT_PUBLIC_MARKET_RESOLVER_ADDRESS,
    process.env.PRESTO_PAYMENT_ADDRESS,
  ].filter((value): value is string => Boolean(value && isAddress(value))).map((value) => value.toLowerCase()));
}

async function validateUsdcExecution(input: CircleContractExecutionPolicyInput, config: ReturnType<typeof getArcConfig>): Promise<boolean> {
  const [target, rawAmount] = input.abiParameters ?? [];
  if (typeof target !== 'string' || !isAddress(target)) return false;
  const amount = parseBaseUnitAmount(rawAmount);
  if (!amount || amount <= ZERO || amount > getMaxUsdcTransferBaseUnits()) return false;

  if (input.abiFunctionSignature === 'approve(address,uint256)') {
    const spender = target.toLowerCase();
    const markets = await fetchOnchainMarkets();
    if (markets.some((market) => market.id.toLowerCase() === spender)) return true;
    return isFactoryDeployedMarket(target as Address, config);
  }

  if (input.abiFunctionSignature === 'transfer(address,uint256)') {
    return configuredTrustedRecipients().has(target.toLowerCase());
  }

  return false;
}

// SCA batch execution: the wallet runs executeBatch on its own address with a list of
// [target, nativeValue, calldata] legs. We only allow batches whose every leg is an
// approve(address,uint256) to USDC for a known market, or a buy(uint8,uint256) on a known
// market. Anything else (other selectors, non-zero native value, malformed legs) is rejected.
const BATCH_SIGNATURE = 'executeBatch((address, uint256, bytes)[])';
const APPROVE_SELECTOR = toFunctionSelector('approve(address,uint256)');
const BUY_SELECTOR = toFunctionSelector('buy(uint8,uint256)');
const BUY_LMSR_SELECTOR = toFunctionSelector('buy(uint8,uint256,uint256)'); // V3 slippage-guarded buy
const MAX_BATCH_LEGS = 4;

type BatchOp =
  | { kind: 'approve'; usdcTarget: string; spender: string; amount: bigint }
  | { kind: 'buy'; market: string };

/**
 * Pure structural validation of an executeBatch payload. Each leg must be a
 * [target, nativeValue, calldata] tuple carrying zero native value and calling only
 * approve(address,uint256) or buy(uint8,uint256). Returns the normalized ops, or
 * { ok: false }. Market/spender provenance is checked separately (it needs the chain).
 */
export function inspectBatch(abiParameters: unknown[] | undefined): { ok: true; ops: BatchOp[] } | { ok: false } {
  const legs = abiParameters?.[0];
  if (!Array.isArray(legs) || legs.length === 0 || legs.length > MAX_BATCH_LEGS) return { ok: false };

  const ops: BatchOp[] = [];
  for (const leg of legs) {
    if (!Array.isArray(leg) || leg.length !== 3) return { ok: false };
    const [target, value, calldata] = leg as [unknown, unknown, unknown];
    if (typeof target !== 'string' || !isAddress(target)) return { ok: false };

    const nativeValue = parseBaseUnitAmount(value);
    if (nativeValue === null || nativeValue !== ZERO) return { ok: false };

    if (typeof calldata !== 'string' || !/^0x[0-9a-fA-F]{8,}$/.test(calldata)) return { ok: false };
    const selector = calldata.slice(0, 10).toLowerCase();

    if (selector === APPROVE_SELECTOR) {
      let decoded;
      try {
        decoded = decodeFunctionData({ abi: erc20Abi, data: calldata as `0x${string}` });
      } catch {
        return { ok: false };
      }
      if (decoded.functionName !== 'approve') return { ok: false };
      const [spender, amount] = decoded.args as readonly [string, bigint];
      if (typeof spender !== 'string' || typeof amount !== 'bigint') return { ok: false };
      ops.push({ kind: 'approve', usdcTarget: target.toLowerCase(), spender: spender.toLowerCase(), amount });
    } else if (selector === BUY_SELECTOR || selector === BUY_LMSR_SELECTOR) {
      ops.push({ kind: 'buy', market: target.toLowerCase() });
    } else {
      return { ok: false };
    }
  }

  return { ok: true, ops };
}

async function validateBatchExecution(
  input: CircleContractExecutionPolicyInput,
  config: ReturnType<typeof getArcConfig>,
): Promise<boolean> {
  const inspected = inspectBatch(input.abiParameters);
  if (!inspected.ok) return false;

  const usdc = config.usdcAddress?.toLowerCase();
  const maxAmount = getMaxUsdcTransferBaseUnits();
  const markets = await fetchOnchainMarkets();
  const marketIds = new Set(markets.map((market) => market.id.toLowerCase()));
  const isKnownMarket = async (addr: string) =>
    marketIds.has(addr) || isFactoryDeployedMarket(addr as Address, config);

  for (const op of inspected.ops) {
    if (op.kind === 'approve') {
      if (!usdc || op.usdcTarget !== usdc) return false;
      if (op.amount <= ZERO || op.amount > maxAmount) return false;
      if (!(await isKnownMarket(op.spender))) return false;
    } else if (!(await isKnownMarket(op.market))) {
      return false;
    }
  }

  return true;
}

export async function isAllowedContractExecution(input: CircleContractExecutionPolicyInput): Promise<boolean> {
  if (!input.contractAddress || !isAddress(input.contractAddress)) return false;
  if (!input.abiFunctionSignature) return false;

  const config = getArcConfig();
  const contract = input.contractAddress.toLowerCase();
  const factory = config.factoryAddress?.toLowerCase();
  const multiOutcomeFactory = config.multiOutcomeFactoryAddress?.toLowerCase();
  // EURC-collateral factories are also valid create targets (euro markets).
  const eurcFactory = config.eurcFactoryAddress?.toLowerCase();
  const eurcMultiOutcomeFactory = config.eurcMultiOutcomeFactoryAddress?.toLowerCase();
  const lmsrFactory = config.lmsrFactoryAddress?.toLowerCase();
  const eurcLmsrFactory = config.eurcLmsrFactoryAddress?.toLowerCase();
  const usdc = config.usdcAddress?.toLowerCase();

  if (input.abiFunctionSignature === BATCH_SIGNATURE) {
    return validateBatchExecution(input, config);
  }

  // V3 LMSR factories (USDC + EURC) deploy share-based markets with a seed subsidy.
  if ((lmsrFactory && contract === lmsrFactory) || (eurcLmsrFactory && contract === eurcLmsrFactory)) {
    return input.abiFunctionSignature === 'createMarket(address,uint64,string,uint8,uint8,uint256)';
  }

  // Receiving a Move-to-Arc: the Circle wallet submits the Gateway-attested mint to itself.
  if (contract === GATEWAY_MINTER_ADDRESS) {
    return input.abiFunctionSignature === GATEWAY_MINT_SIGNATURE;
  }

  if ((factory && contract === factory) || (eurcFactory && contract === eurcFactory)) {
    return input.abiFunctionSignature === 'createMarket(address,uint256,string,uint8)';
  }

  if ((multiOutcomeFactory && contract === multiOutcomeFactory) || (eurcMultiOutcomeFactory && contract === eurcMultiOutcomeFactory)) {
    return input.abiFunctionSignature === 'createMarket(address,uint256,string,uint8,uint8)';
  }

  if (usdc && contract === usdc) {
    return validateUsdcExecution(input, config);
  }

  if (!allowedMarketSignatures.has(input.abiFunctionSignature)) return false;

  const markets = await fetchOnchainMarkets();
  if (markets.some((market) => market.id.toLowerCase() === contract)) return true;

  return isFactoryDeployedMarket(input.contractAddress as Address, config);
}
