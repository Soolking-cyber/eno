'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { forumApi, ForumApiError } from '@/lib/api'
import {
  canDeleteForumPost,
  mapForumComment,
  mapForumPost,
  type ForumCommentResponse,
  type ForumPostResponse,
} from '@/lib/forum-api'
import type { NewForumPost } from './create-post-dialog'
import {
  INITIAL_FORUM_POSTS,
  type ForumComment,
  type ForumPost,
} from './forum-data'

export type ForumSort = 'best' | 'latest' | 'top'
export type FeedMode = 'all' | 'saved'

function insertThreadComment(comments: ForumComment[], comment: ForumComment, parentId: string | null): ForumComment[] {
  if (!parentId) return [comment, ...comments]
  return comments.map((item) => item.id === parentId
    ? { ...item, replies: [...(item.replies || []), comment] }
    : { ...item, replies: item.replies ? insertThreadComment(item.replies, comment, parentId) : item.replies })
}

export function useForumFeed({
  initialPosts,
  openPostId,
  closeThread,
  setCommunity,
  setMode,
  setSort,
  setQuery,
}: {
  initialPosts: ForumPost[]
  openPostId: string | null
  closeThread: () => void
  setCommunity: (slug: string | null) => void
  setMode: (mode: FeedMode) => void
  setSort: (sort: ForumSort) => void
  setQuery: (query: string) => void
}) {
  const { tr } = useLanguage()
  const { user, loading: authLoading, openSignIn } = useAuth()
  const [posts, setPosts] = useState<ForumPost[]>(initialPosts)
  const [votes, setVotes] = useState<Record<string, -1 | 0 | 1>>({})
  const [saved, setSaved] = useState<Set<string>>(() => new Set())
  const [deleteTarget, setDeleteTarget] = useState<ForumPost | null>(null)
  const [deletingPost, setDeletingPost] = useState(false)
  const [threadComments, setThreadComments] = useState<Record<string, ForumComment[]>>({})
  const fetchedAuthenticatedViewer = useRef(false)
  // Monotonic per-action request ids — the reconciliation guard for rapid toggles.
  const actionSeq = useRef<Record<string, number>>({})
  // Keyset cursor for feed pagination — continues the server's `best` chain that
  // produced the SSR page (tabs re-sort the union locally, same as the base feed).
  const feedCursorRef = useRef<string | null>(
    initialPosts.length >= 50 && initialPosts[initialPosts.length - 1].live ? initialPosts[initialPosts.length - 1].id : null,
  )
  const [hasMorePosts, setHasMorePosts] = useState(() => Boolean(
    initialPosts.length >= 50 && initialPosts[initialPosts.length - 1].live,
  ))
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    if (authLoading) return
    // The public feed was already fetched before first paint. Only fetch again
    // when viewer-specific vote/bookmark state is needed, or after that viewer
    // signs out. Never replace the visible post array during page hydration.
    if (!user && !fetchedAuthenticatedViewer.current) return
    let active = true
    forumApi<{ posts: ForumPostResponse[] }>('/api/forum/posts?limit=50')
      .then(({ posts: livePosts }) => {
        if (!active) return
        const liveById = new Map(livePosts.map((post) => [post.id, post]))
        setPosts((current) => current.map((post) => {
          const live = liveById.get(post.id)
          return live ? { ...post, score: live.score - live.viewerVote } : post
        }))
        // MERGE, never replace (audit P2): a `?post=` deep link outside the top-50
        // feed keeps its viewer vote/bookmark state — wholesale replacement erased it
        // whenever this feed refresh landed after the deep-linked post's own fetch.
        setVotes((current) => ({ ...current, ...Object.fromEntries(livePosts.map((post) => [post.id, post.viewerVote])) }))
        setSaved((current) => {
          const next = new Set(current)
          for (const post of livePosts) { if (post.saved) next.add(post.id); else next.delete(post.id) }
          return next
        })
        fetchedAuthenticatedViewer.current = Boolean(user)
      })
      .catch(() => {})
    return () => { active = false }
  }, [authLoading, user])

  useEffect(() => {
    if (!openPostId) return
    if (INITIAL_FORUM_POSTS.some((post) => post.id === openPostId)) return
    let active = true
    forumApi<{ post: ForumPostResponse; comments: ForumCommentResponse[] }>(`/api/forum/posts/${encodeURIComponent(openPostId)}`)
      .then(({ post, comments }) => {
        if (!active) return
        const mapped = mapForumPost(post)
        setPosts((current) => current.some((item) => item.id === mapped.id)
          ? current.map((item) => item.id === mapped.id ? mapped : item)
          : [mapped, ...current])
        setVotes((current) => ({ ...current, [mapped.id]: post.viewerVote }))
        setSaved((current) => {
          const next = new Set(current)
          if (post.saved) next.add(post.id)
          else next.delete(post.id)
          return next
        })
        setThreadComments((current) => ({ ...current, [post.id]: comments.map(mapForumComment) }))
      })
      .catch((error) => {
        if (!active) return
        // A deleted/never-existed deep link deserves an explanation + a clean URL;
        // transient network failures stay silent (the feed already rendered).
        if (error instanceof ForumApiError && error.status === 404) {
          toast.error(tr('This discussion is no longer available.', 'Thảo luận này không còn tồn tại.'))
          closeThread()
        }
      })
    return () => { active = false }
  }, [openPostId, user?.id])

  const activePost = posts.find((post) => post.id === openPostId)
    || INITIAL_FORUM_POSTS.find((post) => post.id === openPostId)
    || null

  const votePost = (id: string, direction: -1 | 1) => {
    if (!user) { openSignIn(); return }
    const post = posts.find((item) => item.id === id)
    const previous = votes[id] || 0
    const next = previous === direction ? 0 : direction
    setVotes((current) => ({ ...current, [id]: next }))
    if (!post?.live) return
    // Per-post request seq (audit P2): rapid toggle puts two POSTs in flight; only the
    // LATEST request may reconcile state, else out-of-order responses re-show a vote
    // the user removed and drift the score until remount.
    const seq = (actionSeq.current[`vote:${id}`] = (actionSeq.current[`vote:${id}`] || 0) + 1)
    void forumApi<{ score: number; viewerVote: -1 | 0 | 1 }>(`/api/forum/posts/${encodeURIComponent(id)}/vote`, {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify({ value: next }),
    }).then((result) => {
      if (actionSeq.current[`vote:${id}`] !== seq) return
      setVotes((current) => ({ ...current, [id]: result.viewerVote }))
      setPosts((current) => current.map((item) => item.id === id ? { ...item, score: result.score - result.viewerVote } : item))
    }).catch(() => {
      if (actionSeq.current[`vote:${id}`] !== seq) return
      setVotes((current) => ({ ...current, [id]: previous }))
      toast.error(tr('Your vote could not be saved.', 'Không thể lưu bình chọn của bạn.'))
    })
  }

  const savePost = (id: string) => {
    if (!user) { openSignIn(); return }
    const post = posts.find((item) => item.id === id)
    const wasSaved = saved.has(id)
    setSaved((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
        toast.message(tr('Removed from saved posts.', 'Đã xóa khỏi bài viết đã lưu.'))
      } else {
        next.add(id)
        toast.success(tr('Saved for later.', 'Đã lưu để xem sau.'))
      }
      return next
    })
    if (!post?.live) return
    const seq = (actionSeq.current[`save:${id}`] = (actionSeq.current[`save:${id}`] || 0) + 1)
    void forumApi<{ saved: boolean }>(`/api/forum/posts/${encodeURIComponent(id)}/bookmark`, {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify({ saved: !wasSaved }),
    }).then((result) => {
      if (actionSeq.current[`save:${id}`] !== seq) return
      setSaved((current) => {
        const next = new Set(current)
        if (result.saved) next.add(id)
        else next.delete(id)
        return next
      })
    }).catch(() => {
      if (actionSeq.current[`save:${id}`] !== seq) return
      setSaved((current) => {
        const next = new Set(current)
        if (wasSaved) next.add(id)
        else next.delete(id)
        return next
      })
      toast.error(tr('Your saved posts could not be updated.', 'Không thể cập nhật bài viết đã lưu.'))
    })
  }

  const reportPost = (post: ForumPost) => {
    if (!user) { openSignIn(); return }
    if (!post.live) {
      toast.message(tr('Preview discussions cannot be reported.', 'Không thể báo cáo thảo luận xem trước.'))
      return
    }
    void forumApi('/api/forum/reports', {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify({ postId: post.id, reason: 'other' }),
    }).then(() => toast.success(tr('Report sent to the community team.', 'Báo cáo đã được gửi đến đội ngũ cộng đồng.')))
      .catch(() => toast.error(tr('The report could not be sent.', 'Không thể gửi báo cáo.')))
  }

  const blockPostAuthor = (post: ForumPost) => {
    if (!user) { openSignIn(); return }
    if (!post.live || !post.authorId) {
      setPosts((current) => current.filter((item) => item.id !== post.id))
      toast.message(tr('This discussion was hidden from your preview.', 'Thảo luận này đã được ẩn khỏi bản xem trước.'))
      return
    }
    void forumApi('/api/forum/blocks', {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify({ profileId: post.authorId, blocked: true }),
    }).then(() => {
      setPosts((current) => current.filter((item) => item.authorId !== post.authorId))
      if (openPostId === post.id) closeThread()
      toast.success(tr('Member blocked. Their posts are now hidden.', 'Đã chặn thành viên. Bài viết của họ hiện đã được ẩn.'))
    }).catch(() => toast.error(tr('This member could not be blocked.', 'Không thể chặn thành viên này.')))
  }

  const requestDeletePost = (post: ForumPost) => {
    if (!user) { openSignIn(); return }
    if (!canDeleteForumPost(post, user.id)) {
      toast.error(tr('Only the post owner can delete this discussion.', 'Chỉ chủ bài viết mới có thể xóa thảo luận này.'))
      return
    }
    setDeleteTarget(post)
  }

  const deletePost = async () => {
    if (!deleteTarget || !user || !canDeleteForumPost(deleteTarget, user.id)) return
    const id = deleteTarget.id
    setDeletingPost(true)
    try {
      await forumApi<{ ok: true }>(`/api/forum/posts/${encodeURIComponent(id)}`, { method: 'DELETE', auth: 'required', direct: true })
      setPosts((current) => current.filter((post) => post.id !== id))
      setSaved((current) => { const next = new Set(current); next.delete(id); return next })
      setVotes((current) => { const next = { ...current }; delete next[id]; return next })
      setThreadComments((current) => { const next = { ...current }; delete next[id]; return next })
      if (openPostId === id) closeThread()
      setDeleteTarget(null)
      toast.success(tr('Your post was deleted.', 'Bài viết của bạn đã được xóa.'))
    } catch (error) {
      const code = error instanceof ForumApiError ? error.code : 'post_delete_failed'
      const copy: Record<string, [string, string]> = {
        forbidden: ['Only the post owner can delete this discussion.', 'Chỉ chủ bài viết mới có thể xóa thảo luận này.'],
        not_found: ['This post was already removed.', 'Bài viết này đã được xóa.'],
        rate_limited: ['Too many delete attempts. Please wait and try again.', 'Có quá nhiều lần xóa. Vui lòng chờ rồi thử lại.'],
        forum_delete_not_configured: ['Post deletion is temporarily unavailable. Please contact support.', 'Tính năng xóa bài tạm thời chưa khả dụng. Vui lòng liên hệ hỗ trợ.'],
      }
      const message = copy[code] || ['Your post could not be deleted. Please retry.', 'Không thể xóa bài viết của bạn. Vui lòng thử lại.']
      toast.error(tr(message[0], message[1]))
    } finally {
      setDeletingPost(false)
    }
  }

  const addThreadReply = async (body: string, parentId: string | null) => {
    // Same guard as every sibling mutation: open the sign-in dialog and throw a
    // typed code the thread dialog suppresses (no misleading "could not be
    // published" toast on top of the sign-in prompt).
    if (!user) { openSignIn(); throw new ForumApiError(401, 'auth_required') }
    if (!activePost) throw new Error('post_not_found')
    const { comment } = await forumApi<{ comment: ForumCommentResponse }>('/api/forum/comments', {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify({ postId: activePost.id, parentId, body }),
    })
    const mapped = mapForumComment(comment)
    setThreadComments((current) => ({
      ...current,
      [activePost.id]: insertThreadComment(current[activePost.id] || [], mapped, parentId),
    }))
    setPosts((current) => current.map((post) => post.id === activePost.id ? { ...post, commentCount: post.commentCount + 1 } : post))
    return mapped
  }

  const voteThreadComment = async (comment: ForumComment, value: -1 | 0 | 1) => {
    if (!user) { openSignIn(); throw new Error('auth_required') }
    if (!comment.live) return { score: comment.score + value, viewerVote: value }
    return forumApi<{ score: number; viewerVote: -1 | 0 | 1 }>(`/api/forum/comments/${encodeURIComponent(comment.id)}/vote`, {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify({ value }),
    })
  }

  const publishPost = async (draft: NewForumPost) => {
    try {
      const { post } = await forumApi<{ post: ForumPostResponse }>('/api/forum/posts', {
      method: 'POST',
      auth: 'required',
      body: JSON.stringify({ ...draft, location: 'all', media: draft.media || [] }),
      })
      const mapped = mapForumPost(post)
      setPosts((current) => [mapped, ...current.filter((item) => item.id !== mapped.id)])
      setVotes((current) => ({ ...current, [mapped.id]: post.viewerVote }))
      setCommunity(draft.community)
      setMode('all')
      setSort('latest')
      setQuery('')
      toast.success(tr('Your post is live.', 'Bài viết của bạn đã được đăng.'))
    } catch (error) {
      toast.error(tr('Your post could not be published.', 'Không thể đăng bài viết của bạn.'))
      throw error
    }
  }

  const loadMorePosts = async () => {
    const cursor = feedCursorRef.current
    if (loadingMore || !cursor) return
    setLoadingMore(true)
    try {
      const { posts: page, nextCursor } = await forumApi<{ posts: ForumPostResponse[]; nextCursor: string | null }>(
        `/api/forum/posts?limit=30&sort=best&cursor=${encodeURIComponent(cursor)}`,
      )
      // Dedupe before merging: deep-linked or freshly published posts may already
      // be in the feed — for those, keep the viewer's optimistic vote/saved state
      // (MERGE, never replace — same audit rule as the viewer refresh above).
      const known = new Set(posts.map((post) => post.id))
      const fresh = page.filter((post) => !known.has(post.id))
      const mapped = fresh.map(mapForumPost)
      setPosts((current) => {
        const seen = new Set(current.map((post) => post.id))
        return [...current, ...mapped.filter((post) => !seen.has(post.id))]
      })
      setVotes((current) => ({ ...current, ...Object.fromEntries(fresh.map((post) => [post.id, post.viewerVote])) }))
      setSaved((current) => {
        const next = new Set(current)
        for (const post of fresh) { if (post.saved) next.add(post.id) }
        return next
      })
      feedCursorRef.current = nextCursor
      setHasMorePosts(Boolean(nextCursor))
    } catch {
      toast.error(tr('More discussions could not be loaded.', 'Không thể tải thêm thảo luận.'))
    } finally {
      setLoadingMore(false)
    }
  }

  return {
    posts,
    votes,
    saved,
    threadComments,
    activePost,
    hasMorePosts,
    loadingMore,
    deleteTarget,
    setDeleteTarget,
    deletingPost,
    votePost,
    savePost,
    reportPost,
    blockPostAuthor,
    requestDeletePost,
    deletePost,
    addThreadReply,
    voteThreadComment,
    publishPost,
    loadMorePosts,
  }
}
