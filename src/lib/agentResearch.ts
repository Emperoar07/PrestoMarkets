type TrendLike = {
  topic: string;
  query: string;
  source: string;
  url?: string;
  marketStructure?: 'price-range';
};

export type TrendResearchAssessment = {
  score: number;
  grade: 'strong' | 'standard' | 'thin' | 'weak';
  sourceAudit: string;
  requiredEvidence: string;
  researchPlan: string;
  referenceLessons: string[];
};

export type ResearchDecision = {
  action: 'Proceed' | 'Refine' | 'Pivot';
  oversight: 'full-auto' | 'gate-only' | 'skip';
  reason: string;
};

const REFERENCE_REPO_LESSONS = [
  'LangGraph: keep research, judgment, and execution as separate stateful stages with clear handoff data.',
  'Polymarket Agents: use RAG, news, web search, and market metadata as read-only context before drafting.',
  'PredictOS: synthesize multiple agent views into a bookmaker-style consensus before any high-impact action.',
  'OpenBB: prefer normalized data-provider outputs over raw scraped text for financial and macro questions.',
  'Crawlee: crawl narrowly, respect timeouts, and extract only the data needed for the decision.',
  'n8n: model agent work as auditable workflow nodes with explicit inputs, outputs, and failure states.',
  'Dr. Manhattan: use exchange-agnostic market models for inspiration, but keep authenticated trading adapters isolated.',
  'OctoBot: default to paper/simulated strategy reasoning before any real wallet or automated execution path.',
  'Polymarket CLOB clients: read-only market data is safe context; private-key trading code is out of scope for Presto market creation.',
  'Agent Switchboard: treat every external tool as a registry entry with category, access method, auth surface, and risk tier before wiring it in.',
  'AutoResearchClaw: use Proceed, Refine, or Pivot decisions so weak evidence becomes a retry or skip instead of a low-quality market.',
  'AutoResearchClaw: use targeted gate-only oversight at high-leverage moments instead of asking for step-by-step human approval.',
];

const TOOL_POLICY =
  'Tool policy: research, search, RAG, and market-metadata tools are read-only context; browser or computer-use tools require sandboxing and timeouts; wallet, payment, trading, and x402 tools require explicit spending policy and manual configuration; unknown auth metadata is treated as risky until verified.';

const DEBATE_ROLES =
  'Research debate roles: Pragmatist checks tradability and user demand; Skeptic checks ambiguity, manipulation, and weak sources; Methodologist checks close date, metric, and settlement evidence.';

function hostOf(value?: string) {
  if (!value) return '';
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function containsAny(value: string, words: string[]) {
  return words.some((word) => value.includes(word));
}

export function assessTrendResearchQuality(trend: TrendLike): TrendResearchAssessment {
  const topic = `${trend.topic} ${trend.query}`.toLowerCase();
  const host = hostOf(trend.url);
  const hasUrl = Boolean(host);
  const source = trend.source.toLowerCase();

  let score = hasUrl ? 62 : 32;
  let requiredEvidence = 'Use the original public article URL and one concrete source of truth the resolver can read.';
  let researchPlan = 'Summarize the claim, identify the resolving authority, then draft only if the outcome can be verified from a public URL.';

  if (trend.marketStructure === 'price-range' || containsAny(source, ['coingecko', 'coinmarketcap'])) {
    score = 92;
    requiredEvidence = 'Use the named price API or official price data endpoint, including the asset, quote currency, and observation time.';
    researchPlan = 'Treat the data-provider quote as the primary source, preserve the generated outcome ranges, and avoid editorial news as settlement evidence.';
  } else if (containsAny(source, ['sports', 'espn', 'livescore', 'thesportsdb'])) {
    score = 84;
    requiredEvidence = 'Use the league, team, fixture, or official scoreboard URL that reports the final result.';
    researchPlan = 'Confirm the teams, fixture date, and final-result source before choosing a short sports horizon.';
  } else if (containsAny(topic, ['sec', 'fed', 'cpi', 'inflation', 'court', 'lawsuit', 'regulator', 'approval', 'etf'])) {
    score = hasUrl ? 74 : 48;
    requiredEvidence = 'Prefer an official agency, court, regulator, exchange, or data-release URL over secondary commentary.';
    researchPlan = 'Separate secondary news momentum from the settlement source, then set a monthly-style horizon unless an official date exists.';
  } else if (containsAny(topic, ['earnings', 'revenue', 'stock', 'gdp', 'jobs report', 'unemployment'])) {
    score = hasUrl ? 72 : 45;
    requiredEvidence = 'Use a financial data provider, company investor-relations page, exchange filing, or official economic release.';
    researchPlan = 'Normalize the metric, threshold, and reporting date before drafting the market.';
  } else if (containsAny(source, ['grok', 'x-live', 'serper'])) {
    score = hasUrl ? 58 : 38;
    requiredEvidence = 'Convert social/search momentum into a primary source URL before deployment.';
    researchPlan = 'Use social or search as discovery only, then anchor settlement to official data, a reputable article, or a direct announcement.';
  } else if (containsAny(source, ['cointelegraph', 'decrypt', 'theblock', 'coindesk', 'bbc', 'techcrunch'])) {
    score = hasUrl ? 70 : 42;
    requiredEvidence = 'Use the article URL for context, and prefer a primary announcement URL when the article references one.';
    researchPlan = 'Extract the concrete claim, avoid vague sentiment, and keep the close date aligned with the event described by the source.';
  }

  const grade: TrendResearchAssessment['grade'] =
    score >= 80 ? 'strong' : score >= 65 ? 'standard' : score >= 50 ? 'thin' : 'weak';

  const sourceAudit = hasUrl
    ? `Source grade ${grade} (${score}/100). Trend URL host: ${host}.`
    : `Source grade ${grade} (${score}/100). Trend has no concrete URL yet.`;

  return {
    score,
    grade,
    sourceAudit,
    requiredEvidence,
    researchPlan,
    referenceLessons: REFERENCE_REPO_LESSONS,
  };
}

export function getResearchDecision(assessment: TrendResearchAssessment): ResearchDecision {
  if (assessment.score >= 85) {
    return {
      action: 'Proceed',
      oversight: 'full-auto',
      reason: 'Source quality is strong enough for autonomous drafting if the market rules stay precise.',
    };
  }

  if (assessment.score >= 65) {
    return {
      action: 'Proceed',
      oversight: 'gate-only',
      reason: 'Source quality is usable, but the drafter must preserve the required evidence and exact settlement metric.',
    };
  }

  if (assessment.score >= 50) {
    return {
      action: 'Refine',
      oversight: 'gate-only',
      reason: 'Evidence is thin, so convert discovery signal into a stronger primary source before deployment.',
    };
  }

  return {
    action: 'Pivot',
    oversight: 'skip',
    reason: 'Evidence is too weak for an onchain market; skip this candidate unless a concrete source appears.',
  };
}

export function formatResearchAssessment(assessment: TrendResearchAssessment, lessonLimit = 5) {
  const decision = getResearchDecision(assessment);
  return [
    assessment.sourceAudit,
    `Decision policy: ${decision.action} with ${decision.oversight} oversight. ${decision.reason}`,
    `Required evidence: ${assessment.requiredEvidence}`,
    `Research plan: ${assessment.researchPlan}`,
    TOOL_POLICY,
    DEBATE_ROLES,
    'Reference repo lessons:',
    ...assessment.referenceLessons.slice(0, lessonLimit).map((lesson) => `- ${lesson}`),
  ].join('\n');
}
