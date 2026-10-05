'use client'

import { fillTemplate } from '@/lib/i18n/placeholders'
import { useState } from 'react'
import { RelativeTime } from '@/components/marketplace/relative-time'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, ChevronRight, MessageCircle, ShieldCheck } from "@/components/ui/icons"
import { toast } from 'sonner'
import { useAuth } from '@/context/auth-context'
import { Tr, useLanguage, useTr } from '@/context/language-context'
import { HelpTopicIcon } from '@/components/marketplace/help-center'
import { HelpVote } from '@/components/marketplace/help-vote'
import { ReportContentButton } from '@/components/marketplace/report-content-button'
import { useLocalized } from '@/components/marketplace/listing-content'
import { formatHelpBody } from '@/components/marketplace/rich-text'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Rows, Row } from '@/components/ui/rows'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { formatArticleDate } from '@/lib/dates'
import { helpModifiedAt } from '@/lib/help-modified'
import { helpTopic } from '@/lib/help-center'
import type { HelpPost } from '@/lib/help-center-data'

/** Server-read translations of one string, target language → text (translate.ts cachedTranslations). */
type Embedded = Record<string, string> | null

/** A related answer: its id, English title and whatever translations of the title the cache holds. */
export type RelatedHelp = { id: string; title: string; i18n: Embedded }

export type HelpComment = {
  id: string
  postId: string
  parentId: string | null
  body: string
  author: { id: string | null; name: string; avatarUrl: string | null; avatarColor: string | null }
  helpful: boolean
  score: number
  viewerVote: number
  createdAt: string
  replies: HelpComment[]
}

