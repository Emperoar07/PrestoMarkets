import { decodeFunctionData, encodeFunctionData, keccak256, stringToHex, type Address, type Hex } from 'viem';

export const ARC_MEMO_ADDRESS = '0x5294E9927c3306DcBaDb03fe70b92e01cCede505' as Address;
export const ARC_MEMO_SIGNATURE = 'memo(address,bytes,bytes32,bytes)' as const;

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
