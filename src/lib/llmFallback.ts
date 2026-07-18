/**
 * Provider-agnostic JSON LLM call with automatic fallback across free / cheap providers.
 *
 * Tries Anthropic first when ANTHROPIC_API_KEY is set, then falls through to Gemini,
 * Groq, Mistral, OpenRouter, Cerebras, Together, and HuggingFace as each becomes available.
 * Providers that error or return malformed JSON are skipped so another configured provider
 * can answer.
 *
 * All providers other than Anthropic use the OpenAI-compatible chat completions shape,
 * so this file only needs a tiny adapter per provider.
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from './logger';

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

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

const LLM_PROVIDER_TIMEOUT_MS = 10_000;

// Optional wall-clock deadline for the WHOLE fallback chain, set by deadline-bound callers
// (the agent pipeline). Each provider request is individually capped at 10s, but the chain is
// ~9 providers x up to 4 models — legally ~200s for ONE call when everything is throttled,
// which is how the market-factory run blew past its 240s budget and Vercel's function kill.
// Module scope is safe here: each cron route runs in its own function instance and the
// pipeline holds a cron lease, so no concurrent caller shares this state.
let llmDeadlineAt: number | null = null;
export function setLlmDeadline(epochMs: number | null) {
  llmDeadlineAt = epochMs && Number.isFinite(epochMs) ? epochMs : null;
}

// AgentRouter (agentrouter.org) — free-credit community gateway proxying frontier models
// (Claude Opus 4.x, GPT-5) behind an OpenAI-compatible endpoint. When a key is configured this
// is the strongest judge in the chain, so reasoning tries it right after the native Anthropic
// key. Third-party relay: prompts transit their servers, so it only ever sees what every other
// fallback provider already sees (market drafts/trends — no secrets, no user data).
async function callAgentRouter(input: LlmCallInput): Promise<ProviderResult | null> {
  const key = envClean('AGENTROUTER_API_KEY') || envClean('AGENT_ROUTER_TOKEN');
  if (!key) return null;
  const models = uniqueStrings([
    envClean(input.task === 'reasoning' ? 'AGENTROUTER_REASONING_MODEL' : 'AGENTROUTER_SAFETY_MODEL'),
    envClean('AGENTROUTER_MODEL'),
    input.task === 'reasoning' ? 'claude-opus-4-8' : 'gpt-5',
    'gpt-5',
  ]);
  return callOpenAiCompatibleModels({
    baseUrl: 'https://agentrouter.org/v1',
    apiKey: key,
    models,
    provider: 'agentrouter',
    // Relay to frontier models (Opus/GPT-5): first-token latency is well above the 10s the
    // fast free tiers get; still bounded by the chain's global deadline.
    timeoutMs: 25_000,
    basePayload: {
      messages: [{ role: 'user', content: input.prompt }],
      max_tokens: input.maxTokens ?? (input.task === 'reasoning' ? 1024 : 256),
      temperature: input.temperature ?? 0.2,
    },
  });
}

async function callAnthropic(input: LlmCallInput): Promise<ProviderResult | null> {
  const key = envClean('ANTHROPIC_API_KEY');
  if (!key) return null;
  const model = input.task === 'reasoning' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
  const anthropic = new Anthropic({ apiKey: key, timeout: LLM_PROVIDER_TIMEOUT_MS });
  try {
    const message = await anthropic.messages.create({
      model,
      max_tokens: input.maxTokens ?? (input.task === 'reasoning' ? 1024 : 256),
      temperature: input.temperature ?? 0.2,
      system: 'You are an objective Presto Markets AI oracle returning highly structured prediction market insights.',
      messages: [{ role: 'user', content: input.prompt }],
      metadata: { user_id: 'presto_fallback_system' },
    });
    if (message.stop_reason !== 'end_turn' && message.stop_reason !== 'stop_sequence') {
      logger.warn('llm-fallback', `Anthropic model ${model} stopped unexpectedly: ${message.stop_reason}`);
      return null;
    }
    const firstContent = message.content.at(0);
    const text = firstContent?.type === 'text' ? firstContent.text : '';
    if (!text) return null;
    return { text, provider: 'anthropic', model };
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 0;
    const message = err instanceof Error ? err.message : String(err);
    // Log every Anthropic failure so silent killers (out-of-credits 400, expired
    // key 401, quota 429) are visible in deployment logs instead of vanishing.
    logger.warn('llm-fallback', `anthropic failed (status ${status})`, { status, error: message.slice(0, 180) });
    // Network/SDK/HTTP errors all permit a later configured provider to answer.
    return null;
  }
}

async function callGemini(input: LlmCallInput): Promise<ProviderResult | null> {
  const key = envClean('GEMINI_API_KEY') || envClean('GOOGLE_GENERATIVE_AI_API_KEY');
  if (!key) return null;

  const models = uniqueStrings([
    envClean(input.task === 'reasoning' ? 'GEMINI_REASONING_MODEL' : 'GEMINI_SAFETY_MODEL'),
    envClean('GEMINI_MARKET_MODEL'),
    // gemini-1.5-flash was retired and now 404s; 2.5-flash is the current fast model.
    'gemini-2.5-flash',
    'gemini-flash-latest',
  ]);

  for (const model of models) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LLM_PROVIDER_TIMEOUT_MS);

      try {
        const genAI = new GoogleGenerativeAI(key);
        const result = await Promise.race([
          genAI.getGenerativeModel({ model }).generateContent({
            contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
            generationConfig: {
              maxOutputTokens: input.maxTokens ?? (input.task === 'reasoning' ? 1024 : 256),
              temperature: input.temperature ?? 0.2,
              ...((input.jsonMode ?? true) ? { responseMimeType: 'application/json' } : {}),
            },
          }),
          new Promise<never>((_, reject) => {
            const id = setTimeout(() => reject(new Error(`gemini timeout after ${LLM_PROVIDER_TIMEOUT_MS}ms`)), LLM_PROVIDER_TIMEOUT_MS);
            controller.signal.addEventListener('abort', () => {
              clearTimeout(id);
              reject(new Error(`gemini timeout after ${LLM_PROVIDER_TIMEOUT_MS}ms`));
            });
          }),
        ]);

        clearTimeout(timeout);
        const text = result.response.text();
        if (text) return { text, provider: 'gemini', model };
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('timeout')) {
        logger.warn('llm-fallback', `gemini ${model} timeout after ${LLM_PROVIDER_TIMEOUT_MS}ms`);
      } else {
        logger.warn('llm-fallback', `gemini ${model} threw`, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return null;
}

async function callOpenAiCompatible(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: string;
  payload: OpenAiChatPayload;
  timeoutMs?: number;
}): Promise<ProviderResult | null> {
  const timeoutMs = input.timeoutMs ?? LLM_PROVIDER_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${input.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn('llm-fallback', `${input.provider} HTTP ${res.status}`, { status: res.status, error: body.slice(0, 200) });
      return null;
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text) return null;
    return { text, provider: input.provider, model: input.model };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('llm-fallback', `${input.provider} timeout after ${timeoutMs}ms`);
      return null;
    }
    logger.warn('llm-fallback', `${input.provider} threw`, { error: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAiCompatibleModels(input: {
  baseUrl: string;
  apiKey: string;
  models: string[];
  provider: string;
  basePayload: Omit<OpenAiChatPayload, 'model'>;
  timeoutMs?: number;
}): Promise<ProviderResult | null> {
  for (const model of input.models) {
    const result = await callOpenAiCompatible({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model,
      provider: input.provider,
      timeoutMs: input.timeoutMs,
      payload: {
        ...input.basePayload,
        model,
      },
    });
    if (result) return result;
  }

  return null;
}

async function callGroq(input: LlmCallInput): Promise<ProviderResult | null> {
  const key = envClean('GROQ_API_KEY');
  if (!key) return null;
  const models = uniqueStrings([
    envClean(input.task === 'reasoning' ? 'GROQ_REASONING_MODEL' : 'GROQ_SAFETY_MODEL'),
    envClean('GROQ_MARKET_MODEL'),
    'llama-3.1-8b-instant',
  ]);
  return callOpenAiCompatibleModels({
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: key,
    models,
    provider: 'groq',
    basePayload: {
      messages: [{ role: 'user', content: input.prompt }],
      max_tokens: input.maxTokens ?? (input.task === 'reasoning' ? 1024 : 256),
      temperature: input.temperature ?? 0.2,
      ...((input.jsonMode ?? true) ? { response_format: { type: 'json_object' as const } } : {}),
    },
  });
}

async function callMistral(input: LlmCallInput): Promise<ProviderResult | null> {
  const key = envClean('MISTRAL_API_KEY');
  if (!key) return null;
  const models = uniqueStrings([
    envClean(input.task === 'reasoning' ? 'MISTRAL_REASONING_MODEL' : 'MISTRAL_SAFETY_MODEL'),
    envClean('MISTRAL_MODEL'),
    input.task === 'reasoning' ? 'mistral-large-latest' : 'mistral-small-latest',
    'open-mistral-nemo',
  ]);
  return callOpenAiCompatibleModels({
    baseUrl: 'https://api.mistral.ai/v1',
    apiKey: key,
    models,
    provider: 'mistral',
    basePayload: {
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
  const models = uniqueStrings([
    envClean(input.task === 'reasoning' ? 'OPENROUTER_REASONING_MODEL' : 'OPENROUTER_SAFETY_MODEL'),
    envClean('OPENROUTER_MODEL'),
    // qwen3-235b:free was delisted (404); these Llama free models are current.
    'meta-llama/llama-3.3-70b-instruct:free',
    'meta-llama/llama-3.2-3b-instruct:free',
  ]);
  return callOpenAiCompatibleModels({
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: key,
    models,
    provider: 'openrouter',
    basePayload: {
      messages: [{ role: 'user', content: input.prompt }],
      max_tokens: input.maxTokens ?? (input.task === 'reasoning' ? 1024 : 256),
      temperature: input.temperature ?? 0.2,
    },
  });
}

async function callCerebras(input: LlmCallInput): Promise<ProviderResult | null> {
  const key = envClean('CEREBRAS_API_KEY');
  if (!key) return null;
  const models = uniqueStrings([
    envClean(input.task === 'reasoning' ? 'CEREBRAS_REASONING_MODEL' : 'CEREBRAS_SAFETY_MODEL'),
    envClean('CEREBRAS_MODEL'),
    'gpt-oss-120b',
    'qwen-3-32b',
  ]);
  return callOpenAiCompatibleModels({
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKey: key,
    models,
    provider: 'cerebras',
    basePayload: {
      messages: [{ role: 'user', content: input.prompt }],
      max_tokens: input.maxTokens ?? (input.task === 'reasoning' ? 1024 : 256),
      temperature: input.temperature ?? 0.2,
    },
  });
}

async function callTogether(input: LlmCallInput): Promise<ProviderResult | null> {
  const key = envClean('TOGETHER_API_KEY');
  if (!key) return null;
  const models = uniqueStrings([
    envClean(input.task === 'reasoning' ? 'TOGETHER_REASONING_MODEL' : 'TOGETHER_SAFETY_MODEL'),
    envClean('TOGETHER_MODEL'),
    'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    'Qwen/Qwen2.5-7B-Instruct-Turbo',
  ]);
  return callOpenAiCompatibleModels({
    baseUrl: 'https://api.together.xyz/v1',
    apiKey: key,
    models,
    provider: 'together',
    basePayload: {
      messages: [{ role: 'user', content: input.prompt }],
      max_tokens: input.maxTokens ?? (input.task === 'reasoning' ? 1024 : 256),
      temperature: input.temperature ?? 0.2,
    },
  });
}

// Cloudflare Workers AI — OpenAI-compatible chat endpoint, generous free tier (shares the same
// CF_ACCOUNT_ID + CF_API_TOKEN used for image generation). Adds capacity so the heavier sports/
// fixture slate doesn't exhaust the other free LLM providers.
async function callCloudflare(input: LlmCallInput): Promise<ProviderResult | null> {
  const account = envClean('CF_ACCOUNT_ID');
  const key = envClean('CF_API_TOKEN');
  if (!account || !key) return null;
  const models = uniqueStrings([
    envClean(input.task === 'reasoning' ? 'CF_REASONING_MODEL' : 'CF_SAFETY_MODEL'),
    envClean('CF_LLM_MODEL'),
    input.task === 'reasoning' ? '@cf/meta/llama-3.3-70b-instruct-fp8-fast' : '@cf/meta/llama-3.1-8b-instruct-fast',
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  ]);
  return callOpenAiCompatibleModels({
    baseUrl: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`,
    apiKey: key,
    models,
    provider: 'cloudflare',
    basePayload: {
      messages: [{ role: 'user', content: input.prompt }],
      max_tokens: input.maxTokens ?? (input.task === 'reasoning' ? 1024 : 256),
      temperature: input.temperature ?? 0.2,
    },
  });
}

async function callHuggingFace(input: LlmCallInput): Promise<ProviderResult | null> {
  const key = envClean('HUGGINGFACE_API_KEY') || envClean('HF_TOKEN') || envClean('HF_API_KEY');
  if (!key) return null;
  const models = uniqueStrings([
    envClean(input.task === 'reasoning' ? 'HUGGINGFACE_REASONING_MODEL' : 'HUGGINGFACE_SAFETY_MODEL'),
    envClean('HUGGINGFACE_MODEL'),
    input.task === 'reasoning' ? 'meta-llama/Llama-3.3-70B-Instruct' : 'meta-llama/Llama-3.1-8B-Instruct',
    'Qwen/Qwen2.5-7B-Instruct',
  ]);
  // HF's OpenAI-compatible router auto-routes to an available inference provider. Not every
  // backend supports json_object response_format, so we don't force it — extractJsonObject
  // tolerates fenced / prefixed JSON.
  return callOpenAiCompatibleModels({
    baseUrl: 'https://router.huggingface.co/v1',
    apiKey: key,
    models,
    provider: 'huggingface',
    basePayload: {
      messages: [{ role: 'user', content: input.prompt }],
      max_tokens: input.maxTokens ?? (input.task === 'reasoning' ? 1024 : 256),
      temperature: input.temperature ?? 0.2,
    },
  });
}

/**
 * Try providers in order until one returns a JSON object. Callers still parse and
 * validate the task-specific fields they require.
 */
