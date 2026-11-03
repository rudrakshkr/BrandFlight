import { useMemo, useState } from 'react'
import {
  contrastRatio,
  isHexColor,
  normalizeHex,
  recommendClosestPaletteSwatch,
} from './lib/wcagContrast'

interface Props {
  colors: string[]
}

const THRESHOLDS = [
  { label: 'Normal text · AA', ratio: 4.5, description: 'Minimum for most body text' },
  { label: 'Large text · AA', ratio: 3, description: '24px regular or about 19px bold' },
  { label: 'Normal text · AAA', ratio: 7, description: 'Enhanced contrast' },
  { label: 'Large text · AAA', ratio: 4.5, description: 'Enhanced contrast for large text' },
  { label: 'UI & graphics', ratio: 3, description: 'For essential controls and visual boundaries' },
] as const

export default function BrandContrastAnalyzer({ colors }: Props) {
  const palette = useMemo(
    () => [...new Set(colors.filter(isHexColor).map(normalizeHex))],
    [colors],
  )
  const [selectedForeground, setSelectedForeground] = useState<string | null>(null)
  const [selectedBackground, setSelectedBackground] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const foreground = selectedForeground ?? palette[0] ?? '#17262A'
  const background = selectedBackground ?? palette[palette.length - 1] ?? '#FFFFFF'
  const foregroundIsValid = isHexColor(foreground)
  const backgroundIsValid = isHexColor(background)
  const pairIsValid = foregroundIsValid && backgroundIsValid
  const previewForeground = foregroundIsValid ? normalizeHex(foreground) : '#17262A'
  const previewBackground = backgroundIsValid ? normalizeHex(background) : '#FFFFFF'
  const ratio = pairIsValid ? contrastRatio(foreground, background) : null

  const paletteRecommendation = useMemo(
    () => ratio !== null && ratio < 4.5
      ? recommendClosestPaletteSwatch(foreground, background, palette, 4.5)
      : null,
    [foreground, background, palette, ratio],
  )

  const selectForeground = (value: string) => {
    setSelectedForeground(value)
    setCopied(false)
    setCopyError('')
  }

  const selectBackground = (value: string) => {
    setSelectedBackground(value)
    setCopied(false)
    setCopyError('')
  }

  const copyRecommendation = async () => {
    if (!paletteRecommendation) return
    try {
      await navigator.clipboard.writeText(paletteRecommendation.color)
      setCopied(true)
      setCopyError('')
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
      setCopyError('Clipboard access is unavailable. Copy the hex value from the preview.')
    }
  }

  return (
    <section className="bf-contrast-analyzer" aria-labelledby="bf-contrast-title">
      <div className="bf-contrast-heading">
        <div>
          <span className="bf-contrast-eyebrow">ACCESSIBILITY · WCAG 2.1</span>
          <h3 id="bf-contrast-title">Brand colour contrast</h3>
          <p>Choose approved brand colours or enter custom hex values. Recommendations are always selected from the approved palette.</p>
        </div>
        <span className="bf-contrast-count">{palette.length} palette colours</span>
      </div>

      <div className="bf-contrast-controls">
        <div className="bf-contrast-control">
          <span className="bf-contrast-control-title">Text / foreground colour</span>
          <div className="bf-contrast-control-fields">
            <div className="bf-contrast-select-wrap">
              <i className="bf-contrast-swatch" style={{ backgroundColor: previewForeground }} aria-hidden="true" />
              <select
                aria-label="Choose foreground colour from saved palette"
                value={palette.includes(normalizeHex(foreground)) ? normalizeHex(foreground) : ''}
                onChange={(event) => selectForeground(event.target.value)}
              >
                <option value="">Choose saved colour</option>
                {palette.map((color) => <option key={color} value={color}>{color}</option>)}
              </select>
            </div>
            <input
              className="bf-contrast-hex-input"
              type="text"
              aria-label="Enter custom foreground hex colour"
              aria-invalid={!foregroundIsValid}
              value={foreground}
              onChange={(event) => selectForeground(event.target.value)}
              placeholder="#17262A"
              maxLength={7}
              spellCheck={false}
              autoCapitalize="characters"
              inputMode="text"
            />
          </div>
          {!foregroundIsValid && <small className="bf-contrast-field-error" role="status">Enter a valid hex code in #RRGGBB format.</small>}
        </div>

        <div className="bf-contrast-control">
          <span className="bf-contrast-control-title">Background colour</span>
          <div className="bf-contrast-control-fields">
            <div className="bf-contrast-select-wrap">
              <i className="bf-contrast-swatch" style={{ backgroundColor: previewBackground }} aria-hidden="true" />
              <select
                aria-label="Choose background colour from saved palette"
                value={palette.includes(normalizeHex(background)) ? normalizeHex(background) : ''}
                onChange={(event) => selectBackground(event.target.value)}
              >
                <option value="">Choose saved colour</option>
                {palette.map((color) => <option key={color} value={color}>{color}</option>)}
              </select>
            </div>
            <input
              className="bf-contrast-hex-input"
              type="text"
              aria-label="Enter custom background hex colour"
              aria-invalid={!backgroundIsValid}
              value={background}
              onChange={(event) => selectBackground(event.target.value)}
              placeholder="#FFFFFF"
              maxLength={7}
              spellCheck={false}
              autoCapitalize="characters"
              inputMode="text"
            />
          </div>
          {!backgroundIsValid && <small className="bf-contrast-field-error" role="status">Enter a valid hex code in #RRGGBB format.</small>}
        </div>
      </div>

      {palette.length === 0 && (
        <p className="bf-contrast-note">No saved palette colours are available. You can still enter custom hex values, but an approved swatch cannot be recommended until a manager adds brand colours.</p>
      )}

      <div className="bf-contrast-preview" style={{ color: previewForeground, backgroundColor: previewBackground }}>
        <span>LIVE PREVIEW</span>
        <strong>BrandFlight makes every message count.</strong>
        <p>Sample body text shows how this colour pairing reads at normal size.</p>
        <small>Small supporting text preview</small>
      </div>

      <div className="bf-contrast-ratio-row">
        <div>
          <span>Contrast ratio</span>
          <strong>{ratio === null ? '—' : `${ratio.toFixed(2)}:1`}</strong>
        </div>
        <span className={`bf-contrast-verdict ${ratio !== null && ratio >= 4.5 ? 'is-pass' : 'is-review'}`}>
          {!pairIsValid
            ? 'Enter valid hex values'
            : ratio !== null && ratio >= 4.5
              ? 'AA normal text passes'
              : 'AA normal text needs improvement'}
        </span>
      </div>

      <div className="bf-contrast-thresholds" aria-label="WCAG contrast thresholds">
        {THRESHOLDS.map((threshold) => {
          const passes = ratio === null ? null : ratio >= threshold.ratio
          return (
            <div className="bf-contrast-threshold" key={threshold.label}>
              <span className={`bf-contrast-threshold-dot ${passes === null ? 'is-pending' : passes ? 'is-pass' : 'is-fail'}`} aria-hidden="true">
                {passes === null ? '—' : passes ? '✓' : '!'}
              </span>
              <div>
                <strong>{threshold.label}</strong>
                <small>{threshold.ratio.toFixed(1)}:1 · {threshold.description}</small>
              </div>
              <em className={passes === null ? 'is-pending' : passes ? 'is-pass' : 'is-fail'}>
                {passes === null ? 'Enter hex' : passes ? 'Pass' : 'Fail'}
              </em>
            </div>
          )
        })}
      </div>

      {paletteRecommendation && (
        <div className="bf-contrast-recommendation">
          <div className="bf-contrast-recommendation-copy">
            <span>CLOSEST APPROVED SWATCH · AA NORMAL TEXT</span>
            <strong>{paletteRecommendation.color}</strong>
            <small>This is the closest colour in the approved brand palette that meets the 4.5:1 AA target against {previewBackground}. Contrast: {paletteRecommendation.ratio.toFixed(2)}:1. The saved palette has not been changed.</small>
          </div>
          <span className="bf-contrast-recommendation-swatch" style={{ backgroundColor: paletteRecommendation.color, color: previewBackground }} aria-label={`Recommended approved palette colour ${paletteRecommendation.color}`}>Aa</span>
          <div className="bf-contrast-recommendation-actions">
            <button type="button" className="bf-btn-secondary" onClick={() => selectForeground(paletteRecommendation.color)}>
              Preview approved swatch
            </button>
            <button type="button" className="bf-btn-secondary" onClick={() => void copyRecommendation()}>
              {copied ? 'Copied' : 'Copy hex'}
            </button>
          </div>
          {copyError && <p className="bf-contrast-copy-error" role="status">{copyError}</p>}
        </div>
      )}

      {ratio !== null && ratio < 4.5 && palette.length > 0 && !paletteRecommendation && (
        <p className="bf-contrast-no-recommendation" role="status">
          No approved palette colour meets the 4.5:1 AA target against {previewBackground}. Choose a different background or update the approved palette.
        </p>
      )}

      {!paletteRecommendation && ratio !== null && ratio >= 4.5 && (
        <p className="bf-contrast-pass-note">This pair meets the WCAG AA minimum for normal-sized text. Check the intended font size and weight in the actual design as well.</p>
      )}

      <p className="bf-contrast-disclaimer">
        This checks opaque six-digit hex pairs using the WCAG relative-luminance formula. It does not assess text over photographs, gradients, transparency, font sizing, layout, or full WCAG conformance. Recommendations are previews only and do not change the saved brand palette.
      </p>
    </section>
  )
}
