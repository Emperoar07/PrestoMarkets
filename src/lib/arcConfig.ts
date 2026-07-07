export type ArcReadinessItem = {
  label: string;
  value: string;
  ready: boolean;
};

const DEFAULT_MARKET_FACTORY_ADDRESS = '0xe51ff3E9f3Ce36e8427ae286d7768ce9dA55B5D4';
const DEFAULT_MULTI_OUTCOME_MARKET_FACTORY_ADDRESS = '0xD01e6828601b9d813b36110748257B0C461a0128';
const DEFAULT_LEGACY_MARKET_FACTORY_ADDRESSES = ['0xB5FA65ae7c76b2DeecA1906848e8805df6dCF807'];
const DEFAULT_LEGACY_MULTI_OUTCOME_FACTORY_ADDRESSES = ['0xd2961F0e52a1F1Af787cf3722E90459dC0995F2c'];
const DEFAULT_ARC_RPC_URL = 'https://rpc.testnet.arc.network';
const DEFAULT_ARC_EURC_ADDRESS = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';

export type CollateralSymbol = 'USDC' | 'EURC';

/** Map a market's collateral token address to its display symbol. Defaults to USDC. */
export function collateralSymbolForAddress(address: string | undefined): CollateralSymbol {
  if (!address) return 'USDC';
  const config = getArcConfig();
  if (config.eurcAddress && address.toLowerCase() === config.eurcAddress.toLowerCase()) return 'EURC';
  return 'USDC';
}

/** Currency prefix for a collateral symbol (€ for EURC, $ for USDC). */
export function collateralUnit(symbol: CollateralSymbol): string {
  return symbol === 'EURC' ? '€' : '$';
}

function publicEnv(value: string | undefined) {
  return value?.trim() ?? '';
}

