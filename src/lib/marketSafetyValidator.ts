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

// Whole-word matchers with inflection tolerance. Plain substring matching produced
// false positives ("deadline"→dead, "studied"→die, "diet"→die); a bare \b...\b under-
// matched inflected forms ("murdered"→murder, "crashes"→crash). So we anchor a word
// boundary at the start and allow a common inflectional suffix before the trailing
// boundary: "murdered"/"died"/"crashes" match, "deadline"/"diet" do not.
const HARMFUL_RE = new RegExp(`\\b(?:${HARMFUL_KEYWORDS.join('|')})(?:s|es|d|ed|ing)?\\b`, 'i');
const REAL_PERSON_RE = new RegExp(`\\b(?:${REAL_PERSON_INDICATORS.join('|')})s?\\b`, 'i');

/**
 * Check if a market topic is harmful (death/tragedy speculation on real people).
 * Returns error reason if harmful, or {ok: true} if safe to create.
 *
 * This is a deterministic first-pass gate; the agent pipeline also runs an LLM
 * safety review (safetyCheckWithHaiku) for nuance this keyword list cannot catch.
 */
export function validateMarketSafety(
  title: string,
  description: string,
  rules: string,
): SafetyCheckResult {
  const combinedText = `${title} ${description} ${rules}`;

  // Check for harmful keywords (whole-word)
  if (!HARMFUL_RE.test(combinedText)) {
    return { ok: true };
  }

  // If a harmful keyword is present, only block when it is about a real person
  const hasRealPersonIndicator = REAL_PERSON_RE.test(combinedText);

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
