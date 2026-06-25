// Turns raw wallet / viem / contract errors into a short, human sentence fit for a compact toast or
// status line. Wallet libraries append the full request (from/to/data: 0x… calldata, "Request
// Arguments", "Version: viem@x") to their messages, which overflows the UI with hex. We map the
// common cases to plain language and strip the machine noise from everything else.

const HEX_BLOB = /0x[0-9a-fA-F]{16,}/g;
const NOISE_MARKERS = [
  'Request Arguments',
  'Raw Call Arguments',
  'Contract Call:',
  'Estimate Gas Arguments',
  'Details:',
  'Version:',
  'docs.metamask',
  'viem@',
];

function cleanGeneric(raw: string): string {
  let msg = raw;
  for (const marker of NOISE_MARKERS) {
    const i = msg.indexOf(marker);
    if (i > 0) msg = msg.slice(0, i);
  }
  // viem leads reverts with "execution reverted:" — keep the reason, drop the prefix.
  msg = msg.replace(/^execution reverted:?\s*/i, '');
  msg = msg.replace(HEX_BLOB, '').replace(/\s+/g, ' ').trim();
  msg = msg.replace(/[\s,:;(-]+$/, '').trim();
  if (msg.length > 160) msg = `${msg.slice(0, 157).trimEnd()}…`;
  return msg;
}

export function humanizeTxError(error: unknown, fallback = 'Transaction failed.'): string {
  const raw = (error instanceof Error ? error.message : typeof error === 'string' ? error : '') || '';
  const lower = raw.toLowerCase();
  if (!raw) return fallback;

  // Wallet rejection (MetaMask / Circle PIN / passkey decline).
  if (
    lower.includes('user rejected') || lower.includes('user denied') ||
    lower.includes('rejected the request') || lower.includes('notallowederror') ||
    lower.includes('cancelled the') || lower.includes('canceled the') ||
    (lower.includes('cancel') && lower.includes('request'))
  ) {
    return 'You cancelled the request in your wallet.';
  }
  // Contract custom errors + balance issues.
  if (lower.includes('insufficientshares')) return "You don't have enough shares to sell.";
  if (lower.includes('insufficient') || lower.includes('exceeds balance') || lower.includes('transfer amount exceeds')) {
    return raw.includes('$') && raw.length < 160 ? raw : 'Not enough balance to cover this transaction.';
  }
  if (lower.includes('slippageexceeded') || lower.includes('slippage') || lower.includes('price moved')) {
    return 'The price moved past your limit. Refresh the quote and try again.';
  }
  if (lower.includes('marketclosed') || lower.includes('marketnotclosed') || lower.includes('closed for trading') || lower.includes('already settled') || lower.includes('match is live') || lower.includes('trading is locked')) {
    return raw.length < 160 && !lower.includes('0x') ? raw : 'This market is not open for trading right now.';
  }
  if (lower.includes('notseeded')) return "This market isn't funded yet. Try again in a moment.";
  if (lower.includes('aa21') || lower.includes('paymaster') || lower.includes('sponsor')) {
    return 'Gas sponsorship was unavailable for a moment. Try again shortly.';
  }
  if (lower.includes('nonce') || lower.includes('already pending') || lower.includes('replacement transaction')) {
    return 'A transaction is already in progress. Wait for it to finish, then retry.';
  }
  if (lower.includes('chain') && (lower.includes('mismatch') || lower.includes('does not match'))) {
    return 'Your wallet is on the wrong network. Switch to Arc Testnet and try again.';
  }
  if (lower.includes('session expired') || lower.includes('sign in again')) {
    return 'Your wallet session expired. Sign in again to continue.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'The network took too long to respond. Check the explorer, then retry if needed.';
  }

  return cleanGeneric(raw) || fallback;
}
