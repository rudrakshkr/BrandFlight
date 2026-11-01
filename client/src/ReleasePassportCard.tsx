import { useState } from 'react'

interface Passport {
  id: string
  passportHash: string
  issuedAt: string
}

interface Props {
  passport: Passport | null | undefined
  /** Retained for existing component call sites; verification links use the frontend origin. */
  apiBaseUrl: string
}

export default function ReleasePassportCard({ passport }: Props) {
  const [copied, setCopied] = useState(false)
  if (!passport) {
    return (
      <section className="bf-release-passport bf-release-passport-unavailable" aria-label="Release passport unavailable">
        <div className="bf-release-passport-topline"><span>BRANDFLIGHT RELEASE PASSPORT</span><strong>NOT ISSUED</strong></div>
        <h3>No passport on record</h3>
        <p className="bf-release-passport-copy">This campaign was approved before Release Passport issuance was enabled. Newly approved campaigns receive a verifiable release record.</p>
      </section>
    )
  }

  const verificationUrl = `${window.location.origin}/passport/${encodeURIComponent(passport.id)}`
  const copyVerificationUrl = async () => {
    try {
      await navigator.clipboard.writeText(verificationUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="bf-release-passport" aria-label="Release passport">
      <div className="bf-release-passport-topline">
        <span className="bf-release-passport-icon" aria-hidden="true">✓</span>
        <span>BRANDFLIGHT RELEASE PASSPORT</span>
        <strong>ISSUED</strong>
      </div>
      <h3>Approved campaign record</h3>
      <p className="bf-release-passport-copy">A tamper-evident snapshot of the approved copy, image audit inputs, rulebook configuration and reviewer decision.</p>
      <div className="bf-release-passport-hash">
        <span>SNAPSHOT SHA-256</span>
        <code title={passport.passportHash}>{passport.passportHash.slice(0, 20)}…{passport.passportHash.slice(-12)}</code>
      </div>
      <div className="bf-release-passport-footer">
        <span>Issued {new Date(passport.issuedAt).toLocaleString()}</span>
        <div className="bf-release-passport-actions">
          <button type="button"
            className="bf-btn-secondary"
            onClick={() => void copyVerificationUrl()}
          >
            {copied ? 'Copied verification link' : 'Copy verification link'}
          </button>
          <a className="bf-btn-primary" href={verificationUrl} target="_blank" rel="noreferrer">
            Open verification report ↗
          </a>
        </div>
      </div>
    </section>
  )
}
