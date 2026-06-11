export type ArcReadinessItem = {
  label: string;
  value: string;
  ready: boolean;
};

function publicEnv(value: string | undefined) {
  return value?.trim() ?? '';
}

function publicEnvList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function getArcConfig() {
  const chainId = publicEnv(process.env.NEXT_PUBLIC_ARC_CHAIN_ID);
  const rpcUrl = publicEnv(process.env.NEXT_PUBLIC_ARC_RPC_URL) || publicEnv(process.env.ARC_RPC_URL);
  const usdcAddress = publicEnv(process.env.NEXT_PUBLIC_USDC_ADDRESS);
  const factoryAddress = publicEnv(process.env.NEXT_PUBLIC_MARKET_FACTORY_ADDRESS);
  const multiOutcomeFactoryAddress = publicEnv(process.env.NEXT_PUBLIC_MULTI_OUTCOME_MARKET_FACTORY_ADDRESS);
  // Retired factories whose markets must stay readable (positions, claims, history) after a
  // factory upgrade. New markets are only ever created through the primary factories above.
  const legacyFactoryAddresses = publicEnvList(process.env.NEXT_PUBLIC_LEGACY_MARKET_FACTORY_ADDRESSES);
  const legacyMultiOutcomeFactoryAddresses = publicEnvList(process.env.NEXT_PUBLIC_LEGACY_MULTI_OUTCOME_FACTORY_ADDRESSES);

  return {
    chainId,
    rpcUrl,
    usdcAddress,
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
