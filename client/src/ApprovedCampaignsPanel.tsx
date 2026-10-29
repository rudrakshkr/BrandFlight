import { useCallback, useEffect, useState, type FormEvent } from 'react'

interface ApprovedSummary {
  id: string
  title: string
  tags: string[]
  status: string
  createdAt: string
  updatedAt: string
  brandProfile?: { id: string; name: string } | null
  creator?: { id: string; name: string; email?: string; role?: string } | null
  _count: { findings: number; comments: number; revisions: number }
}

interface ApprovedComment {
  id: string
  body: string
  createdAt: string
  author?: { id: string; name: string; role: string; email?: string }
}

interface ApprovedDetail extends ApprovedSummary {
  contentText: string
  imageName: string | null
  imageAltText: string | null
  imageUrl: string | null
  imageAuditData: {
    totalFindings?: number
    findings?: Array<{ title: string; category: string; severity: string; message: string }>
    image?: { dominantColors?: string[]; width?: number | null; height?: number | null }
    logoVerification?: { status?: string; summary?: string; confidence?: number }
  } | null
  comments: ApprovedComment[]
  findings: Array<{ id: string; title: string; category: string; severity: string; message: string }>
}

interface Props {
  apiBaseUrl: string
  token: string
}

function displayDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export default function ApprovedCampaignsPanel({ apiBaseUrl, token }: Props) {
  const [campaigns, setCampaigns] = useState<ApprovedSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<ApprovedDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(false)
  const [posting, setPosting] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadCampaigns = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${apiBaseUrl}/api/submissions?scope=approved`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json().catch(() => null) as {
        submissions?: ApprovedSummary[]; error?: string
      } | null
      if (!response.ok || !Array.isArray(data?.submissions)) {
        throw new Error(data?.error ?? `Unable to load approved campaigns (HTTP ${response.status}).`)
      }
      setCampaigns(data.submissions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load approved campaigns.')
    } finally {
      setLoading(false)
    }
  }, [apiBaseUrl, token])

  useEffect(() => {
    const timerId = window.setTimeout(() => { void loadCampaigns() }, 0)
    return () => window.clearTimeout(timerId)
  }, [loadCampaigns])

  const openCampaign = async (item: ApprovedSummary) => {
    setSelectedId(item.id)
    setOpening(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`${apiBaseUrl}/api/submissions/${encodeURIComponent(item.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json().catch(() => null) as {
        submission?: ApprovedDetail; error?: string
      } | null
      if (!response.ok || !data?.submission) {
        throw new Error(data?.error ?? `Unable to open campaign (HTTP ${response.status}).`)
      }
      if (data.submission.status !== 'APPROVED') {
        throw new Error('This campaign is no longer approved. Refresh the list and try again.')
      }
      setSelected(data.submission)
      setCommentText('')
    } catch (err) {
      setSelected(null)
      setError(err instanceof Error ? err.message : 'Unable to open campaign.')
    } finally {
      setOpening(false)
    }
  }

  const postComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const body = commentText.trim()
    if (!selected || !body || posting) return
    setPosting(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`${apiBaseUrl}/api/submissions/${encodeURIComponent(selected.id)}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ body }),
      })
      const data = await response.json().catch(() => null) as {
        comment?: ApprovedComment; error?: string
      } | null
      if (!response.ok || !data?.comment) {
        throw new Error(data?.error ?? `Unable to post comment (HTTP ${response.status}).`)
      }
      setSelected((current) => current && current.id === selected.id
        ? { ...current, comments: [...current.comments, data.comment!] }
        : current)
      setCampaigns((current) => current.map((item) => item.id === selected.id
        ? { ...item, _count: { ...item._count, comments: item._count.comments + 1 } }
        : item))
      setCommentText('')
      setNotice('Comment added to the campaign discussion.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to post comment.')
    } finally {
      setPosting(false)
    }
  }

  return (
    <section className="bf-approved-page">
      <header className="bf-approved-header">
        <div>
          <span className="bf-approved-eyebrow">SHARED WORKSPACE</span>
          <h1>Approved Campaigns</h1>
          <p>Published decisions in one place, with a shared discussion for all three roles.</p>
        </div>
        <button type="button" className="bf-btn-secondary" onClick={() => void loadCampaigns()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && <div className="bf-approved-feedback error" role="alert">{error}</div>}
      {notice && <div className="bf-approved-feedback success" role="status">{notice}</div>}

      <div className="bf-approved-layout">
        <aside className="bf-approved-list" aria-label="Approved campaigns">
          <div className="bf-approved-list-head">
            <h2>Campaigns</h2>
            <span>{campaigns.length}</span>
          </div>
          {loading && campaigns.length === 0 ? (
            <div className="bf-approved-empty">Loading approved campaigns…</div>
          ) : campaigns.length === 0 ? (
            <div className="bf-approved-empty">
              <strong>No approved campaigns yet</strong>
              <p>Once a Reviewer or Manager approves a campaign, it will appear here for everyone.</p>
            </div>
          ) : campaigns.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`bf-approved-item${selectedId === item.id ? ' active' : ''}`}
              onClick={() => void openCampaign(item)}
              disabled={opening}
              aria-current={selectedId === item.id ? 'true' : undefined}
            >
              <span className="bf-approved-item-top">
                <span className="bf-approved-status">Approved</span>
                <span className="bf-approved-date">{displayDate(item.updatedAt)}</span>
              </span>
              <strong>{item.title}</strong>
              <span className="bf-approved-item-meta">{item.brandProfile?.name ?? 'Brand'} · {item.creator?.name ?? 'Creator'}</span>
              <span className="bf-approved-item-counts">{item._count.comments} comments · {item._count.revisions} revisions</span>
            </button>
          ))}
        </aside>

        <div className="bf-approved-detail" aria-busy={opening}>
          {opening ? (
            <div className="bf-approved-detail-empty"><span className="bf-loading-spinner" aria-hidden="true" /><strong>Opening approved campaign…</strong></div>
          ) : !selected ? (
            <div className="bf-approved-detail-empty">
              <span className="bf-approved-detail-mark" aria-hidden="true">✓</span>
              <h2>Select an approved campaign</h2>
              <p>View the final copy and image of your approved campaign :)</p>
            </div>
          ) : (
            <>
              <header className="bf-approved-detail-header">
                <div>
                  <span className="bf-approved-status"><span aria-hidden="true">✓</span> Approved</span>
                  <h2>{selected.title}</h2>
                  <p>{selected.brandProfile?.name ?? 'Brand'} · Created by {selected.creator?.name ?? 'Creator'} · Approved {displayDate(selected.updatedAt)}</p>
                </div>
                {selected.tags?.length > 0 && <div className="bf-approved-tags">{selected.tags.map((tag) => <span key={tag}>{tag.replace(/_/g, ' ')}</span>)}</div>}
              </header>

              <section className="bf-approved-section">
                <h3>Final campaign</h3>
                <pre className="bf-approved-copy">{selected.contentText}</pre>
                {selected.imageUrl && (
                  <figure className="bf-approved-image">
                    <img src={selected.imageUrl} alt={selected.imageAltText?.trim() || selected.imageName || `Image for ${selected.title}`} loading="lazy" />
                    <figcaption>{selected.imageName || 'Campaign image'}{selected.imageAltText ? ` · Alt text: ${selected.imageAltText}` : ' · No alt text supplied'}</figcaption>
                  </figure>
                )}
                {selected.imageAuditData && (
                  <div className="bf-approved-audit-summary">
                    <strong>Saved image audit</strong>
                    <span>{selected.imageAuditData.totalFindings ?? 0} finding(s) at approval</span>
                    {selected.imageAuditData.logoVerification?.status && <span>Logo: {selected.imageAuditData.logoVerification.status.replace(/_/g, ' ')}</span>}
                  </div>
                )}
              </section>

              <section className="bf-approved-discussion" aria-labelledby="bf-approved-discussion-title">
                <div className="bf-approved-discussion-head">
                  <div><h3 id="bf-approved-discussion-title">Campaign discussion</h3><p>Comments are shared with Creator, Reviewer, and Manager.</p></div>
                  <span>{selected.comments.length}</span>
                </div>
                <div className="bf-approved-thread" aria-live="polite">
                  {selected.comments.length === 0 ? (
                    <div className="bf-approved-thread-empty"><strong>Start the conversation</strong><p>No comments on this approved campaign yet.</p></div>
                  ) : selected.comments.map((comment) => (
                    <article className="bf-approved-comment" key={comment.id}>
                      <div className="bf-approved-comment-meta">
                        <strong>{comment.author?.name ?? 'Workspace member'}</strong>
                        <span>{comment.author?.role ?? 'User'}</span>
                        <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
                      </div>
                      <p>{comment.body}</p>
                    </article>
                  ))}
                </div>
                <form className="bf-approved-comment-form" onSubmit={(event) => void postComment(event)}>
                  <label htmlFor="bf-approved-comment-input">Add to discussion</label>
                  <textarea id="bf-approved-comment-input" rows={3} maxLength={2000} value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Write a comment for everyone viewing this campaign…" disabled={posting} />
                  <div><span>Visible to all workspace roles</span><button type="submit" className="bf-btn-primary" disabled={posting || !commentText.trim()}>{posting ? 'Posting…' : 'Post comment'}</button></div>
                </form>
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
