import { describe, expect, it } from 'vitest';
import { toMarketV1 } from '../apiContracts';
import type { Market } from '../markets';

describe('API v1 contracts', () => {
  it('correctly maps and whitelists fields for MarketV1', () => {
    const mockMarket: Market = {
      id: '0x1234567890abcdef1234567890abcdef12345678',
      type: 'Prediction',
      title: 'Will the AI agent pass snapshot tests?',
      description: 'Resolves YES if the tests pass.',
      category: 'Testing',
      categories: ['Testing', 'Quality'],
      volume: '1000.50',
      liquidity: '500.00',
      closeLabel: 'June 30, 2026',
      status: 'Open',
      collateral: 'USDC',
      chain: 'Arc Testnet',
      resolver: 'Oracle',
      resolutionMode: 'Agent assisted',
      sourceOfTruth: 'Test output logs',
      rules: 'Must be verified by vitest',
      createdBy: '0x9999999999999999999999999999999999999999',
      createdByType: 'agent',
      displayType: 'binary',
      agentName: 'TestAgent',
      agentConfidence: '85%',
      agentReason: 'High probability of success',
      trendSource: 'trends',
      trendUrl: 'https://trends.example.com',
      momentumScore: 7,
      safetyScore: 9,
      outcomes: [
        { label: 'YES', odds: 85, liquidity: '400.00' },
        { label: 'NO', odds: 15, liquidity: '100.00' },
      ],
    } as unknown as Market;

    const result = toMarketV1(mockMarket);

    // Verify mapped output
    expect(result).toMatchInlineSnapshot(`
      {
        "agent": {
          "confidence": "85%",
          "momentumScore": 7,
          "name": "TestAgent",
          "reason": "High probability of success",
          "safetyScore": 9,
          "trendSource": "trends",
          "trendUrl": "https://trends.example.com",
        },
        "categories": [
          "Testing",
          "Quality",
        ],
        "category": "Testing",
        "closeLabel": "June 30, 2026",
        "collateral": "USDC",
        "createdByType": "agent",
        "description": "Resolves YES if the tests pass.",
        "displayType": "binary",
        "id": "0x1234567890abcdef1234567890abcdef12345678",
        "imageURI": undefined,
        "outcomeOptions": undefined,
        "outcomes": [
          {
            "label": "YES",
            "odds": 85,
            "probability": 0.85,
          },
          {
            "label": "NO",
            "odds": 15,
            "probability": 0.15,
          },
        ],
        "rules": "Must be verified by vitest",
        "sourceOfTruth": "Test output logs",
        "status": "Open",
        "title": "Will the AI agent pass snapshot tests?",
        "type": "Prediction",
        "volume": "1000.50",
      }
    `);
  });
});
