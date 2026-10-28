import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { ImageAuditData } from './types/imageAudit'

interface SubmissionSummary {
  id: string
  title: string
  status: string
  createdAt: string
  updatedAt: string
  brandProfile: { id: string; name: string }
  _count: { findings: number; comments: number; revisions: number }
  imageUrl?: string | null
  imageName?: string | null
  imageAltText?: string | null
  tags?: string[]
}

export interface SubmissionDetail {
  id: string
  title: string
  contentText: string
  status: string
  brandProfileId: string
  brandProfile: { id: string; name: string }
  imageName: string | null
  imageAltText: string | null
  imageAuditData: ImageAuditData | null
  findings: Array<{
    category: 'TONE' | 'TERMINOLOGY' | 'CLAIM' | 'VISUAL' | 'ACCESSIBILITY'
    severity: 'INFO' | 'WARNING' | 'ERROR'
    title: string
    message: string
    evidence: string | null
    suggestion: string | null
    originalSpan: string | null
    suggestedSpan: string | null
    ruleCode: string | null
    confidence: string | null
  }>
  imageUrl: string | null
  imagePublicId: string | null
  tags?: string[]
  comments: Array<{
    id: string
    body: string
    createdAt: string
    author?: { id: string; name: string; email: string; role: string }
  }>
}

interface Props {
  apiBaseUrl: string
  token: string
  onOpenDraft: (submission: SubmissionDetail) => void
  onNewDraft: () => void
}

const DRAFT_TAG_OPTIONS = [
  { value: 'SOCIAL', label: 'Social' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'BLOG', label: 'Blog' },
  { value: 'LANDING_PAGE', label: 'Landing page' },
  { value: 'PAID_AD', label: 'Paid ad' },
  { value: 'PRODUCT', label: 'Product' },
  { value: 'OTHER', label: 'Other' },
] as const

type DraftTag = (typeof DRAFT_TAG_OPTIONS)[number]['value']

function tagLabel(value: string) {
  return DRAFT_TAG_OPTIONS.find((tag) => tag.value === value)?.label ?? value
}

