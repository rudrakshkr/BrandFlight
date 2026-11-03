export interface TextRange {
  start: number;
  end: number;
}

interface NumericMatch {
  value: string;
  start: number;
  end: number;
}

function extractNumericMatches(text: string): NumericMatch[] {
  const expression = /(?:₹|\$)?\s*\d+(?:[.,]\d+)?\s*(?:%|percent|days?|hours?|minutes?|months?|years?)?/gi;
  return [...text.matchAll(expression)].map((match) => {
    const start = match.index ?? 0;
    return {
      value: match[0],
      start,
      end: start + match[0].length,
    };
  });
}

function normalize(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

/**
 * Returns unique numerical expressions not present in approved facts.
 * Expressions overlapping a recognized PII range are ignored so that
 * identifier fragments are not misclassified as marketing claims.
 */
export function findUnverifiedNumericClaims(
  content: string,
  approvedFacts: readonly string[],
  excludedRanges: readonly TextRange[] = [],
): string[] {
  const approvedNumbers = new Set(
    approvedFacts.flatMap((fact) =>
      extractNumericMatches(fact).map((match) => normalize(match.value)),
    ),
  );
  const seen = new Set<string>();
  const claims: string[] = [];

  for (const match of extractNumericMatches(content)) {
    const overlapsExcludedRange = excludedRanges.some(
      (range) => match.start < range.end && match.end > range.start,
    );
    if (overlapsExcludedRange) continue;

    const claim = match.value.trim();
    const key = normalize(claim);
    if (approvedNumbers.has(key) || seen.has(key)) continue;

    seen.add(key);
    claims.push(claim);
  }

  return claims;
}
