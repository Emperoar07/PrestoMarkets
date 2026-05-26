/**
 * Hide source URLs from market display.
 * Users see market questions, not the data sources behind them.
 */

export function stripSourceFromDescription(description: string): string {
  // Remove "Source: URL" patterns
  return description
    .replace(/\n*source:[\s\S]*$/i, '')
    .replace(/\n*evidence:[\s\S]*$/i, '')
    .trim();
}

export function stripSourceFromRules(rules: string): string {
  // Remove URLs and "check here" references
  return rules
    .replace(/https?:\/\/\S+/g, '')
    .replace(/source of truth.*$/i, '')
    .trim();
}