function CommentRow({ comment, nested = false }: { comment: HelpComment; nested?: boolean }) {
  const body = useTr(comment.body)
  return (
    <li className={cn('flex gap-3 py-4', nested ? 'pl-4' : 'border-b border-border last:border-b-0')}>
      <Avatar name={comment.author.name} url={comment.author.avatarUrl} color={comment.author.avatarColor} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{comment.author.name}</span>
          <span aria-hidden>·</span>
          <RelativeTime iso={comment.createdAt} />
          {comment.helpful && (
            <Badge variant="brand" size="sm">
              <CheckCircle2 className="size-3" aria-hidden />
              <Tr text="Helpful" />
            </Badge>
          )}
        </p>
        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-body">{body}</p>
        <div className="mt-2 flex items-center gap-1">
          <HelpVote id={comment.id} kind="comment" score={comment.score} viewerVote={comment.viewerVote} size="sm" />
          {/* App Store gate `ugc-safety` (R5): report this reply into the moderation queue. Renders nothing
              while the gate is off; a reply still being posted (no server id yet) has nothing to report. */}
          {comment.id && <ReportContentButton kind="help-comment" id={comment.id} />}
        </div>
        {comment.replies.length > 0 && (
          // Replies indent once and stop. A help thread is a question and its answers,
          // not a debate tree — deeper nesting on a phone just eats the text column, so
          // the server hoists everything below level 2 up to here.
          <ul className="mt-2 border-l border-border">
            {comment.replies.map((reply) => (
              <CommentRow key={reply.id} comment={reply} nested />
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

function RelatedRow({ item }: { item: RelatedHelp }) {
  // 'english': related answers are official ones only (loadRelatedHelp filters `official: true`).
  const title = useLocalized(item.title, null, item.i18n, 'english')
  return (
    <Row className="py-0">
      <Link
        href={`/help/${encodeURIComponent(item.id)}`}
        className="group grid grid-cols-[minmax(0,1fr)_1rem] items-center gap-x-3 py-3 text-sm font-semibold text-foreground hover:text-accent-foreground"
      >
        <span className="min-w-0">{title}</span>
        <ChevronRight className="size-4 text-ink-4 group-hover:text-accent-foreground" aria-hidden />
      </Link>
    </Row>
  )
}

export function HelpThreadClient({
  post,
  comments: initial,
  i18n,
  related = [],
}: {
  post: HelpPost
  comments: HelpComment[]
  /**
   * The Translation cache's rows for this post's title and body, read on the server (L-CONTENT-VI).
   * The curated Vietnamese for every seeded answer lives in that cache (sync-help-center.ts), but
   * `useTr` only reaches it after hydration, so a Vietnamese reader's server HTML — h1 included — was
   * English. useLocalized renders the embed synchronously and falls back to useTr without it.
   * ⛔ AN OFFICIAL ANSWER IS ENGLISH BY AUTHORSHIP, NOT BY DETECTION (useLocalized's 'english' source):
   * the English reader gets the text as written and nothing is ever sent to /api/translate target=en.
   * Detection decides per LETTER, and 10 of the 40 seeded bodies carry one it reads as foreign
   * ("12.000.000 đ", "한국어") — each was machine-translated English→English after hydration, and a
   * Vietnamese reader was shown the English body over the curated twin (review, 2026-09-29).
   * ⚠️ A MEMBER'S POST keeps the owner's 2026-07-14 rule for user-written text (listing-content.tsx):
   * under the English UI a Vietnamese-authored post reads in English — the embed's `en`, else one
   * /api/translate call (rate-limited, cached) — which useTr never applied because it never targets
   * English. Its known cost is the listing description's: an English post quoting "500.000 đ" is
   * detected as Vietnamese and round-trips.
   */
  i18n?: { title: Embedded; body: Embedded }
  related?: RelatedHelp[]
}) {
  const { tr, lang } = useLanguage()
  const { user, openSignIn } = useAuth()
  const router = useRouter()
  const title = useLocalized(post.title, null, i18n?.title, post.official ? 'english' : 'title')
  const body = useLocalized(post.body, null, i18n?.body, post.official ? 'english' : 'description')
  // Printed only after a REAL edit: never-edited, helpModifiedAt is the createdAt the seed writes as
  // its curated-order key, which the page leaves unprinted (JSON-LD and lastmod still carry it, I3c).
  // Whenever a date IS printed it is helpModifiedAt, so it cannot differ from dateModified.
  const modifiedAt = post.official && post.editedAt ? helpModifiedAt(post) : null
  const topic = helpTopic(post.community)

  const [comments, setComments] = useState(initial)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  // The composer stays behind a button until asked for (C-HELP-CENTER). An official answer read by
  // someone who got what they came for should end on the answer, not on an empty reply box.
  const [composing, setComposing] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!user) {
      openSignIn()
      return
    }
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const response = await fetch('/api/forum/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.id, body: text }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || String(response.status))
      }
      // POST /api/forum/comments answers `{ comment: {…} }` — reading the envelope as the comment gave the
      // fresh row `id: undefined` (a missing React key, and nothing for its Report control to name) until
      // the refresh below replaced it.
      const payload = await response.json()
      const created = payload?.comment ?? payload
      setComments((prev) => [
        ...prev,
        {
          id: created.id,
          postId: post.id,
          parentId: null,
          body: created.body ?? text,
          author: {
            id: created.author?.id ?? null,
            name: created.author?.name ?? tr('You', 'Bạn'),
            avatarUrl: created.author?.avatarUrl ?? null,
            avatarColor: created.author?.avatarColor ?? null,
          },
          helpful: false,
          score: created.score ?? 0,
          viewerVote: 0,
          createdAt: created.createdAt ?? new Date().toISOString(),
          // The composer only posts top-level replies, so a fresh one has no children.
          replies: [],
        },
      ])
      setDraft('')
      // The reply exists now but commentCount on the server payload is stale; refresh
      // so the count and any moderation state re-render from the source of truth.
      router.refresh()
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      toast.error(
        code === 'account_restricted'
          ? tr('Your account cannot post replies right now.', 'Tài khoản của bạn hiện không thể trả lời.')
          : code === 'rate_limited'
            ? tr('Too many replies just now. Try again shortly.', 'Bạn vừa gửi quá nhiều phản hồi. Vui lòng thử lại sau.')
            : tr('Could not post your reply. Try again.', 'Chưa gửi được phản hồi. Vui lòng thử lại.'),
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <article>
      <Link
        href="/help"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-foreground hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        <Tr text="Help center" />
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {topic && (
          <Link
            href="/help"
            className="press inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-body hover:bg-muted"
          >
            {/* Same renderer as the /help chips (14px at chip scale) so the topic's
                glyph is identical everywhere it appears.
                ⚠️ NO `selected` HERE, ON PURPOSE. This chip LABELS the post's topic — it is
                not a selection, and tapping it goes to /help unfiltered — so it renders the
                idle pure line, like the answer-group headings. Filling it would claim a
                "you are here" state the page does not have, and would be the one chip on
                the site that is filled at rest (owner, 2026-08-07: "not as default"). */}
            <HelpTopicIcon slug={post.community} className="size-3.5" />
            {tr(topic.name, topic.nameVi)}
          </Link>
        )}
        {post.official && (
          <Badge variant="brand" size="sm">
            {/* "From the eno team" is a first-party verification claim, so it carries
                the ONE first-party mark (icon-language §0b: the seal, never a lucide
                badge/shield — "when in doubt, it is the seal"). Chip-tier wash: the
                brand-100 chief still reads one step deeper than the badge's bg-accent
                in both themes. 14px sits on the header row beside the topic chip's
                14px glyph. */}
            <ShieldCheck className="size-3.5" />
            <Tr text="From the eno team" />
          </Badge>
        )}
      </div>

      <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
      <p className="mt-2 text-xs text-muted-foreground">
        {post.author.name}
        {/* ⚠️ AN OFFICIAL ANSWER SHOWS WHEN ITS COPY LAST CHANGED, NOT A RELATIVE "2 months ago" (C-DATES).
            The date is helpModifiedAt — `editedAt ?? createdAt`, the same value /help/[id]'s JSON-LD
            dateModified and the sitemap lastmod carry (I3c), so the page and the crawler agree — printed
            only once editedAt exists (a real edit, I3b): never-edited it is the seed's curated-order
            createdAt, and the line is left out rather than print that. formatArticleDate is zone-free string surgery, and
            `lang` is the page's [lang] variant in both the server render and the first client pass
            (the provider starts from it), so this cannot mismatch. */}
        {post.official ? (
          modifiedAt && (
            <>
              <span aria-hidden> · </span>
              {tr('Updated', 'Cập nhật')}{' '}
              <time dateTime={modifiedAt}>{formatArticleDate(modifiedAt, lang)}</time>
            </>
          )
        ) : (
          <>
            <span aria-hidden> · </span>
            <RelativeTime iso={post.createdAt} />
          </>
        )}
      </p>

      {/* Headings, paragraphs and lists (rich-text.tsx formatHelpBody), not a pre-line <p> printing
          "•" characters (C-HELP-RENDER). Sub-heads are only guessed on the eno team's own answers;
          a community post keeps its lines and lists. 60ch holds the measure inside the 3xl column. */}
      <div className="mt-5 max-w-[60ch] text-base leading-relaxed text-body">
        {formatHelpBody(body, { implicitHeadings: post.official, headingLevel: 2 })}
      </div>

      <div className="mt-6 flex items-center gap-3 border-y border-border py-3">
        <HelpVote id={post.id} kind="post" score={post.score} viewerVote={post.viewerVote} />
        <span className="text-sm text-muted-foreground">
          <Tr text="Was this helpful?" />
        </span>
        {/* App Store gate `ugc-safety` (R5): a MEMBER's question can be reported; the eno team's own
            answers are edited, not moderated, and the server refuses them as a report target. */}
        {!post.official && <ReportContentButton kind="help-post" id={post.id} className="ml-auto" />}
      </div>

      {related.length > 0 && (
        <section className="mt-8" aria-labelledby="help-thread-related">
          <h2 id="help-thread-related" className="h-section text-foreground">
            {tr('Related answers', 'Câu trả lời liên quan')}
          </h2>
          <Rows bordered className="mt-3">
            {related.map((item) => (
              <RelatedRow key={item.id} item={item} />
            ))}
          </Rows>
        </section>
      )}

      {/* ⚠️ NO "No replies yet" HEADING AT ZERO (C-HELP-CENTER). It was the page's only h2 on every
          official answer — the outline announced an absence. The heading exists when there is
          something under it; until then the section is one button. */}
      <section className="mt-8" aria-labelledby={comments.length > 0 ? 'help-thread-replies' : undefined}>
        {comments.length > 0 && (
          <h2 id="help-thread-replies" className="flex items-center gap-2 text-base font-bold text-foreground">
            <MessageCircle className="size-4" aria-hidden />
            {fillTemplate(tr('{length} replies', '{length} phản hồi'), '{length} replies', { length: String(comments.length) })}
          </h2>
        )}

        {composing ? (
          <form onSubmit={submit} className={cn(comments.length > 0 && 'mt-4')}>
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              maxLength={10_000}
              // The field appears because the reader just asked for it — focus follows the request.
              autoFocus
              placeholder={tr('Ask a follow-up or add what worked for you…', 'Hỏi thêm hoặc chia sẻ cách bạn đã làm…')}
              aria-label={tr('Write a reply', 'Viết phản hồi')}
            />
            <div className="mt-2 flex justify-end">
              <Button type="submit" variant="cta" disabled={sending || !draft.trim()}>
                {sending ? <Tr text="Posting…" /> : <Tr text="Post reply" />}
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="outline" onClick={() => setComposing(true)} className={cn(comments.length > 0 && 'mt-4')}>
            <MessageCircle className="size-4" aria-hidden />
            {tr('Ask a follow-up question', 'Đặt câu hỏi tiếp theo')}
          </Button>
        )}

        {comments.length > 0 && (
          <ul className="mt-4">
            {comments.map((comment) => (
              <CommentRow key={comment.id} comment={comment} />
            ))}
          </ul>
        )}
      </section>
    </article>
  )
}
