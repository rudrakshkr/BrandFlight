import { useCallback, useEffect, useMemo, useState } from 'react'

interface SubmissionSummary {
  id: string
  title: string
  status: 'DRAFT' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | string
  createdAt: string
  updatedAt: string
  brandProfile?: { id: string; name: string } | null
  creator?: { id: string; name: string; email: string } | null
  reviewer?: { id: string; name: string; email: string } | null
  _count?: { findings: number; comments: number; revisions: number }
}

interface ManagerDashboardProps {
  apiBaseUrl: string
  token: string
  onOpenReviewQueue: () => void
  onOpenRulebook: () => void
  onOpenSubmission: (submissionId: string) => void
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'Draft', className: 'draft' },
  IN_REVIEW: { label: 'In review', className: 'review' },
  CHANGES_REQUESTED: { label: 'Changes requested', className: 'changes' },
  APPROVED: { label: 'Approved', className: 'approved' },
}

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString()
}

export default function ManagerDashboard({
  apiBaseUrl,
  token,
  onOpenReviewQueue,
  onOpenRulebook,
  onOpenSubmission,
}: ManagerDashboardProps) {
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('ALL')

  const loadSubmissions = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`${apiBaseUrl}/api/submissions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await response.json().catch(() => null)) as {
        submissions?: SubmissionSummary[]
        error?: string
      } | null

      if (!response.ok || !data?.submissions) {
        throw new Error(data?.error ?? `Unable to load submissions (HTTP ${response.status}).`)
      }

      setSubmissions(data.submissions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the Manager Console.')
    } finally {
      setLoading(false)
    }
  }, [apiBaseUrl, token])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSubmissions(), 0)
    return () => window.clearTimeout(timer)
  }, [loadSubmissions])

  const counts = useMemo(() => ({
    total: submissions.length,
    draft: submissions.filter((item) => item.status === 'DRAFT').length,
    inReview: submissions.filter((item) => item.status === 'IN_REVIEW').length,
    changesRequested: submissions.filter((item) => item.status === 'CHANGES_REQUESTED').length,
    approved: submissions.filter((item) => item.status === 'APPROVED').length,
  }), [submissions])

  const filtered = useMemo(() => {
    const rows = filter === 'ALL'
      ? submissions
      : submissions.filter((item) => item.status === filter)
    return [...rows].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
  }, [filter, submissions])

  return (
    <section className="bf-manager-page">
      <header className="bf-manager-hero">
        <div>
          <span className="bf-manager-eyebrow">OPERATIONS · GOVERNANCE</span>
          <h1 className="bf-page-title">Manager Console</h1>
          <p className="bf-page-subtitle">
            Monitor campaign submissions, track review progress, and manage the brand rulebook.
          </p>
        </div>
        <button
          type="button"
          className="bf-btn-secondary"
          onClick={() => void loadSubmissions()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh overview'}
        </button>
      </header>

      <div className="bf-manager-actions">
        <button type="button" className="bf-manager-action" onClick={onOpenReviewQueue}>
          <span className="bf-manager-action-icon" aria-hidden="true">↗</span>
          <span>
            <strong>Review Queue</strong>
            <small>Open submitted campaigns and record reviewer decisions.</small>
          </span>
          <span className="bf-manager-action-arrow" aria-hidden="true">→</span>
        </button>
        <button type="button" className="bf-manager-action" onClick={onOpenRulebook}>
          <span className="bf-manager-action-icon" aria-hidden="true">≡</span>
          <span>
            <strong>Brand Rulebook &amp; Facts</strong>
            <small>Maintain terminology rules, approved claims, and brand colors.</small>
          </span>
          <span className="bf-manager-action-arrow" aria-hidden="true">→</span>
        </button>
      </div>

      {error && <div className="bf-save-feedback error" role="alert">{error}</div>}

      <section className="bf-manager-metrics" aria-label="Submission status overview">
        <article className="bf-manager-metric bf-manager-metric-total">
          <span className="bf-manager-metric-label">All submissions</span>
          <strong>{loading ? '—' : counts.total}</strong>
          <span className="bf-manager-metric-note">Across all creators</span>
        </article>
        <article className="bf-manager-metric">
          <span className="bf-manager-metric-label">In review</span>
          <strong>{loading ? '—' : counts.inReview}</strong>
          <span className="bf-manager-metric-note">Awaiting a decision</span>
        </article>
        <article className="bf-manager-metric">
          <span className="bf-manager-metric-label">Changes requested</span>
          <strong>{loading ? '—' : counts.changesRequested}</strong>
          <span className="bf-manager-metric-note">Returned to creators</span>
        </article>
        <article className="bf-manager-metric">
          <span className="bf-manager-metric-label">Approved</span>
          <strong>{loading ? '—' : counts.approved}</strong>
          <span className="bf-manager-metric-note">Cleared by review</span>
        </article>
      </section>

      <section className="bf-manager-table-card">
        <div className="bf-manager-table-header">
          <div>
            <h2>Submission register</h2>
            <p>Latest status and ownership across the workspace.</p>
          </div>
          <label className="bf-manager-filter">
            <span className="bf-manager-sr-only">Filter submissions by status</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="ALL">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="IN_REVIEW">In review</option>
              <option value="CHANGES_REQUESTED">Changes requested</option>
              <option value="APPROVED">Approved</option>
            </select>
          </label>
        </div>

        {loading ? (
          <div className="bf-manager-empty">Loading submission register…</div>
        ) : filtered.length === 0 ? (
          <div className="bf-manager-empty">
            <strong>No submissions in this view</strong>
            <p>Change the status filter or return when creators save campaigns.</p>
          </div>
        ) : (
          <div className="bf-manager-table-scroll">
            <table className="bf-manager-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Creator</th>
                  <th>Status</th>
                  <th>Reviewer</th>
                  <th>Updated</th>
                  <th>History</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const meta = STATUS_META[item.status] ?? {
                    label: item.status.replace(/_/g, ' '),
                    className: 'draft',
                  }
                  return (
                    <tr
                      key={item.id}
                      className="bf-manager-row-clickable"
                      tabIndex={0}
                      role="button"
                      aria-label={`Open campaign ${item.title}`}
                      onClick={() => onOpenSubmission(item.id)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenSubmission(item.id) } }}
                    >
                      <td>
                        <strong>{item.title}</strong>
                        <small>{item.brandProfile?.name ?? 'BrandFlight'}</small>
                      </td>
                      <td>{item.creator?.name ?? '—'}</td>
                      <td>
                        <span className={`bf-manager-status ${meta.className}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td>{item.reviewer?.name ?? '—'}</td>
                      <td>{dateLabel(item.updatedAt)}</td>
                      <td>
                        <span>{item._count?.revisions ?? 0} revisions</span>
                        <small>{item._count?.comments ?? 0} comments</small>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="bf-manager-register-footnote">
          This register is read-only. Decisions are recorded from the Review Queue.
        </p>
      </section>
    </section>
  )
}
