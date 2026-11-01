export const ACCESSIBILITY_ROLE_TARGETS = {
  BODY_TEXT: 4.5,
  HEADING: 3,
  CTA_TEXT: 4.5,
  CAPTION: 4.5,
  UI_ELEMENT: 3,
} as const;

export type AccessibilityRole = keyof typeof ACCESSIBILITY_ROLE_TARGETS;

export interface AccessibilityColorPair {
  role: AccessibilityRole;
  foreground: string;
  background: string;
}

function parseHex(hex: string): [number, number, number] | null {
  const value = hex.trim();
  if (!/^#[0-9a-f]{6}$/i.test(value)) return null;
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && parseHex(value) !== null;
}

function linearize(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045
    ? srgb / 12.92
    : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground: string, background: string): number | null {
  const foregroundRgb = parseHex(foreground);
  const backgroundRgb = parseHex(background);
  if (!foregroundRgb || !backgroundRgb) return null;

  const luminance = (rgb: [number, number, number]) =>
    0.2126 * linearize(rgb[0]) +
    0.7152 * linearize(rgb[1]) +
    0.0722 * linearize(rgb[2]);
  const first = luminance(foregroundRgb);
  const second = luminance(backgroundRgb);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function mixHex(from: string, to: string, amount: number): string {
  const source = parseHex(from);
  const target = parseHex(to);
  if (!source || !target) return from.toUpperCase();
  const channels = source.map((channel, index) =>
    Math.round(channel + ((target[index] ?? channel) - channel) * amount),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function recommendAccessibleForeground(
  foreground: string,
  background: string,
  minimumRatio: number,
): string | null {
  if (!isHexColor(foreground) || !isHexColor(background)) return null;
  const currentRatio = contrastRatio(foreground, background);
  if (currentRatio !== null && currentRatio >= minimumRatio) return foreground.toUpperCase();

  const candidates: Array<{ color: string; distance: number }> = [];
  const source = parseHex(foreground)!;
  for (const endpoint of ["#000000", "#FFFFFF"] as const) {
    const endpointRatio = contrastRatio(endpoint, background);
    if (endpointRatio === null || endpointRatio < minimumRatio) continue;
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const middle = (low + high) / 2;
      const candidate = mixHex(foreground, endpoint, middle);
      if ((contrastRatio(candidate, background) ?? 0) >= minimumRatio) high = middle;
      else low = middle;
    }
    const color = mixHex(foreground, endpoint, high);
    const rgb = parseHex(color)!;
    const distance = rgb.reduce((sum, channel, index) => sum + (channel - (source[index] ?? channel)) ** 2, 0);
    candidates.push({ color, distance });
  }
  return candidates.sort((a, b) => a.distance - b.distance)[0]?.color ?? null;
}

/** Validate a complete manager-defined role palette and ensure each saved pair meets its WCAG target. */
export function parseAccessibilityColorPairs(value: unknown): AccessibilityColorPair[] | null {
  if (!Array.isArray(value) || value.length !== Object.keys(ACCESSIBILITY_ROLE_TARGETS).length) return null;

  const normalized = new Map<AccessibilityRole, AccessibilityColorPair>();
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const role = record.role;
    const foreground = record.foreground;
    const background = record.background;
    if (
      typeof role !== "string" || !Object.hasOwn(ACCESSIBILITY_ROLE_TARGETS, role) ||
      !isHexColor(foreground) || !isHexColor(background)
    ) return null;
    const typedRole = role as AccessibilityRole;
    if (normalized.has(typedRole)) return null;
    const ratio = contrastRatio(foreground, background);
    if (ratio === null || ratio + 1e-9 < ACCESSIBILITY_ROLE_TARGETS[typedRole]) return null;
    normalized.set(typedRole, {
      role: typedRole,
      foreground: foreground.toUpperCase(),
      background: background.toUpperCase(),
    });
  }

  return (Object.keys(ACCESSIBILITY_ROLE_TARGETS) as AccessibilityRole[])
    .map((role) => normalized.get(role))
    .filter((pair): pair is AccessibilityColorPair => Boolean(pair));
}
