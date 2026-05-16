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

## Testing

```bash
npm run test:contracts
```

## Not Included Yet

- AMM pricing
- Order books
- Dispute windows
- Autonomous AI resolution
- USYC yield accounting
- Cross chain funding

## Safety Notes

The contracts should be audited before real value is used. The resolver is still trusted in this phase, and market metadata needs a durable storage plan before production deployment.
