/**
 * Cross-collateral swap via Circle App Kit.
 *
 * Lets a user pay for a market in EURC even if the market settles in USDC (or vice versa)
 * by routing through Circle's Swap capability on Arc Testnet right before the buy, and
 * routing the payout back through Swap right after the claim or refund.
 *
 * Limitation: only external EVM wallets (window.ethereum) are supported. Circle
 * user-controlled wallets cannot use App Kit Swap because their browser SDK does not expose
 * an EIP-1193 provider that signs without going through the PIN/biometric challenge per call.
 */

import type { Address } from 'viem';

export type StableSymbol = 'USDC' | 'EURC';

export type SwapResult = {
  amountIn: string;
  amountOut: string;
  txHash: string;
  explorerUrl?: string;
};

function getKitKey(): string {
  const key = (process.env.NEXT_PUBLIC_CIRCLE_KIT_KEY ?? '').trim();
  if (!key) throw new Error('NEXT_PUBLIC_CIRCLE_KIT_KEY is not set. Cross-collateral swap is unavailable.');
  return key;
}

async function createBrowserAdapter() {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('Cross-collateral swap requires an EVM browser wallet (MetaMask / WalletConnect). Circle app wallets cannot swap on the client.');
  }
  const { createViemAdapterFromProvider } = await import('@circle-fin/adapter-viem-v2');
  return createViemAdapterFromProvider({ provider: window.ethereum as Parameters<typeof createViemAdapterFromProvider>[0]['provider'] });
}

export async function quoteSwap(input: {
  tokenIn: StableSymbol;
  tokenOut: StableSymbol;
  amountIn: string;
}): Promise<{ amountOut: string }> {
  if (input.tokenIn === input.tokenOut) return { amountOut: input.amountIn };
  const { AppKit } = await import('@circle-fin/app-kit');
  const kit = new AppKit();
  const adapter = await createBrowserAdapter();
  const result = await kit.estimateSwap({
    from: { adapter, chain: 'Arc_Testnet' },
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountIn: input.amountIn,
    config: { kitKey: getKitKey() },
  }) as { amountOut?: string };
  return { amountOut: String(result?.amountOut ?? input.amountIn) };
}

export async function executeSwap(input: {
  tokenIn: StableSymbol;
  tokenOut: StableSymbol;
  amountIn: string;
}): Promise<SwapResult> {
  if (input.tokenIn === input.tokenOut) {
    throw new Error('Source and destination tokens are the same; no swap needed.');
  }
  const { AppKit } = await import('@circle-fin/app-kit');
  const kit = new AppKit();
  const adapter = await createBrowserAdapter();
  const result = await kit.swap({
    from: { adapter, chain: 'Arc_Testnet' },
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountIn: input.amountIn,
    config: { kitKey: getKitKey() },
  }) as { amountIn?: string; amountOut?: string; txHash?: string; explorerUrl?: string };

  return {
    amountIn: String(result?.amountIn ?? input.amountIn),
    amountOut: String(result?.amountOut ?? '0'),
    txHash: String(result?.txHash ?? ''),
    explorerUrl: result?.explorerUrl,
  };
}

export function getStableContract(symbol: StableSymbol): Address | null {
  const env = symbol === 'USDC'
    ? process.env.NEXT_PUBLIC_USDC_ADDRESS
    : process.env.NEXT_PUBLIC_EURC_ADDRESS;
  const cleaned = (env ?? '').trim();
  if (!cleaned.startsWith('0x')) {
    // Fall back to the Arc Testnet EURC address from arcConfig if env is unset.
    if (symbol === 'EURC') return '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as Address;
    return null;
  }
  return cleaned as Address;
}
