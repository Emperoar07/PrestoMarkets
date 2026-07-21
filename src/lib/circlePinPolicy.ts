// Fail-closed gate for the Circle PIN/userToken identity path (audit finding #1).
//
// Circle user-controlled wallets can't produce an ECDSA signature, so Presto verifies ownership
// by resolving a caller-supplied `userToken` to the wallets it controls. That is a challenge-
// session token, not proof of identity on its own: obtaining a userToken for a *known* app userId
// (e.g. an email) is enough to enumerate that user's wallets and claim a Presto session WITHOUT
// the PIN. Until that path is hardened (bind to a pre-verified session + OTP), this flow must be
// OFF in production unless the operator explicitly opts in, while staying usable locally.
export function isCirclePinFlowEnabled(input: { nodeEnv?: string; configured?: string }): boolean {
  if (input.nodeEnv === 'production') {
    return input.configured === 'true';
  }
  return true;
}
