export type AccessibilityRole = 'BODY_TEXT' | 'HEADING' | 'CTA_TEXT' | 'CAPTION' | 'UI_ELEMENT'

export interface AccessibilityColorPair {
  role: AccessibilityRole
  foreground: string
  background: string
}

export const ACCESSIBILITY_ROLE_CONFIG: Array<{
  role: AccessibilityRole
  label: string
  description: string
  targetRatio: number
}> = [
  { role: 'BODY_TEXT', label: 'Body text', description: 'Paragraphs and regular copy', targetRatio: 4.5 },
  { role: 'HEADING', label: 'Headings', description: 'Large headings (at least 24px regular or 18.66px bold)', targetRatio: 3 },
  { role: 'CTA_TEXT', label: 'CTA text', description: 'Text inside primary and secondary calls to action', targetRatio: 4.5 },
  { role: 'CAPTION', label: 'Captions', description: 'Small supporting text and footnotes', targetRatio: 4.5 },
  { role: 'UI_ELEMENT', label: 'UI elements', description: 'Essential icons, control boundaries and indicators', targetRatio: 3 },
]

export const DEFAULT_ACCESSIBILITY_PAIRS: AccessibilityColorPair[] = [
  { role: 'BODY_TEXT', foreground: '#17262A', background: '#FFFFFF' },
  { role: 'HEADING', foreground: '#115E59', background: '#EAF5F1' },
  { role: 'CTA_TEXT', foreground: '#FFFFFF', background: '#115E59' },
  { role: 'CAPTION', foreground: '#354442', background: '#FFFFFF' },
  { role: 'UI_ELEMENT', foreground: '#115E59', background: '#FFFFFF' },
]

export function normalizeAccessibilityPairs(value: unknown): AccessibilityColorPair[] {
  if (!Array.isArray(value)) return DEFAULT_ACCESSIBILITY_PAIRS.map((pair) => ({ ...pair }))
  const byRole = new Map<string, AccessibilityColorPair>()
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const pair = item as Record<string, unknown>
    if (
      typeof pair.role === 'string' &&
      ACCESSIBILITY_ROLE_CONFIG.some((config) => config.role === pair.role) &&
      typeof pair.foreground === 'string' &&
      typeof pair.background === 'string'
    ) {
      byRole.set(pair.role, {
        role: pair.role as AccessibilityRole,
        foreground: pair.foreground,
        background: pair.background,
      })
    }
  }
  return ACCESSIBILITY_ROLE_CONFIG.map((config) =>
    byRole.get(config.role) ?? DEFAULT_ACCESSIBILITY_PAIRS.find((pair) => pair.role === config.role)!,
  )
}
