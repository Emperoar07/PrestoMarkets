/**
 * Anthropic Provider - Claude implementation
 */

import { LlmProvider, ProviderRequest, ProviderResponse } from './base';
import { logger } from '../logger';

export class AnthropicProvider extends LlmProvider {
  async call(request: ProviderRequest): Promise<ProviderResponse> {
    const apiKey = this.config.apiKey;

    if (!apiKey) {
      throw this.createError('Anthropic API key not configured');
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 30_000);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.model || 'claude-opus-4-1',
          max_tokens: request.maxTokens || 512,
          temperature: request.temperature ?? 0.3,
          messages: [{ role: 'user', content: request.prompt }],
        }),
        signal: controller.signal,
      });

      const latency = Date.now() - startTime;

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const message = error.error?.message || response.statusText;
        throw this.createError(
          `Anthropic API error: ${message}`,
          error.error?.type,
          response.status
        );
      }

      const data = await response.json() as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const text = data.content?.[0]?.text || '';
      if (!text) {
        throw this.createError('Empty response from Anthropic');
      }

      return {
        text,
        provider: this.config.name,
        model: this.config.model,
        tokens: {
          input: data.usage?.input_tokens || 0,
          output: data.usage?.output_tokens || 0,
        },
        latency,
      };
    } catch (error) {
      const latency = Date.now() - startTime;

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw this.createError(
            `Anthropic timeout after ${this.config.timeout || 30_000}ms`,
            'TIMEOUT'
          );
        }
        throw this.createError(error.message, 'UNKNOWN');
      }

      throw this.createError('Unknown error', 'UNKNOWN');
    } finally {
      clearTimeout(timeout);
    }
  }
}
