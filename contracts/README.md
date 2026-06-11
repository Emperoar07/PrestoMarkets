# Presto Markets Contracts

These contracts power prediction markets on Arc Testnet. They are production-ready for testnet use but not yet audited for mainnet deployment.

## Binary Market Contract

The core binary YES/NO market contract handles:

- Share accounting for two outcomes.
- USDC collateral deposits and claims.
- Explicit resolver-based settlement: the resolver chooses which outcome wins.
- Optimistic proposal path: the resolver can propose an outcome, anyone can dispute during the challenge window, and undisputed proposals can settle after the window.
- Canceled market refunds: if a market is canceled before resolution, everyone gets their collateral back.
- Resolution evidence URIs: resolvers attach evidence links to their resolution onchain.
- Fixed-share quote preview: contracts expose the current implied probability and parimutuel payout estimate for a potential buy.
- Protocol fees: a 5 percent maximum fee on claims (configurable by owner).
- Hardhat test coverage: buying, selling, settlement, claims, refunds, fee routing, factory creation, owner controls.

## Multi Outcome Market Contract

The V2 scaffold supports 2 to 12 outcomes per market:

- Outcome-specific share accounting: each outcome has its own balance.
- Resolver-based settlement by outcome index, plus the same optimistic proposal and dispute affordances as the binary market.
- Winner claims from the resolved collateral snapshot: claims are calculated at resolution time.
- Canceled market refunds across all outcomes: everyone is refunded pro rata.
- Fixed-share quote preview for every outcome.
- Separate factory: the multi-outcome factory is separate from the binary factory, so live binary markets stay stable while we test V2.

## Building and Testing

```bash
# Install dependencies
npm install

# Run contract tests
npm run test:contracts

# Build contracts
npm run build:contracts
```

All contracts are written in Solidity and compiled with Hardhat. Tests run against a local hardhat network. Gas costs are benchmarked but not optimized yet.

## Agent-Assisted Settlement

Agent-resolved testnet markets can submit a resolution through their registered resolver when declared-source evidence is available and meets the confidence threshold. Resolvers can now use the optimistic proposal flow so users have a challenge window before an undisputed proposal settles. If evidence is missing or inconclusive, the application leaves the market pending review rather than automatically canceling it.

This is safe for testnet because:

- The resolver is still trusted for proposing outcomes; disputes pause settlement but do not yet escalate to a bonded oracle.
- Testnet USDC has no real value.
- Users understand that markets can remain pending indefinitely.

Before mainnet, we need bonded disputes and an external oracle such as UMA so malicious proposals can be economically punished and escalated.

## What's Not Here Yet

These features are planned but not yet implemented:

- **AMM pricing models** for automated market maker curves.
- **Order books** for limit orders and matching engines.
- **Bonded optimistic challenges** so resolver decisions can be appealed beyond the local challenge-window flag.
- **USYC yield accounting** for yield-bearing stablecoins.
- **Cross-chain funding** via Circle Gateway.

## Security and Testnet Status

The contracts are safe for testnet use. Before any mainnet deployment:

- Full security audit by a professional firm.
- Third-party code review.
- Resolver registration and reputation tracking.
- Market metadata durability plan (IPFS or on-contract storage).
- Governance setup for protocol parameters.

For testnet, resolvers are trusted addresses managed by the Presto team. Market creators choose their resolver at creation time. The Presto agent resolver is configured at deploy time and can be updated by the contract owner.
