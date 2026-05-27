# Presto Markets Contracts

These contracts are Phase 3 scaffolds for a public Arc Testnet market pilot.

## Current Scope

- Binary YES and NO markets
- USDC collateral
- Fixed share accounting
- Explicit resolver based settlement
- Canceled market refunds
- Resolution evidence URI
- Protocol fee scaffold with a 5 percent maximum
- Hardhat tests for market buying, settlement, claims, refunds, fees, factory creation, and owner controls

## V2 Multi Outcome Scaffold

- Two to twelve outcome fixed-share markets
- Outcome-specific share accounting
- Resolver settlement by outcome index
- Winner claims from the resolved collateral snapshot
- Canceled market refunds across every outcome
- Separate factory so the live binary factory can stay stable while V2 is tested

## Testing

```bash
npm run test:contracts
```

## Application Settlement Automation

Testnet agent-resolved markets can submit a resolution through their configured resolver when declared-source evidence is available and confident. If evidence is unavailable or inconclusive, the application leaves the market pending review rather than automatically canceling it. Optimistic challenges and bonds are required before this pattern is suitable for real value.

## Not Included Yet

- AMM pricing
- Order books
- Dispute windows
- Optimistic challenge and bonded dispute resolution
- USYC yield accounting
- Cross chain funding

## Safety Notes

The contracts should be audited before real value is used. The resolver is still trusted in this phase, and market metadata needs a durable storage plan before production deployment.
