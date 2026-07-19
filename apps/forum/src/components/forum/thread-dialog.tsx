'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowBigDown,
  ArrowBigUp,
  Bookmark,
  CheckCircle2,
  MessageCircle,
  Reply,
  Share2,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage, useTr } from '@/context/language-context'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldControl, FieldLabel } from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ForumApiError } from '@/lib/api'
import {
  DEFAULT_THREAD_COMMENTS,
  THREAD_COMMENTS,
  type ForumComment,
  type ForumCommunity,
  type ForumPost,
} from './forum-data'
import { ForumTrustBadgeIcon } from './trust-badge'

type CommentVoteResult = { score: number; viewerVote: -1 | 0 | 1 }

function ThreadComment({
  comment,
  onReply,
  onVote,
}: {
  comment: ForumComment
  onReply: (comment: ForumComment) => void
  onVote: (comment: ForumComment, value: -1 | 0 | 1) => Promise<CommentVoteResult>
}) {
  const { tr } = useLanguage()
  const [vote, setVote] = useState<-1 | 0 | 1>(comment.viewerVote || 0)
  const [baseScore, setBaseScore] = useState(comment.score)
  const [collapsed, setCollapsed] = useState(false)
  const replies = comment.replies || []
  const score = baseScore + vote
  const translatedBody = useTr(comment.body)
  const translatedRole = useTr(comment.authorRole)

  // Monotonic request id — rapid toggle reconciliation (audit: out-of-order responses
  // settled the UI on the FIRST request's result).
  const voteSeq = useRef(0)
  const voteComment = (direction: -1 | 1) => {
    const previous = vote
    const next = vote === direction ? 0 : direction
    setVote(next)
    const seq = ++voteSeq.current
    void onVote(comment, next).then((result) => {
      if (voteSeq.current !== seq) return
      setVote(result.viewerVote)
      setBaseScore(result.score - result.viewerVote)
    }).catch(() => {
      if (voteSeq.current !== seq) return
      setVote(previous)
      toast.error(tr('Your vote could not be saved.', 'Không thể lưu bình chọn của bạn.'))
    })
  }

  return (
    <article className="relative flex gap-3">
      <Avatar name={comment.author} url={comment.authorAvatarUrl} color={comment.authorAvatarColor} size="sm" className="h-8 w-8 text-2xs" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-bold text-foreground">{comment.author}</span>
          <ForumTrustBadgeIcon badge={comment.trustBadge} trustScore={comment.trustScore} />
          {comment.authorRole && <span className="text-2xs text-body">{translatedRole}</span>}
          <span className="text-2xs text-ink-4">{comment.timeLabel}</span>
          {comment.helpful && (
            <Badge variant="brand" size="sm">
              <CheckCircle2 className="h-3 w-3" />
              {tr('Helpful answer', 'Câu trả lời hữu ích')}
            </Badge>
          )}
        </div>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground">{translatedBody}</p>
        <div className="mt-2 flex items-center gap-1">
          <Button
            type="button"
            variant="soft"
            size="sm"
            className={cn('h-7 gap-1 px-2 text-xs text-body', vote === 1 && 'bg-accent text-accent-foreground')}
            onClick={() => voteComment(1)}
            aria-pressed={vote === 1}
            aria-label={vote === 1 ? tr('Remove helpful vote', 'Bỏ đánh giá hữu ích') : tr('Mark reply as helpful', 'Đánh dấu phản hồi hữu ích')}
          >
            <ArrowBigUp className={cn('h-4 w-4', vote === 1 && 'fill-current')} />
            {score}
          </Button>
          <Button type="button" variant="soft" size="sm" className="h-7 gap-1 px-2 text-xs text-body" onClick={() => onReply(comment)}>
            <Reply className="h-3.5 w-3.5" />
            {tr('Reply', 'Trả lời')}
          </Button>
        </div>
        {replies.length > 0 && (collapsed ? (
          <Button type="button" variant="bare" size="none" className="mt-3 h-auto text-xs font-semibold text-accent-foreground" onClick={() => setCollapsed(false)}>
            {tr(`Show ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`, `Hiện ${replies.length} phản hồi`)}
          </Button>
        ) : (
          <div className="relative mt-4 space-y-4 pl-5">
            <Button
              type="button"
              variant="bare"
              size="none"
              className="group absolute inset-y-0 left-0 w-3 rounded-full before:absolute before:inset-y-0 before:left-1.5 before:border-l before:border-border hover:before:border-brand focus-visible:before:border-brand"
              onClick={() => setCollapsed(true)}
              aria-label={tr('Collapse this comment branch', 'Thu gọn nhánh bình luận này')}
            />
            {replies.map((reply) => <ThreadComment key={reply.id} comment={reply} onReply={onReply} onVote={onVote} />)}
          </div>
        ))}
      </div>
    </article>
  )
}

