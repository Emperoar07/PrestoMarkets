/**
 * Hide source URLs from market display.
 * Users see market questions, not the data sources behind them.
 */

export function stripSourceFromDescription(description: string): string {
  // Remove "Source: URL" patterns (must start at line beginning)
  return description
    .replace(/\nsource:[\s\S]*$/i, '')
    .replace(/\nevidence:[\s\S]*$/i, '')
    .trim();
}
