export type ArcReadinessItem = {
  label: string;
  value: string;
  ready: boolean;
};

function publicEnv(value: string | undefined) {
  return value?.trim() ?? '';
}

export function getArcConfig() {
  const chainId = publicEnv(process.env.NEXT_PUBLIC_ARC_CHAIN_ID);
  const usdcAddress = publicEnv(process.env.NEXT_PUBLIC_USDC_ADDRESS);
  const factoryAddress = publicEnv(process.env.NEXT_PUBLIC_MARKET_FACTORY_ADDRESS);

  return {
    chainId,
    usdcAddress,
    factoryAddress,
    circlePaymasterEnabled: process.env.NEXT_PUBLIC_CIRCLE_PAYMASTER_ENABLED === 'true',
    circleWalletsEnabled: process.env.NEXT_PUBLIC_CIRCLE_WALLETS_ENABLED === 'true',
    circleBridgeKitEnabled: process.env.NEXT_PUBLIC_CIRCLE_BRIDGE_KIT_ENABLED === 'true',
    circleGatewayEnabled: process.env.NEXT_PUBLIC_CIRCLE_GATEWAY_ENABLED === 'true',
  };
}

export function getArcReadinessItems(): ArcReadinessItem[] {
  const config = getArcConfig();

  return [
    {
      label: 'Arc chain',
      value: config.chainId || 'Missing chain id',
      ready: config.chainId.length > 0,
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
  ];
}
