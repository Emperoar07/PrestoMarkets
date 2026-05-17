# Presto Markets

Presto Markets is a public Arc Testnet market platform for predictions, opinions, and opportunity discovery.

Product line: > Your opinions. Your opportunities. Your predictions.

This repository is separate from Presto DEX. It keeps the same dark navy and cyan brand language, but the product is focused on markets 

## Arc Blueprint Positioning

Presto Markets follows the Arc prediction market blueprint. The goal is to make uncertainty tradable while keeping the experience grounded in USDC, predictable costs, fast settlement, and clear rules.

Core scope:

* USDC comes first as the market collateral.
* Markets should act as public signal infrastructure, not only betting flows.
* Small trades should feel practical because Arc uses stablecoin gas.
* Every market needs clear rules, a source of truth, resolver evidence, and an auditable result.
* EURC and other stable settlement paths can come later once the USDC version is safe.
* Higher trust civic, enterprise, and institutional markets should be possible later with stronger controls.

## Arc App Kit

Arc App Kit is product infrastructure for movement and funding rails. It can help with USDC sends, bridge flows, swap or funding flows, and unified balance later.

It does not replace the custom market contracts.

## Circle Product Rails

Current integration scope:

* USDC
* Contracts

Planned integration scope:

* Paymaster for USDC gas flows.
* Wallets for smoother onboarding.
* Bridge Kit and CCTP for cross chain USDC funding.
* Gateway for unified USDC balance once the account model is ready.

These planned rails should only be marked live after wallet, funding, and settlement flows are tested end to end.

## Arc MCP

Use Arc MCP for every Arc-specific design or implementation decision before making code changes.

MCP server:

```text
https://docs.arc.io/mcp
```

Setup guide:

```text
https://docs.arc.io/ai/mcp
```

Cursor config:

```json
{
  "mcpServers": {
    "arc-docs": {
      "url": "https://docs.arc.io/mcp"
    }
  }
}
```

VS Code config is checked into `.vscode/mcp.json`.

## Development

```bash
npm install
npm run dev
```

Contract tests:

```bash
npm run test:contracts
```

Deploy factory to Arc Testnet:

```bash
npm run deploy:arc
```

Copy `.env.example` to `.env.local` when deployment addresses are available.

Arc Testnet deployment:

```text
PrestoMarketFactory: 0xB5FA65ae7c76b2DeecA1906848e8805df6dCF807
USDC collateral: 0x3600000000000000000000000000000000000000
Deployment record: data/arc-testnet.json
```

## Safety Notes

* Keep V1 public only.
* Use USDC collateral first.
* Do not add USYC yield accounting until reward and redemption math is separately audited.
* Do not add autonomous AI resolution until resolver bonds, disputes, and failure paths are designed.
