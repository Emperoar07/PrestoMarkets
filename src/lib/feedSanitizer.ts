const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+(instructions|prompts|context)/gi,
  /disregard\s+(all\s+)?(prior|previous|earlier)\s+(instructions|prompts|context)/gi,
  /\bsystem\s*[:>]/gi,
  /\bassistant\s*[:>]/gi,
  /<\s*\/?\s*(system|assistant|user|instructions?)\s*>/gi,
  /###+\s*(system|instruction|prompt)/gi,
  /\[\s*(system|instruction|prompt)\s*\]/gi,
];

function safeCodePoint(value: number, fallback: string): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) {
    return fallback;
  }
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith('#x')) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return safeCodePoint(codePoint, match);
    }
    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return safeCodePoint(codePoint, match);
    }
    return NAMED_ENTITIES[normalized] ?? match;
  });
}

export function sanitizeFeedText(value: string): string {
  let out = decodeHtmlEntities(value).replace(/<[^>]+>/g, ' ');
  for (const pattern of INJECTION_PATTERNS) {
    out = out.replace(pattern, '[redacted]');
  }
  return out.replace(/\s+/g, ' ').trim();
}