export async function callLlmJson(input: LlmCallInput): Promise<ProviderResult> {
  // Reasoning (market resolution, drafting) tries Cloudflare Workers AI right after the premium
  // providers: its default reasoning model is llama-3.3-70B, a much stronger judge than the fast
  // 8B models the later free tiers default to, and its free tier is generous. Safety/classify
  // calls keep the latency-ordered chain — small fast models are fine there.
  const chain = input.task === 'reasoning'
    ? [callAnthropic, callAgentRouter, callGemini, callCloudflare, callGroq, callMistral, callOpenRouter, callCerebras, callTogether, callHuggingFace]
    : [callAnthropic, callAgentRouter, callGemini, callGroq, callMistral, callOpenRouter, callCerebras, callTogether, callCloudflare, callHuggingFace];
  for (const fn of chain) {
    // Respect the caller's wall-clock deadline: stop starting providers once it passes, and
    // never wait on an in-flight provider longer than the time remaining.
    const remainingMs = llmDeadlineAt === null ? Number.POSITIVE_INFINITY : llmDeadlineAt - Date.now();
    if (remainingMs <= 0) break;
    const result = Number.isFinite(remainingMs)
      ? await Promise.race([
        fn(input),
        new Promise<null>((resolve) => { const t = setTimeout(() => resolve(null), remainingMs); (t as { unref?: () => void }).unref?.(); }),
      ])
      : await fn(input);
    if (!result) continue;

    try {
      const parsed = extractJsonObject(result.text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected a JSON object.');
      }
      return result;
    } catch {
      logger.warn('llm-fallback', `${result.provider} ${result.model} returned malformed JSON`, { provider: result.provider, model: result.model });
    }
  }
  throw new Error('No LLM provider returned usable JSON. Check configured provider credentials, quotas, model availability, and deployment logs.');
}

/**
 * Convenience: extract a JSON object from raw model text. Models sometimes wrap JSON in
 * markdown fences or include preamble; this strips that.
 */
export function extractJsonObject(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  return JSON.parse(match?.at(0) ?? text);
}
