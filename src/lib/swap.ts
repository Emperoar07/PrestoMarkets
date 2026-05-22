/**
 * Cross-collateral swap via Circle Stablecoin Kits, executed through a server proxy.
 *
 * Direct browser calls to api.circle.com/v1/stablecoinKits/swap fail CORS preflight
 * because Circle's CORS policy rejects the x-user-agent header. We work around this
 * by proxying the create-swap call through our own /api/swap route (server-side, no
 * CORS), then executing the returned instructions[] against the user's connected wallet
 * via viem. Each instruction is an ERC-20 approve plus a contract call against a router.
 */

import { createPublicClient, createWalletClient, custom, http, parseUnits, type Address, type Hex } from 'viem';
import { getArcConfig, getArcChainId } from './arcConfig';
import { erc20Abi } from './contracts';

export type StableSymbol = 'USDC' | 'EURC';

export type SwapResult = {
  amountIn: string;
  amountOut: string;
  txHash: string;
};

type SwapInstruction = {
  target: string;
  data: string;
  value: string;
  tokenIn: string;
  amountToApprove: string;
  tokenOut: string;
  minTokenOut?: string;
};

type CreateSwapResponse = {
  estimatedAmount: string;
  fromAddress: string;
  toAddress: string;
  // The remaining fields aren't documented as always-present in Circle's response. We only
  // enforce them when they are; the request-side validation in /api/swap is the primary
  // guarantee that they match what the user asked for.
  tokenInChain?: string;
  tokenOutChain?: string;
  tokenInAddress?: string;
  tokenOutAddress?: string;
  transaction: {
    executionParams: {
      execId: string;
      deadline: string;
      tokens: Array<{ token: string; beneficiary: string }>;
      instructions: SwapInstruction[];
    };
    gasLimit?: string | number;
  };
};

const ARC_CHAIN_NAME = 'Arc_Testnet';

function getStableAddress(symbol: StableSymbol): Address {
  const config = getArcConfig();
  if (symbol === 'USDC') {
    if (!config.usdcAddress) throw new Error('NEXT_PUBLIC_USDC_ADDRESS is not set');
    return config.usdcAddress as Address;
  }
  if (!config.eurcAddress) throw new Error('EURC address is unavailable');
  return config.eurcAddress as Address;
}

function arcChain() {
  const config = getArcConfig();
  return {
    id: getArcChainId(),
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] as [string] } },
  };
}

async function getWalletAccount(): Promise<{ address: Address; walletClient: ReturnType<typeof createWalletClient>; publicClient: ReturnType<typeof createPublicClient> }> {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('Cross-collateral swap needs an EVM browser wallet (MetaMask / WalletConnect).');
  }
  const config = getArcConfig();
  const chain = arcChain();
  await window.ethereum.request({ method: 'eth_requestAccounts' });
  const walletClient = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [address] = await walletClient.getAddresses();
  if (!address) throw new Error('No wallet account returned for the swap.');
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  return { address, walletClient, publicClient };
}

async function createSwap(input: {
  tokenIn: StableSymbol;
  tokenOut: StableSymbol;
  amountIn: string;
  fromAddress: Address;
}): Promise<CreateSwapResponse> {
  const tokenInAddress = getStableAddress(input.tokenIn);
  const tokenOutAddress = getStableAddress(input.tokenOut);
  const amountUnits = parseUnits(input.amountIn, 6).toString();

  const res = await fetch('/api/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tokenInAddress,
      tokenInChain: ARC_CHAIN_NAME,
      tokenOutAddress,
      tokenOutChain: ARC_CHAIN_NAME,
      fromAddress: input.fromAddress,
      toAddress: input.fromAddress,
      amount: amountUnits,
    }),
  });
  const data = await res.json().catch(() => null) as CreateSwapResponse | { error?: string } | null;
  if (!res.ok || !data || (data as { error?: string }).error) {
    throw new Error((data as { error?: string })?.error || `Swap quote failed: ${res.status}`);
  }
  return data as CreateSwapResponse;
}

