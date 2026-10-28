import { useCallback, useEffect, useState } from 'react'

interface SubmissionSummary {
  id: string
  title: string
  status: string
  createdAt: string
  updatedAt: string
  brandProfile: { id: string; name: string }
  _count: { findings: number; comments: number; revisions: number }
}

export interface SubmissionDetail {
  id: string
  title: string
  contentText: string
  status: string
  brandProfileId: string
  brandProfile: { id: string; name: string }
  findings: Array<{
    category: 'TONE' | 'TERMINOLOGY' | 'CLAIM' | 'VISUAL' | 'ACCESSIBILITY'
    severity: 'INFO' | 'WARNING' | 'ERROR'
    title: string
    message: string
    evidence: string | null
    suggestion: string | null
    ruleCode: string | null
    confidence: string | null
  }>
}

interface Props {
  apiBaseUrl: string
  token: string
  onOpenDraft: (submission: SubmissionDetail) => void
  onNewDraft: () => void
}

export default function SavedSubmissionsPanel({
  apiBaseUrl,
  token,
  onOpenDraft,
  onNewDraft,
}: Props) {
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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

      if (!response.ok || !Array.isArray(data?.submissions)) {
        throw new Error(data?.error ?? `Unable to load submissions (HTTP ${response.status}).`)
      }

      setSubmissions(data.submissions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load saved submissions.')
    } finally {
      setLoading(false)
    }
  }, [apiBaseUrl, token])

  useEffect(() => {
    void loadSubmissions()
  }, [loadSubmissions])

  const handleOpen = async (item: SubmissionSummary) => {
    if (item.status !== 'DRAFT' && item.status !== 'CHANGES_REQUESTED') return

    setOpeningId(item.id)
    setError(null)

    try {
      const response = await fetch(`${apiBaseUrl}/api/submissions/${item.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      const data = (await response.json().catch(() => null)) as {
        submission?: SubmissionDetail
        error?: string
      } | null

      if (!response.ok || !data?.submission) {
        throw new Error(data?.error ?? `Unable to open draft (HTTP ${response.status}).`)
      }

      onOpenDraft(data.submission)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open this draft.')
    } finally {
      setOpeningId(null)
    }
  }

  const handleSubmitForReview = async (item: SubmissionSummary) => {
    if (item.status !== 'DRAFT' && item.status !== 'CHANGES_REQUESTED') return

    setSubmittingId(item.id)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/submissions/${encodeURIComponent(item.id)}/submit`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      )

      const data = (await response.json().catch(() => null)) as {
        submission?: { id: string; status: string }
        error?: string
      } | null

      if (!response.ok || !data?.submission) {
        throw new Error(data?.error ?? `Submission failed (HTTP ${response.status}).`)
      }

      setNotice(`"${item.title}" was submitted for review.`)
      await loadSubmissions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit for review.')
    } finally {
      setSubmittingId(null)
    }
  }

  return (
    <section className="bf-saved-page">
      <div className="bf-saved-page-header">
        <div>
          <h1 className="bf-page-title">Saved Submissions</h1>
          <p className="bf-page-subtitle">
            Reopen campaign drafts stored in BrandFlight and continue editing them.
          </p>
        </div>

        <div className="bf-saved-header-actions">
          <button
            type="button"
            className="bf-btn-secondary"
            onClick={() => void loadSubmissions()}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="bf-btn-primary" onClick={onNewDraft}>
            New Draft
          </button>
        </div>
      </div>

      {error && (
        <div className="bf-save-feedback error" role="alert">
          {error}
        </div>
      )}

      {notice && (
        <div className="bf-save-feedback success" role="status">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="bf-saved-empty">Loading saved submissions…</div>
      ) : submissions.length === 0 ? (
        <div className="bf-saved-empty">
          <h2>No saved submissions yet</h2>
          <p>Run a preflight audit and save your campaign draft to see it here.</p>
          <button type="button" className="bf-btn-primary" onClick={onNewDraft}>
            Create your first draft
          </button>
        </div>
      ) : (
        <div className="bf-saved-grid">
          {submissions.map((item) => {
            const editable =
              item.status === 'DRAFT' || item.status === 'CHANGES_REQUESTED'

            return (
              <article className="bf-saved-card" key={item.id}>
                <div className="bf-saved-card-top">
                  <span
                    className={`bf-saved-status ${item.status.toLowerCase().replace(/_/g, '-')}`}
                  >
                    {item.status.replace(/_/g, ' ')}
                  </span>
                  <span className="bf-saved-brand">{item.brandProfile?.name ?? 'BrandFlight'}</span>
                </div>

                <h2 className="bf-saved-title">{item.title}</h2>

                <p className="bf-saved-meta">
                  Updated {new Date(item.updatedAt).toLocaleString()}
                </p>

                <div className="bf-saved-counts">
                  <span>{item._count.findings} findings</span>
                  <span>{item._count.comments} comments</span>
                  <span>{item._count.revisions} revisions</span>
                </div>

                <div className="bf-saved-card-footer">
                  {editable ? (
                    <div className="bf-saved-card-actions">
                      <button
                        type="button"
                        className="bf-btn-secondary"
                        disabled={openingId !== null || submittingId !== null}
                        onClick={() => void handleOpen(item)}
                      >
                        {openingId === item.id ? 'Opening…' : 'Open Draft'}
                      </button>
                      <button
                        type="button"
                        className="bf-btn-primary"
                        disabled={openingId !== null || submittingId !== null}
                        onClick={() => void handleSubmitForReview(item)}
                      >
                        {submittingId === item.id ? 'Submitting…' : 'Submit for Review'}
                      </button>
                    </div>
                  ) : (
                    <span className="bf-saved-readonly">
                      {item.status === 'IN_REVIEW'
                        ? 'Awaiting reviewer decision'
                        : item.status === 'APPROVED'
                          ? 'Approved'
                          : 'Editing unavailable in this view'}
                    </span>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
