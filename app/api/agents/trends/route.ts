import { NextRequest, NextResponse } from 'next/server';
import { createMarketCategories } from '@/lib/categories';
import { verifyApiKey } from '@/lib/authCompare';
import type { MarketType } from '@/lib/markets';
import { callLlmJson, extractJsonObject } from '@/lib/llmFallback';
import { ARC_ECOSYSTEM_CONTEXT_SUMMARY, isArcCommunityContextUrl } from '@/lib/arcEcosystemContext';

type TrendRequest = {
  trendText: string;
  trendUrl?: string;
  trendSource?: string;
  category?: string;
};

type MarketDraft = {
  type: MarketType;
  title: string;
  description: string;
  category: string;
  rules: string;
  sourceOfTruth: string;
  closeInHours: number;
  agent: {
    agentName: string;
    agentSource: string;
    agentModel: string;
    agentReason: string;
    agentConfidence: string;
    trendSource: string;
    trendUrl?: string;
    momentumScore: number;
    safetyScore: number;
  };
};

type GeminiMarketDraft = Partial<MarketDraft> & {
  momentumScore?: number;
  safetyScore?: number;
  confidence?: string;
  reason?: string;
};

function requireAgentKey(req: NextRequest) {
  return verifyApiKey(req.headers.get('x-api-key'), process.env.PRESTO_AGENT_API_KEY);
}

function clampScore(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function isCreateMarketCategory(value: string | undefined): value is (typeof createMarketCategories)[number] {
  return Boolean(value && (createMarketCategories as readonly string[]).includes(value));
}

function fallbackDraft(input: TrendRequest): MarketDraft {
  const category = isCreateMarketCategory(input.category)
    ? input.category
    : 'Trending';
  const sourceOfTruth = input.trendUrl && !isArcCommunityContextUrl(input.trendUrl)
    ? input.trendUrl
    : 'Primary public sources linked from the trend, official announcements, or reputable public data sources.';

  return {
    type: 'Prediction',
    title: `Will this trend be confirmed by a primary source within 72 hours?`,
    description: `Agent-created market candidate based on public trend momentum: ${input.trendText.slice(0, 240)}`,
    category,
    rules: 'YES wins if the claim in the trend is confirmed by the listed source of truth before close. NO wins if it is contradicted or not confirmed before close. Cancel if the claim is ambiguous, unverifiable, or materially changes.',
    sourceOfTruth,
    closeInHours: 72,
    agent: {
      agentName: 'Presto Trend Agent',
      agentSource: 'X/Grok trend monitor',
      agentModel: 'Fallback rules engine',
      agentReason: 'Generated from submitted trend text because no configured AI provider returned a structured draft.',
      agentConfidence: 'Low',
      trendSource: input.trendSource || 'Submitted trend',
      trendUrl: input.trendUrl,
      momentumScore: 55,
      safetyScore: 60,
    },
  };
}

async function draftWithGemini(input: TrendRequest): Promise<GeminiMarketDraft | null> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;

  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MARKET_MODEL || 'gemini-2.5-flash',
    systemInstruction: 'You are a professional Presto Markets AI oracle. Your job is to analyze trends and output safe, objective binary prediction markets in structured JSON matching the requested schema.',
  });
  const result = await model.generateContent([
    'Create one safe, objective binary prediction market from this trend.',
    'Return only JSON with: title, description, category, rules, sourceOfTruth, closeInHours, momentumScore, safetyScore, confidence, reason.',
    `Arc ecosystem context: ${ARC_ECOSYSTEM_CONTEXT_SUMMARY}`,
    'If the trend URL is community.arc.io, treat it as ecosystem context only and choose a non-community sourceOfTruth before auto-creation.',
    `Allowed categories: ${createMarketCategories.join(', ')}`,
    `Trend source: ${input.trendSource || 'X/public trend'}`,
    `Trend URL: ${input.trendUrl || 'none'}`,
    `Trend text: ${input.trendText}`,
  ].join('\n\n'));
  const text = result.response.text();
  const json = text.match(/\{[\s\S]*\}/)?.at(0) ?? text;
  return JSON.parse(json) as GeminiMarketDraft;
}

