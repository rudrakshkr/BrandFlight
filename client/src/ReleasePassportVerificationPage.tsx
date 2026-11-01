import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import BrandFlightLogo from './BrandFlightLogo'

interface VerificationResponse {
  valid: boolean
  status: 'VALID' | 'INVALIDATED' | 'NOT_FOUND' | string
  passportId?: string
  passportHash?: string
  issuedAt?: string
  campaign?: {
    title: string
    brandName: string
  }
  approval?: {
    reviewerName: string
    approvedAt: string
    decision: 'APPROVED' | string
  } | null
  checks?: {
    passportSignature: boolean
    campaignSnapshot: boolean
    textAuditReceipt: boolean
    imageAuditReceipt: boolean | null
    approvalState: boolean
  }
  audit?: {
    textSemanticStatus: 'completed' | 'unavailable'
    image: 'completed' | 'not_applicable'
  } | null
  message?: string
}

interface Props {
  apiBaseUrl: string
}

function formatDate(value?: string) {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : date.toLocaleString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
}

function shortHash(value?: string) {
  if (!value) return 'Unavailable'
  return `${value.slice(0, 18)}…${value.slice(-10)}`
}

export default function ReleasePassportVerificationPage({ apiBaseUrl }: Props) {
  const { passportId } = useParams()
  const [result, setResult] = useState<VerificationResponse | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'not-found' | 'error'>('loading')
  const [error, setError] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const pageState = passportId ? state : 'not-found'

  useEffect(() => {
    if (!passportId) return;

    const controller = new AbortController()
    const verify = async () => {
      setState('loading')
      setError('')
      setResult(null)

      try {
        const response = await fetch(
          `${apiBaseUrl}/api/submissions/passport/${encodeURIComponent(passportId)}/verify`,
          { signal: controller.signal, headers: { Accept: 'application/json' } },
        )
        const data = await response.json().catch(() => null) as VerificationResponse | null

        if (response.status === 404 || data?.status === 'NOT_FOUND') {
          setResult(data)
          setState('not-found')
          return
        }
        if (!response.ok || !data) {
          throw new Error(data?.message || `Verification service returned HTTP ${response.status}.`)
        }

        setResult(data)
        setState('ready')
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Unable to verify this release passport.')
        setState('error')
      }
    }

    void verify()
    return () => controller.abort()
  }, [apiBaseUrl, passportId, retryCount])

  const checkRows = result?.checks ? [
    {
      key: 'passport',
      title: 'Passport signature',
      detail: 'The approval snapshot has a valid BrandFlight signature.',
      passed: result.checks.passportSignature,
      notApplicable: false,
    },
    {
      key: 'campaign',
      title: 'Campaign version',
      detail: 'The campaign title, brand and content still match the approved snapshot.',
      passed: result.checks.campaignSnapshot,
      notApplicable: false,
    },
    {
      key: 'text',
      title: 'Text preflight & brand rules',
      detail: 'The saved text audit receipt matches the campaign and current text rules and approved facts.',
      passed: result.checks.textAuditReceipt,
      notApplicable: false,
    },
    {
      key: 'image',
      title: 'Image preflight',
      detail: result.checks.imageAuditReceipt === null
        ? 'No campaign image was included in this approval.'
        : 'The saved image audit receipt matches the approved image, alt text and brand colour settings.',
      passed: result.checks.imageAuditReceipt,
      notApplicable: result.checks.imageAuditReceipt === null,
    },
    {
      key: 'approval',
      title: 'Approval decision',
      detail: 'The campaign is still approved by the reviewer recorded in this passport.',
      passed: result.checks.approvalState,
      notApplicable: false,
    },
  ] : []

  return (
    <main className="bf-passport-verify-page">
      <div className="bf-passport-verify-shell">
        <header className="bf-passport-verify-header">
          <a className="bf-passport-brand" href="/" aria-label="BrandFlight home">
            <BrandFlightLogo variant="verification" />
          </a>
          <span className="bf-passport-header-label">RELEASE PASSPORT</span>
        </header>

        {pageState === 'loading' && (
          <section className="bf-passport-state-card" aria-live="polite">
            <span className="bf-passport-loader" aria-hidden="true" />
            <h1>Checking release passport</h1>
            <p>Comparing the approval record with the current campaign and audit evidence.</p>
          </section>
        )}

        {pageState === 'not-found' && (
          <section className="bf-passport-state-card bf-passport-state-error" role="alert">
            <span className="bf-passport-state-icon" aria-hidden="true">?</span>
            <p className="bf-passport-eyebrow">PUBLIC VERIFICATION</p>
            <h1>Passport not found</h1>
            <p>This link may be incorrect, or the release passport is no longer available.</p>
          </section>
        )}

        {pageState === 'error' && (
          <section className="bf-passport-state-card bf-passport-state-error" role="alert">
            <span className="bf-passport-state-icon" aria-hidden="true">!</span>
            <p className="bf-passport-eyebrow">VERIFICATION UNAVAILABLE</p>
            <h1>We could not check this passport</h1>
            <p>{error}</p>
            <button type="button" className="bf-passport-retry" onClick={() => setRetryCount((count) => count + 1)}>Try again</button>
          </section>
        )}

        {pageState === 'ready' && result && (
          <>
            <section className={`bf-passport-result-hero ${result.valid ? 'is-valid' : 'is-invalid'}`}>
              <div className="bf-passport-result-copy">
                <p className="bf-passport-eyebrow">PUBLIC VERIFICATION REPORT</p>
                <div className="bf-passport-result-title-row">
                  <span className="bf-passport-result-icon" aria-hidden="true">{result.valid ? '✓' : '!'}</span>
                  <div>
                    <h1>{result.valid ? 'Release passport verified' : 'Verification needs attention'}</h1>
                    <p>{result.valid
                      ? 'This campaign matches the version and approval record held by BrandFlight.'
                      : 'This passport did not pass every check. Review the mismatches below before relying on this approval record.'}</p>
                  </div>
                </div>
              </div>
              <span className="bf-passport-status-pill">{result.valid ? 'VERIFIED' : 'NOT VERIFIED'}</span>
            </section>

            <section className="bf-passport-campaign-card" aria-labelledby="bf-passport-campaign-title">
              <div className="bf-passport-section-heading">
                <div>
                  <p className="bf-passport-eyebrow">APPROVED CAMPAIGN</p>
                  <h2 id="bf-passport-campaign-title">{result.campaign?.title || 'Campaign details unavailable'}</h2>
                </div>
                <span className="bf-passport-brand-chip">{result.campaign?.brandName || 'Brand not available'}</span>
              </div>
              <div className="bf-passport-meta-grid">
                <div>
                  <span>Approved by</span>
                  <strong>{result.approval?.reviewerName || 'Reviewer details unavailable'}</strong>
                </div>
                <div>
                  <span>Approval date</span>
                  <strong>{formatDate(result.approval?.approvedAt)}</strong>
                </div>
                <div>
                  <span>Passport issued</span>
                  <strong>{formatDate(result.issuedAt)}</strong>
                </div>
                <div>
                  <span>Decision</span>
                  <strong>{result.approval?.decision === 'APPROVED' ? 'Approved' : 'Unavailable'}</strong>
                </div>
              </div>
            </section>

            <section className="bf-passport-checks-section" aria-labelledby="bf-passport-checks-title">
              <div className="bf-passport-section-heading bf-passport-checks-heading">
                <div>
                  <p className="bf-passport-eyebrow">INTEGRITY CHECKS</p>
                  <h2 id="bf-passport-checks-title">What did BrandFlight verify?</h2>
                  <p>Each check compares the issued record with the current campaign state.</p>
                </div>
                <strong className="bf-passport-check-count">{checkRows.filter((check) => !check.notApplicable && check.passed === true).length} / {checkRows.filter((check) => !check.notApplicable).length} required checks verified</strong>
              </div>
              <div className="bf-passport-check-list">
                {checkRows.map((check) => (
                  <article className={`bf-passport-check-row ${check.passed === true || check.notApplicable ? 'is-passed' : 'is-failed'}`} key={check.key}>
                    <span className="bf-passport-check-icon" aria-hidden="true">{check.notApplicable ? '—' : check.passed ? '✓' : '!'}</span>
                    <div>
                      <h3>{check.title}</h3>
                      <p>{check.detail}</p>
                    </div>
                    <strong>{check.notApplicable ? 'Not applicable' : check.passed ? 'Verified' : 'Mismatch'}</strong>
                  </article>
                ))}
              </div>
            </section>

            <section className="bf-passport-audit-note">
              <div>
                <p className="bf-passport-eyebrow">AUDIT SUMMARY</p>
                <h2>Preflight evidence</h2>
              </div>
              <div className="bf-passport-audit-values">
                <span><strong>Text semantic review</strong>{result.audit?.textSemanticStatus === 'completed' ? 'Completed' : 'Unavailable'}</span>
                <span><strong>Image audit</strong>{result.audit ? (result.audit.image === 'completed' ? 'Completed' : 'Not applicable') : 'Unavailable'}</span>
              </div>
            </section>

            <section className="bf-passport-reference-card">
              <div>
                <p className="bf-passport-eyebrow">RECORD REFERENCE</p>
                <h2>Snapshot fingerprint</h2>
                <p>This fingerprint identifies the signed approval snapshot. It is not the campaign content itself.</p>
              </div>
              <code title={result.passportHash}>{shortHash(result.passportHash)}</code>
            </section>

            <footer className="bf-passport-disclaimer">
              <span aria-hidden="true">i</span>
              <p>A verified passport confirms the integrity of the recorded approval, campaign snapshot and audit evidence. It is not a legal compliance certificate and does not independently prove that marketing claims are true.</p>
            </footer>
            <div className="bf-passport-page-footer">
              <span>BrandFlight · Public, read-only verification</span>
              <button type="button" onClick={() => setRetryCount((count) => count + 1)}>Recheck</button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