export async function quoteSwap(input: { tokenIn: StableSymbol; tokenOut: StableSymbol; amountIn: string; fromAddress?: Address }): Promise<{ amountOut: string }> {
  if (input.tokenIn === input.tokenOut) return { amountOut: input.amountIn };
  let from: Address;
  if (input.fromAddress) {
    from = input.fromAddress;
  } else {
    const { address } = await getWalletAccount();
    from = address;
  }
  const response = await createSwap({ ...input, fromAddress: from });
  return { amountOut: response.estimatedAmount };
}

export async function executeSwap(input: { tokenIn: StableSymbol; tokenOut: StableSymbol; amountIn: string }): Promise<SwapResult> {
  if (input.tokenIn === input.tokenOut) {
    throw new Error('Source and destination tokens are the same; no swap needed.');
  }
  const { address, walletClient, publicClient } = await getWalletAccount();
  const response = await createSwap({ ...input, fromAddress: address });

  // Defense-in-depth: we forward raw calldata from Circle into the user's wallet, so verify
  // the response is consistent with what we asked for. The primary guarantee is the
  // request-side validation in /api/swap; here we add belt-and-braces checks on the response.
  // toAddress is the critical drain-prevention check (always present per Circle docs); the
  // other fields are checked only when echoed, since their presence is undocumented.
  if (response.toAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error('Swap recipient does not match the connected wallet — refusing to sign.');
  }
  const expectedTokenIn = getStableAddress(input.tokenIn).toLowerCase();
  const expectedTokenOut = getStableAddress(input.tokenOut).toLowerCase();
  if (response.tokenInChain && response.tokenInChain !== ARC_CHAIN_NAME) {
    throw new Error(`Swap input chain mismatch: ${response.tokenInChain}.`);
  }
  if (response.tokenOutChain && response.tokenOutChain !== ARC_CHAIN_NAME) {
    throw new Error(`Swap output chain mismatch: ${response.tokenOutChain}.`);
  }
  if (response.tokenInAddress && response.tokenInAddress.toLowerCase() !== expectedTokenIn) {
    throw new Error('Swap response references an unexpected input token.');
  }
  if (response.tokenOutAddress && response.tokenOutAddress.toLowerCase() !== expectedTokenOut) {
    throw new Error('Swap response references an unexpected output token.');
  }

  const { instructions } = response.transaction.executionParams;
  if (!instructions?.length) throw new Error('Swap response had no instructions to execute.');

  // Cap any single approval at 2x amountIn (in base units). Stops a malicious response from
  // turning the swap into an unbounded approve + drain on the user's USDC/EURC balance.
  const amountInBaseUnits = parseUnits(input.amountIn, 6);
  const approvalCap = amountInBaseUnits * BigInt(2);

  let lastTxHash: Hex = '0x' as Hex;
  for (const instr of instructions) {
    // Approve the router for the input token if needed.
    if (instr.amountToApprove && instr.amountToApprove !== '0') {
      // The tokenIn in each instruction must match what the user originally agreed to spend.
      if (instr.tokenIn.toLowerCase() !== expectedTokenIn) {
        throw new Error('Swap instruction references an unexpected approve token — refusing to sign.');
      }
      let need = BigInt(instr.amountToApprove);
      if (need > approvalCap) need = approvalCap;
      const currentAllowance = await publicClient.readContract({
        address: instr.tokenIn as Address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, instr.target as Address],
      });
      if (currentAllowance < need) {
        const approveHash = await walletClient.writeContract({
          account: address,
          chain: arcChain(),
          address: instr.tokenIn as Address,
          abi: erc20Abi,
          functionName: 'approve',
          args: [instr.target as Address, need],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
    }

    // Execute the swap call.
    const txHash = await walletClient.sendTransaction({
      account: address,
      chain: arcChain(),
      to: instr.target as Address,
      data: instr.data as Hex,
      value: instr.value && instr.value !== '0x' ? BigInt(instr.value) : BigInt(0),
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    lastTxHash = txHash;
  }

  return {
    amountIn: input.amountIn,
    amountOut: response.estimatedAmount,
    txHash: lastTxHash,
  };
}
