import { describe, expect, it, vi } from 'vitest';
import { waitForSubmittedTransaction } from '../liveActions';

// Minimal fake of the viem public client surface the helper touches.
function fakeClient(getReceipt: () => Promise<unknown>) {
  return { getTransactionReceipt: getReceipt } as unknown as Parameters<typeof waitForSubmittedTransaction>[0];
}

const HASH = '0xabc' as `0x${string}`;

describe('waitForSubmittedTransaction', () => {
  it('confirms immediately from a successful receipt (UI no longer spins after the tx mines)', async () => {
    const client = fakeClient(async () => ({ status: 'success' }));
    await expect(waitForSubmittedTransaction(client, HASH)).resolves.toBe(true);
  });

  it('confirms from the on-chain effect even when the receipt read is lagging', async () => {
    // Receipt never resolves (simulates a read RPC behind the chain), but the effect check passes —
    // this is the exact "tx succeeded but UI stuck pending" case the fix targets.
    const client = fakeClient(async () => null);
    const confirmOnchain = vi.fn(async () => true);
    await expect(waitForSubmittedTransaction(client, HASH, confirmOnchain)).resolves.toBe(true);
    expect(confirmOnchain).toHaveBeenCalled();
  });

  it('throws when the transaction reverted', async () => {
    const client = fakeClient(async () => ({ status: 'reverted' }));
    await expect(waitForSubmittedTransaction(client, HASH)).rejects.toThrow(/reverted/i);
  });
});
