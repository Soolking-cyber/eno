'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowBigDown,
  ArrowBigUp,
  Bookmark,
  CheckCircle2,
  CornerDownRight,
  MessageCircle,
  Reply,
  Share2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
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
import {
  DEFAULT_THREAD_COMMENTS,
  THREAD_COMMENTS,
  type ForumComment,
  type ForumCommunity,
  type ForumPost,
} from './forum-data'

function ThreadComment({ comment, nested = false }: { comment: ForumComment; nested?: boolean }) {
  const { tr } = useLanguage()
  const [vote, setVote] = useState<0 | 1>(0)
  const score = comment.score + vote

  return (
    <article className={cn('relative flex gap-3', nested && 'mt-4')}>
      {nested && <CornerDownRight className="mt-2 h-4 w-4 shrink-0 text-ink-4" />}
      <Avatar name={comment.author} size="sm" className="h-8 w-8 text-2xs" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-bold text-foreground">{comment.author}</span>
          {comment.authorRole && <span className="text-2xs text-body">{comment.authorRole}</span>}
          <span className="text-2xs text-ink-4">{comment.timeLabel}</span>
          {comment.helpful && (
            <Badge variant="brand" size="sm">
              <CheckCircle2 className="h-3 w-3" />
              {tr('Helpful answer', 'Câu trả lời hữu ích')}
            </Badge>
          )}
        </div>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground">{comment.body}</p>
        <div className="mt-2 flex items-center gap-1">
          <Button
            type="button"
            variant="soft"
            size="sm"
            className={cn('h-7 gap-1 px-2 text-xs text-body', vote === 1 && 'bg-accent text-accent-foreground')}
            onClick={() => setVote(vote === 1 ? 0 : 1)}
            aria-pressed={vote === 1}
          >
            <ArrowBigUp className={cn('h-4 w-4', vote === 1 && 'fill-current')} />
            {score}
          </Button>
          <Button type="button" variant="soft" size="sm" className="h-7 gap-1 px-2 text-xs text-body">
            <Reply className="h-3.5 w-3.5" />
            {tr('Reply', 'Trả lời')}
          </Button>
        </div>
        {comment.replies?.map((reply) => <ThreadComment key={reply.id} comment={reply} nested />)}
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
}: {
  post: ForumPost | null
  community: ForumCommunity | null
  vote: -1 | 0 | 1
  saved: boolean
  onOpenChange: (open: boolean) => void
  onVote: (direction: -1 | 1) => void
  onSave: () => void
}) {
  const { tr } = useLanguage()
  const [reply, setReply] = useState('')
  const [addedComments, setAddedComments] = useState<ForumComment[]>([])

  useEffect(() => {
    setReply('')
    setAddedComments([])
  }, [post?.id])

  const comments = useMemo(() => {
    if (!post) return []
    return [...addedComments, ...(THREAD_COMMENTS[post.id] || DEFAULT_THREAD_COMMENTS)]
  }, [addedComments, post])

  if (!post || !community) return null
  const score = post.score + vote

  const share = async () => {
    const url = `${window.location.origin}/forum?post=${encodeURIComponent(post.id)}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success(tr('Discussion link copied.', 'Đã sao chép liên kết thảo luận.'))
    } catch {
      toast.message(url)
    }
  }

  const addReply = () => {
    const body = reply.trim()
    if (!body) return
    setAddedComments((current) => [{
      id: `local-${Date.now()}`,
      author: tr('You', 'Bạn'),
      body,
      score: 1,
      timeLabel: tr('Just now', 'Vừa xong'),
    }, ...current])
    setReply('')
    toast.success(tr('Your reply was added to this preview.', 'Câu trả lời đã được thêm vào bản xem trước.'))
  }

  return (
    <Dialog open={Boolean(post)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden bg-card p-0 sm:max-h-[calc(100dvh-3rem)] sm:max-w-3xl">
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          <DialogHeader className="border-b border-border px-5 py-5 pr-14 sm:px-6">
            <div className="flex flex-wrap items-center gap-2 text-xs text-body">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary font-bold text-white">
                {community.name.charAt(0)}
              </span>
              <span className="font-bold text-foreground">{tr(community.name, community.nameVi)}</span>
              <span aria-hidden="true">·</span>
              <span>{post.author}</span>
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
              {post.title}
            </DialogTitle>
            <DialogDescription className="mt-2 whitespace-pre-line text-base leading-relaxed text-body">
              {post.body}
            </DialogDescription>
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
            <Button type="button" variant="soft" size="sm" className="text-body">
              <MessageCircle className="h-4 w-4" />
              {post.commentCount + addedComments.length}
            </Button>
            <Button type="button" variant="soft" size="sm" className="ml-auto text-body" onClick={share}>
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
                <Button type="button" variant="cta" size="sm" disabled={!reply.trim()} onClick={addReply}>
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
              {comments.map((comment) => <ThreadComment key={comment.id} comment={comment} />)}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
