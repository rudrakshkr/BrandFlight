import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageAuditData } from './types/imageAudit'

type Decision = 'APPROVED' | 'CHANGES_REQUESTED'

interface Summary {
  id: string
  title: string
  status: string
  updatedAt: string
  brandProfile?: { id: string; name: string }
  creator?: { id: string; name: string; email: string }
  _count: { findings: number; comments: number; revisions: number }
  imageUrl?: string | null
}

interface Finding {
  id: string
  category: string
  severity: string
  title: string
  message: string
  evidence: string | null
  suggestion: string | null
  ruleCode: string | null
  confidence: string | null
  isResolved: boolean
}

interface Comment {
  id: string
  body: string
  createdAt: string
  author?: { id: string; name: string; role: string; email: string }
}

interface Detail extends Summary {
  contentText: string
  brandProfileId: string
  imageName: string | null
  imageAltText: string | null
  imageAuditData: ImageAuditData | null
  findings: Finding[]
  comments: Comment[]
  revisions: Array<{ id: string; version: number; createdAt: string }>
  imagePublicId: string | null
}

interface Props {
  apiBaseUrl: string
  token: string
  initialSubmissionId?: string | null
  onInitialSelectionHandled?: () => void
}

export default function ReviewQueuePanel({ apiBaseUrl, token, initialSubmissionId = null, onInitialSelectionHandled }: Props) {
  const [queue, setQueue] = useState<Summary[]>([])
  const [selected, setSelected] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const handledInitialSelectionRef = useRef<string | null>(null)
  const [commentBusy, setCommentBusy] = useState(false)
  const [decisionBusy, setDecisionBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [commentText, setCommentText] = useState('')
  const [queueView, setQueueView] = useState<'IN_REVIEW' | 'HISTORY'>('IN_REVIEW')
  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null)

  const loadQueue = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`${apiBaseUrl}/api/submissions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json().catch(() => null) as {
        submissions?: Summary[]
        error?: string
      } | null

      if (!response.ok || !Array.isArray(data?.submissions)) {
        throw new Error(data?.error ?? `Could not load queue (HTTP ${response.status}).`)
      }

      // Keep drafts in memory for manager-console deep links; the visible queue still filters them out.
      setQueue(data.submissions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load review queue.')
    } finally {
      setLoading(false)
    }
  }, [apiBaseUrl, token])

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadQueue()
    }, 0)

    return () => window.clearTimeout(timerId)
  }, [loadQueue])

  const openSubmission = useCallback(async (item: Summary) => {
    setOpeningId(item.id)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/submissions/${encodeURIComponent(item.id)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const data = await response.json().catch(() => null) as {
        submission?: Detail
        error?: string
      } | null
      if (!response.ok || !data?.submission) throw new Error(data?.error ?? `Could not open submission (HTTP ${response.status}).`)
      setSelected(data.submission)
      setCommentText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open submission.')
    } finally {
      setOpeningId(null)
    }
  }, [apiBaseUrl, token])

  const openInitialSelection = useCallback(async () => {
    if (!initialSubmissionId || loading || handledInitialSelectionRef.current === initialSubmissionId) return
    const item = queue.find((entry) => entry.id === initialSubmissionId)
    if (!item) {
      handledInitialSelectionRef.current = initialSubmissionId
      onInitialSelectionHandled?.()
      return
    }
    handledInitialSelectionRef.current = initialSubmissionId
    if (item.status !== 'IN_REVIEW') setQueueView('HISTORY')
    try {
      await openSubmission(item)
    } finally {
      onInitialSelectionHandled?.()
    }
  }, [initialSubmissionId, loading, queue, openSubmission, onInitialSelectionHandled])

  useEffect(() => {
    if (!initialSubmissionId) {
      handledInitialSelectionRef.current = null
      return
    }

    const timerId = window.setTimeout(() => {
      void openInitialSelection()
    }, 0)

    return () => window.clearTimeout(timerId)
  }, [initialSubmissionId, openInitialSelection])

  const addComment = async () => {
    if (!selected || !commentText.trim() || commentBusy) return

    setCommentBusy(true)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/submissions/${encodeURIComponent(selected.id)}/comments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ body: commentText.trim() }),
        },
      )
      const data = await response.json().catch(() => null) as {
        comment?: Comment
        error?: string
      } | null

      if (!response.ok || !data?.comment) {
        throw new Error(data?.error ?? `Could not add comment (HTTP ${response.status}).`)
      }

      setSelected((current) => current
        ? { ...current, comments: [...current.comments, data.comment!] }
        : current)
      setCommentText('')
      setNotice('Comment added.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add comment.')
    } finally {
      setCommentBusy(false)
    }
  }

  const openDecisionConfirmation = (status: Decision) => {
    if (!selected || decisionBusy) return
    if (status === 'CHANGES_REQUESTED' && !commentText.trim()) {
      setError('Add a comment explaining the requested changes.')
      return
    }
    setError(null)
    setNotice(null)
    setPendingDecision(status)
  }

  const decide = async (status: Decision) => {
    if (!selected || decisionBusy) return

    if (status === 'CHANGES_REQUESTED' && !commentText.trim()) {
      setError('Add a comment explaining the requested changes.')
      return
    }

    setDecisionBusy(true)
    setError(null)
    setNotice(null)
    const title = selected.title

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/submissions/${encodeURIComponent(selected.id)}/review`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            status,
            note: commentText.trim(),
          }),
        },
      )
      const data = await response.json().catch(() => null) as {
        submission?: { id: string; status: string }
        error?: string
      } | null

      if (!response.ok || !data?.submission) {
        throw new Error(data?.error ?? `Could not record decision (HTTP ${response.status}).`)
      }

      setSelected(null)
      setCommentText('')
      setPendingDecision(null)
      setNotice(status === 'APPROVED'
        ? `"${title}" was approved.`
        : `"${title}" was returned for changes.`)
      await loadQueue()
    } catch (err) {
      setPendingDecision(null)
      setError(err instanceof Error ? err.message : 'Could not record decision.')
    } finally {
      setDecisionBusy(false)
    }
  }

  useEffect(() => {
    if (!pendingDecision || decisionBusy) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingDecision(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pendingDecision, decisionBusy])

  const visibleQueue = queue.filter((item) => queueView === 'IN_REVIEW'
    ? item.status === 'IN_REVIEW'
    : item.status === 'APPROVED' || item.status === 'CHANGES_REQUESTED' || item.status === 'DRAFT')
  const reviewCount = queue.filter((item) => item.status === 'IN_REVIEW').length
  const historyCount = queue.filter((item) => item.status !== 'IN_REVIEW').length
  const historyLabel = queue.some((item) => item.status === 'DRAFT') ? 'History & drafts' : 'Review history'

  return (
    <section className="bf-review-page">
      <div className="bf-review-header">
        <div>
          <h1 className="bf-page-title">Review Queue</h1>
          <p className="bf-page-subtitle">
            Review pending campaigns, then find past comments and decisions under Review history.
          </p>
        </div>
        <button
          type="button"
          className="bf-btn-secondary"
          onClick={() => void loadQueue()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh Queue'}
        </button>
      </div>

      {error && <div className="bf-save-feedback error" role="alert">{error}</div>}
      {notice && <div className="bf-save-feedback success" role="status">{notice}</div>}

      {pendingDecision && selected && (
        <div
          className="bf-decision-confirmation-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !decisionBusy) setPendingDecision(null)
          }}
        >
          <section
            className="bf-decision-confirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bf-decision-confirmation-title"
            aria-describedby="bf-decision-confirmation-description"
          >
            <span className={`bf-decision-confirmation-mark ${pendingDecision === 'APPROVED' ? 'approve' : 'changes'}`} aria-hidden="true">
              {pendingDecision === 'APPROVED' ? '✓' : '↺'}
            </span>
            <h2 id="bf-decision-confirmation-title">
              {pendingDecision === 'APPROVED' ? 'Approve this campaign?' : 'Request changes?'}
            </h2>
            <p id="bf-decision-confirmation-description">
              {pendingDecision === 'APPROVED'
                ? `This will mark “${selected.title}” as approved and complete the review.`
                : `This will return “${selected.title}” to the creator so they can revise and resubmit it.`}
            </p>
            {pendingDecision === 'CHANGES_REQUESTED' && (
              <div className="bf-decision-confirmation-note">
                <strong>Feedback to the creator</strong>
                <p>{commentText.trim()}</p>
              </div>
            )}
            {pendingDecision === 'APPROVED' && commentText.trim() && (
              <div className="bf-decision-confirmation-note">
                <strong>Comment already in the thread</strong>
                <p>Your comment will remain visible in the campaign discussion.</p>
              </div>
            )}
            <div className="bf-decision-confirmation-actions">
              <button
                type="button"
                className="bf-btn-secondary"
                autoFocus
                disabled={decisionBusy}
                onClick={() => setPendingDecision(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={pendingDecision === 'APPROVED' ? 'bf-btn-primary' : 'bf-review-request'}
                disabled={decisionBusy}
                onClick={() => void decide(pendingDecision)}
              >
                {decisionBusy
                  ? 'Saving…'
                  : pendingDecision === 'APPROVED'
                    ? 'Confirm Approval'
                    : 'Confirm Request Changes'}
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="bf-review-layout">
        <aside className="bf-review-list">
          <div className="bf-review-list-header">
            <h2>{queueView === 'IN_REVIEW' ? 'Awaiting review' : historyLabel}</h2>
            <span>{visibleQueue.length}</span>
          </div>
          <div className="bf-review-tabs" aria-label="Review queue views">
            <button type="button" className={queueView === 'IN_REVIEW' ? 'active' : ''} aria-pressed={queueView === 'IN_REVIEW'} onClick={() => setQueueView('IN_REVIEW')}>
              Awaiting review <span>{reviewCount}</span>
            </button>
            <button type="button" className={queueView === 'HISTORY' ? 'active' : ''} aria-pressed={queueView === 'HISTORY'} onClick={() => setQueueView('HISTORY')}>
              {historyLabel} <span>{historyCount}</span>
            </button>
          </div>

          {loading && visibleQueue.length === 0 ? (
            <p className="bf-review-empty">Loading campaigns…</p>
          ) : visibleQueue.length === 0 ? (
            <div className="bf-review-empty">
              <h3>{queueView === 'IN_REVIEW' ? 'Queue is clear' : historyLabel === 'History & drafts' ? 'No other campaigns' : 'No review history yet'}</h3>
              <p>{queueView === 'IN_REVIEW' ? 'New submissions awaiting a decision will appear here.' : 'Approved campaigns and campaigns returned for changes will appear here.'}</p>
            </div>
          ) : visibleQueue.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`bf-review-queue-item ${selected?.id === item.id ? 'active' : ''}`}
              aria-busy={openingId === item.id}
              disabled={openingId !== null || decisionBusy}
              onClick={() => void openSubmission(item)}
            >
              <span className="bf-review-queue-status">{item.status.replace(/_/g, ' ')} · {item._count.findings} findings · {item._count.comments} comments</span>
              <strong>{item.title}</strong>
              <span className="bf-review-small">
                {item.creator?.name ?? 'Creator'} · {item.brandProfile?.name ?? 'Brand'}
              </span>
              {openingId === item.id && <span className="bf-review-small">Opening…</span>}
            </button>
          ))}
        </aside>

        <div className="bf-review-detail" aria-busy={openingId !== null}>
          {openingId && (
            <div className="bf-review-opening-overlay" role="status" aria-live="polite">
              <div className="bf-review-opening-indicator">
                <span className="bf-loading-spinner" aria-hidden="true" />
                <div>
                  <strong>Opening campaign…</strong>
                  <p>Loading submitted copy, image audit, discussion, and revision history.</p>
                </div>
              </div>
            </div>
          )}
          {!selected ? (
            <div className="bf-review-empty bf-review-detail-empty">
              <h2>Select a submission</h2>
              <p>Choose an item from the queue to inspect its copy and saved findings.</p>
            </div>
          ) : (
            <>
              <header className="bf-review-detail-header">
                <span className="bf-review-queue-status">{selected.status.replace(/_/g, ' ')}</span>
                <h2>{selected.title}</h2>
                <p>
                  {selected.creator?.name ?? 'Creator'}
                  {selected.brandProfile?.name ? ` · ${selected.brandProfile.name}` : ''}
                  {' · '}{selected.revisions.length} revision(s)
                </p>
              </header>

              <section className="bf-review-section">
                <h3>Submitted copy</h3>
                <pre className="bf-review-copy">{selected.contentText}</pre>
              </section>

              {(selected.imageUrl || selected.imageAuditData || selected.imageName || selected.imageAltText) && (
                <section className="bf-review-section">
                  <h3>Campaign image &amp; alt-text audit</h3>
                  {selected.imageUrl && (
                    <figure className="bf-review-image-preview">
                      <img
                        src={selected.imageUrl}
                        alt={selected.imageAltText?.trim() || selected.imageName || `Campaign image for ${selected.title}`}
                        loading="lazy"
                      />
                      <figcaption>{selected.imageName || "Campaign image"}</figcaption>
                    </figure>
                  )}
                  <p>
                    <b>Image:</b>{' '}
                    {selected.imageName ??
                      selected.imageAuditData?.image.name ??
                      'Image metadata saved'}
                  </p>
                  <p>
                    <b>Alt text:</b>{' '}
                    {selected.imageAltText?.trim() || 'No alt text supplied.'}
                  </p>

                  {selected.imageAuditData ? (
                    <>
                      {selected.imageAuditData.logoVerification && (
                        <section className={`bf-logo-verification-card outcome-${selected.imageAuditData.logoVerification.outcome.toLowerCase()}`} aria-label="Brand logo verification">
                          <div className="bf-logo-verification-heading">
                            <div><span className="bf-logo-verification-eyebrow">OFFICIAL BRAND ASSET</span><h3>Logo verification</h3></div>
                            <span className={`bf-logo-verification-badge outcome-${selected.imageAuditData.logoVerification.outcome.toLowerCase()}`}>
                              {selected.imageAuditData.logoVerification.outcome === 'NOT_CONFIGURED' ? 'Not configured' : selected.imageAuditData.logoVerification.outcome.replace(/_/g, ' ')}
                            </span>
                          </div>
                          {selected.imageAuditData.logoVerification.referenceLogo && (
                            <div className="bf-logo-reference-row">
                              <img src={selected.imageAuditData.logoVerification.referenceLogo.secureUrl} alt={`Approved reference: ${selected.imageAuditData.logoVerification.referenceLogo.name}`} loading="lazy" />
                              <div><strong>{selected.imageAuditData.logoVerification.referenceLogo.name}</strong><p>{selected.imageAuditData.logoVerification.referenceLogo.expectedWordmark ? `Expected wordmark: ${selected.imageAuditData.logoVerification.referenceLogo.expectedWordmark}` : 'No expected wordmark configured'}</p><small>{selected.imageAuditData.logoVerification.required ? 'Logo required' : 'Logo optional'} · {selected.imageAuditData.logoVerification.confidence.toLowerCase()} confidence</small></div>
                            </div>
                          )}
                          <p className="bf-logo-verification-summary">{selected.imageAuditData.logoVerification.summary}</p>
                          <div className="bf-logo-check-grid">
                            <span><small>Logo detected</small><strong>{selected.imageAuditData.logoVerification.outcome === 'NOT_CONFIGURED' ? 'Not checked' : selected.imageAuditData.logoVerification.outcome === 'NEEDS_REVIEW' ? 'Needs review' : selected.imageAuditData.logoVerification.logoDetected ? 'Yes' : 'No'}</strong></span>
                            <span><small>Wordmark</small><strong>{selected.imageAuditData.logoVerification.wordmarkStatus.replace(/_/g, ' ')}</strong></span>
                            <span><small>Logo colors</small><strong>{selected.imageAuditData.logoVerification.colorStatus.replace(/_/g, ' ')}</strong></span>
                            <span><small>Integrity</small><strong>{selected.imageAuditData.logoVerification.integrityStatus.replace(/_/g, ' ')}</strong></span>
                          </div>
                          {selected.imageAuditData.logoVerification.evidence.length > 0 && <ul className="bf-logo-verification-list">{selected.imageAuditData.logoVerification.evidence.map((item, index) => <li key={`review-logo-evidence-${index}`}>{item}</li>)}</ul>}
                          {selected.imageAuditData.logoVerification.suggestions.length > 0 && <ul className="bf-logo-verification-list suggestions">{selected.imageAuditData.logoVerification.suggestions.map((item, index) => <li key={`review-logo-suggestion-${index}`}>{item}</li>)}</ul>}
                        </section>
                      )}
                      <p>
                        <b>Image audit findings:</b>{' '}
                        {selected.imageAuditData.totalFindings}
                        {selected.imageAuditData.image.colorAnalysis
                          ? selected.imageAuditData.totalFindings === 0
                            ? ' — no configured image rules were triggered; this is not a full accessibility certification.'
                            : ' — review the configured findings below.'
                          : ' — saved result predates per-color checks; re-run Image Audit for a current comparison.'}
                      </p>

                      <div className="bf-image-audit-review-summary">
                        <strong>
                          {selected.imageAuditData.image.colorAnalysis
                            ? `${selected.imageAuditData.image.colorAnalysis.filter((item) => item.matchesPalette).length} of ${selected.imageAuditData.image.colorAnalysis.length} dominant colors within palette tolerance`
                            : 'This saved audit predates per-color palette comparison; re-run Image Audit for detailed matching.'}
                        </strong>
                        <span>Palette comparison is a simple RGB similarity check, not a full visual or WCAG assessment.</span>
                      </div>
                      {selected.imageAuditData.image.colorAnalysis ? (
                        <div className="bf-color-audit-list bf-color-audit-list-review">
                          {selected.imageAuditData.image.colorAnalysis.map((item) => (
                            <div className={`bf-color-audit-item ${!item.nearestApprovedColor ? 'is-no-palette' : item.matchesPalette ? 'is-match' : 'is-off-palette'}`} key={`review-color-${item.color}`}>
                              <span className="bf-swatch-color" style={{ backgroundColor: item.color }} />
                              <div className="bf-color-audit-copy">
                                <strong>{item.color}</strong>
                                <span>{item.matchesPalette ? 'Within tolerance' : 'Outside tolerance'}</span>
                              </div>
                              <div className="bf-color-audit-nearest">
                                <small>Nearest approved</small>
                                <strong>{item.nearestApprovedColor ?? 'No palette'}</strong>
                                {item.distance !== null && <small>RGB distance: {item.distance}</small>}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="bf-swatch-list">
                          {selected.imageAuditData.image.dominantColors.map((color) => (
                            <div className="bf-swatch-item" key={`dominant-${color}`}>
                              <span className="bf-swatch-color" style={{ backgroundColor: color }} />
                              <code>{color}</code>
                              <span className="bf-review-small">Detected</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="bf-swatch-list">
                        {selected.imageAuditData.image.approvedColors.map((color) => (
                          <div className="bf-swatch-item" key={`approved-${color}`}>
                            <span className="bf-swatch-color" style={{ backgroundColor: color }} />
                            <code>{color}</code>
                            <span className="bf-review-small">Approved</span>
                          </div>
                        ))}
                      </div>

                      {selected.imageAuditData.findings.map((finding, index) => (
                        <article
                          className="bf-review-finding"
                          key={`image-${finding.ruleCode}-${finding.title}-${index}`}
                        >
                          <div className="bf-review-finding-top">
                            <span>{finding.category}</span>
                            <strong className={`bf-review-severity ${finding.severity.toLowerCase()}`}>
                              {finding.severity}
                            </strong>
                            <code>{finding.ruleCode}</code>
                          </div>
                          <h4>{finding.title}</h4>
                          <p>{finding.message}</p>
                          <p><b>Evidence:</b> {finding.evidence}</p>
                          <p><b>Suggestion:</b> {finding.suggestion}</p>
                        </article>
                      ))}
                    </>
                  ) : (
                    <p className="bf-review-small">
                      Image metadata is saved, but an audit result is not attached.
                    </p>
                  )}
                </section>
              )}

              <section className="bf-review-section">
                <h3>Saved findings ({selected.findings.length})</h3>
                {selected.findings.length === 0 ? (
                  <p className="bf-review-small">No findings were saved.</p>
                ) : selected.findings.map((finding) => (
                  <article className="bf-review-finding" key={finding.id}>
                    <div className="bf-review-finding-top">
                      <span>{finding.category}</span>
                      <strong className={`bf-review-severity ${finding.severity.toLowerCase()}`}>
                        {finding.severity}
                      </strong>
                      {finding.ruleCode && <code>{finding.ruleCode}</code>}
                    </div>
                    <h4>{finding.title}</h4>
                    <p>{finding.message}</p>
                    {finding.evidence && <p><b>Evidence:</b> {finding.evidence}</p>}
                    {finding.suggestion && <p><b>Suggestion:</b> {finding.suggestion}</p>}
                  </article>
                ))}
              </section>

              <section className="bf-review-section">
                <h3>Comments &amp; activity ({selected.comments.length})</h3>
                {selected.comments.length === 0 ? (
                  <p className="bf-review-small">No comments yet. Comments and decision notes will be kept together here.</p>
                ) : selected.comments.map((comment) => (
                  <article className={`bf-review-comment${comment.body.startsWith('OVERRIDE REQUEST') ? ' bf-review-comment-override' : ''}`} key={comment.id}>
                    <div className="bf-review-comment-meta">
                      <strong>{comment.author?.name ?? 'User'}</strong>
                      <span>{comment.author?.role ?? ''}</span>
                      <time>{new Date(comment.createdAt).toLocaleString()}</time>
                    </div>
                    {comment.body.startsWith('OVERRIDE REQUEST') ? (
                      <>
                        <span className="bf-override-message-badge">Creator override request</span>
                        <div className="bf-override-message-content">
                          {comment.body.split('\n').slice(1).filter(Boolean).map((line, index) => {
                            const separator = line.indexOf(':')
                            return <p key={`${comment.id}-detail-${index}`}>{separator > 0 ? <><strong>{line.slice(0, separator + 1)}</strong> {line.slice(separator + 1).trim()}</> : line}</p>
                          })}
                        </div>
                      </>
                    ) : <p>{comment.body}</p>}
                  </article>
                ))}

                {selected.status === 'IN_REVIEW' ? (
                  <form className="bf-review-comment-form" onSubmit={(event) => {
                    event.preventDefault()
                    void addComment()
                  }}>
                    <label htmlFor="bf-review-comment">Comment or decision note</label>
                    <textarea
                      id="bf-review-comment"
                      rows={3}
                      maxLength={2000}
                      value={commentText}
                      onChange={(event) => setCommentText(event.target.value)}
                      placeholder="Post a comment, or explain the changes needed before requesting changes…"
                      disabled={commentBusy || decisionBusy}
                    />
                    <p className="bf-review-note-hint">Post Comment saves a discussion note. Request Changes saves this text as the required feedback. An optional note entered before approval is also kept in the thread.</p>
                    <div className="bf-review-decision-buttons">
                      <button className="bf-btn-secondary" type="submit" disabled={commentBusy || decisionBusy || !commentText.trim()}>
                        {commentBusy ? 'Posting…' : 'Post Comment'}
                      </button>
                      <button type="button" className="bf-review-request" disabled={decisionBusy || !commentText.trim()} onClick={() => openDecisionConfirmation('CHANGES_REQUESTED')}>
                        {decisionBusy ? 'Saving…' : 'Request Changes'}
                      </button>
                      <button type="button" className="bf-btn-primary" disabled={decisionBusy} onClick={() => openDecisionConfirmation('APPROVED')}>
                        {decisionBusy ? 'Saving…' : 'Approve'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="bf-review-note-hint">This review is complete. Its comments remain available here for reference.</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