function statusLabel(status: string) {
  return status.replace(/_/g, ' ')
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
  const [savingDetailsId, setSavingDetailsId] = useState<string | null>(null)
  const [editingDetailsId, setEditingDetailsId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editTags, setEditTags] = useState<DraftTag[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [tagFilter, setTagFilter] = useState('ALL')
  const [notice, setNotice] = useState<string | null>(null)
  const [discussion, setDiscussion] = useState<SubmissionDetail | null>(null)
  const [discussionLoadingId, setDiscussionLoadingId] = useState<string | null>(null)
  const [discussionText, setDiscussionText] = useState('')
  const [discussionBusy, setDiscussionBusy] = useState(false)
  const [discussionNotice, setDiscussionNotice] = useState<string | null>(null)

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
      setError(err instanceof Error ? err.message : 'Unable to load saved campaigns.')
    } finally {
      setLoading(false)
    }
  }, [apiBaseUrl, token])

  useEffect(() => {
    const timerId = window.setTimeout(() => void loadSubmissions(), 0)
    return () => window.clearTimeout(timerId)
  }, [loadSubmissions])

  const handleOpen = async (item: SubmissionSummary) => {
    if (item.status !== 'DRAFT' && item.status !== 'CHANGES_REQUESTED') return

    setOpeningId(item.id)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch(`${apiBaseUrl}/api/submissions/${encodeURIComponent(item.id)}`, {
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

  const handleViewDiscussion = async (item: SubmissionSummary) => {
    setDiscussionLoadingId(item.id)
    setError(null)
    setNotice(null)
    setDiscussionNotice(null)

    try {
      // Always fetch the current thread. The campaign may have received comments
      // after the creator last opened My Campaigns.
      const response = await fetch(`${apiBaseUrl}/api/submissions/${encodeURIComponent(item.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await response.json().catch(() => null)) as {
        submission?: SubmissionDetail
        error?: string
      } | null

      if (!response.ok || !data?.submission) {
        throw new Error(data?.error ?? `Unable to load campaign discussion (HTTP ${response.status}).`)
      }

      setDiscussion(data.submission)
      setDiscussionText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load campaign discussion.')
    } finally {
      setDiscussionLoadingId(null)
    }
  }

  const handleRefreshDiscussion = async () => {
    if (!discussion || discussionLoadingId) return
    setDiscussionLoadingId(discussion.id)
    setDiscussionNotice(null)
    setError(null)

    try {
      const response = await fetch(`${apiBaseUrl}/api/submissions/${encodeURIComponent(discussion.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await response.json().catch(() => null)) as {
        submission?: SubmissionDetail
        error?: string
      } | null

      if (!response.ok || !data?.submission) {
        throw new Error(data?.error ?? `Unable to refresh discussion (HTTP ${response.status}).`)
      }
      setDiscussion(data.submission)
      setDiscussionNotice('Discussion refreshed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh discussion.')
    } finally {
      setDiscussionLoadingId(null)
    }
  }

  const handlePostDiscussionComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!discussion || !discussionText.trim() || discussionBusy) return

    setDiscussionBusy(true)
    setDiscussionNotice(null)
    setError(null)

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/submissions/${encodeURIComponent(discussion.id)}/comments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ body: discussionText.trim() }),
        },
      )
      const data = (await response.json().catch(() => null)) as {
        comment?: SubmissionDetail['comments'][number]
        error?: string
      } | null

      if (!response.ok || !data?.comment) {
        throw new Error(data?.error ?? `Unable to post comment (HTTP ${response.status}).`)
      }

      setDiscussion((current) => current && current.id === discussion.id
        ? { ...current, comments: [...current.comments, data.comment!] }
        : current)
      setSubmissions((current) => current.map((item) => item.id === discussion.id
        ? { ...item, _count: { ...item._count, comments: item._count.comments + 1 } }
        : item))
      setDiscussionText('')
      setDiscussionNotice('Comment posted. It is now part of this campaign’s discussion.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to post comment.')
    } finally {
      setDiscussionBusy(false)
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
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      )
      const data = (await response.json().catch(() => null)) as {
        submission?: { id: string; status: string }
        error?: string
      } | null

      if (!response.ok || !data?.submission) {
        throw new Error(data?.error ?? `Submission failed (HTTP ${response.status}).`)
      }

      setNotice(`“${item.title}” was submitted for review.`)
      await loadSubmissions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit for review.')
    } finally {
      setSubmittingId(null)
    }
  }

  const startEditDetails = (item: SubmissionSummary) => {
    setEditingDetailsId(item.id)
    setEditTitle(item.title)
    setEditTags((item.tags ?? []).filter((tag): tag is DraftTag =>
      DRAFT_TAG_OPTIONS.some((option) => option.value === tag),
    ))
    setError(null)
    setNotice(null)
  }

  const toggleEditTag = (tag: DraftTag) => {
    setEditTags((current) => current.includes(tag)
      ? current.filter((entry) => entry !== tag)
      : [...current, tag])
  }

  const saveDetails = async (item: SubmissionSummary) => {
    const title = editTitle.trim()
    if (!title) {
      setError('Give this campaign a name before saving.')
      return
    }
    if (title.length > 160) {
      setError('Campaign names must be 160 characters or fewer.')
      return
    }

    setSavingDetailsId(item.id)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch(`${apiBaseUrl}/api/submissions/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title, tags: editTags }),
      })
      const data = (await response.json().catch(() => null)) as {
        submission?: { id: string; title: string; tags?: string[]; updatedAt: string }
        error?: string
      } | null

      if (!response.ok || !data?.submission) {
        throw new Error(data?.error ?? `Could not save campaign details (HTTP ${response.status}).`)
      }

      setSubmissions((current) => current.map((entry) => entry.id === item.id
        ? {
            ...entry,
            title: data.submission!.title,
            tags: data.submission!.tags ?? editTags,
            updatedAt: data.submission!.updatedAt,
          }
        : entry))
      setEditingDetailsId(null)
      setNotice('Campaign name and tags saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save campaign details.')
    } finally {
      setSavingDetailsId(null)
    }
  }

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('ALL')
    setTagFilter('ALL')
  }

  const normalizedSearch = search.trim().toLowerCase()
  const filteredSubmissions = submissions.filter((item) => {
    const matchesSearch = !normalizedSearch || [
      item.title,
      item.brandProfile?.name ?? '',
      ...(item.tags ?? []).map(tagLabel),
    ].some((value) => value.toLowerCase().includes(normalizedSearch))
    const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter
    const matchesTag = tagFilter === 'ALL' || (item.tags ?? []).includes(tagFilter)
    return matchesSearch && matchesStatus && matchesTag
  })

  return (
    <section className="bf-saved-page">
      <div className="bf-saved-page-header">
        <div>
          <h1 className="bf-page-title">My Campaigns</h1>
          <p className="bf-page-subtitle">
            Find drafts, organize them by type, and track what is waiting for review.
          </p>
        </div>
        <div className="bf-saved-header-actions">
          <button type="button" className="bf-btn-secondary" onClick={() => void loadSubmissions()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="bf-btn-primary" onClick={onNewDraft}>New Draft</button>
        </div>
      </div>

      {error && <div className="bf-save-feedback error" role="alert">{error}</div>}
      {notice && <div className="bf-save-feedback success" role="status">{notice}</div>}

      {loading ? (
        <div className="bf-saved-empty">Loading campaigns…</div>
      ) : submissions.length === 0 ? (
        <div className="bf-saved-empty">
          <h2>No campaigns yet</h2>
          <p>Run Preflight Audit and save a campaign to find it here.</p>
          <button type="button" className="bf-btn-primary" onClick={onNewDraft}>Create your first draft</button>
        </div>
      ) : (
        <>
          <div className="bf-saved-filters" aria-label="Filter campaigns">
            <label className="bf-saved-search">
              <span>Search</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Campaign name, brand, or tag" />
            </label>
            <label>
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="ALL">All statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="CHANGES_REQUESTED">Changes requested</option>
                <option value="IN_REVIEW">In review</option>
                <option value="APPROVED">Approved</option>
              </select>
            </label>
            <label>
              <span>Campaign type</span>
              <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
                <option value="ALL">All types</option>
                {DRAFT_TAG_OPTIONS.map((tag) => <option value={tag.value} key={tag.value}>{tag.label}</option>)}
              </select>
            </label>
            <div className="bf-saved-filter-summary">
              <span>{filteredSubmissions.length} of {submissions.length}</span>
              {(search || statusFilter !== 'ALL' || tagFilter !== 'ALL') && (
                <button type="button" className="bf-saved-link-button" onClick={clearFilters}>Clear filters</button>
              )}
            </div>
          </div>

          {filteredSubmissions.length === 0 ? (
            <div className="bf-saved-empty">
              <h2>No campaigns match</h2>
              <p>Try another search or clear the filters.</p>
              <button type="button" className="bf-btn-secondary" onClick={clearFilters}>Clear filters</button>
            </div>
          ) : (
            <div className="bf-saved-grid">
              {filteredSubmissions.map((item) => {
                const editable = item.status === 'DRAFT' || item.status === 'CHANGES_REQUESTED'
                const isEditing = editingDetailsId === item.id
                const busy = openingId !== null || submittingId !== null || savingDetailsId !== null

                return (
                  <article className="bf-saved-card" key={item.id}>
                    <div className="bf-saved-card-top">
                      <span className={`bf-saved-status ${item.status.toLowerCase().replace(/_/g, '-')}`}>
                        {statusLabel(item.status)}
                      </span>
                      <span className="bf-saved-brand">{item.brandProfile?.name ?? 'BrandFlight'}</span>
                    </div>

                    {item.imageUrl && (
                      <figure className="bf-saved-image-preview">
                        <img src={item.imageUrl} alt={item.imageAltText?.trim() || item.imageName || `Campaign image for ${item.title}`} loading="lazy" />
                        <figcaption>{item.imageName || 'Campaign image'}</figcaption>
                      </figure>
                    )}

                    <h2 className="bf-saved-title">{item.title}</h2>
                    <div className="bf-saved-tags" aria-label="Campaign tags">
                      {(item.tags ?? []).length > 0
                        ? (item.tags ?? []).map((tag) => <span className="bf-saved-tag" key={tag}>{tagLabel(tag)}</span>)
                        : <span className="bf-saved-no-tags">No type tags</span>}
                    </div>
                    <p className="bf-saved-meta">Updated {new Date(item.updatedAt).toLocaleString()}</p>
                    <div className="bf-saved-counts">
                      <span>{item._count.findings} findings</span>
                      <button
                        type="button"
                        className="bf-saved-discussion-link"
                        disabled={busy || discussionLoadingId !== null}
                        onClick={() => void handleViewDiscussion(item)}
                      >
                        {discussionLoadingId === item.id
                          ? 'Loading discussion…'
                          : `View discussion (${item._count.comments})`}
                      </button>
                      <span>{item._count.revisions} revisions</span>
                    </div>

                    {editable && !isEditing && (
                      <button type="button" className="bf-saved-link-button bf-saved-edit-link" disabled={busy} onClick={() => startEditDetails(item)}>
                        Edit name &amp; tags
                      </button>
                    )}

                    {editable && isEditing && (
                      <form className="bf-saved-edit-form" onSubmit={(event) => { event.preventDefault(); void saveDetails(item) }}>
                        <label>
                          <span>Campaign name</span>
                          <input value={editTitle} maxLength={160} onChange={(event) => setEditTitle(event.target.value)} required disabled={savingDetailsId === item.id} />
                        </label>
                        <fieldset>
                          <legend>Campaign type tags</legend>
                          <div className="bf-saved-tag-options">
                            {DRAFT_TAG_OPTIONS.map((tag) => (
                              <label key={tag.value}>
                                <input type="checkbox" checked={editTags.includes(tag.value)} onChange={() => toggleEditTag(tag.value)} disabled={savingDetailsId === item.id} />
                                <span>{tag.label}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <div className="bf-saved-edit-actions">
                          <button type="submit" className="bf-btn-primary" disabled={savingDetailsId === item.id}>
                            {savingDetailsId === item.id ? 'Saving…' : 'Save details'}
                          </button>
                          <button type="button" className="bf-btn-secondary" disabled={savingDetailsId === item.id} onClick={() => setEditingDetailsId(null)}>Cancel</button>
                        </div>
                      </form>
                    )}

                    <div className="bf-saved-card-footer">
                      {editable ? (
                        <div className="bf-saved-card-actions">
                          <button type="button" className="bf-btn-secondary" disabled={busy || isEditing} onClick={() => void handleOpen(item)}>
                            {openingId === item.id ? 'Opening…' : 'Open Draft'}
                          </button>
                          <button type="button" className="bf-btn-primary" disabled={busy || isEditing} onClick={() => void handleSubmitForReview(item)}>
                            {submittingId === item.id ? 'Submitting…' : 'Submit for Review'}
                          </button>
                        </div>
                      ) : (
                        <span className="bf-saved-readonly">
                          {item.status === 'IN_REVIEW' ? 'Awaiting reviewer decision' : item.status === 'APPROVED' ? 'Approved' : 'Editing unavailable in this view'}
                        </span>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </>
      )}
      {discussion && (
        <div className="bf-discussion-backdrop">
          <section
            className="bf-discussion-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bf-discussion-title"
          >
            <header className="bf-discussion-header">
              <div>
                <span className="bf-discussion-eyebrow">CAMPAIGN DISCUSSION</span>
                <h2 id="bf-discussion-title">{discussion.title}</h2>
                <p>{statusLabel(discussion.status)} · {discussion.comments.length} comments</p>
              </div>
              <div className="bf-discussion-header-actions">
                <button
                  type="button"
                  className="bf-btn-secondary"
                  disabled={discussionLoadingId !== null}
                  onClick={() => void handleRefreshDiscussion()}
                >
                  {discussionLoadingId === discussion.id ? 'Refreshing…' : 'Refresh comments'}
                </button>
                <button
                  type="button"
                  className="bf-btn-secondary"
                  onClick={() => {
                    setDiscussion(null)
                    setDiscussionText('')
                    setDiscussionNotice(null)
                  }}
                >
                  Close
                </button>
              </div>
            </header>

            {discussionNotice && <div className="bf-save-feedback success" role="status">{discussionNotice}</div>}
            <div className="bf-discussion-thread" aria-live="polite">
              {discussion.comments.length === 0 ? (
                <div className="bf-discussion-empty">
                  <strong>No comments yet</strong>
                  <p>Reviewer and manager comments will appear here as soon as they are posted. You can also leave a comment for the review team.</p>
                </div>
              ) : discussion.comments.map((comment) => (
                <article className="bf-discussion-comment" key={comment.id}>
                  <div className="bf-discussion-comment-meta">
                    <strong>{comment.author?.name ?? 'Workspace member'}</strong>
                    <span>{comment.author?.role ?? 'User'}</span>
                    <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
                  </div>
                  <p>{comment.body}</p>
                </article>
              ))}
            </div>

            <form className="bf-discussion-form" onSubmit={(event) => void handlePostDiscussionComment(event)}>
              <label htmlFor="bf-creator-discussion-input">Add a comment</label>
              <textarea
                id="bf-creator-discussion-input"
                rows={3}
                maxLength={2000}
                value={discussionText}
                onChange={(event) => setDiscussionText(event.target.value)}
                placeholder="Ask a question or reply to the review team…"
                disabled={discussionBusy}
              />
              <div className="bf-discussion-form-footer">
                <p>Comments stay attached to this campaign, regardless of its review status.</p>
                <button type="submit" className="bf-btn-primary" disabled={discussionBusy || !discussionText.trim()}>
                  {discussionBusy ? 'Posting…' : 'Post comment'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}
