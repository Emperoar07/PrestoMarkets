# Audit #1 — retire the PIN sign-in method

**Why:** A PIN user's identity was a caller-typed username (guessable). Circle's own docs state "a
PIN by itself does not verify user identity — authenticate with social login or email OTP first."
So a guessed username could mint another user's Circle `userToken` → Presto session
(social-identity impersonation; funds still need the PIN to sign). The secure methods (email OTP,
social, passkey) were always available; PIN was the outlier.

## Shipped (code)
- PIN removed from the sign-in UI (`WalletConnectButton`) — only Email / Passkey remain (Email is
  Circle's email-OTP flow; social also available).
- `loginWithCirclePin` throws "retired" — closes any programmatic caller.
- New PIN registration already blocked server-side: `createUser` is gated by
  `CIRCLE_PIN_FLOW_ENABLED` (false in prod). `session` (token renewal) stays open because
  email/social/passkey use it too.

## Operator step to FULLY close the source (recommended)
The above removes PIN from the app, but the Circle backend will still mint a `userToken` for an
existing PIN userId if called directly. To close that at the source:

1. Circle Developer Console → **Wallets → User-Controlled → Configuration** (authentication types).
2. **Disable the PIN authentication type** so Circle no longer issues sessions for PIN identities.
3. Existing PIN users re-onboard with **email OTP / social / passkey** — all Circle-authenticated,
   non-guessable. (A PIN wallet is a different Circle identity from an email one, so re-onboarding
   creates a fresh wallet; on testnet this is acceptable.)

The durable per-IP rate limit on the identity actions (12/min, cross-instance) remains as
defense-in-depth for the interim.
