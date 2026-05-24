import { agentTransferUsdc } from './agentWallet';

export type L402Challenge = {
  address: string;
  price: string;
  currency: string;
};

function parseL402Challenge(authHeader: string): L402Challenge {
  // Example: L402 address="0xABC...", price="0.15", currency="USDC"
  const addressMatch = authHeader.match(/address="([^"]+)"/);
  const priceMatch = authHeader.match(/price="([^"]+)"/);
  
  if (!addressMatch || !priceMatch) {
    throw new Error('Invalid L402 challenge header');
  }
  
  return {
    address: addressMatch[1],
    price: priceMatch[1],
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
