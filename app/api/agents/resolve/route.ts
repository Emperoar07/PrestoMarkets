import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildAgentResolutionReport } from '@/lib/agentResolution';
import { verifyApiKey } from '@/lib/authCompare';
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

const SYSTEM_PROMPT = `You are Presto Markets' resolution oracle - an AI agent that researches prediction market questions and produces evidence reports. Your job is evidence preparation only; you never settle a market yourself.

Rules you must follow:
- Only use publicly verifiable primary sources (news, official stats, on-chain data).
- Do not invent sources. If uncertain, say so and recommend CANCEL.
- Return a structured JSON report with fields: outcome, confidence, sources, evidenceSummary, uncertainty.
- outcome must exactly match one allowed market outcome provided by the request, or be "CANCEL".
- confidence must be "High", "Medium", or "Low".`;

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!rateLimit(ip)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const agentKey = req.headers.get('x-api-key');
  if (!verifyApiKey(agentKey, process.env.PRESTO_AGENT_API_KEY)) {
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

  const allowedOutcomes = market.outcomes?.map((outcome) => outcome.label).filter(Boolean) ?? ['YES', 'NO'];
  const outcomeSchema = JSON.stringify([...allowedOutcomes, 'CANCEL']);
  const anthropic = new Anthropic({ apiKey });

  const userPrompt = `Research and produce an evidence report for this prediction market:

Title: ${market.title}
Description: ${market.description ?? ''}
Category: ${market.category}
Rules: ${market.rules ?? 'Standard YES/NO binary resolution.'}
Source of truth: ${market.sourceOfTruth ?? 'Public information.'}
Close date: ${market.closeLabel}
Status: ${market.status}
Allowed outcomes: ${outcomeSchema}

Return ONLY valid JSON matching this schema:
{
  "outcome": ${outcomeSchema},
  "confidence": "High" | "Medium" | "Low",
  "sources": ["url1", "url2"],
  "evidenceSummary": "Two to four sentences of timestamped evidence.",
  "uncertainty": "Any missing data or reasons a human should review before settling."
}`;

  let text1 = '';
  let text2 = '';
  let text3 = '';
  let text = '';

  try {
    // Execute sequentially to respect free-tier concurrency limits
    const res1 = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      temperature: 0.1,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      metadata: { user_id: 'presto_resolve_oracle' },
    });
    if (res1.stop_reason !== 'end_turn' && res1.stop_reason !== 'stop_sequence') {
      throw new Error(`Claude Researcher 1 stopped unexpectedly: ${res1.stop_reason}`);
    }
    text1 = res1.content.find((b) => b.type === 'text')?.text ?? '';

    const res2 = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      metadata: { user_id: 'presto_resolve_oracle' },
    });
    if (res2.stop_reason !== 'end_turn' && res2.stop_reason !== 'stop_sequence') {
      throw new Error(`Claude Researcher 2 stopped unexpectedly: ${res2.stop_reason}`);
    }
    text2 = res2.content.find((b) => b.type === 'text')?.text ?? '';

    const res3 = await anthropic.messages.create({
      model: 'claude-haiku-4-3',
      max_tokens: 1024,
      temperature: 0.4,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      metadata: { user_id: 'presto_resolve_oracle' },
    });
    if (res3.stop_reason !== 'end_turn' && res3.stop_reason !== 'stop_sequence') {
      throw new Error(`Claude Researcher 3 stopped unexpectedly: ${res3.stop_reason}`);
    }
    text3 = res3.content.find((b) => b.type === 'text')?.text ?? '';

    const judgePrompt = `You are the Meta-Agent Judge. Three separate AI researchers have produced evidence reports for the following prediction market:
  
Title: ${market.title}
Rules: ${market.rules ?? 'Standard YES/NO binary resolution.'}
Allowed outcomes: ${outcomeSchema}

Here are their reports:
=== Researcher 1 ===
${text1}
=== Researcher 2 ===
${text2}
=== Researcher 3 ===
${text3}

Your job is to resolve any contradictions, weigh their confidence scores, and output the final, calibrated verdict.
Return ONLY valid JSON matching this schema:
{
  "outcome": ${outcomeSchema},
  "confidence": "High" | "Medium" | "Low",
  "sources": ["url1", "url2"],
  "evidenceSummary": "Two to four sentences of timestamped evidence, noting if researchers disagreed.",
  "uncertainty": "Any missing data or reasons a human should review before settling."
}`;

    const judgeMessage = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      temperature: 0.2,
      system: 'You are a master Meta-Agent Judge. You output ONLY valid JSON.',
      messages: [{ role: 'user', content: judgePrompt }],
      metadata: { user_id: 'presto_resolve_oracle' },
    });
    if (judgeMessage.stop_reason !== 'end_turn' && judgeMessage.stop_reason !== 'stop_sequence') {
      throw new Error(`Judge stopped unexpectedly: ${judgeMessage.stop_reason}`);
    }
    text = judgeMessage.content.find((b) => b.type === 'text')?.text ?? '';

  } catch (error) {
    return NextResponse.json({ error: 'Resolution oracle AI API call failed: ' + (error instanceof Error ? error.message : String(error)) }, { status: 502 });
  }

  let parsed: {
    outcome: string;
    confidence: string;
    sources: string[];
    evidenceSummary: string;
    uncertainty: string;
  };

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.at(0) ?? text);
  } catch {
    return NextResponse.json({ error: 'Oracle returned unparseable response', raw: text }, { status: 502 });
  }

  if (parsed.outcome !== 'CANCEL' && !allowedOutcomes.includes(parsed.outcome)) {
    return NextResponse.json({ error: 'Oracle returned an outcome outside this market options.' }, { status: 502 });
  }

  // Build the full structured report using the existing agentResolution format
  const report = buildAgentResolutionReport({
    market,
    outcome: parsed.outcome === 'CANCEL' ? 'CANCEL' : parsed.outcome,
    confidence: parsed.confidence,
    evidenceNotes: parsed.evidenceSummary + (parsed.uncertainty ? `\n\nUncertainty: ${parsed.uncertainty}` : ''),
    evidenceSources: (parsed.sources ?? []).join('\n'),
    operator: 'Presto Resolution Oracle (Claude Ensemble Judge)',
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
    poweredBy: 'Circle Agent Stack - Claude Ensemble (2x Sonnet, 1x Haiku) - Arc Testnet ERC-8004',
  });
}
