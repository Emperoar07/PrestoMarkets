/**
 * Content safety validation for agent-created markets.
 * Prevents creation of markets that profit from harm, death, or tragedy.
 */

const HARMFUL_KEYWORDS = [
  'die',
  'death',
  'dead',
  'dies',
  'killed',
  'killing',
  'accident',
  'crash',
  'disaster',
  'tragedy',
  'suicide',
  'murder',
  'fatal',
  'fatality',
];

const REAL_PERSON_INDICATORS = [
  'founder',
  'ceo',
  'president',
  'minister',
  'politician',
  'actor',
  'celebrity',
  'executive',
];

export type SafetyCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Check if a market topic is harmful (death/tragedy speculation on real people).
 * Returns error reason if harmful, or {ok: true} if safe to create.
 */
export function validateMarketSafety(
  title: string,
  description: string,
  rules: string,
): SafetyCheckResult {
  const combinedText = `${title} ${description} ${rules}`.toLowerCase();

  // Check for harmful keywords
  const hasHarmfulKeyword = HARMFUL_KEYWORDS.some(keyword =>
    combinedText.includes(keyword),
  );

  if (!hasHarmfulKeyword) {
    return { ok: true };
  }

  // If harmful keyword present, check if about real person
  const hasRealPersonIndicator = REAL_PERSON_INDICATORS.some(indicator =>
    combinedText.includes(indicator),
  );

  if (hasRealPersonIndicator) {
    return {
      ok: false,
      reason:
        'Markets speculating on deaths, accidents, or tragedies involving real people cannot be created. ' +
        'This protects individuals and their families from harm.',
    };
  }

  return { ok: true };
}
