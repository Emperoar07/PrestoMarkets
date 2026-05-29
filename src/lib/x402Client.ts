import { isAddress } from 'viem';
import { agentTransferUsdc } from './agentWallet';

export type L402Challenge = {
  address: string;
  price: string;
  currency: string;
};

// Maximum USDC the agent will pay to satisfy a single x402 challenge. The
// challenge address and price are dictated by the upstream server's response,
// so without a cap a compromised, malicious, or misconfigured endpoint could
// drain the agent wallet. Override with X402_MAX_PRICE_USDC; defaults to 1 USDC.
function getMaxX402PriceUsdc(): number {
  const parsed = Number(process.env.X402_MAX_PRICE_USDC);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

// Optional allowlist of payment recipient addresses (comma-separated). When set,
// the agent only pays challenges whose address is on the list.
function getAllowedRecipients(): string[] {
  return (process.env.X402_ALLOWED_RECIPIENTS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function parseL402Challenge(authHeader: string): L402Challenge {
  // Example: L402 address="0xABC...", price="0.15", currency="USDC"
  const addressMatch = authHeader.match(/address="([^"]+)"/);
  const priceMatch = authHeader.match(/price="([^"]+)"/);

  if (!addressMatch || !priceMatch) {
    throw new Error('Invalid L402 challenge header');
  }

  const address = addressMatch[1];
  const price = priceMatch[1];

  // Validate the recipient is a real EVM address before we ever try to pay it.
  if (!isAddress(address)) {
    throw new Error(`x402 challenge specified an invalid payment address: ${address}`);
  }

  // Validate the price is a positive, finite number and within the configured cap.
  const priceNum = Number(price);
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    throw new Error(`x402 challenge specified an invalid price: ${price}`);
  }
  const maxPrice = getMaxX402PriceUsdc();
  if (priceNum > maxPrice) {
    throw new Error(`x402 challenge price ${priceNum} USDC exceeds the configured cap of ${maxPrice} USDC.`);
  }

  // Enforce the recipient allowlist when one is configured.
  const allowed = getAllowedRecipients();
  if (allowed.length > 0 && !allowed.includes(address.toLowerCase())) {
    throw new Error(`x402 payment recipient ${address} is not on the X402_ALLOWED_RECIPIENTS allowlist.`);
  }

  return {
    address,
    price,
    currency: 'USDC',
  };
}

export async function fetchWithX402(url: string, init?: RequestInit): Promise<Response> {
  // 1. Initial request to get the 402 challenge
  const res = await fetch(url, init);
  
  if (res.status !== 402) {
    // Service didn't require payment, or failed for another reason
    return res;
  }
  
  const authHeader = res.headers.get('www-authenticate');
  if (!authHeader || (!authHeader.toLowerCase().includes('l402') && !authHeader.toLowerCase().includes('x402'))) {
    throw new Error('Endpoint returned 402 but no L402/x402 challenge header found');
  }
  
  const challenge = parseL402Challenge(authHeader);
  
  // 2. Pay the challenge via the agent wallet
  const paymentResult = await agentTransferUsdc(challenge.address, challenge.price);
  
  if (!paymentResult.ok || !paymentResult.txHash) {
    throw new Error(`Failed to pay x402 challenge: ${paymentResult.error}`);
  }
  
  // 3. Retry the request with the receipt.
  // Standard L402 uses a mac and preimage, but for simplified on-chain Arc protocols
  // like Stoa, the transaction hash itself is sent as proof of payment.
  const authValue = `L402 txHash="${paymentResult.txHash}"`;
  
  const retryInit = {
    ...init,
    headers: {
      ...init?.headers,
      'Authorization': authValue,
    }
  };
  
  return fetch(url, retryInit);
}
