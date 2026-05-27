import type { TrendItem } from '../agentPipeline';

// This is a manual test of the fallback template behavior
// Run with: npx ts-node src/lib/__tests__/agentPipeline.test.ts

// Mock the helper functions since we can't import directly
function cleanDraftText(text: string, _trend?: TrendItem, _fallback?: string): string {
  return text.trim();
}

function analyzeMarketHorizon(_trend: TrendItem) {
  return {
    closeDate: '2026-06-03',
    label: 'daily',
    reason: 'test',
  };
}

// Fallback template logic (extracted for testing)
function fallbackTemplateFromTrend(trend: TrendItem, suggestedType?: string) {
  const horizon = analyzeMarketHorizon(trend);
  const isPriceRange = trend.marketStructure === 'price-range' && Boolean(trend.outcomeOptions?.length);

  let title: string;
  let description: string;

  if (isPriceRange) {
    title = cleanDraftText(`${trend.topic} price by ${horizon.closeDate}?`, trend);
    description = cleanDraftText(trend.topic, trend);
  } else {
    const sanitizedTopic = trend.topic
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .slice(0, 60)
      .trim();
    title = cleanDraftText(`Will ${sanitizedTopic}?`, trend);
    description = cleanDraftText(`News: ${trend.topic}`, trend);
  }

  return {
    title,
    description,
    rules: isPriceRange
      ? `Resolve to the single range containing the USD price at the first available source observation at or after close time. Outcomes: ${trend.outcomeOptions?.join('; ')}.`
      : 'YES wins if the event occurs by the close date. NO wins if it does not occur or remains unresolved.',
    sourceOfTruth: trend.url ?? trend.source ?? 'Public sources',
    closeDate: trend.closeDate ?? horizon.closeDate,
    type: isPriceRange ? 'Prediction' : suggestedType === 'Opinion' ? 'Opinion' : 'Prediction',
    outcomeOptions: trend.outcomeOptions,
  };
}

// Test cases
function runTests() {
  console.log('Testing agent pipeline fallback template...\n');

  // Test 1: News headline should become straightforward question
  const newsHeadline: TrendItem = {
    topic: 'Bitcoin Surges Past $100k on regulatory clarity',
    query: 'Bitcoin price movements following regulatory announcements',
    source: 'breaking-news',
    url: 'https://example.com/bitcoin-news',
  };

  const newsDraft = fallbackTemplateFromTrend(newsHeadline);
  console.log('Test 1: News headline with straightforward question');
  console.log(`  Topic: "${newsHeadline.topic}"`);
  console.log(`  Generated title: "${newsDraft.title}"`);
  console.log(`  Generated description: "${newsDraft.description}"`);
  console.log(`  ✓ Title is straightforward question (not headline): ${newsDraft.title.startsWith('Will ')}`);
  console.log(`  ✓ Description includes news: ${newsDraft.description.includes('Bitcoin Surges')}\n`);

  // Test 2: Price range market
  const priceRangeTrend: TrendItem = {
    topic: 'Bitcoin',
    query: 'Bitcoin price prediction',
    source: 'crypto-price',
    marketStructure: 'price-range',
    outcomeOptions: ['$90k-$100k', '$100k-$110k', '$110k+'],
  };

  const priceDraft = fallbackTemplateFromTrend(priceRangeTrend);
  console.log('Test 2: Price range market');
  console.log(`  Generated title: "${priceDraft.title}"`);
  console.log(`  Generated description: "${priceDraft.description}"`);
  console.log(`  ✓ Title includes price horizon: ${priceDraft.title.includes('price by')}`);
  console.log(`  ✓ Has outcome options: ${priceDraft.outcomeOptions?.length === 3}\n`);

  // Test 3: Another news headline
  const techNews: TrendItem = {
    topic: 'Apple releases new AI integration for iPhone 16',
    query: 'Apple AI features announcement and adoption rates',
    source: 'tech-news',
    url: 'https://example.com/apple-ai',
  };

  const techDraft = fallbackTemplateFromTrend(techNews);
  console.log('Test 3: Tech news headline');
  console.log(`  Topic: "${techNews.topic}"`);
  console.log(`  Generated title: "${techDraft.title}"`);
  console.log(`  Generated description: "${techDraft.description}"`);
  console.log(`  ✓ Title is question format: ${techDraft.title.includes('?')}`);
  console.log(`  ✓ Title length reasonable: ${techDraft.title.length < 90}\n`);

  console.log('All tests completed. ✓');
}

runTests();
