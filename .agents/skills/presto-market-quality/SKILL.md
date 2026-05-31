---
name: presto-market-quality
description: Review and harden Presto Markets agent-created market ideas, drafts, and pipeline changes. Use when evaluating whether a market is good, fixing bad agent markets, editing src/lib/agentPipeline.ts or src/lib/agentContext.ts, or checking title, category, source, close-date, image, and resolution-rule quality.
---

# Presto Market Quality

## Purpose

Use this skill before approving, creating, or patching agent-created markets. The goal is to prevent headline-copy markets, stale already-resolved events, bad categories, broken sources, and vague settlement rules.

## Market Decision Workflow

1. Identify the actual unresolved event.
   - If the article already says the lawsuit, filing, launch, resumption, announcement, or investment plan happened, do not create a market asking whether it happened.
   - Reframe only if there is a clear future milestone, such as approval, construction start, court ruling, funding close, shipped capacity, official game result, or stated metric threshold.
   - Skip the trend when no future milestone exists.

2. Classify the market type honestly.
   - Use `Prediction` for legal, regulatory, corporate-action, investment-plan, sports-result, launch, price, and measurable external outcomes.
   - Use `Opinion` only for community sentiment, preference, public choice, or ecosystem-direction questions.
   - Never label objective news as `Opinion` to force variety.

3. Check the title.
   - Good titles ask a future, measurable question: `Will SoftBank begin construction on its French AI data center project by Dec 31, 2026?`
   - Reject titles like `Will SEC sues...`, `Will SoftBank says...`, `Will company announced...`, `Did...`, `Has...`, or copied headlines.
   - Keep titles under 90 characters when possible and remove raw classifier labels.

4. Check categories.
   - Use clean categories only: `Crypto`, `BTC`, `ETH`, `SOL`, `POL`, `Sports`, `Football`, `Basketball`, `DeFi`, `AI`, `Politics`, `Tech`, `Markets`, `Arc`, `Web3`, `Finance`, `Geopolitics`, `Culture`, `Economy`, `Weather`, `Elections`.
   - Remove `primary`, `secondary`, `trending`, `new`, `all`, and pipe-combined labels such as `Crypto|DeFi`.

5. Check settlement.
   - The source of truth must be a concrete public `http` or `https` URL.
   - Rules must say what YES wins on, what NO wins on, the deadline, and what happens if the source never confirms the claim.
   - For sports, prefer official league, ESPN, TheSportsDB, or other score/provider pages and close near the fixture or decision window.

6. Check presentation.
   - Every agent market needs an `imageURI`: source image first, generated fallback second.
   - Agent rationale should be short paragraph-style reasoning, not pipe-separated audit logs.
   - Do not reintroduce Arc Testnet, liquidity, gas, chain, or resolver plumbing as user-facing prose.

## Pipeline Patch Checklist

When editing `src/lib/agentPipeline.ts` or `src/lib/agentContext.ts`:

- Add deterministic guards for repeated failure classes instead of relying only on prompt wording.
- Keep `agentContext.ts` updated with meaningful product behavior changes that affect agent reasoning.
- Preserve the safety gate, research gate, duplicate check, source URL check, and composite signal check.
- Run `npm.cmd run typecheck` before claiming completion.

## Quick Verdict Labels

- `Good`: future event, clear source, correct type, clean title, concrete rules, useful image.
- `Needs reframing`: real topic but currently asks about a thing already reported or uses a weak headline hook.
- `Skip`: no unresolved public milestone or source cannot settle it.
- `Bug`: bad category leakage, broken image behavior, malformed grammar, wrong market type, or stale close horizon.
