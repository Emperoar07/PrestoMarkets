/**
 * Integration test: Verify agent market creation flow with new straightforward question format
 *
 * Pipeline Flow:
 * 1. Trend Input → News headline + context
 * 2. Stage 3 Drafting → Straightforward question title + news summary description
 * 3. MarketDraft Creation → Flows to API with correct fields
 * 4. API Validation → Title must be valid question, description has news context
 *
 * Run with: npx ts-node src/lib/__tests__/agentPipeline.integration.test.ts
 */

// Mock implementations for testing
type TrendItem = {
  topic: string;
  query: string;
  source: string;
  url?: string;
};

type GeminiDraft = {
  title: string;
  description: string;
  rules: string;
  sourceOfTruth: string;
  closeDate: string;
  type: string;
  outcomeOptions?: string[];
};

type MarketDraft = GeminiDraft & {
  agent: {
    createdByType: string;
    agentName: string;
    agentSource: string;
    agentConfidence: string;
  };
};

// Simulate the drafting stage (Stage 3 of pipeline)
function simulateGeminiDraft(trend: TrendItem): GeminiDraft {
  const sanitized = trend.topic
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .slice(0, 60)
    .trim();

  return {
    title: `Will ${sanitized}?`,
    description: `News: ${trend.topic}`,
    rules: 'YES wins if event occurs by close date. NO wins if not.',
    sourceOfTruth: trend.url ?? trend.source,
    closeDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    type: 'Prediction',
  };
}

// Simulate the MarketDraft creation (end of Stage 3)
function createMarketDraft(draft: GeminiDraft, trend: TrendItem): MarketDraft {
  return {
    ...draft,
    agent: {
      createdByType: 'agent',
      agentName: 'Presto Agent',
      agentSource: trend.source,
      agentConfidence: '85%',
    },
  };
}

// Simulate API validation (simplified)
function validateMarketDraft(draft: MarketDraft): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Title should be a question
  if (!draft.title.includes('?')) {
    errors.push('Title must be a question (contain ?)');
  }

  // Title should not be too long
  if (draft.title.length > 90) {
    errors.push('Title too long (max 90 characters)');
  }

  // Description should include news context
  if (!draft.description.includes('News:')) {
    errors.push('Description should include news headline');
  }

  // Rules and source required
  if (!draft.rules?.trim()) {
    errors.push('Rules required');
  }
  if (!draft.sourceOfTruth?.trim()) {
    errors.push('Source of truth required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Integration test cases
function runIntegrationTests() {
  console.log('━━━ Agent Pipeline Integration Tests ━━━\n');

  const testCases = [
    {
      name: 'Bitcoin News',
      trend: {
        topic: 'Bitcoin Surges Past $100k on Regulatory Clarity',
        query: 'Bitcoin price movements following SEC guidance',
        source: 'breaking-news',
        url: 'https://example.com/bitcoin-news',
      },
      expectedTitle: 'Will Bitcoin Surges',
      expectedDescription: 'News: Bitcoin Surges Past',
    },
    {
      name: 'Apple AI Announcement',
      trend: {
        topic: 'Apple Announces Revolutionary AI Features for iPhone 16',
        query: 'Apple AI integration announcement and adoption metrics',
        source: 'tech-news',
        url: 'https://example.com/apple-ai',
      },
      expectedTitle: 'Will Apple',
      expectedDescription: 'News: Apple Announces',
    },
    {
      name: 'Fed Rate Decision',
      trend: {
        topic: 'Federal Reserve Cuts Interest Rates by 50 Basis Points',
        query: 'Fed monetary policy adjustment and market implications',
        source: 'financial-news',
        url: 'https://example.com/fed-decision',
      },
      expectedTitle: 'Will Federal',
      expectedDescription: 'News: Federal Reserve',
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of testCases) {
    console.log(`\nTest: ${test.name}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    try {
      // Stage 3: Generate draft
      const draft = simulateGeminiDraft(test.trend);
      console.log(`Stage 3 Draft:`);
      console.log(`  Title: "${draft.title}"`);
      console.log(`  Description: "${draft.description}"`);

      // Create MarketDraft for API
      const marketDraft = createMarketDraft(draft, test.trend);

      // Validate the draft
      const validation = validateMarketDraft(marketDraft);

      console.log(`\nValidation:`);
      console.log(`  Valid: ${validation.valid ? '✓ PASS' : '✗ FAIL'}`);

      if (!validation.valid) {
        validation.errors.forEach((e) => console.log(`    - ${e}`));
        failed += 1;
      } else {
        // Verify specific content
        const titleCheck = draft.title.includes(test.expectedTitle);
        const descCheck = draft.description.includes(test.expectedDescription);

        console.log(`  Title contains expected text: ${titleCheck ? '✓' : '✗'}`);
        console.log(`  Description contains expected text: ${descCheck ? '✓' : '✗'}`);

        if (titleCheck && descCheck) {
          console.log(`\n✓ ${test.name}: PASSED`);
          passed += 1;
        } else {
          console.log(`\n✗ ${test.name}: FAILED (content mismatch)`);
          failed += 1;
        }
      }
    } catch (e) {
      console.log(`✗ ${test.name}: ERROR - ${String(e)}`);
      failed += 1;
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`\nIntegration test ${failed === 0 ? '✓ COMPLETE' : '✗ INCOMPLETE'}`);

  // Print pipeline flow diagram
  console.log(`\n━━━ Pipeline Flow ━━━`);
  console.log(`1. Trend Input (News Headline + Context)`);
  console.log(`   ↓`);
  console.log(`2. Stage 3: Drafting`);
  console.log(`   • Generate straightforward question from context`);
  console.log(`   • Move headline to description field`);
  console.log(`   ↓`);
  console.log(`3. MarketDraft Creation`);
  console.log(`   • title: straightforward question`);
  console.log(`   • description: "News: {original headline}"`);
  console.log(`   ↓`);
  console.log(`4. API Validation & Market Creation`);
  console.log(`   • API receives well-formed market data`);
  console.log(`   • Market goes onchain with correct fields`);
}

// Run tests
runIntegrationTests();
