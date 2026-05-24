import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildAgentResolutionReport } from '@/lib/agentResolution';
import type { AppMarket } from '@/lib/appState';

// Rate-limit: 10 requests / 5 min per IP
const rl = new Map<string, { count: number; resetAt: number }>();
function rateLimit(ip: string) {
  const now = Date.now();
  const entry = rl.get(ip);
  if (entry && now < entry.resetAt) {
    if (entry.count >= 10) return false;
    entry.count++;
  } else {
    rl.set(ip, { count: 1, resetAt: now + 300_000 });
  }
  if (rl.size > 2000) rl.clear();
  return true;
}

const SYSTEM_PROMPT = `You are Presto Markets' resolution oracle — an AI agent that researches prediction market questions and produces evidence reports. Your job is evidence preparation only; you never settle a market yourself.

Rules you must follow:
- Only use publicly verifiable primary sources (news, official stats, on-chain data).
- Do not invent sources. If uncertain, say so and recommend CANCEL.
- Return a structured JSON report with fields: outcome, confidence, sources, evidenceSummary, uncertainty.
- outcome must be exactly "YES", "NO", or "CANCEL".
- confidence must be "High", "Medium", or "Low".`;

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!rateLimit(ip)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const agentKey = req.headers.get('x-api-key');
  const validKey = process.env.PRESTO_AGENT_API_KEY;
  if (!validKey || agentKey !== validKey) {
    return NextResponse.json({ error: 'Unauthorized: PRESTO_AGENT_API_KEY required' }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Resolution oracle not configured (missing ANTHROPIC_API_KEY)' }, { status: 503 });
  }

  let body: { market: AppMarket };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { market } = body;
  if (!market?.id || !market?.title) {
    return NextResponse.json({ error: 'market.id and market.title are required' }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey });

  const userPrompt = `Research and produce an evidence report for this prediction market:

Title: ${market.title}
Description: ${market.description ?? ''}
Category: ${market.category}
Rules: ${market.rules ?? 'Standard YES/NO binary resolution.'}
Source of truth: ${market.sourceOfTruth ?? 'Public information.'}
Close date: ${market.closeLabel}
Status: ${market.status}

Return ONLY valid JSON matching this schema:
{
  "outcome": "YES" | "NO" | "CANCEL",
  "confidence": "High" | "Medium" | "Low",
  "sources": ["url1", "url2"],
  "evidenceSummary": "Two to four sentences of timestamped evidence.",
  "uncertainty": "Any missing data or reasons a human should review before settling."
}`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = message.content.find((b) => b.type === 'text')?.text ?? '';

  let parsed: {
    outcome: 'YES' | 'NO' | 'CANCEL';
    confidence: string;
    sources: string[];
    evidenceSummary: string;
    uncertainty: string;
  };

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? text);
  } catch {
    return NextResponse.json({ error: 'Oracle returned unparseable response', raw: text }, { status: 502 });
  }

  // Build the full structured report using the existing agentResolution format
  const report = buildAgentResolutionReport({
    market,
    outcome: parsed.outcome === 'CANCEL' ? 'CANCEL' : parsed.outcome,
    confidence: parsed.confidence,
    evidenceNotes: parsed.evidenceSummary + (parsed.uncertainty ? `\n\nUncertainty: ${parsed.uncertainty}` : ''),
    evidenceSources: (parsed.sources ?? []).join('\n'),
    operator: 'Presto Resolution Oracle (Claude claude-sonnet-4-6)',
  });

  return NextResponse.json({
    ok: true,
    recommendation: {
      outcome: parsed.outcome,
      confidence: parsed.confidence,
      evidenceSummary: parsed.evidenceSummary,
      uncertainty: parsed.uncertainty,
      sources: parsed.sources ?? [],
    },
    report: report.report,
    dataUri: report.dataUri,
    pretty: report.pretty,
    poweredBy: 'Circle Agent Stack · Claude claude-sonnet-4-6 · Arc Testnet ERC-8004',
  });
}
