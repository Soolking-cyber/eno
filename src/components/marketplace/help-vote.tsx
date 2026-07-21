'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowBigUp } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// The Reddit-style upvote for Help Center answers and replies (owner: "people can
// upvote info they liked"). It posts to the SAME forum endpoints eno.forum uses —
// /api/forum/posts/[id]/vote and /api/forum/comments/[id]/vote — which is only
// possible because /help is same-origin with the API: isAllowedForumOrigin() accepts
// NEXT_PUBLIC_APP_URL (src/lib/forum/cors.ts:44-49) and getForumAuth() falls back to
// the eno.vn cookie session when there is no bearer (src/lib/forum/auth.ts:28). No
// SSO handoff, no CORS, no second vote system.
//
// Upvote-only by design. The API accepts -1, but a help answer is not a debate: a
// downvote on "how do I report a listing" tells a reader nothing and buries answers
// people need. Clicking an active upvote retracts it (value 0), which is the whole
// interaction.

type Props = {
  id: string
  kind: 'post' | 'comment'
  score: number
  viewerVote: number
  className?: string
  /** Compact = the inline pill used on list cards; full = the standalone control. */
  size?: 'sm' | 'md'
}

export function HelpVote({ id, kind, score, viewerVote, className, size = 'md' }: Props) {
  const { user, openSignIn } = useAuth()
  const { tr } = useLanguage()
  // Optimistic local state. The server returns the authoritative score, which we
  // adopt on success and roll back to on failure.
  const [state, setState] = useState({ score, voted: viewerVote > 0 })
  const [pending, setPending] = useState(false)

  // Adopt fresh SERVER values when they change. useState only reads its initializer
  // once, so without this a router.refresh() (posting a reply refreshes the thread)
  // re-renders the page with a new score while this button stays frozen on the value
  // it mounted with — someone else's votes never appear.
  //
  // Guarded two ways so it cannot fight the user: it ignores a render while a vote is
  // in flight, and it only reacts when the props THEMSELVES changed — otherwise it
  // would immediately overwrite our own optimistic update with the stale prop.
  const lastServer = useRef({ score, viewerVote })
  useEffect(() => {
    if (pending) return
    if (lastServer.current.score === score && lastServer.current.viewerVote === viewerVote) return
    lastServer.current = { score, viewerVote }
    setState({ score, voted: viewerVote > 0 })
  }, [score, viewerVote, pending])

  const submit = async () => {
    if (!user) {
      openSignIn()
      return
    }
    if (pending) return
    const next = state.voted ? 0 : 1
    const previous = state
    setState({ score: state.score + (next === 1 ? 1 : -1), voted: next === 1 })
    setPending(true)
    try {
      const response = await fetch(`/api/forum/${kind === 'post' ? 'posts' : 'comments'}/${encodeURIComponent(id)}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: next }),
      })
      if (!response.ok) throw new Error(String(response.status))
      const data = await response.json().catch(() => null)
      if (data && typeof data.score === 'number') {
        setState({ score: data.score, voted: (data.viewerVote ?? next) > 0 })
      }
    } catch {
      setState(previous)
      toast.error(tr('Could not save your vote. Try again.', 'Chưa lưu được bình chọn. Vui lòng thử lại.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      variant="bare"
      size="none"
      onClick={submit}
      // The `if (pending) return` guard inside submit() reads a value captured at render:
      // two fast clicks can both run before the state flush, firing two POSTs. Disabling
      // the element stops the second click at the DOM.
      disabled={pending}
      aria-pressed={state.voted}
      aria-label={tr('Helpful', 'Hữu ích')}
      className={cn(
        'press inline-flex shrink-0 items-center gap-1 rounded-full border border-border font-semibold transition-colors',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-sm',
        state.voted
          ? 'border-brand bg-accent text-accent-foreground'
          : 'bg-transparent text-body hover:bg-muted',
        className,
      )}
    >
      {/* Explicit size-* beats ui/button's icon rule, which is authored at
          `:where(&) svg` (specificity 0,0,1) precisely so the caller wins. */}
      <ArrowBigUp className={cn(size === 'sm' ? 'size-4' : 'size-5', state.voted && 'fill-current')} aria-hidden />
      <span className="tabular-nums">{state.score}</span>
    </Button>
  )
}
