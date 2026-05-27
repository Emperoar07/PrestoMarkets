# Agent Market Question Format Change

## Summary

Changed agent market creation to use straightforward questions instead of news headlines, with the news summary moved to the market description field.

## Previous Behavior

**Example News Input:**
- News Topic: "Bitcoin Surges Past $100k on Regulatory Clarity"
- News Context: "Bitcoin's price jumped following clear regulatory guidance from the SEC"

**Previous Market Output:**
- Title: "Bitcoin Surges Past $100k on Regulatory Clarity?" (headline as question)
- Description: "Will Bitcoin Surges Past $100k on Regulatory Clarity?" (redundant)

## New Behavior

**Same News Input:**
- News Topic: "Bitcoin Surges Past $100k on Regulatory Clarity"
- News Context: "Bitcoin's price jumped following clear regulatory guidance from the SEC"

**New Market Output:**
- Title: "Will Bitcoin close above $100k by [date]?" (straightforward question)
- Description: "News: Bitcoin Surges Past $100k on Regulatory Clarity" (original headline preserved)

## Implementation Details

### Stage 3 Drafting Prompt Changes

1. **Input Labeling** - Clarified that `trend.topic` is a news headline:
   ```
   News headline or topic summary: "${trend.topic}"
   News context and details: "${trend.query}"
   ```

2. **Title Guidance** - Emphasized straightforward questions over headlines:
   ```
   - Title must be a clear STRAIGHTFORWARD QUESTION under 90 characters
   - Generate questions like "Will X happen by Y?" or "Will X exceed Y?"
   - Do NOT make the title a copy of the news headline
   ```

3. **Description Guidance** - Include original news in description:
   ```
   - Description should include the original news topic/headline as context
   ```

### Fallback Template Changes

When all LLM providers fail, the template now:
- Generates straightforward questions: `Will ${sanitized_topic}?`
- Includes original news in description: `News: ${original_topic}`
- Maintains price-range market behavior unchanged

## Examples of Questions Generated

| News Headline | Generated Question |
|---|---|
| "Apple Announces New AI Features" | "Will Apple's new AI features be widely adopted by [date]?" |
| "Fed Cuts Interest Rates 0.5%" | "Will the Fed's interest rate cut boost market recovery by [date]?" |
| "Tesla Announces New Model" | "Will Tesla's new model pre-orders exceed 100k by [date]?" |
| "Bitcoin Surges Past $100k" | "Will Bitcoin close above $100k by [date]?" |

## Benefits

1. **Clearer Market Intent** - Questions explicitly state what's being predicted
2. **Better Trader Experience** - Straightforward questions are easier to understand and trade
3. **Preserved Context** - Original news headlines still available in description for full context
4. **Consistency** - Follows sports/event market pattern: "Will [team] win?" vs headlines

## Testing

Run the agent pipeline test to verify straightforward question generation:
```bash
npx ts-node src/lib/__tests__/agentPipeline.test.ts
```

All tests verify:
- ✓ News headlines become straightforward questions
- ✓ Original headlines preserved in description
- ✓ Price-range markets maintain current behavior
- ✓ Question formatting and length validation
