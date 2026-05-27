/**
 * Provider Base - Abstract interface for LLM providers
 * Enables: Pluggable providers, consistent error handling, metrics tracking
 */

export type ProviderConfig = {
  name: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  timeout?: number;
  maxRetries?: number;
};

export type ProviderRequest = {
  task: string; // 'reasoning', 'classification', 'safety', 'draft'
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  format?: 'text' | 'json';
};

export type ProviderResponse = {
  text: string;
  provider: string;
  model: string;
  tokens?: { input: number; output: number };
  latency?: number;
};

export type ProviderError = {
  message: string;
  code?: string;
  retryable?: boolean;
  statusCode?: number;
};

export abstract class LlmProvider {
  protected config: ProviderConfig;
  protected lastError?: ProviderError;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  abstract call(request: ProviderRequest): Promise<ProviderResponse>;

  getName(): string {
    return this.config.name;
  }

  getLastError(): ProviderError | undefined {
    return this.lastError;
  }

  isConfigured(): boolean {
    return !!this.config.apiKey;
  }

  protected createError(
    message: string,
    code?: string,
    statusCode?: number
  ): ProviderError {
    const error: ProviderError = { message, code, statusCode };

    // Determine if error is retryable
    if (statusCode) {
      error.retryable = statusCode >= 500 || statusCode === 429;
    }

    this.lastError = error;
    return error;
  }
}

export type ProviderMetrics = {
  provider: string;
  successCount: number;
  failureCount: number;
  totalLatency: number;
  avgLatency: number;
  lastError?: string;
};