async function classifyWithFallback(input: TrendRequest, draft: MarketDraft) {
  const prompt = [
    'Score this prediction market candidate.',
    'Return only JSON with safetyScore, momentumScore, duplicateRisk, shouldCreate, reason.',
    JSON.stringify({
      trend: input,
      arcContext: ARC_ECOSYSTEM_CONTEXT_SUMMARY,
      sourcePolicy: 'community.arc.io is ecosystem context only and must not be used as final settlement sourceOfTruth.',
      draft: {
        title: draft.title,
        rules: draft.rules,
        sourceOfTruth: draft.sourceOfTruth,
      },
    }),
  ].join('\n\n');

  const result = await callLlmJson({ task: 'safety', prompt, maxTokens: 256, temperature: 0 });
  return extractJsonObject(result.text) as {
    safetyScore?: number;
    momentumScore?: number;
    shouldCreate?: boolean;
    reason?: string;
  };
}

export async function POST(req: NextRequest) {
  if (!requireAgentKey(req)) {
    return NextResponse.json({ error: 'Unauthorized agent request' }, { status: 401 });
  }

  let input: TrendRequest;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!input.trendText?.trim()) {
    return NextResponse.json({ error: 'trendText is required' }, { status: 400 });
  }

  let draft = fallbackDraft(input);

  try {
    const gemini = await draftWithGemini(input);
    if (gemini?.title && gemini?.rules && gemini?.sourceOfTruth) {
      draft = {
        ...draft,
        title: String(gemini.title),
        description: String(gemini.description || draft.description),
        category: isCreateMarketCategory(String(gemini.category)) ? String(gemini.category) : draft.category,
        rules: String(gemini.rules),
        sourceOfTruth: String(gemini.sourceOfTruth),
        closeInHours: Number(gemini.closeInHours) || draft.closeInHours,
        agent: {
          ...draft.agent,
          agentModel: process.env.GEMINI_MARKET_MODEL || 'gemini-1.5-flash',
          agentReason: String(gemini.reason || draft.agent.agentReason),
          agentConfidence: String(gemini.confidence || 'Medium'),
          momentumScore: clampScore(gemini.momentumScore, draft.agent.momentumScore),
          safetyScore: clampScore(gemini.safetyScore, draft.agent.safetyScore),
        },
      };
    }
  } catch (error) {
    draft.agent.agentReason = `Gemini draft failed; fallback used. ${error instanceof Error ? error.message : ''}`.trim();
  }

  try {
    const score = await classifyWithFallback(input, draft);
    if (score) {
      draft.agent = {
        ...draft.agent,
        agentReason: score.reason || draft.agent.agentReason,
        momentumScore: clampScore(score.momentumScore, draft.agent.momentumScore),
        safetyScore: clampScore(score.safetyScore, draft.agent.safetyScore),
      };
    }
  } catch {
    // The second opinion is optional; do not block fallback or Gemini drafts.
  }

  const shouldAutoCreate = draft.agent.momentumScore >= 70 && draft.agent.safetyScore >= 75;
  const sourceNeedsPrimaryEvidence = isArcCommunityContextUrl(draft.sourceOfTruth);

  return NextResponse.json({
    ok: true,
    draft,
    shouldAutoCreate: shouldAutoCreate && !sourceNeedsPrimaryEvidence,
    next: {
      endpoint: '/api/agents/markets/create',
      method: 'POST',
      note: sourceNeedsPrimaryEvidence
        ? 'Arc community content is context only. Replace sourceOfTruth with an official, primary, or reputable news URL before creating.'
        : 'Submit this draft to create an agent-badged onchain market. No human approval required when shouldAutoCreate is true.',
    },
  });
}
