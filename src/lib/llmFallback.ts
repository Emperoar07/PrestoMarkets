/**
 * Provider-agnostic JSON LLM call with automatic fallback across free / cheap providers.
 *
 * Tries Anthropic first when ANTHROPIC_API_KEY is set, then falls through to Groq,
 * OpenRouter, Cerebras, and Together as each becomes available. On 401/402/429 or
 * insufficient_quota errors the next provider is tried. If every provider fails the
 * underlying error is rethrown so the caller can see the last reason.
 *
 * All providers other than Anthropic use the OpenAI-compatible chat completions shape,
 * so this file only needs a tiny adapter per provider.
 */

import Anthropic from '@anthropic-ai/sdk';

export type LlmTask = 'safety' | 'reasoning';

export type LlmCallInput = {
  task: LlmTask;
  /** Full prompt. Caller is responsible for asking the model to return JSON only. */
  prompt: string;
  /** Max output tokens. Defaults to 256 for safety, 1024 for reasoning. */
  maxTokens?: number;
  /** Temperature. Defaults to 0.2. */
  temperature?: number;
  /** Force JSON-mode where the provider supports it. Default true. */
  jsonMode?: boolean;
};

type ProviderResult = {
  text: string;
  provider: string;
  model: string;
};

type OpenAiChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type OpenAiChatPayload = {
  model: string;
  messages: OpenAiChatMessage[];
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: 'json_object' };
};

function envClean(name: string): string {
  return (process.env[name] ?? '').trim();
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 401 || status === 402 || status === 429 || status === 403 || (status >= 500 && status <= 599);
}

async function callAnthropic(input: LlmCallInput): Promise<ProviderResult | null> {
  const key = envClean('ANTHROPIC_API_KEY');
  if (!key) return null;
  const model = input.task === 'reasoning' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
  const anthropic = new Anthropic({ apiKey: key });
  try {
    const message = await anthropic.messages.create({
      model,
      max_tokens: input.maxTokens ?? (input.task === 'reasoning' ? 1024 : 256),
      temperature: input.temperature ?? 0.2,
      messages: [{ role: 'user', content: input.prompt }],
    });
    const text = message.content[0]?.type === 'text' ? message.content[0].text : '';
    if (!text) return null;
    return { text, provider: 'anthropic', model };
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 0;
    if (isRetryableHttpStatus(status)) return null;
    // Non-retryable Anthropic failure (network etc.) — bubble up so we try the next provider.
    return null;
  }
}

async function callOpenAiCompatible(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: string;
  payload: OpenAiChatPayload;
}): Promise<ProviderResult | null> {
  try {
    const res = await fetch(`${input.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.payload),
    });
    if (!res.ok) {
      // Trace which provider failed so the caller can surface a useful message.
      const body = await res.text().catch(() => '');
      console.warn(`[llm-fallback] ${input.provider} HTTP ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text) return null;
    return { text, provider: input.provider, model: input.model };
  } catch (err) {
    console.warn(`[llm-fallback] ${input.provider} threw:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function callGroq(input: LlmCallInput): Promise<ProviderResult | null> {
  const key = envClean('GROQ_API_KEY');
  if (!key) return null;
  const model = 'llama-3.3-70b-versatile';
  return callOpenAiCompatible({
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: key,
    model,
    provider: 'groq',
    payload: {
      model,
      messages: [{ role: 'user', content: input.prompt }],
      max_tokens: input.maxTokens ?? (input.task === 'reasoning' ? 1024 : 256),
      temperature: input.temperature ?? 0.2,
      ...((input.jsonMode ?? true) ? { response_format: { type: 'json_object' as const } } : {}),
    },
  });
}

async function callOpenRouter(input: LlmCallInput): Promise<ProviderResult | null> {
  const key = envClean('OPENROUTER_API_KEY');
  if (!key) return null;
  // OpenRouter's free Gemini 2.0 Flash Exp model. Strong general reasoning, zero cost.
  const model = input.task === 'reasoning'
    ? 'google/gemini-2.0-flash-exp:free'
    : 'meta-llama/llama-3.1-70b-instruct:free';
  return callOpenAiCompatible({
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: key,
    model,
    provider: 'openrouter',
    payload: {
      model,
      messages: [{ role: 'user', content: input.prompt }],
      max_tokens: input.maxTokens ?? (input.task === 'reasoning' ? 1024 : 256),
      temperature: input.temperature ?? 0.2,
    },
  });
}

async function callCerebras(input: LlmCallInput): Promise<ProviderResult | null> {
  const key = envClean('CEREBRAS_API_KEY');
  if (!key) return null;
  const model = 'llama-3.3-70b';
  return callOpenAiCompatible({
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKey: key,
    model,
    provider: 'cerebras',
    payload: {
      model,
      messages: [{ role: 'user', content: input.prompt }],
      max_tokens: input.maxTokens ?? (input.task === 'reasoning' ? 1024 : 256),
      temperature: input.temperature ?? 0.2,
    },
  });
}

async function callTogether(input: LlmCallInput): Promise<ProviderResult | null> {
  const key = envClean('TOGETHER_API_KEY');
  if (!key) return null;
  const model = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  return callOpenAiCompatible({
    baseUrl: 'https://api.together.xyz/v1',
    apiKey: key,
    model,
    provider: 'together',
    payload: {
      model,
      messages: [{ role: 'user', content: input.prompt }],
      max_tokens: input.maxTokens ?? (input.task === 'reasoning' ? 1024 : 256),
      temperature: input.temperature ?? 0.2,
    },
  });
}

/**
 * Try providers in order until one succeeds. Returns the raw text from whichever model
 * answered first. Caller is expected to JSON.parse it (or extract a JSON object from it).
 */
export async function callLlmJson(input: LlmCallInput): Promise<ProviderResult> {
  const chain = [callAnthropic, callGroq, callOpenRouter, callCerebras, callTogether];
  for (const fn of chain) {
    const result = await fn(input);
    if (result) return result;
  }
  throw new Error('All LLM providers failed or unavailable. Set ANTHROPIC_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY, or TOGETHER_API_KEY.');
}

/**
 * Convenience: extract a JSON object from raw model text. Models sometimes wrap JSON in
 * markdown fences or include preamble; this strips that.
 */
export function extractJsonObject(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  return JSON.parse(match?.[0] ?? text);
}
