'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/auth-context'
import { Tr, useLanguage, useTr } from '@/context/language-context'
import { EnoSeal } from '@/components/marketplace/eno-seal'
import { HelpTopicIcon } from '@/components/marketplace/help-center'
import { HelpVote } from '@/components/marketplace/help-vote'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { helpTopic } from '@/lib/help-center'
import type { HelpPost } from '@/lib/help-center-data'
import { timeAgo } from '@/lib/types'

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
  const { lang } = useLanguage()
  const body = useTr(comment.body)
  return (
    <li className={cn('flex gap-3 py-4', nested ? 'pl-4' : 'border-b border-border last:border-b-0')}>
      <Avatar name={comment.author.name} url={comment.author.avatarUrl} color={comment.author.avatarColor} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{comment.author.name}</span>
          <span aria-hidden>·</span>
          <span>{timeAgo(comment.createdAt, lang)}</span>
          {comment.helpful && (
            <Badge variant="brand" size="sm">
              <CheckCircle2 className="size-3" aria-hidden />
              <Tr text="Helpful" />
            </Badge>
          )}
        </p>
        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-body">{body}</p>
        <div className="mt-2">
          <HelpVote id={comment.id} kind="comment" score={comment.score} viewerVote={comment.viewerVote} size="sm" />
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

export function HelpThreadClient({ post, comments: initial }: { post: HelpPost; comments: HelpComment[] }) {
  const { tr, lang } = useLanguage()
  const { user, openSignIn } = useAuth()
  const router = useRouter()
  const title = useTr(post.title)
  const body = useTr(post.body)
  const topic = helpTopic(post.community)

  const [comments, setComments] = useState(initial)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

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
      const created = await response.json()
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
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-body transition-colors hover:bg-muted"
          >
            {/* Same renderer as the /help chips (14px at chip scale) so the topic's
                glyph is identical everywhere it appears. Line-only here — an idle chip
                is chrome (§6); the trust topic's seal keeps its chief by design. */}
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
            <EnoSeal className="size-3.5" />
            <Tr text="From the eno team" />
          </Badge>
        )}
      </div>

      <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
      <p className="mt-2 text-xs text-muted-foreground">
        {post.author.name}
        <span aria-hidden> · </span>
        {timeAgo(post.createdAt, lang)}
      </p>

      {/* Plain text with "•" bullets — no markdown renderer exists in this stack, so
          whitespace-pre-line is what preserves the authored structure. */}
      <p className="mt-5 whitespace-pre-line text-base leading-relaxed text-body">{body}</p>

      <div className="mt-6 flex items-center gap-3 border-y border-border py-3">
        <HelpVote id={post.id} kind="post" score={post.score} viewerVote={post.viewerVote} />
        <span className="text-sm text-muted-foreground">
          <Tr text="Was this helpful?" />
        </span>
      </div>

      <section className="mt-8" aria-labelledby="help-thread-replies">
        <h2 id="help-thread-replies" className="flex items-center gap-2 text-base font-bold text-foreground">
          <MessageCircle className="size-4" aria-hidden />
          {comments.length > 0
            ? tr(`${comments.length} replies`, `${comments.length} phản hồi`)
            : tr('No replies yet', 'Chưa có phản hồi')}
        </h2>

        <form onSubmit={submit} className="mt-4">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            maxLength={10_000}
            placeholder={tr('Ask a follow-up or add what worked for you…', 'Hỏi thêm hoặc chia sẻ cách bạn đã làm…')}
            aria-label={tr('Write a reply', 'Viết phản hồi')}
          />
          <div className="mt-2 flex justify-end">
            <Button type="submit" variant="cta" disabled={sending || !draft.trim()}>
              {sending ? <Tr text="Posting…" /> : <Tr text="Post reply" />}
            </Button>
          </div>
        </form>

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
