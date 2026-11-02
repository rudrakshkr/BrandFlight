import { contrastRatio, isHexColor } from './lib/wcagContrast'
import {
  ACCESSIBILITY_ROLE_CONFIG,
  type AccessibilityColorPair,
} from './lib/accessibilityStandards'

interface Props {
  value: AccessibilityColorPair[]
  onChange: (value: AccessibilityColorPair[]) => void
}

export default function BrandAccessibilityStandards({ value, onChange }: Props) {
  const update = (role: AccessibilityColorPair['role'], field: 'foreground' | 'background', next: string) => {
    onChange(value.map((pair) => pair.role === role ? { ...pair, [field]: next } : pair))
  }

  return (
    <section className="bf-accessibility-standards" aria-labelledby="bf-accessibility-standards-title">
      <div className="bf-accessibility-standards-heading">
        <div>
          <span className="bf-contrast-eyebrow">SAVED BRAND RULES · ACCESSIBILITY</span>
          <h3 id="bf-accessibility-standards-title">Accessible colour roles</h3>
          <p>These are manager-approved reference colour pairs for each design role. BrandFlight checks each saved pair against its role's WCAG target and shows it as a reference during image review. For text in uploaded images, the audit measures the actual pixel colours and selects the WCAG threshold by text size: 4.5:1 for normal or unknown-size text, and 3:1 for large text. Saved hex values are references, not exact-match rules.</p>
        </div>
        <span className="bf-contrast-count">5 standards</span>
      </div>

      <div className="bf-accessibility-role-list">
        {ACCESSIBILITY_ROLE_CONFIG.map((config) => {
          const pair = value.find((item) => item.role === config.role)
          const foreground = pair?.foreground ?? ''
          const background = pair?.background ?? ''
          const valid = isHexColor(foreground) && isHexColor(background)
          const ratio = valid ? contrastRatio(foreground, background) : null
          const passes = ratio !== null && ratio >= config.targetRatio
          return (
            <article className="bf-accessibility-role-row" key={config.role}>
              <div className="bf-accessibility-role-copy">
                <strong>{config.label}</strong>
                <small>{config.description}</small>
                <span className={passes ? 'is-pass' : 'is-fail'}>
                  {ratio === null ? 'Enter valid hex colours' : `${ratio.toFixed(2)}:1 · ${passes ? 'Meets' : 'Below'} ${config.targetRatio.toFixed(1)}:1 target`}
                </span>
              </div>
              <div className="bf-accessibility-role-fields">
                <label>
                  <span>Text</span>
                  <span className="bf-accessibility-color-field">
                    <input
                      type="color"
                      aria-label={`${config.label} text colour picker`}
                      value={isHexColor(foreground) ? foreground : '#17262A'}
                      onChange={(event) => update(config.role, 'foreground', event.target.value.toUpperCase())}
                    />
                    <input
                      type="text"
                      aria-label={`${config.label} text hex`}
                      value={foreground}
                      maxLength={7}
                      placeholder="#17262A"
                      spellCheck={false}
                      onChange={(event) => update(config.role, 'foreground', event.target.value)}
                    />
                  </span>
                </label>
                <label>
                  <span>Background</span>
                  <span className="bf-accessibility-color-field">
                    <input
                      type="color"
                      aria-label={`${config.label} background colour picker`}
                      value={isHexColor(background) ? background : '#FFFFFF'}
                      onChange={(event) => update(config.role, 'background', event.target.value.toUpperCase())}
                    />
                    <input
                      type="text"
                      aria-label={`${config.label} background hex`}
                      value={background}
                      maxLength={7}
                      placeholder="#FFFFFF"
                      spellCheck={false}
                      onChange={(event) => update(config.role, 'background', event.target.value)}
                    />
                  </span>
                </label>
              </div>
            </article>
          )
        })}
      </div>
      <p className="bf-accessibility-standards-note">Save these reference pairs with the Brand Profile. They help teams keep a consistent accessible design treatment; they do not replace measurements of the uploaded artwork. Image text uses the WCAG threshold for its detected size (4.5:1 normal/unknown, 3:1 large), while essential non-text controls and graphics use the 3:1 reference target. A brand-profile change invalidates image-audit receipts created under the previous standards.</p>
    </section>
  )
}
