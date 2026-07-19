'use client'

import type { MouseEvent } from 'react'
import {
  ArrowBigDown,
  ArrowBigUp,
  Bookmark,
  CheckCircle2,
  Flag,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Pin,
  Share2,
  Trash2,
  UserRoundX,
} from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage, useTr } from '@/context/language-context'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import type { ForumCommunity, ForumPost } from './forum-data'
import { ForumTrustBadgeIcon } from './trust-badge'

export function ForumPostCard({
  post,
  community,
  vote,
  saved,
  onVote,
  onSave,
  onOpen,
  onBlock,
  onReport,
  canDelete,
  onDelete,
}: {
  post: ForumPost
  community: ForumCommunity
  vote: -1 | 0 | 1
  saved: boolean
  onVote: (direction: -1 | 1) => void
  onSave: () => void
  onOpen: () => void
  onBlock: () => void
  onReport: () => void
  canDelete: boolean
  onDelete: () => void
}) {
  const { tr } = useLanguage()
  const score = post.score + vote
  const translatedTitle = useTr(post.title)
  const translatedBody = useTr(post.body)
  const translatedRole = useTr(post.authorRole)
  // Real permalink for crawlers, new tabs, and middle/modified clicks; a plain
  // click is intercepted below and keeps the in-feed ?post= dialog flow
  // (pushState — no server round-trip, no page reload).
  const permalink = `/post/${encodeURIComponent(post.id)}`
  const openFromAnchor = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen()
  }

  const share = async () => {
    const url = `${window.location.origin}${permalink}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success(tr('Discussion link copied.', 'Đã sao chép liên kết thảo luận.'))
    } catch {
      toast.message(url)
    }
  }

  return (
    <Card className="gap-0 rounded-none border-b border-border/80 bg-transparent py-0 ring-0">
      <div className="flex">
        <div className="hidden w-14 shrink-0 flex-col items-center justify-center gap-1 py-4 sm:flex">
          <Button
            type="button"
            variant="bare"
            size="icon"
            className={cn('text-body hover:bg-accent hover:text-accent-foreground', vote === 1 && 'bg-accent text-accent-foreground')}
            onClick={() => onVote(1)}
            aria-label={tr('Upvote', 'Bình chọn lên')}
            aria-pressed={vote === 1}
          >
            <ArrowBigUp className={cn('h-5 w-5', vote === 1 && 'fill-current')} />
          </Button>
          <span className="text-xs font-bold tabular-nums text-foreground">{score}</span>
          <Button
            type="button"
            variant="bare"
            size="icon"
            className={cn('text-body hover:bg-destructive/10 hover:text-destructive', vote === -1 && 'bg-destructive/10 text-destructive')}
            onClick={() => onVote(-1)}
            aria-label={tr('Downvote', 'Bình chọn xuống')}
            aria-pressed={vote === -1}
          >
            <ArrowBigDown className={cn('h-5 w-5', vote === -1 && 'fill-current')} />
          </Button>
        </div>

        <div className="min-w-0 flex-1 px-4 pb-3 pt-4 sm:px-5">
          <div className="flex items-start gap-2.5">
            <Avatar name={post.author} url={post.authorAvatarUrl} color={post.authorAvatarColor} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                <span className="font-bold text-foreground">{tr(community.name, community.nameVi)}</span>
                <span className="text-ink-4" aria-hidden="true">·</span>
                <span className="text-body">{post.author}</span>
                <ForumTrustBadgeIcon badge={post.trustBadge} trustScore={post.trustScore} />
                {post.official && <CheckCircle2 className="h-3.5 w-3.5 fill-brand text-white" aria-label={tr('Official', 'Chính thức')} />}
                <span className="text-ink-4" aria-hidden="true">·</span>
                <span className="text-ink-4">{post.timeLabel}</span>
              </div>
              {post.authorRole && <p className="mt-0.5 text-2xs text-body">{translatedRole}</p>}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger render={
                <IconButton size="sm" className="text-body hover:bg-tint" aria-label={tr('More post actions', 'Thêm thao tác với bài viết')}>
                  <MoreHorizontal className="h-5 w-5" />
                </IconButton>
              } />
              <DropdownMenuContent align="end" className="min-w-44">
                {canDelete ? <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <Trash2 />
                  {tr('Delete post', 'Xóa bài viết')}
                </DropdownMenuItem> : <>
                  <DropdownMenuItem onClick={onBlock}>
                    <UserRoundX />
                    {tr('Block this member', 'Chặn thành viên này')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={onReport}>
                    <Flag />
                    {tr('Report post', 'Báo cáo bài viết')}
                  </DropdownMenuItem>
                </>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {post.pinned && (
              <Badge variant="brand" size="sm">
                <Pin className="h-3 w-3" />
                {tr('Pinned', 'Đã ghim')}
              </Badge>
            )}
            <Badge variant={post.kind === 'question' ? 'warning' : post.kind === 'event' ? 'success' : 'neutral'} size="sm">
              {tr(post.flair, post.flairVi)}
            </Badge>
            {post.locationLabel && (
              <span className="inline-flex items-center gap-1 text-2xs font-medium text-body">
                <MapPin className="h-3 w-3" />
                {post.locationLabel}
              </span>
            )}
          </div>

          <Button
            asChild
            variant="bare"
            size="none"
            className="mt-3 h-auto w-full justify-start whitespace-normal text-left text-lg font-bold leading-snug text-foreground hover:text-accent-foreground"
          >
            <a href={permalink} onClick={openFromAnchor}>{translatedTitle}</a>
          </Button>
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-body">{translatedBody}</p>
          {post.media?.length ? (
            <div className={cn('mt-3 grid gap-1.5 overflow-hidden rounded-xl', post.media.length > 1 && 'grid-cols-2')}>
              {post.media.slice(0, 4).map((item, index) => (
                <img key={item.url} src={item.url} alt={item.altText || ''} className={cn('h-52 w-full object-cover', post.media!.length > 1 && 'h-36', index === 0 && post.media!.length === 3 && 'row-span-2 h-full')} />
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex items-center gap-1 pt-1">
            <div className="flex items-center rounded-xl bg-tint p-0.5 sm:hidden">
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
              <span className="min-w-7 text-center text-xs font-bold tabular-nums text-foreground">{score}</span>
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

            <Button asChild variant="soft" size="sm" className="text-body">
              <a href={permalink} onClick={openFromAnchor} aria-label={tr('Open replies', 'Mở phản hồi')}>
                <MessageCircle className="h-4 w-4" />
                <span>{post.commentCount}</span>
                <span className="hidden sm:inline">{tr('replies', 'phản hồi')}</span>
              </a>
            </Button>
            <Button type="button" variant="soft" size="sm" className="ml-auto text-body" onClick={share} aria-label={tr('Share post', 'Chia sẻ bài viết')}>
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
        </div>
      </div>
    </Card>
  )
}
