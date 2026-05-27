# Presto Markets Production Hardening

This checklist is the safety gate before Presto Markets moves beyond Arc testnet value. It is intentionally conservative.

## Current Contract Scope

The current protocol is a fixed-share USDC market with binary V1 and multi-outcome V2 factories on Arc Testnet.

Live scope:

* Users buy fixed outcome shares before close.
* A configured resolver resolves the market after close with an evidence URI.
* Winners claim from the resolved collateral snapshot.
* The resolver can cancel after close and users can refund.
* Separate binary and multi-outcome factories create markets and control fee settings.
* Agent-resolved testnet markets may resolve automatically only when live evidence clears the configured confidence threshold.
* Automatic resolution fails closed: missing or inconclusive evidence never triggers an automatic cancel.

Not live:

* AMM pricing.
* Selling positions.
* Optimistic challenge and bonded dispute resolution.
* Disputes and bonds.
* USYC yield accounting.
* Multicurrency settlement.

## Audit Notes

Review these before any real-value deployment:

* Fixed-share accounting: confirm claim math, refund math, fee math, rounding, and resolved collateral snapshot behavior.
* Resolver authority: confirm only the configured resolver can resolve or cancel and that resolver key custody is acceptable.
* Timing assumptions: confirm close-time behavior, late buys, settlement timing, and cancellation timing.
* Factory controls: confirm owner powers, fee recipient changes, fee caps, and ownership transfer process.
* Token assumptions: confirm the selected USDC contract decimals, allowance behavior, transfer behavior, and any blacklist or paused-token risk.
* Metadata assumptions: confirm market metadata, rules, source of truth, image URI, and resolution evidence URI standards.
* Event coverage: confirm indexers can reconstruct creation, buys, resolution, claims, refunds, and cancellations.

## Failure Paths To Design

Do not launch real-value markets until these are defined:

* Resolver unavailable: decide whether markets can be extended, canceled, reassigned, or escalated.
* Resolver compromised: define emergency pause, owner response, and communication procedure.
* Ambiguous outcome: define cancellation, dispute, or human review rules.
* Evidence dispute: define challenge window, evidence format, review authority, and final result timing.
* Evidence provider unavailable: preserve the market state for retry or manual review; do not cancel due to an outage.
* Bad market creation: define invalid market criteria, duplicate handling, and user warning rules.
* Indexing failure: define how the UI behaves when logs are incomplete or RPC reads fail.
* Token transfer failure: define allowance, insufficient balance, paused token, and rejected transfer messaging.

## Dispute And Bond Design Placeholder

This is not implemented yet. A safe design should answer:

* Who can dispute a resolution?
* What bond does the resolver post?
* What bond does a challenger post?
* How long is the challenge window?
* Who decides the final outcome?
* What happens to bonds after correct, incorrect, or spam disputes?
* How are users refunded if the market cannot be settled safely?

## Arc-Specific Operating Assumption

Arc provides EVM compatibility, USDC-denominated gas, and deterministic finality. Once a transaction is final, the app should treat settlement as irreversible. That makes pre-settlement rule clarity, resolver evidence, and failure-path design more important than post-facto rollback logic.

## Release Gate

Before real-value markets:

* Contract audit notes are reviewed.
* Resolver operations are documented.
* Dispute and bond design is approved or explicitly deferred with strict market limits.
* Account activity indexing is persistent enough for user support.
* A fresh Arc deployment record is committed.
* The production deployment is refreshed after env changes.
* Automated resolution remains testnet-only until a challenge process is implemented.
