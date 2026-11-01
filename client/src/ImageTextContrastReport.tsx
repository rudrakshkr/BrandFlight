import type { ImageTextContrastAnalysis } from './types/imageAudit'

interface Props {
  analysis?: ImageTextContrastAnalysis | null
}

const ROLE_LABELS: Record<string, string> = {
  BODY_TEXT: 'Body text',
  HEADING: 'Heading',
  CTA_TEXT: 'Call to action',
  CAPTION: 'Caption',
  UI_ELEMENT: 'UI element',
  UNKNOWN: 'Unclassified text',
}

export default function ImageTextContrastReport({ analysis }: Props) {
  if (!analysis) return null

  const hasLegacyEstimates = analysis.regions.some((region) =>
    region.measurement !== 'PIXEL_SAMPLE' && region.measurement !== 'MANUAL_REVIEW',
  )
  const statusLabel = hasLegacyEstimates
    ? 'Legacy AI estimate · re-run required'
    : {
        ANALYZED: 'Pixel sampling complete',
        NO_TEXT_DETECTED: 'No visible text detected',
        NEEDS_REVIEW: 'Manual review required',
        UNAVAILABLE: 'Screening unavailable',
      }[analysis.status]

  return (
    <section className={`bf-image-text-contrast-report status-${analysis.status.toLowerCase()}`} aria-label="Image text contrast analysis">
      <div className="bf-image-text-contrast-heading">
        <div>
          <span className="bf-contrast-eyebrow">ACCESSIBILITY · IMAGE PREFLIGHT</span>
          <h3>Text contrast screening</h3>
          <p>{analysis.summary}</p>
        </div>
        <span className={`bf-image-text-contrast-status ${analysis.status.toLowerCase()}`}>{statusLabel}</span>
      </div>
      <p className="bf-image-text-contrast-method">
        {hasLegacyEstimates
          ? 'This saved result predates deterministic pixel sampling. Its earlier foreground/background colours and contrast ratios were AI visual estimates and must not be used for pass/fail decisions. Run Image Audit again to replace this legacy result.'
          : <>
              {analysis.standardsConfigured
                ? 'Manager-saved accessible colour role pairs are configured; the audit measures the actual sampled colours against WCAG thresholds.'
                : 'No Manager colour-role pairs have been saved; default WCAG AA thresholds still apply.'}
              {' '}Gemini locates text regions and estimates their role and size. Foreground and background colours are sampled from the uploaded image pixels, not supplied by the AI. Variable, transparent, multicolour or uncertain regions are sent for manual review.
            </>}
      </p>
      {analysis.regions.length > 0 && (
        <div className="bf-image-text-contrast-regions">
          {analysis.regions.map((region, index) => (
            <article className={`bf-image-text-contrast-region ${region.measurement ? region.evaluation.toLowerCase() : 'manual_review'}`} key={`${region.location}-${index}`}>
              <div className="bf-image-text-contrast-region-top">
                <div>
                  <strong>{ROLE_LABELS[region.role] ?? 'Text region'}</strong>
                  <small>{region.location || 'Location not specified'} · {region.confidence.toLowerCase()} confidence</small>
                </div>
                <span className={`bf-image-text-contrast-verdict ${region.measurement ? region.evaluation.toLowerCase() : 'manual_review'}`}>
                  {!region.measurement
                    ? 'Legacy AI estimate · re-run'
                    : region.evaluation === 'PIXEL_PASS' ? 'Pixel-sampled pass' : region.evaluation === 'PIXEL_FAIL' ? 'Below target' : 'Manual review'}
                </span>
              </div>
              {region.text && <p className="bf-image-text-contrast-excerpt">“{region.text}”</p>}
              <div className="bf-image-text-colour-pair">
                <span>
                  <i style={{ backgroundColor: region.foregroundHex || '#E5E7EB' }} />
                  <small>Text</small>
                  <code>{region.foregroundHex || 'Unclear'}</code>
                </span>
                <span>
                  <i style={{ backgroundColor: region.backgroundHex || '#E5E7EB' }} />
                  <small>Background</small>
                  <code>{region.backgroundHex || region.backgroundType.toLowerCase()}</code>
                </span>
                <strong>{region.contrastRatio === null ? '—' : `${!region.measurement ? 'AI est. ' : ''}${region.contrastRatio.toFixed(2)}:1`}</strong>
                <small>Target {region.targetRatio.toFixed(1)}:1</small>
              </div>
              {region.recommendedForeground && (
                <p className="bf-image-text-contrast-recommendation">
                  Suggested text colour: <code>{region.recommendedForeground}</code>. Confirm it in the source design before publishing.
                </p>
              )}
              {region.measurementNote && <p className="bf-image-text-contrast-note">{region.measurementNote}</p>}
              {region.note && <p className="bf-image-text-contrast-note">{region.note}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
