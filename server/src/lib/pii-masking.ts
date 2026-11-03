import { randomBytes } from "node:crypto";

export const PII_TYPES = [
  "EMAIL",
  "UPI_ID",
  "INDIAN_PHONE",
  "AADHAAR",
  "PAN",
  "CREDIT_CARD",
] as const;

export type PiiType = (typeof PII_TYPES)[number];

export interface PiiMaskCategoryCount {
  type: PiiType;
  count: number;
}

export interface PiiMaskSummary {
  masked: boolean;
  totalUniqueValues: number;
  categories: PiiMaskCategoryCount[];
}

export interface PiiMaskingSession {
  mask(value: string): string;
  restore(value: string): string;
  summary(): PiiMaskSummary;
}

interface Detector {
  type: PiiType;
  expression: RegExp;
  isValid?: (value: string) => boolean;
}

interface PiiMatch {
  start: number;
  end: number;
  value: string;
  type: PiiType;
  priority: number;
}

function passesLuhn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

const DETECTORS: Detector[] = [
  {
    type: "EMAIL",
    expression: /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi,
  },
  {
    // UPI VPAs often use a provider handle without a dotted email domain.
    // A longer email match at the same position wins over this fallback pattern.
    type: "UPI_ID",
    expression: /\b[A-Z0-9][A-Z0-9._-]{1,63}@[A-Z][A-Z0-9-]{1,30}\b/gi,
  },
  {
    type: "PAN",
    expression: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi,
  },
  {
    type: "AADHAAR",
    // Supports contiguous or commonly grouped 12-digit Aadhaar-shaped values.
    // This is pattern detection, not a government-ID validity check.
    expression: /(?<!\d)[2-9](?:[\s-]?\d){11}(?![\s-]?\d)/g,
  },
  {
    type: "INDIAN_PHONE",
    expression: /(?<!\d)(?:(?:\+91|0091)[\s.-]?)?0?[6-9](?:[\s.-]?\d){9}(?![\s.-]?\d)/g,
  },
  {
    type: "CREDIT_CARD",
    expression: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g,
    isValid: passesLuhn,
  },
];

function collectMatches(value: string): PiiMatch[] {
  const matches: PiiMatch[] = [];
  DETECTORS.forEach((detector, priority) => {
    detector.expression.lastIndex = 0;
    for (const match of value.matchAll(detector.expression)) {
      const matchedValue = match[0];
      const start = match.index;
      if (start === undefined || !matchedValue || detector.isValid?.(matchedValue) === false) continue;
      matches.push({
        start,
        end: start + matchedValue.length,
        value: matchedValue,
        type: detector.type,
        priority,
      });
    }
  });

  // Prefer the longest high-confidence match when patterns overlap.
  matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || a.priority - b.priority);
  const selected: PiiMatch[] = [];
  let previousEnd = -1;
  for (const match of matches) {
    if (match.start < previousEnd) continue;
    selected.push(match);
    previousEnd = match.end;
  }
  return selected;
}

/** Returns source ranges recognized by the same detector used for masking. */
export function findPiiRanges(value: string): Array<{ start: number; end: number; type: PiiType }> {
  return collectMatches(value).map(({ start, end, type }) => ({ start, end, type }));
}

/**
 * Creates a request-scoped masker. The reversible token map is held only in
 * memory by this session and is never serialized or persisted.
 */
export function createPiiMaskingSession(): PiiMaskingSession {
  const nonce = randomBytes(6).toString("hex").toUpperCase();
  const tokenByValue = new Map<string, string>();
  const valueByToken = new Map<string, string>();
  const typeByToken = new Map<string, PiiType>();
  let nextToken = 1;

  const prefix = `[[BFPII_${nonce}_`;

  function mask(value: string): string {
    const matches = collectMatches(value);
    if (matches.length === 0) return value;

    let output = "";
    let cursor = 0;
    for (const match of matches) {
      output += value.slice(cursor, match.start);
      const key = `${match.type}\u0000${match.value}`;
      let token = tokenByValue.get(key);
      if (!token) {
        token = `${prefix}${match.type}_${String(nextToken).padStart(4, "0")}]]`;
        nextToken += 1;
        tokenByValue.set(key, token);
        valueByToken.set(token, match.value);
        typeByToken.set(token, match.type);
      }
      output += token;
      cursor = match.end;
    }
    return output + value.slice(cursor);
  }

  function restore(value: string): string {
    if (!value.includes(prefix)) return value;

    const tokenExpression = new RegExp(`\\[\\[BFPII_${nonce}_[A-Z_]+_[0-9]{4}\\]\\]`, "gi");
    const restored = value.replace(tokenExpression, (token) => {
      const original = valueByToken.get(token.toUpperCase());
      if (original === undefined) {
        throw new Error("An unknown sensitive-data placeholder was returned by the AI provider.");
      }
      return original;
    });

    if (restored.includes(prefix)) {
      throw new Error("A sensitive-data placeholder could not be safely restored.");
    }
    return restored;
  }

  function summary(): PiiMaskSummary {
    const counts = new Map<PiiType, number>();
    for (const type of typeByToken.values()) counts.set(type, (counts.get(type) ?? 0) + 1);
    return {
      masked: valueByToken.size > 0,
      totalUniqueValues: valueByToken.size,
      categories: PII_TYPES.flatMap((type) => {
        const count = counts.get(type) ?? 0;
        return count > 0 ? [{ type, count }] : [];
      }),
    };
  }

  return { mask, restore, summary };
}
