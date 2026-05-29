import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the agent wallet so no real chain calls happen.
const agentTransferUsdc = vi.fn();
vi.mock('../agentWallet', () => ({
  agentTransferUsdc: (...args: unknown[]) => agentTransferUsdc(...args),
}));

import { fetchWithX402 } from '../x402Client';

const VALID_ADDR = '0x1111111111111111111111111111111111111111';
const originalFetch = global.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

function challenge402(headerValue: string) {
  return {
    status: 402,
    headers: { get: (name: string) => (name.toLowerCase() === 'www-authenticate' ? headerValue : null) },
  };
}

beforeEach(() => {
  mockFetch = vi.fn();
  global.fetch = mockFetch as unknown as typeof fetch;
  agentTransferUsdc.mockReset();
  delete process.env.X402_MAX_PRICE_USDC;
  delete process.env.X402_ALLOWED_RECIPIENTS;
});

afterEach(() => {
  vi.clearAllMocks();
  global.fetch = originalFetch;
});

describe('fetchWithX402', () => {
  it('returns the response unchanged when no payment is required', async () => {
    const ok = { status: 200 };
    mockFetch.mockResolvedValueOnce(ok);

    const res = await fetchWithX402('https://example.com/resource');

    expect(res).toBe(ok);
    expect(agentTransferUsdc).not.toHaveBeenCalled();
  });

  it('pays and retries for a valid in-cap challenge', async () => {
    mockFetch
      .mockResolvedValueOnce(challenge402(`L402 address="${VALID_ADDR}", price="0.15", currency="USDC"`))
      .mockResolvedValueOnce({ status: 200 });
    agentTransferUsdc.mockResolvedValueOnce({ ok: true, txHash: '0xabc' });

    const res = await fetchWithX402('https://example.com/resource');

    expect(agentTransferUsdc).toHaveBeenCalledWith(VALID_ADDR, '0.15');
    expect((res as { status: number }).status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('refuses to pay when the price exceeds the cap', async () => {
    mockFetch.mockResolvedValueOnce(challenge402(`L402 address="${VALID_ADDR}", price="999999", currency="USDC"`));

    await expect(fetchWithX402('https://example.com/resource')).rejects.toThrow(/exceeds the configured cap/);
    expect(agentTransferUsdc).not.toHaveBeenCalled();
  });

  it('refuses to pay an invalid recipient address', async () => {
    mockFetch.mockResolvedValueOnce(challenge402(`L402 address="0xnot-an-address", price="0.10", currency="USDC"`));

    await expect(fetchWithX402('https://example.com/resource')).rejects.toThrow(/invalid payment address/);
    expect(agentTransferUsdc).not.toHaveBeenCalled();
  });

  it('refuses non-positive / non-numeric prices', async () => {
    mockFetch.mockResolvedValueOnce(challenge402(`L402 address="${VALID_ADDR}", price="abc", currency="USDC"`));

    await expect(fetchWithX402('https://example.com/resource')).rejects.toThrow(/invalid price/);
    expect(agentTransferUsdc).not.toHaveBeenCalled();
  });

  it('enforces the recipient allowlist when configured', async () => {
    process.env.X402_ALLOWED_RECIPIENTS = '0x2222222222222222222222222222222222222222';
    mockFetch.mockResolvedValueOnce(challenge402(`L402 address="${VALID_ADDR}", price="0.10", currency="USDC"`));

    await expect(fetchWithX402('https://example.com/resource')).rejects.toThrow(/not on the X402_ALLOWED_RECIPIENTS allowlist/);
    expect(agentTransferUsdc).not.toHaveBeenCalled();
  });

  it('respects a custom price cap from the environment', async () => {
    process.env.X402_MAX_PRICE_USDC = '0.05';
    mockFetch.mockResolvedValueOnce(challenge402(`L402 address="${VALID_ADDR}", price="0.10", currency="USDC"`));

    await expect(fetchWithX402('https://example.com/resource')).rejects.toThrow(/exceeds the configured cap/);
    expect(agentTransferUsdc).not.toHaveBeenCalled();
  });
});
