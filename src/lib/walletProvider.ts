import { isStringArray, assertAddress } from './typeGuards';

export type WalletProviderMode = 'circle-user-controlled' | 'external-eoa';

export type ConnectedWallet = {
  address: string;
  mode: WalletProviderMode;
  walletId?: string;
  userId?: string;
};

const ARC_CHAIN_HEX = '0x4cef52';
const connectedWalletStorageKey = 'presto.connectedWallet';
const connectedWalletEventName = 'presto:wallet';
const pendingCircleSocialLoginKey = 'presto.circle.pendingSocialLogin';
export type CircleSession = {
  appId: string;
  userToken: string;
  encryptionKey: string;
  walletId: string;
  /** Stable Circle userId — lets us call POST /users/token to mint a fresh userToken without re-PIN. */
  userId?: string;
  /** Epoch ms when this userToken was issued. Tokens are hard-capped at 60min by Circle. */
  issuedAt?: number;
};

// Circle's userToken + encryptionKey grant impersonation against Circle's API for the user's
// wallet (subject to PIN), so any XSS that reads them lets an attacker drive contractExecution
// challenges. Holding the session in module-scoped memory (cleared on tab close, never
// serialized to storage) closes the steal-and-replay path. Trade-off: a hard reload signs the
// user out of Circle and they must re-authenticate. Acceptable.
let circleSessionRef: CircleSession | null = null;

// Hard-coded by Circle: userToken expires after 60 minutes. We refresh at 50 to leave headroom.
const USER_TOKEN_REFRESH_AT_MS = 50 * 60_000;

export function getCircleSession(): CircleSession | null {
  return circleSessionRef;
}

function setCircleSession(session: CircleSession | null) {
  circleSessionRef = session;
}

/**
 * If the current Circle session's userToken is older than ~50 minutes, mint a fresh one from
 * the stored userId so the user can keep transacting without re-signing in. Returns the
 * (possibly refreshed) session. If no userId is stored (older sessions before this field was
 * added) or the refresh call fails, returns null to force re-authentication.
 *
 * Includes 8-second timeout to prevent hanging on slow/unresponsive Circle API.
 */
export async function refreshCircleSessionIfNeeded(): Promise<CircleSession | null> {
  const current = circleSessionRef;
  if (!current) return null;
  const ageMs = current.issuedAt ? Date.now() - current.issuedAt : Infinity;
  if (ageMs < USER_TOKEN_REFRESH_AT_MS) return current;
  if (!current.userId) return current;

  try {
    // Add 8-second timeout to prevent hanging on slow/unresponsive Circle API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);

    try {
      const refreshed = await Promise.race([
        callCircleWalletProvider<CircleLoginResult>({
          action: 'session',
          userId: current.userId,
        }),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener('abort', () =>
            reject(new Error('Session refresh timeout after 8 seconds'))
          )
        ),
      ]);
      clearTimeout(timeoutId);

      if (refreshed?.userToken && refreshed.encryptionKey) {
        const next: CircleSession = {
          ...current,
          userToken: refreshed.userToken,
          encryptionKey: refreshed.encryptionKey,
          issuedAt: Date.now(),
        };
        setCircleSession(next);
        return next;
      }

      // Log incomplete response and clear session
      const { logger } = await import('./logger');
      logger.warn('circle-session', 'Session refresh returned incomplete response', {
        hasUserToken: !!refreshed?.userToken,
        hasEncryptionKey: !!refreshed?.encryptionKey,
      });
      setCircleSession(null);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    // Log failure but do NOT return stale token. Force re-authentication.
    const { logger } = await import('./logger');
    logger.warn('circle-session', 'Session refresh failed', {
      error: error instanceof Error ? error.message : String(error),
      ageMs: current.issuedAt ? Date.now() - current.issuedAt : 'unknown',
    });

    // Clear the session to force user to re-auth
    setCircleSession(null);
    return null;
  }
}

export type CircleSocialProvider = 'google';

export type CircleWalletLoginInput =
  | { method: 'email'; email: string }
  | { method: 'social'; provider: CircleSocialProvider }
  | { method: 'pin'; userId: string };

type CircleConfig = {
  appId: string;
  blockchain: string;
  accountType: string;
};

type CircleDeviceToken = {
  deviceToken: string;
  deviceEncryptionKey: string;
  otpToken?: string;
};

type CircleLoginResult = {
  userToken: string;
  encryptionKey: string;
  refreshToken?: string;
  userID?: string;
  userId?: string;
  oAuthInfo?: {
    socialUserInfo?: {
      email?: string;
    };
  };
};

