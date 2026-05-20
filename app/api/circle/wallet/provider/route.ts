import { NextResponse } from 'next/server';

function envClean(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

const circleBaseUrl = envClean('CIRCLE_BASE_URL', 'https://api.circle.com');

const rateLimitWindow = 60_000;
const rateLimitMax = 20;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + rateLimitWindow });
    if (rateLimitStore.size > 10_000) {
      for (const [key, val] of rateLimitStore) {
        if (now > val.resetAt) rateLimitStore.delete(key);
      }
    }
    return true;
  }
  if (entry.count >= rateLimitMax) return false;
  entry.count++;
  return true;
}
const arcWalletBlockchain = envClean('CIRCLE_WALLET_BLOCKCHAIN', 'ARC-TESTNET');
const arcWalletAccountType = envClean('CIRCLE_WALLET_ACCOUNT_TYPE', 'SCA');

type CircleAction =
  | 'config'
  | 'createUser'
  | 'deviceToken'
  | 'session'
  | 'initialize'
  | 'wallets'
  | 'contractExecution'
  | 'getTransaction'
  | 'findTransactionByChallenge';

type CircleRequestBody = {
  action?: CircleAction;
  userId?: string;
  userToken?: string;
  deviceId?: string;
  email?: string;
  loginMethod?: 'email' | 'social';
  walletId?: string;
  contractAddress?: string;
  abiFunctionSignature?: string;
  abiParameters?: unknown[];
  amount?: string;
  feeLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  refId?: string;
  transactionId?: string;
};

type CircleErrorBody = {
  error?: string;
  message?: string;
  code?: string | number;
  errors?: Array<{ message?: string; error?: string; code?: string | number }>;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeCircleError(data: unknown, fallback: string) {
  if (!data || typeof data !== 'object') {
    return fallback;
  }

  const body = data as CircleErrorBody;
  const nestedError = body.errors?.find((item) => item.message || item.error);
  const message = body.message || body.error || nestedError?.message || nestedError?.error || fallback;
  const code = body.code || nestedError?.code;

  return code ? `${message} (${code})` : message;
}

function requireCircleConfig() {
  const apiKey = envClean('CIRCLE_API_KEY');
  const appId = envClean('NEXT_PUBLIC_CIRCLE_APP_ID');

  if (envClean('NEXT_PUBLIC_CIRCLE_WALLETS_ENABLED') !== 'true') {
    throw new Error('Circle User-Controlled Wallets are not enabled for this deployment.');
  }

  if (!apiKey) {
    throw new Error('CIRCLE_API_KEY is required for Circle User-Controlled Wallets.');
  }

  if (!appId) {
    throw new Error('NEXT_PUBLIC_CIRCLE_APP_ID is required for Circle User-Controlled Wallets.');
  }

  return { apiKey, appId };
}

async function circleFetch(path: string, input: RequestInit & { userToken?: string } = {}) {
  const { apiKey } = requireCircleConfig();
  const headers = new Headers(input.headers);

  headers.set('Authorization', `Bearer ${apiKey}`);
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');

  if (input.userToken) {
    headers.set('X-User-Token', input.userToken);
  }

  const response = await fetch(`${circleBaseUrl}${path}`, {
    ...input,
    headers,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return jsonError(normalizeCircleError(data, 'Circle wallet request failed.'), response.status);
  }

  return NextResponse.json(data.data ?? data, { status: response.status });
}

export async function POST(request: Request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  if (!checkRateLimit(ip)) {
    return jsonError('Too many requests. Please try again later.', 429);
  }

  try {
    const body = await request.json().catch(() => ({})) as CircleRequestBody;
    const action = body.action || 'config';

    if (action === 'config') {
      const { appId } = requireCircleConfig();
      return NextResponse.json({
        appId,
        blockchain: arcWalletBlockchain,
        accountType: arcWalletAccountType,
      });
    }

    if (action === 'createUser') {
      if (!body.userId) return jsonError('userId is required.');

      const response = await fetch(`${circleBaseUrl}/v1/w3s/users`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${requireCircleConfig().apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ userId: body.userId }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok && response.status !== 409) {
        return jsonError(normalizeCircleError(data, 'Circle user creation failed.'), response.status);
      }

      return NextResponse.json(data.data ?? { userId: body.userId });
    }

    if (action === 'session') {
      if (!body.userId) return jsonError('userId is required.');

      return circleFetch('/v1/w3s/users/token', {
        method: 'POST',
        body: JSON.stringify({
          userId: body.userId,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
    }

    if (action === 'deviceToken') {
      if (!body.deviceId) return jsonError('deviceId is required.');

      const isEmailLogin = body.loginMethod === 'email';
      if (isEmailLogin && !body.email) return jsonError('email is required for email login.');

      return circleFetch(isEmailLogin ? '/v1/w3s/users/email/token' : '/v1/w3s/users/social/token', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          deviceId: body.deviceId,
          ...(isEmailLogin ? { email: body.email } : {}),
        }),
      });
    }

    if (action === 'initialize') {
      if (!body.userToken) return jsonError('userToken is required.');

      return circleFetch('/v1/w3s/user/initialize', {
        method: 'POST',
        userToken: body.userToken,
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          accountType: arcWalletAccountType,
          blockchains: [arcWalletBlockchain],
          metadata: [{
            name: 'Presto Markets',
            refId: 'presto-markets',
          }],
        }),
      });
    }

    if (action === 'wallets') {
      if (!body.userToken) return jsonError('userToken is required.');

      return circleFetch('/v1/w3s/wallets', {
        method: 'GET',
        userToken: body.userToken,
      });
    }

    if (action === 'contractExecution') {
      if (!body.userToken) return jsonError('userToken is required.');
      if (!body.walletId) return jsonError('walletId is required.');
      if (!body.contractAddress) return jsonError('contractAddress is required.');
      if (!body.abiFunctionSignature) return jsonError('abiFunctionSignature is required.');

      // Circle's user-controlled contractExecution requires fee as { type: 'level', config: { feeLevel } }.
      // A bare feeLevel string is rejected with 400.
      return circleFetch('/v1/w3s/user/transactions/contractExecution', {
        method: 'POST',
        userToken: body.userToken,
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          walletId: body.walletId,
          contractAddress: body.contractAddress,
          abiFunctionSignature: body.abiFunctionSignature,
          abiParameters: body.abiParameters ?? [],
          ...(body.amount ? { amount: body.amount } : {}),
          fee: { type: 'level', config: { feeLevel: body.feeLevel ?? 'MEDIUM' } },
          ...(body.refId ? { refId: body.refId } : {}),
        }),
      });
    }

    if (action === 'getTransaction') {
      if (!body.userToken) return jsonError('userToken is required.');
      if (!body.transactionId) return jsonError('transactionId is required.');

      return circleFetch(`/v1/w3s/transactions/${encodeURIComponent(body.transactionId)}`, {
        method: 'GET',
        userToken: body.userToken,
      });
    }

    if (action === 'findTransactionByChallenge') {
      if (!body.userToken) return jsonError('userToken is required.');
      if (!body.walletId) return jsonError('walletId is required.');
      // Circle's contractExecution endpoint returns only challengeId. The transactionId is
      // obtained by listing the wallet's recent transactions; the latest INITIATED/PENDING
      // entry matching this challengeId is the one we just created.
      return circleFetch(`/v1/w3s/transactions?walletIds=${encodeURIComponent(body.walletId)}&pageSize=5`, {
        method: 'GET',
        userToken: body.userToken,
      });
    }

    return jsonError(`Unknown Circle wallet action: ${action}`);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Circle wallet request failed.', 501);
  }
}
