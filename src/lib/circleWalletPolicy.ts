import { createPublicClient, http, isAddress, type Address } from 'viem';
import { arcTestnet } from 'viem/chains';
import { getArcConfig } from './arcConfig';
import { fetchOnchainMarkets } from './onchainMarkets';
import { prestoMarketFactoryAbi, prestoMultiOutcomeMarketFactoryAbi } from './contracts';

export type CircleContractExecutionPolicyInput = {
  contractAddress?: string;
  abiFunctionSignature?: string;
  abiParameters?: unknown[];
};

const allowedMarketSignatures = new Set([
  'buy(uint8,uint256)',
  'resolve(uint8,string)',
  'cancel()',
  'claim()',
  'refund()',
]);

const DEFAULT_MAX_USDC_TRANSFER_BASE_UNITS = BigInt(5_000_000);
const ZERO = BigInt(0);

async function isFactoryDeployedMarket(marketAddress: Address, config: ReturnType<typeof getArcConfig>): Promise<boolean> {
  try {
    const publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(config.rpcUrl),
    });

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

export async function isAllowedContractExecution(input: CircleContractExecutionPolicyInput): Promise<boolean> {
  if (!input.contractAddress || !isAddress(input.contractAddress)) return false;
  if (!input.abiFunctionSignature) return false;

  const config = getArcConfig();
  const contract = input.contractAddress.toLowerCase();
  const factory = config.factoryAddress?.toLowerCase();
  const multiOutcomeFactory = config.multiOutcomeFactoryAddress?.toLowerCase();
  const usdc = config.usdcAddress?.toLowerCase();

  if (factory && contract === factory) {
    return input.abiFunctionSignature === 'createMarket(address,uint256,string,uint8)';
  }

  if (multiOutcomeFactory && contract === multiOutcomeFactory) {
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