export function ThreadDialog({
  post,
  community,
  vote,
  saved,
  onOpenChange,
  onVote,
  onSave,
  comments: liveComments,
  onAddReply,
  onCommentVote,
  canDelete = false,
  onDelete,
}: {
  post: ForumPost | null
  community: ForumCommunity | null
  vote: -1 | 0 | 1
  saved: boolean
  onOpenChange: (open: boolean) => void
  onVote: (direction: -1 | 1) => void
  onSave: () => void
  comments?: ForumComment[] | null
  onAddReply?: (body: string, parentId: string | null) => Promise<ForumComment>
  onCommentVote?: (comment: ForumComment, value: -1 | 0 | 1) => Promise<CommentVoteResult>
  canDelete?: boolean
  onDelete?: () => void
}) {
  const { tr } = useLanguage()
  const [reply, setReply] = useState('')
  const [commentsByPost, setCommentsByPost] = useState<Record<string, ForumComment[]>>({})
  const [replyTo, setReplyTo] = useState<{ id: string; author: string } | null>(null)
  const [submittingReply, setSubmittingReply] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const translatedTitle = useTr(post?.title)
  const translatedBody = useTr(post?.body)

  useEffect(() => {
    setReply('')
    setReplyTo(null)
  }, [post?.id])

  const addedComments = post ? commentsByPost[post.id] || [] : []
  const comments = useMemo(() => {
    if (!post) return []
    const seeded = liveComments ?? (post.live ? [] : THREAD_COMMENTS[post.id] || DEFAULT_THREAD_COMMENTS)
    return [...addedComments, ...seeded]
  }, [addedComments, liveComments, post])

  if (!post || !community) return null
  const score = post.score + vote

  const share = async () => {
    const url = `${window.location.origin}/?post=${encodeURIComponent(post.id)}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success(tr('Discussion link copied.', 'Đã sao chép liên kết thảo luận.'))
    } catch {
      toast.message(url)
    }
  }

  const addReply = async () => {
    const body = reply.trim()
    if (!body) return
    if (post.live && onAddReply) {
      setSubmittingReply(true)
      try {
        await onAddReply(body, replyTo?.id || null)
        setReply('')
        setReplyTo(null)
        toast.success(tr('Your reply is live.', 'Câu trả lời của bạn đã được đăng.'))
      } catch (error) {
        // auth_required already opened the sign-in dialog — an error toast on
        // top of it would be misleading (the draft stays in the composer).
        if (!(error instanceof ForumApiError && error.code === 'auth_required')) {
          toast.error(tr('Your reply could not be published.', 'Không thể đăng câu trả lời của bạn.'))
        }
      } finally {
        setSubmittingReply(false)
      }
      return
    }
    setCommentsByPost((current) => ({
      ...current,
      [post.id]: [{
        id: `local-${Date.now()}`,
        author: tr('You', 'Bạn'),
        body,
        score: 1,
        timeLabel: tr('Just now', 'Vừa xong'),
      }, ...(current[post.id] || [])],
    }))
    setReply('')
    setReplyTo(null)
    toast.success(tr('Your reply was added to this preview.', 'Câu trả lời đã được thêm vào bản xem trước.'))
  }

  const startReply = (comment: ForumComment) => {
    setReplyTo({ id: comment.id, author: comment.author })
    setReply(`@${comment.author} `)
    requestAnimationFrame(() => document.getElementById('forum-thread-reply')?.focus())
  }

  return (
    <Dialog open={Boolean(post)} onOpenChange={onOpenChange}>
      <DialogContent ref={dialogRef} initialFocus={dialogRef} className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden bg-card p-0 sm:max-h-[calc(100dvh-3rem)] sm:max-w-3xl">
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          <DialogHeader className="border-b border-border px-5 py-5 pr-14 sm:px-6">
            <div className="flex flex-wrap items-center gap-2 text-xs text-body">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary font-bold text-white">
                {community.name.charAt(0)}
              </span>
              <span className="font-bold text-foreground">{tr(community.name, community.nameVi)}</span>
              <span aria-hidden="true">·</span>
              <span>{post.author}</span>
              <ForumTrustBadgeIcon badge={post.trustBadge} trustScore={post.trustScore} />
              <span aria-hidden="true">·</span>
              <span>{post.timeLabel}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {post.pinned && <Badge variant="brand" size="sm">{tr('Pinned', 'Đã ghim')}</Badge>}
              <Badge variant={post.kind === 'question' ? 'warning' : 'neutral'} size="sm">
                {tr(post.flair, post.flairVi)}
              </Badge>
            </div>
            <DialogTitle className="mt-2 text-xl font-bold leading-snug text-foreground sm:text-2xl">
              {translatedTitle}
            </DialogTitle>
            <DialogDescription className="mt-2 whitespace-pre-line text-base leading-relaxed text-body">
              {translatedBody}
            </DialogDescription>
            {post.media?.length ? (
              <div className={cn('mt-4 grid gap-2 overflow-hidden rounded-xl', post.media.length > 1 && 'grid-cols-2')}>
                {post.media.map((item) => <img key={item.url} src={item.url} alt={item.altText || ''} className="max-h-96 w-full object-cover" />)}
              </div>
            ) : null}
          </DialogHeader>

          <div className="flex items-center gap-1 border-b border-border px-4 py-2 sm:px-6">
            <div className="flex items-center rounded-xl bg-tint p-0.5">
              <Button
                type="button"
                variant="bare"
                size="icon-sm"
                className={cn('text-body', vote === 1 && 'bg-accent text-accent-foreground')}
                onClick={() => onVote(1)}
                aria-label={tr('Upvote', 'Bình chọn lên')}
                aria-pressed={vote === 1}
              >
                <ArrowBigUp className={cn('h-4 w-4', vote === 1 && 'fill-current')} />
              </Button>
              <span className="min-w-8 text-center text-xs font-bold tabular-nums text-foreground">{score}</span>
              <Button
                type="button"
                variant="bare"
                size="icon-sm"
                className={cn('text-body', vote === -1 && 'bg-destructive/10 text-destructive')}
                onClick={() => onVote(-1)}
                aria-label={tr('Downvote', 'Bình chọn xuống')}
                aria-pressed={vote === -1}
              >
                <ArrowBigDown className={cn('h-4 w-4', vote === -1 && 'fill-current')} />
              </Button>
            </div>
            <span className="inline-flex h-8 items-center gap-2 rounded-xl px-3 text-sm font-medium text-body" aria-label={`${post.commentCount + addedComments.length} ${tr('replies', 'phản hồi')}`}>
              <MessageCircle className="h-4 w-4" />
              {post.commentCount + addedComments.length}
            </span>
            {canDelete && <Button type="button" variant="soft" size="sm" className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onDelete} aria-label={tr('Delete post', 'Xóa bài viết')}>
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">{tr('Delete', 'Xóa')}</span>
            </Button>}
            <Button type="button" variant="soft" size="sm" className={cn('text-body', !canDelete && 'ml-auto')} onClick={share} aria-label={tr('Share post', 'Chia sẻ bài viết')}>
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">{tr('Share', 'Chia sẻ')}</span>
            </Button>
            <Button
              type="button"
              variant="soft"
              size="sm"
              className={cn('text-body', saved && 'bg-accent text-accent-foreground')}
              onClick={onSave}
              aria-pressed={saved}
              aria-label={saved ? tr('Remove from saved posts', 'Xóa khỏi bài viết đã lưu') : tr('Save post', 'Lưu bài viết')}
            >
              <Bookmark className={cn('h-4 w-4', saved && 'fill-current')} />
              <span className="hidden sm:inline">{saved ? tr('Saved', 'Đã lưu') : tr('Save', 'Lưu')}</span>
            </Button>
          </div>

          <div className="px-5 py-5 sm:px-6">
            <Field>
              <FieldLabel>{tr('Join the conversation', 'Tham gia cuộc trò chuyện')}</FieldLabel>
              <FieldControl
                id="forum-thread-reply"
                render={
                  <Textarea
                    id="forum-thread-reply"
                    size="compact"
                    rows={3}
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    placeholder={tr('Share a helpful, firsthand answer…', 'Chia sẻ câu trả lời hữu ích từ trải nghiệm thực tế…')}
                  />
                }
              />
              <div className="flex justify-end">
                {replyTo && (
                  <Button type="button" variant="bare" size="sm" className="mr-auto text-body" onClick={() => { setReplyTo(null); setReply('') }}>
                    {tr(`Replying to ${replyTo.author} · cancel`, `Đang trả lời ${replyTo.author} · hủy`)}
                  </Button>
                )}
                <Button type="button" variant="cta" size="sm" disabled={!reply.trim() || submittingReply} onClick={() => void addReply()}>
                  <Reply className="h-4 w-4" />
                  {tr('Reply', 'Trả lời')}
                </Button>
              </div>
            </Field>

            <div className="my-5 flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="shrink-0 text-xs font-semibold text-body">
                {tr('Community replies', 'Phản hồi từ cộng đồng')} · {comments.length}
              </span>
              <Separator className="flex-1" />
            </div>

            <div className="space-y-6">
              {comments.map((comment) => (
                <ThreadComment
                  key={comment.id}
                  comment={comment}
                  onReply={startReply}
                  onVote={onCommentVote || (async (item, value) => ({ score: item.score + value, viewerVote: value }))}
                />
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
