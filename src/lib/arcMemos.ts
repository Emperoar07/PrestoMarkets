import { decodeFunctionData, encodeFunctionData, keccak256, stringToHex, type Address, type Hex } from 'viem';

export const ARC_MEMO_ADDRESS = '0x5294E9927c3306DcBaDb03fe70b92e01cCede505' as Address;
export const ARC_MEMO_SIGNATURE = 'memo(address,bytes,bytes32,bytes)' as const;

// Arc's predeployed Multicall3From (docs.arc.io/arc/references/contract-addresses): batches calls
// like Multicall3, but routes each subcall through the CallFrom precompile so the ORIGINAL
// msg.sender is preserved. That makes approve + buy possible in ONE ordinary EOA transaction —
// the approve sets the user's own allowance, and the buy spends it, atomically, one wallet prompt.
export const ARC_MULTICALL3FROM_ADDRESS = '0x522fAf9A91c41c443c66765030741e4AaCe147D0' as Address;

export const arcMulticall3FromAbi = [
  {
    type: 'function',
    name: 'aggregate3',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'callData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      {
        name: 'returnData',
        type: 'tuple[]',
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
      },
    ],
  },
] as const;

/**
 * Encode an atomic multi-call through Arc's Multicall3From. Subcalls run with the original sender
 * preserved and allowFailure=false, so either every call succeeds or the whole transaction reverts.
 * NOTE: subcalls are the RAW target calls (not memo-wrapped) — nesting through the Memo contract
 * inside Multicall3From is undocumented, so we don't do it on the money path.
 */
export function encodeMulticall3FromCall(calls: Array<{ target: Address; data: Hex }>): { to: Address; data: Hex } {
  return {
    to: ARC_MULTICALL3FROM_ADDRESS,
    data: encodeFunctionData({
      abi: arcMulticall3FromAbi,
      functionName: 'aggregate3',
      args: [calls.map((call) => ({ target: call.target, allowFailure: false, callData: call.data }))],
    }),
  };
}

export const arcMemoAbi = [
  {
    type: 'function',
    name: 'memo',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'memoId', type: 'bytes32' },
      { name: 'memoData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Memo',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'target', type: 'address', indexed: true },
      { name: 'callDataHash', type: 'bytes32', indexed: false },
      { name: 'memoId', type: 'bytes32', indexed: true },
      { name: 'memo', type: 'bytes', indexed: false },
      { name: 'memoIndex', type: 'uint256', indexed: false },
    ],
  },
] as const;

export type PrestoMemoAction =
  | 'market_create'
  | 'resolution_fee'
  | 'buy'
  | 'sell'
  | 'resolve'
  | 'propose'
  | 'dispute'
  | 'cancel'
  | 'claim'
  | 'refund'
  | 'gateway_deposit'
  | 'gateway_mint';

export type PrestoMemoPayload = {
  app: 'presto';
  version: 1;
  action: PrestoMemoAction;
  target: Address;
  at: string;
  marketId?: Address;
  outcome?: string;
  outcomeIndex?: number;
  amount6?: string;
  collateral?: string;
  sourceDomain?: number;
  destinationDomain?: number;
  agentRunId?: string;
  ref?: string;
};

type BuildMemoInput = Omit<PrestoMemoPayload, 'app' | 'version' | 'at'> & {
  at?: string;
};

export function buildPrestoMemo(input: BuildMemoInput): { memoId: Hex; memoData: Hex; payload: PrestoMemoPayload } {
  const payload: PrestoMemoPayload = {
    app: 'presto',
    version: 1,
    at: input.at ?? new Date().toISOString(),
    ...input,
  };
  const memoJson = JSON.stringify(payload);
  const memoData = stringToHex(memoJson);
  return {
    memoId: keccak256(stringToHex(`${payload.app}:${payload.version}:${payload.action}:${payload.target}:${payload.at}:${payload.ref ?? ''}`)),
    memoData,
    payload,
  };
}

export function encodeMemoWrappedCall(input: {
  target: Address;
  data: Hex;
  memo: BuildMemoInput;
}): { to: Address; data: Hex; memoId: Hex; memoData: Hex; payload: PrestoMemoPayload } {
  const memo = buildPrestoMemo({ ...input.memo, target: input.target });
  return {
    to: ARC_MEMO_ADDRESS,
    data: encodeFunctionData({
      abi: arcMemoAbi,
      functionName: 'memo',
      args: [input.target, input.data, memo.memoId, memo.memoData],
    }),
    memoId: memo.memoId,
    memoData: memo.memoData,
    payload: memo.payload,
  };
}

export function buildMemoContractExecution(input: {
  target: Address;
  data: Hex;
  memo: BuildMemoInput;
}): {
  contractAddress: Address;
  abiFunctionSignature: typeof ARC_MEMO_SIGNATURE;
  abiParameters: [Address, Hex, Hex, Hex];
  memoId: Hex;
  memoData: Hex;
  payload: PrestoMemoPayload;
} {
  const memo = buildPrestoMemo({ ...input.memo, target: input.target });
  return {
    contractAddress: ARC_MEMO_ADDRESS,
    abiFunctionSignature: ARC_MEMO_SIGNATURE,
    abiParameters: [input.target, input.data, memo.memoId, memo.memoData],
    memoId: memo.memoId,
    memoData: memo.memoData,
    payload: memo.payload,
  };
}

export function decodeMemoWrappedCall(data: Hex): { target: Address; data: Hex; memoId: Hex; memoData: Hex } | null {
  try {
    const decoded = decodeFunctionData({ abi: arcMemoAbi, data });
    if (decoded.functionName !== 'memo') return null;
    const [target, callData, memoId, memoData] = decoded.args;
    return { target, data: callData, memoId, memoData };
  } catch {
    return null;
  }
}