function publicEnvList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function uniqueValues(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function getArcConfig() {
  const chainId = publicEnv(process.env.NEXT_PUBLIC_ARC_CHAIN_ID);
  const configuredRpcUrl = publicEnv(process.env.NEXT_PUBLIC_ARC_RPC_URL) || publicEnv(process.env.ARC_RPC_URL);
  // Ordered RPC fallback: dedicated providers (dRPC, QuikNode) lead because the public Arc RPC is
  // hard rate-limited (HTTP 429) and was throttling trades — eth_sendRawTransaction died on 429 with
  // the public endpoint in front. The public RPC is now the LAST-RESORT fallback: viem only reaches
  // it when every dedicated provider is unavailable, so a dead dedicated key still degrades to public
  // (reads keep working) without sending normal load to the throttled endpoint.
  const alchemy = publicEnv(process.env.NEXT_PUBLIC_ARC_RPC_ALCHEMY);
  const drpc = publicEnv(process.env.NEXT_PUBLIC_ARC_RPC_DRPC);
  const quiknode = publicEnv(process.env.NEXT_PUBLIC_ARC_RPC_QUIKNODE);
  // Generic numbered slots — fill ANY with ANY endpoint (e.g. several Alchemy keys), any order;
  // empty ones drop out. All join the fallback chain; an exhausted one is skipped (arcShouldThrow)
  // and serves again once topped up. Must be referenced statically so Next.js inlines them.
  const numbered = [
    publicEnv(process.env.NEXT_PUBLIC_ARC_RPC_1),
    publicEnv(process.env.NEXT_PUBLIC_ARC_RPC_2),
    publicEnv(process.env.NEXT_PUBLIC_ARC_RPC_3),
    publicEnv(process.env.NEXT_PUBLIC_ARC_RPC_4),
    publicEnv(process.env.NEXT_PUBLIC_ARC_RPC_5),
    publicEnv(process.env.NEXT_PUBLIC_ARC_RPC_6),
    publicEnv(process.env.NEXT_PUBLIC_ARC_RPC_7),
    publicEnv(process.env.NEXT_PUBLIC_ARC_RPC_8),
    publicEnv(process.env.NEXT_PUBLIC_ARC_RPC_9),
    publicEnv(process.env.NEXT_PUBLIC_ARC_RPC_10),
  ];
  // Alchemy legs first (primary + numbered) so failover lands on another healthy high-limit
  // endpoint immediately; dRPC/QuikNode free tiers exhaust and a dead leg in between costs ~2s/hop.
  const rpcUrls = uniqueValues([alchemy, ...numbered, drpc, quiknode, configuredRpcUrl, DEFAULT_ARC_RPC_URL].filter(Boolean));
  const rpcUrl = rpcUrls[0] ?? DEFAULT_ARC_RPC_URL;
  const usdcAddress = publicEnv(process.env.NEXT_PUBLIC_USDC_ADDRESS);
  // EURC on Arc Testnet (Circle docs) — euro-denominated market collateral. 6 decimals like USDC.
  const eurcAddress = publicEnv(process.env.NEXT_PUBLIC_EURC_ADDRESS) || DEFAULT_ARC_EURC_ADDRESS;
  // EURC-collateral factories (euro markets). Read alongside the USDC factories so euro markets
  // appear in the explorer; absent until the EURC factory is deployed.
  const eurcFactoryAddress = publicEnv(process.env.NEXT_PUBLIC_EURC_MARKET_FACTORY_ADDRESS);
  const eurcMultiOutcomeFactoryAddress = publicEnv(process.env.NEXT_PUBLIC_EURC_MULTI_OUTCOME_FACTORY_ADDRESS);
  // V3 LMSR factories (one per collateral handles both binary and multi via outcomeCount). Read
  // alongside the V1/V2 factories so LMSR markets appear in the explorer; absent until deployed.
  // New market creation cuts over to these once the env is set (see the create + agent paths).
  const lmsrFactoryAddress = publicEnv(process.env.NEXT_PUBLIC_LMSR_MARKET_FACTORY_ADDRESS);
  const eurcLmsrFactoryAddress = publicEnv(process.env.NEXT_PUBLIC_EURC_LMSR_MARKET_FACTORY_ADDRESS);
  const factoryAddress = publicEnv(process.env.NEXT_PUBLIC_MARKET_FACTORY_ADDRESS) || DEFAULT_MARKET_FACTORY_ADDRESS;
  const multiOutcomeFactoryAddress = publicEnv(process.env.NEXT_PUBLIC_MULTI_OUTCOME_MARKET_FACTORY_ADDRESS) || DEFAULT_MULTI_OUTCOME_MARKET_FACTORY_ADDRESS;
  // Retired factories whose markets must stay readable (positions, claims, history) after a
  // factory upgrade. New markets are only ever created through the primary factories above.
  const legacyFactoryAddresses = uniqueValues([
    ...publicEnvList(process.env.NEXT_PUBLIC_LEGACY_MARKET_FACTORY_ADDRESSES),
    ...DEFAULT_LEGACY_MARKET_FACTORY_ADDRESSES,
  ].filter((address) => address.toLowerCase() !== factoryAddress.toLowerCase()));
  const legacyMultiOutcomeFactoryAddresses = uniqueValues([
    ...publicEnvList(process.env.NEXT_PUBLIC_LEGACY_MULTI_OUTCOME_FACTORY_ADDRESSES),
    ...publicEnvList(process.env.NEXT_PUBLIC_LEGACY_MULTI_OUTCOME_MARKET_FACTORY_ADDRESSES),
    ...DEFAULT_LEGACY_MULTI_OUTCOME_FACTORY_ADDRESSES,
  ].filter((address) => address.toLowerCase() !== multiOutcomeFactoryAddress.toLowerCase()));

  return {
    chainId,
    rpcUrl,
    rpcUrls,
    usdcAddress,
    eurcAddress,
    eurcFactoryAddress,
    eurcMultiOutcomeFactoryAddress,
    lmsrFactoryAddress,
    eurcLmsrFactoryAddress,
    factoryAddress,
    multiOutcomeFactoryAddress,
    legacyFactoryAddresses,
    legacyMultiOutcomeFactoryAddresses,
    circlePaymasterEnabled: process.env.NEXT_PUBLIC_CIRCLE_PAYMASTER_ENABLED === 'true',
    circleWalletsEnabled: process.env.NEXT_PUBLIC_CIRCLE_WALLETS_ENABLED === 'true',
    circleBridgeKitEnabled: process.env.NEXT_PUBLIC_CIRCLE_BRIDGE_KIT_ENABLED === 'true',
    circleGatewayEnabled: process.env.NEXT_PUBLIC_CIRCLE_GATEWAY_ENABLED === 'true',
  };
}

export function getArcChainId(): number {
  const config = getArcConfig();
  const parsed = parseInt(config.chainId, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5042002;
}

export function getArcReadinessItems(): ArcReadinessItem[] {
  const config = getArcConfig();

  return [
    {
      label: 'Arc chain',
      value: config.chainId && config.rpcUrl ? `${config.chainId} RPC ready` : 'Missing chain id or RPC',
      ready: config.chainId.length > 0 && config.rpcUrl.length > 0,
    },
    {
      label: 'USDC collateral',
      value: config.usdcAddress || 'Set NEXT_PUBLIC_USDC_ADDRESS',
      ready: config.usdcAddress.length > 0,
    },
    {
      label: 'Market factory',
      value: config.factoryAddress || 'Set NEXT_PUBLIC_MARKET_FACTORY_ADDRESS',
      ready: config.factoryAddress.length > 0,
    },
    {
      label: 'Multi-outcome factory',
      value: config.multiOutcomeFactoryAddress || 'Set NEXT_PUBLIC_MULTI_OUTCOME_MARKET_FACTORY_ADDRESS',
      ready: config.multiOutcomeFactoryAddress.length > 0,
    },
  ];
}