type PendingCircleSocialLogin = CircleDeviceToken & {
  appId: string;
  blockchain: string;
  provider: CircleSocialProvider;
  redirectUri: string;
};

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getStoredConnectedWallet(): ConnectedWallet | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.localStorage.getItem(connectedWalletStorageKey);
    return stored ? JSON.parse(stored) as ConnectedWallet : null;
  } catch {
    return null;
  }
}

export function setStoredConnectedWallet(wallet: ConnectedWallet | null) {
  if (typeof window === 'undefined') return;

  if (wallet) {
    window.localStorage.setItem(connectedWalletStorageKey, JSON.stringify(wallet));
  } else {
    window.localStorage.removeItem(connectedWalletStorageKey);
  }

  window.dispatchEvent(new CustomEvent<ConnectedWallet | null>(connectedWalletEventName, { detail: wallet }));
}

export function subscribeConnectedWallet(listener: (wallet: ConnectedWallet | null) => void) {
  function handleWalletEvent(event: Event) {
    listener((event as CustomEvent<ConnectedWallet | null>).detail);
  }

  window.addEventListener(connectedWalletEventName, handleWalletEvent);
  return () => window.removeEventListener(connectedWalletEventName, handleWalletEvent);
}

async function ensureArc(provider: EthereumProvider) {
  const chainId = await provider.request({ method: 'eth_chainId' });

  if (chainId === ARC_CHAIN_HEX) {
    return;
  }

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ARC_CHAIN_HEX }],
    });
  } catch {
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: ARC_CHAIN_HEX,
        chainName: 'Arc Testnet',
        nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
        rpcUrls: [process.env.NEXT_PUBLIC_ARC_RPC_URL?.trim() || 'https://rpc.testnet.arc.network'],
      }],
    });
  }
}

export async function getExistingExternalWallet(): Promise<ConnectedWallet | null> {
  if (!window.ethereum) {
    return getStoredConnectedWallet();
  }

  const accountsRaw = await window.ethereum.request({ method: 'eth_accounts' });
  if (!isStringArray(accountsRaw) || accountsRaw.length === 0) {
    return getStoredConnectedWallet();
  }
  const address = assertAddress(accountsRaw[0]);

  return { address, mode: 'external-eoa' };
}

export async function disconnectExternalWallet() {
  if (!window.ethereum) {
    return;
  }

  try {
    await window.ethereum.request({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }],
    });
  } catch {
    // Some injected wallets do not expose programmatic disconnect.
  }

  setStoredConnectedWallet(null);
}

export async function connectOfficialWalletProvider(input?: CircleWalletLoginInput): Promise<ConnectedWallet> {
  const circleWallet = await connectCircleUserControlledWalletProvider(input);
  if (circleWallet) {
    setStoredConnectedWallet(circleWallet);
    return circleWallet;
  }

  const externalWallet = await connectExternalWalletProvider();
  setStoredConnectedWallet(externalWallet);
  return externalWallet;
}

export async function completePendingCircleSocialLogin(): Promise<ConnectedWallet | null> {
  if (typeof window === 'undefined' || !window.location.hash) {
    return null;
  }

  const pending = getPendingCircleSocialLogin();
  if (!pending) {
    return null;
  }

  try {
    const login = await runCircleSocialVerification(pending);
    const wallet = await finishCircleWalletLogin({
      config: {
        appId: pending.appId,
        blockchain: pending.blockchain,
        accountType: '',
      },
      login,
      userHint: login.userID || login.userId || login.oAuthInfo?.socialUserInfo?.email || pending.provider,
    });

    setStoredConnectedWallet(wallet);
    return wallet;
  } finally {
    window.sessionStorage.removeItem(pendingCircleSocialLoginKey);
  }
}

async function connectCircleUserControlledWalletProvider(input?: CircleWalletLoginInput): Promise<ConnectedWallet | null> {
  const enabled = process.env.NEXT_PUBLIC_CIRCLE_WALLETS_ENABLED === 'true';

  if (!enabled) {
    return null;
  }

  if (!input) {
    return null;
  }

  if (input.method === 'email') {
    const email = input.email.trim();
    if (!email) {
      throw new Error('Enter an email address to continue with Circle.');
    }

    return connectCircleEmailWallet(email);
  }

  if (input.method === 'social') {
    return connectCircleSocialWallet(input.provider);
  }

  const userId = input.userId.trim();

  if (!userId) {
    throw new Error('Enter a user ID or email to continue with Circle PIN.');
  }

  if (userId.length < 5) {
    throw new Error('Circle PIN user ID must be at least 5 characters.');
  }

  const config = await getCircleConfig();
  await callCircleWalletProvider({ action: 'createUser', userId });
  const session = await callCircleWalletProvider<CircleLoginResult>({ action: 'session', userId });

  return finishCircleWalletLogin({ config, login: session, userHint: userId });
}

