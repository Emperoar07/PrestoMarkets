/**
 * Provider Pool - Manages multiple providers with fallback and metrics
 * Implements circuit breaker pattern and provider rotation
 */

import { LlmProvider, ProviderRequest, ProviderResponse, ProviderMetrics } from './base';
import { logger } from '../logger';

export class ProviderPool {
  private providers: LlmProvider[];
  private metrics = new Map<string, ProviderMetrics>();
  private circuitBreakers = new Map<string, { failures: number; lastFailTime: number }>();
  private readonly circuitBreakerThreshold = 3;
  private readonly circuitBreakerWindow = 5 * 60 * 1000; // 5 minutes

  constructor(providers: LlmProvider[]) {
    this.providers = providers;

    // Initialize metrics for each provider
    for (const provider of providers) {
      this.metrics.set(provider.getName(), {
        provider: provider.getName(),
        successCount: 0,
        failureCount: 0,
        totalLatency: 0,
        avgLatency: 0,
      });

      this.circuitBreakers.set(provider.getName(), {
        failures: 0,
        lastFailTime: 0,
      });
    }
  }

  async call(request: ProviderRequest): Promise<ProviderResponse> {
    const availableProviders = this.getAvailableProviders();

    if (availableProviders.length === 0) {
      throw new Error('No available providers (all circuit breakers open)');
    }

    const errors: Array<{ provider: string; error: string }> = [];

    for (const provider of availableProviders) {
      try {
        const response = await provider.call(request);

        // Record success
        this.recordSuccess(provider.getName(), response.latency || 0);
        logger.info('provider-pool', `${provider.getName()} succeeded for task: ${request.task}`);

        return response;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ provider: provider.getName(), error: errorMessage });

        // Record failure
        this.recordFailure(provider.getName(), errorMessage);
        logger.warn('provider-pool', `${provider.getName()} failed for task: ${request.task}`, {
          error: errorMessage,
        });

        // Continue to next provider
      }
    }

    // All providers failed
    const summary = errors
      .map(e => `${e.provider}: ${e.error}`)
      .join(' | ');

    throw new Error(`All providers exhausted: ${summary}`);
  }

  private getAvailableProviders(): LlmProvider[] {
    const now = Date.now();
    const available: LlmProvider[] = [];

    for (const provider of this.providers) {
      if (!provider.isConfigured()) continue;

      const breaker = this.circuitBreakers.get(provider.getName());
      if (!breaker) continue;

      // Check if circuit breaker is open
      if (breaker.failures >= this.circuitBreakerThreshold) {
        const timeSinceLastFailure = now - breaker.lastFailTime;

        if (timeSinceLastFailure < this.circuitBreakerWindow) {
          // Circuit breaker is open, skip this provider
          continue;
        } else {
          // Circuit breaker window expired, reset and try again
          breaker.failures = 0;
        }
      }

      available.push(provider);
    }

    return available;
  }

  private recordSuccess(providerName: string, latency: number) {
    const metrics = this.metrics.get(providerName);
    if (!metrics) return;

    metrics.successCount += 1;
    metrics.totalLatency += latency;
    metrics.avgLatency = metrics.totalLatency / (metrics.successCount + metrics.failureCount);

    // Reset circuit breaker on success
    const breaker = this.circuitBreakers.get(providerName);
    if (breaker) {
      breaker.failures = Math.max(0, breaker.failures - 1);
    }
  }

  private recordFailure(providerName: string, error: string) {
    const metrics = this.metrics.get(providerName);
    if (metrics) {
      metrics.failureCount += 1;
      metrics.lastError = error;
      metrics.avgLatency = metrics.totalLatency / (metrics.successCount + metrics.failureCount);
    }

    const breaker = this.circuitBreakers.get(providerName);
    if (breaker) {
      breaker.failures += 1;
      breaker.lastFailTime = Date.now();
    }
  }

  getMetrics(): ProviderMetrics[] {
    return Array.from(this.metrics.values());
  }

  getMetricsByProvider(providerName: string): ProviderMetrics | undefined {
    return this.metrics.get(providerName);
  }
}
