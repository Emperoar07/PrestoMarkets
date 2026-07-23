# Audit #3 — separate dispute proposer from adjudicator (ready-to-deploy branch)

**Branch:** `feat/dispute-adjudicator-separation`
**Status:** reviewed, NOT deployed. Merging to `main` alone changes nothing on-chain — the fix takes
effect only for markets deployed from the new bytecode.

## The fix (minimal, no new role)
The market already has two immutable roles: `resolver` (the agent that proposes outcomes) and
`guardian` (the factory owner / deployer). Before, `resolveDisputed` was gated on `resolver`, so the
same party proposed an outcome AND judged the dispute against it — not independent arbitration.

Change: `resolveDisputed` now requires `guardian` (`contracts/PrestoLmsrMarket.sol`). Since the
factory sets `guardian = owner` (the deployer `0x659e…`) and the agent-resolver is a different key
(`0x3f95…`), the proposer and adjudicator are now distinct with no constructor/factory change.

The resolver code (`agentResolveDisputedV3`) tries the **guardian** key first and falls back to the
**agent** key on `NotGuardian`, so a mixed fleet (old resolver-gated markets + new guardian-gated
markets) both keep settling during the transition.

## Deploy steps (operator)
1. `GUARDIAN_PRIVATE_KEY` must be set in the runtime env (deployer key) — the resolver uses it to
   adjudicate. It already exists for pause/unpause.
2. Compile + deploy a fresh LMSR factory from this branch:
   `npx hardhat run scripts/deploy-lmsr.cjs --network arc` (or the existing deploy script).
3. Verify the new market bytecode on arcscan (`npx hardhat verify …`).
4. Point the app at the new factory: update `NEXT_PUBLIC_LMSR_MARKET_FACTORY_ADDRESS`
   (and EURC equivalent) to the new address, then redeploy the app.
5. Existing markets keep their old bytecode (agent adjudicates via the fallback); only NEW markets
   use guardian-adjudication. Old markets age out naturally.

## Risk
- Deploys new fund-holding contracts — test on Arc testnet first (create a market, propose, dispute,
  resolveDisputed as guardian, verify bond transfer).
- If `GUARDIAN_PRIVATE_KEY` is missing at runtime, new-market dispute resolution fails until it is
  set — the fallback to the agent key won't help because new bytecode rejects the agent.