async function connectCircleEmailWallet(email: string) {
  const config = await getCircleConfig();
  const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk');
  const deviceSdk = createStyledCircleSdk(new W3SSdk({ appSettings: { appId: config.appId } }));
  const deviceId = await deviceSdk.getDeviceId();
  const token = await callCircleWalletProvider<CircleDeviceToken>({
    action: 'deviceToken',
    loginMethod: 'email',
    email,
    deviceId,
  });
  const login = await runCircleEmailVerification(config.appId, token);

  return finishCircleWalletLogin({
    config,
    login,
    userHint: login.userID || login.userId || email,
  });
}

async function connectCircleSocialWallet(provider: CircleSocialProvider): Promise<ConnectedWallet> {
  const config = await getCircleConfig();
  const socialConfig = getCircleSocialConfig(provider);

  if (!socialConfig) {
    throw new Error(`${providerLabel(provider)} login needs its OAuth ID configured for Circle first.`);
  }

  const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk');
  const deviceSdk = createStyledCircleSdk(new W3SSdk({ appSettings: { appId: config.appId } }));
  const deviceId = await deviceSdk.getDeviceId();
  const token = await callCircleWalletProvider<CircleDeviceToken>({
    action: 'deviceToken',
    loginMethod: 'social',
    deviceId,
  });
  const pending: PendingCircleSocialLogin = {
    ...token,
    appId: config.appId,
    blockchain: config.blockchain,
    provider,
    redirectUri: socialConfig.redirectUri,
  };

  window.sessionStorage.setItem(pendingCircleSocialLoginKey, JSON.stringify(pending));

  const sdk = createStyledCircleSdk(new W3SSdk({
    appSettings: { appId: config.appId },
    loginConfigs: {
      ...token,
      ...socialConfig.loginConfigs,
    },
  }));

  await sdk.performLogin('Google' as Parameters<typeof sdk.performLogin>[0]);

  return new Promise<ConnectedWallet>(() => undefined);
}

async function finishCircleWalletLogin(input: {
  config: CircleConfig;
  login: CircleLoginResult;
  userHint: string;
}): Promise<ConnectedWallet> {
  let wallet = await getFirstCircleWallet(input.login.userToken, input.config.blockchain);

  if (!wallet) {
    const challenge = await callCircleWalletProvider<{ challengeId: string }>({
      action: 'initialize',
      userToken: input.login.userToken,
    });

    await executeCircleChallenge({
      appId: input.config.appId,
      userToken: input.login.userToken,
      encryptionKey: input.login.encryptionKey,
      challengeId: challenge.challengeId,
    });
    wallet = await getFirstCircleWallet(input.login.userToken, input.config.blockchain);
  }

  if (!wallet?.address) {
    throw new Error('Circle User-Controlled Wallets did not return an Arc wallet address.');
  }

  setCircleSession({
    appId: input.config.appId,
    userToken: input.login.userToken,
    encryptionKey: input.login.encryptionKey,
    walletId: wallet.id,
    userId: input.login.userID || input.login.userId || input.userHint,
    issuedAt: Date.now(),
  });

  return {
    address: wallet.address,
    walletId: wallet.id,
    userId: input.userHint,
    mode: 'circle-user-controlled',
  };
}

async function getCircleConfig() {
  return callCircleWalletProvider<CircleConfig>({ action: 'config' });
}

async function callCircleWalletProvider<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/circle/wallet/provider', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as { error?: string; message?: string } | T | null;

  if (!response.ok) {
    const errorData = data as { error?: string; message?: string } | null;
    throw new Error(errorData?.error || errorData?.message || 'Circle User-Controlled Wallet provider failed.');
  }

  return data as T;
}

async function getFirstCircleWallet(userToken: string, blockchain: string) {
  const data = await callCircleWalletProvider<{ wallets?: Array<{ id: string; address: string; blockchain?: string }> }>({
    action: 'wallets',
    userToken,
  });
  const wallets = data.wallets || [];

  return wallets.find((wallet) => wallet.blockchain === blockchain) || wallets[0] || null;
}

async function executeCircleChallenge(input: {
  appId: string;
  userToken: string;
  encryptionKey: string;
  challengeId: string;
}) {
  const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk');
  const sdk = createStyledCircleSdk(new W3SSdk({
    appSettings: { appId: input.appId },
  }));

  // The Circle Web SDK requires a device session before executing wallet
  // challenges, even when the user has already completed email/social/PIN auth.
  await sdk.getDeviceId();
  sdk.setAuthentication({
    userToken: input.userToken,
    encryptionKey: input.encryptionKey,
  });

  await new Promise<void>((resolve, reject) => {
    sdk.execute(input.challengeId, (error) => {
      if (error) {
        reject(new Error(error.message || 'Circle wallet challenge failed.'));
        return;
      }

      resolve();
    });
  });
}

