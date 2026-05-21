/**
 * Singleton confirmation queue so non-React lib code (circleActions) can request a
 * preview modal from the React UI before invoking Circle's PIN challenge. The UI
 * component subscribes once, and lib code calls `requestCircleConfirmation(details)`
 * and awaits the user's decision.
 */

export type CircleConfirmDetails = {
  /** Short label like "Buy YES on Will ETH break $5k". */
  label: string;
  /** What action they're about to authorize, in human terms. */
  action: string;
  /** Contract being called, address. */
  contractAddress: string;
  /** Solidity function signature being called, e.g. "buy(uint8,uint256)". */
  functionSignature: string;
  /** Optional friendly amount display, e.g. "$10.00 USDC". */
  amountDisplay?: string;
  /** Optional ABI parameters preview as an ordered list of human-readable strings. */
  parameters?: string[];
  /** Optional explorer link for the contract. */
  contractExplorerUrl?: string;
};

type PendingRequest = {
  id: number;
  details: CircleConfirmDetails;
  resolve: (approved: boolean) => void;
};

type Listener = (req: PendingRequest | null) => void;

let nextId = 1;
let current: PendingRequest | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const fn of listeners) fn(current);
}

export function requestCircleConfirmation(details: CircleConfirmDetails): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (listeners.size === 0) {
      // No UI mounted; fail safe by auto-rejecting so the user doesn't get a silent PIN prompt.
      console.warn('Circle confirmation UI is not mounted; rejecting the prompt.');
      resolve(false);
      return;
    }
    current = {
      id: nextId++,
      details,
      resolve: (approved: boolean) => {
        resolve(approved);
        current = null;
        emit();
      },
    };
    emit();
  });
}

export function subscribeCircleConfirmation(listener: Listener): () => void {
  listeners.add(listener);
  // Replay current state so freshly mounted UI shows any pending request.
  listener(current);
  return () => { listeners.delete(listener); };
}
