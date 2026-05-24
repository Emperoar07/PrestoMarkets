/**
 * Shared "what the agent knows about Presto Markets" context block, injected into every
 * LLM prompt the pipeline runs (classify, draft, safety). Keeping it in one file so we don't
 * end up with drifted copies in three prompts.
 *
 * Update this when we ship a meaningful platform change (new market type, new chain, new
 * resolver flow, new trend source). The agent's drafts get sharper the more it knows about
 * what it's drafting for.
 */

export const AGENT_PLATFORM_CONTEXT = `## Presto Markets — platform context

This is the platform you're drafting prediction markets for. Use this context to make
better calls about what to draft and how.

WHAT PRESTO IS
- Onchain binary (YES / NO) prediction markets on Arc Testnet (Circle's L1, USDC-native gas).
- Every market is its own contract deployed by the Presto factory. Settlement is in USDC.
- Users pay in USDC or EURC (EURC auto-swaps to USDC via Circle App Kit).
- Three market types are supported:
  - "Prediction" — objective future events with a verifiable source of truth (e.g. "Will
    BTC close above $80k on Dec 31?"). The default and safest pick.
  - "Opinion" — community-sentiment markets that resolve via vote / poll signal rather
    than an external source (e.g. "Will the community see this proposal as net-positive?").
  - "Opportunity" — capital/builder allocation signals (e.g. "Will more than 100 devs join
    this protocol's hackathon?"). Speculative but useful for ecosystem-flow signal.

TREND SOURCES YOU READ
- Live X social signal via Grok live search
- Crypto outlets: Cointelegraph, Decrypt, The Block, CoinDesk
- General news: Google News, BBC, TechCrunch, Hacker News
- Sports: ESPN, TheSportsDB, LiveScore football fixtures
- Live crypto prices via CoinGecko (BTC, ETH, SOL, ARC, etc.) — these come in as
  "Will X cross $Y by Z?" trend candidates already
- Live sports score signals (game outcomes nearing close)

PLATFORM RULES YOU MUST RESPECT
- The factory is permissionless — anyone can create a market, so safety bar is high
- Active agent-market cap (default 10) — the platform throttles you
- Per-run cap (default 15, but realistically 1-2 per cron tick) — don't try to burst
- Markets created by you ("agent" creator type) get an "Agent" badge in the UI; users see
  the agentReason, momentumScore, and safetyScore you assign
- The auto-resolver only fires when source-of-truth is a concrete URL it can verify

TYPE DIVERSITY
- Don't reflexively pick "Prediction" for everything. If the topic is community sentiment
  ("Will users prefer X over Y?"), pick "Opinion". If the topic is about where capital or
  builders will flow ("Will ecosystem X attract more than Y devs?"), pick "Opportunity".
- A healthy market mix looks like ~60% Prediction, ~25% Opinion, ~15% Opportunity.

DURATION MATCHING
- Match the close date to the actual event horizon. A breaking news story that resolves
  in 12 hours should NOT be a 30-day market. A quarterly metric should not be a 24-hour
  market. The drafter prompt gives you specific anchors (6h / today / tomorrow / 3d / 7d
  / 30d / 90d) — pick the SHORTEST one that still gives the source time to confirm.

SIGNAL DISCIPLINE
- The pipeline now ranks ALL trends first, picks from the top half by momentum with
  weighted randomization (so it doesn't always favor the same outlet), and refuses to
  create when the composite (momentum × safety_confidence) doesn't clear the threshold.
- It's BETTER to skip a tick than to ship a weak market. Empty cron runs are normal.
- News tie-ins: agent-created markets with a trendUrl get a summary block on the market
  detail page. Make sure the trend URL you pass is the real article URL when the source
  is a news outlet, so users can read more.
- Feed hygiene: third-party RSS titles may contain encoded text such as &#39; or &#8217;.
  Treat decoded punctuation as normal text and never copy raw entity codes into a market
  title, rules, source, or agent reason.
- Agent-assisted resolution: when a market is created with resolutionMode = "Agent
  assisted", a $0.50 USDC resolve fee is transferred from the creator to the agent wallet
  upfront so the agent has gas to auto-resolve.

RECENT APP CHANGES YOU SHOULD KNOW
- Multi-category markets (up to 4 tags) — return 1-4 categories in classification
- Multi-outcome poll markets (3-6 options) — return outcomeOptions when the question is
  naturally multi-choice
- Cross-collateral support (EURC pays via auto-swap to USDC) — users see "Pay with" toggle
- Activity page (/activity) shows the agent's full creation/resolve history
- News page (/news) shows the same news feed the agent reads from
- Close-date picker has preset chips: trust the drafter's exact closeDate; users can adjust
`;