async function runCircleEmailVerification(appId: string, token: CircleDeviceToken) {
  const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk');

  return new Promise<CircleLoginResult>((resolve, reject) => {
    const sdk = createStyledCircleSdk(new W3SSdk({
      appSettings: { appId },
      loginConfigs: token,
    }, (error, result) => {
      if (error) {
        reject(new Error(error.message || 'Circle email verification failed.'));
        return;
      }

      if (!result?.userToken || !result.encryptionKey) {
        reject(new Error('Circle email verification did not return a user session.'));
        return;
      }

      resolve(result as CircleLoginResult);
    }));

    sdk.verifyOtp();
  });
}

async function runCircleSocialVerification(pending: PendingCircleSocialLogin) {
  const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk');
  const socialConfig = getCircleSocialConfig(pending.provider, pending.redirectUri);

  if (!socialConfig) {
    throw new Error(`${providerLabel(pending.provider)} login needs its OAuth ID configured for Circle first.`);
  }

  return new Promise<CircleLoginResult>((resolve, reject) => {
    createStyledCircleSdk(new W3SSdk({
      appSettings: { appId: pending.appId },
      loginConfigs: {
        deviceToken: pending.deviceToken,
        deviceEncryptionKey: pending.deviceEncryptionKey,
        ...socialConfig.loginConfigs,
      },
    }, (error, result) => {
      if (error) {
        reject(new Error(error.message || 'Circle social login failed.'));
        return;
      }

      if (!result?.userToken || !result.encryptionKey) {
        reject(new Error('Circle social login did not return a user session.'));
        return;
      }

      resolve(result as CircleLoginResult);
    }));
  });
}

function createStyledCircleSdk<T extends {
  setThemeColor: (theme: Record<string, unknown>) => void;
  setLocalizations: (localizations: Record<string, unknown>) => void;
}>(sdk: T) {
  sdk.setThemeColor({
    bg: '#0f172a',
    divider: '#243047',
    textMain: '#f8fafc',
    textMain2: '#e2e8f0',
    textAuxiliary: '#94a3b8',
    textAuxiliary2: '#64748b',
    textInteractive: '#25c0f4',
    inputBg: '#101a2c',
    inputText: '#f8fafc',
    inputBorderFocused: '#25c0f4',
    mainBtnBg: '#25c0f4',
    mainBtnBgOnHover: '#46d2ff',
    mainBtnText: '#090e1a',
    secondBtnText: '#f8fafc',
    secondBtnBorder: '#243047',
    titleGradients: ['#f8fafc', '#25c0f4'],
  });
  sdk.setLocalizations({
    emailOtp: {
      title: 'Verify your email',
      subtitle: 'Enter the code Circle sent to continue into Presto Markets.',
      resendHint: 'Did not get the code?',
      resend: 'Send again',
    },
    initPincode: {
      headline: 'Create your wallet PIN',
      subhead: 'Circle keeps your keyshare on your device.',
    },
    securityIntros: {
      headline: 'Secure your wallet recovery',
      description: 'These answers help recover access if your PIN is lost.',
    },
  });

  return sdk;
}

function getCircleSocialConfig(provider: CircleSocialProvider, redirectUri = getCircleSocialRedirectUri()) {
  const clientId = process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_CLIENT_ID;
  return clientId ? {
    redirectUri,
    loginConfigs: {
      google: {
        clientId,
        redirectUri,
        selectAccountPrompt: true,
      },
    },
  } : null;
}

function getCircleSocialRedirectUri() {
  if (typeof window === 'undefined') {
    return '';
  }

  return process.env.NEXT_PUBLIC_CIRCLE_SOCIAL_REDIRECT_URI || `${window.location.origin}${window.location.pathname}`;
}

function getPendingCircleSocialLogin() {
  try {
    const stored = window.sessionStorage.getItem(pendingCircleSocialLoginKey);
    return stored ? JSON.parse(stored) as PendingCircleSocialLogin : null;
  } catch {
    return null;
  }
}

function providerLabel(provider: CircleSocialProvider) {
  return 'Google';
}

async function connectExternalWalletProvider(): Promise<ConnectedWallet> {
  if (!window.ethereum) {
    throw new Error('Circle User-Controlled Wallets are not configured and no browser wallet was found.');
  }

  const accountsRaw = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!isStringArray(accountsRaw) || accountsRaw.length === 0) {
    throw new Error('No wallet account was returned.');
  }
  const address = assertAddress(accountsRaw[0]);

  await ensureArc(window.ethereum);

  return { address, mode: 'external-eoa' };
}

// Testing helper - not used in production
export function setCircleSessionForTesting(session: CircleSession | null) {
  circleSessionRef = session;
}
