import type { AppMarket } from './appState';

export type AgentResolutionOutcome = string;

export type AgentResolutionDraft = {
  market: AppMarket;
  outcome: AgentResolutionOutcome;
  confidence: string;
  evidenceNotes: string;
  evidenceSources: string;
  operator: string;
};

export const agentResolutionGuardrails = [
  'Use the written market rules and source of truth as the only settlement standard.',
  'Treat agent output as evidence preparation, not final authority.',
  'Prefer primary sources, durable URLs, timestamps, and reproducible observations.',
  'Do not resolve from sentiment, private claims, screenshots without source URLs, or incomplete data.',
  'Cancel instead of forcing YES or NO when the source of truth cannot support either outcome.',
];

export function buildAgentResolutionPrompt(market: AppMarket) {
  return [
    'You are assisting Presto Markets with a resolver evidence report.',
    'Do not settle the market yourself. Produce evidence only.',
    '',
    `Market: ${market.title}`,
    `Rules: ${market.rules}`,
    `Source of truth: ${market.sourceOfTruth}`,
    `Close: ${market.closeLabel}`,
    `Resolver: ${market.resolverAddress || market.resolver}`,
    '',
    'Return:',
    '1. Proposed outcome: YES, NO, or CANCEL.',
    '2. Primary source links used.',
    '3. Timestamped evidence summary.',
    '4. Why the evidence satisfies the written rules.',
    '5. Any uncertainty, missing data, or reason a human should not resolve yet.',
  ].join('\n');
}

export function buildAgentResolutionReport(input: AgentResolutionDraft) {
  const report = {
    schema: 'presto.agent-resolution.v1',
    generatedAt: new Date().toISOString(),
    poweredBy: 'Circle Agent Stack compatible evidence workflow',
    guardrails: agentResolutionGuardrails,
    market: {
      id: input.market.id,
      title: input.market.title,
      type: input.market.type,
      category: input.market.category,
      sourceOfTruth: input.market.sourceOfTruth,
      rules: input.market.rules,
      resolver: input.market.resolverAddress || input.market.resolver,
      chain: input.market.chain,
    },
    recommendation: {
      outcome: input.outcome,
      confidence: input.confidence,
      operator: input.operator || 'Presto resolver',
    },
    evidence: {
      notes: input.evidenceNotes.trim(),
      sources: input.evidenceSources
        .split('\n')
        .map((source) => source.trim())
        .filter(Boolean),
    },
    humanConfirmationRequired: true,
  };

  return {
    report,
    dataUri: `data:application/json,${encodeURIComponent(JSON.stringify(report))}`,
    pretty: JSON.stringify(report, null, 2),
  };
}
