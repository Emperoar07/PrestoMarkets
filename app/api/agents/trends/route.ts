import { NextRequest, NextResponse } from 'next/server';
import { createMarketCategories } from '@/lib/categories';
import type { MarketType } from '@/lib/markets';

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
  const apiKey = req.headers.get('x-api-key');
  const validKey = process.env.PRESTO_AGENT_API_KEY;
  return Boolean(validKey && apiKey === validKey);
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

  return {
    type: 'Prediction',
    title: `Will this trend be confirmed by a primary source within 72 hours?`,
    description: `Agent-created market candidate based on public trend momentum: ${input.trendText.slice(0, 240)}`,
    category,
    rules: 'YES wins if the claim in the trend is confirmed by the listed source of truth before close. NO wins if it is contradicted or not confirmed before close. Cancel if the claim is ambiguous, unverifiable, or materially changes.',
    sourceOfTruth: input.trendUrl || 'Primary public sources linked from the trend, official announcements, or reputable public data sources.',
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
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MARKET_MODEL || 'gemini-1.5-flash' });
  const result = await model.generateContent([
    'Create one safe, objective binary prediction market from this trend.',
    'Return only JSON with: title, description, category, rules, sourceOfTruth, closeInHours, momentumScore, safetyScore, confidence, reason.',
    `Allowed categories: ${createMarketCategories.join(', ')}`,
    `Trend source: ${input.trendSource || 'X/public trend'}`,
    `Trend URL: ${input.trendUrl || 'none'}`,
    `Trend text: ${input.trendText}`,
  ].join('\n\n'));
  const text = result.response.text();
  const json = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  return JSON.parse(json) as GeminiMarketDraft;
}

async function classifyWithGroq(input: TrendRequest, draft: MarketDraft) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const { default: Groq } = await import('groq-sdk');
  const groq = new Groq({ apiKey });
  const completion = await groq.chat.completions.create({
    model: process.env.GROQ_MARKET_MODEL || 'llama-3.1-8b-instant',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: 'Score this prediction market candidate. Return only JSON with safetyScore, momentumScore, duplicateRisk, shouldCreate, reason.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          trend: input,
          draft: {
            title: draft.title,
            rules: draft.rules,
            sourceOfTruth: draft.sourceOfTruth,
          },
        }),
      },
    ],
  });
  const text = completion.choices[0]?.message?.content ?? '{}';
  return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text) as {
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
    const groq = await classifyWithGroq(input, draft);
    if (groq) {
      draft.agent = {
        ...draft.agent,
        agentReason: groq.reason || draft.agent.agentReason,
        momentumScore: clampScore(groq.momentumScore, draft.agent.momentumScore),
        safetyScore: clampScore(groq.safetyScore, draft.agent.safetyScore),
      };
    }
  } catch {
    // Groq is an optional second opinion; do not block fallback or Gemini drafts.
  }

  const shouldAutoCreate = draft.agent.momentumScore >= 70 && draft.agent.safetyScore >= 75;

  return NextResponse.json({
    ok: true,
    draft,
    shouldAutoCreate,
    next: {
      endpoint: '/api/agents/markets/create',
      method: 'POST',
      note: 'Submit this draft to create an agent-badged onchain market. No human approval required when shouldAutoCreate is true.',
    },
  });
}
