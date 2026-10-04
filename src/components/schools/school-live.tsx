'use client'

import * as React from 'react'
import { useAuth } from '@/context/auth-context'

/**
 * The per-visitor layer over a CACHED, anonymous page: live eligible counts and the visitor's own votes,
 * fetched once from /api/schools/state (no-store). The server HTML carries counts that may be up to the
 * page's revalidate window old; this replaces them on hydration and after every vote.
 */
type Counts = Record<string, { up: number; down: number }>
type LiveState = {
  counts: Counts
  mine: Record<string, number>
  myReviews: Record<string, number>
  /** Live eligible helpful counts per review (the server's numbers, like school scores). */
  reviewCounts: Counts
  signedIn: boolean | null
  /** The visitor's own votes are KNOWN (every state chunk answered): votes act only from here. */
  ready: boolean
  /** The last state fetch failed in part or whole — a signed-in vote should ask for a reload. */
  failed: boolean
  /** Which account session this is; mutation callbacks pass the one they started in (`at`). */
  epoch: number
  setMine: (id: string, value: number, prev: number, at?: number) => void
  /** Record the visitor's own vote WITHOUT touching the public count (a retraction: the server decides). */
  setMineOnly: (id: string, value: number, at?: number) => void
  /** Undo the optimistic COUNT change of a vote that the server stored but does not count yet. */
  undoCount: (id: string, value: number, prev: number, at?: number) => void
  /** The visitor's own helpful vote, moving the live count optimistically (school votes' rule). */
  setMyReview: (id: string, value: number, prev: number, at?: number) => void
  setMyReviewOnly: (id: string, value: number, at?: number) => void
  undoReviewCount: (id: string, value: number, prev: number, at?: number) => void
  refresh: () => void
}

const Ctx = React.createContext<LiveState | null>(null)

export function SchoolLiveProvider({ schoolIds, reviewIds = [], initial, children }: {
  schoolIds: string[]
  reviewIds?: string[]
  initial: Counts
  children: React.ReactNode
}) {
  const [counts, setCounts] = React.useState<Counts>(initial)
  const [mine, setMineState] = React.useState<Record<string, number>>({})
  const [myReviews, setMyReviews] = React.useState<Record<string, number>>({})
  const [reviewCounts, setReviewCounts] = React.useState<Counts>({})
  const [signedIn, setSignedIn] = React.useState<boolean | null>(null)
  const [ready, setReady] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const ids = schoolIds.join(','), rids = reviewIds.join(',')
  const { user, loading } = useAuth()
  const userId = user?.id ?? null
  // ⚠️ REMOUNT ONLY ON A REAL ACCOUNT SWITCH (diff review): the session resolves a moment after load
  // (null → id) for every signed-in visitor, and remounting then would drop search focus and close dialogs.
  // `epoch` moves only when one RESOLVED account (or signed-out) becomes a different one.
  const [epoch, setEpoch] = React.useState(0)
  const epochRef = React.useRef(0)
  const lastUser = React.useRef<string | null | undefined>(undefined)
  React.useEffect(() => {
    if (loading) return
    if (lastUser.current === undefined) { lastUser.current = userId; return }
    if (lastUser.current !== userId) {
      lastUser.current = userId
      epochRef.current += 1
      setEpoch(epochRef.current)
    }
  }, [userId, loading])

  // ⚠️ CHUNKED: every school id in ONE query string outgrows proxy URL limits as the directory grows
  // (diff review). 100 ids ≈ 2.7 KB per request.
  // ⛔ ONLY THE NEWEST REQUEST MAY WRITE (diff review, both seats): a slower, older response — taken before
  // a later vote, or for the previous account — must never overwrite fresher state.
  const generation = React.useRef(0)
  const refresh = React.useCallback(() => {
    if (!ids && !rids) return
    const gen = ++generation.current
    const chunk = (xs: string[]) => Array.from({ length: Math.ceil(xs.length / 100) }, (_, i) => xs.slice(i * 100, i * 100 + 100))
    const schoolChunks = chunk(ids ? ids.split(',') : [])
    const reviewChunks = chunk(rids ? rids.split(',') : [])
    const n = Math.max(schoolChunks.length, reviewChunks.length, 1)
    Promise.all(Array.from({ length: n }, (_, i) => {
      const q = new URLSearchParams()
      if (schoolChunks[i]?.length) q.set('ids', schoolChunks[i].join(','))
      if (reviewChunks[i]?.length) q.set('reviews', reviewChunks[i].join(','))
      return fetch(`/api/schools/state?${q}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    })).then((parts) => {
      if (gen !== generation.current) return
      // MERGE per chunk that answered: an id a successful chunk asked about and did not return has NO vote
      // (0); a chunk that failed leaves its ids as they were instead of zeroing them (diff review).
      const asked = (list: string[][], i: number) => list[i] ?? []
      setCounts((c) => Object.assign({ ...c }, ...parts.map((d) => d?.counts ?? {})))
      setReviewCounts((c) => Object.assign({ ...c }, ...parts.map((d) => d?.reviewCounts ?? {})))
      setMineState((m) => {
        const next = { ...m }
        parts.forEach((d, i) => { if (d) for (const id of asked(schoolChunks, i)) next[id] = d.mine?.[id] ?? 0 })
        return next
      })
      setMyReviews((m) => {
        const next = { ...m }
        parts.forEach((d, i) => { if (d) for (const id of asked(reviewChunks, i)) next[id] = d.myReviews?.[id] ?? 0 })
        return next
      })
      if (parts.some(Boolean)) setSignedIn(parts.some((d) => d?.signedIn))
      // Ready only when EVERY chunk answered: a vote judged against an unknown starting point is a guess.
      setReady(parts.every(Boolean))
      setFailed(!parts.every(Boolean))
    })
  }, [ids, rids])

  // ⛔ A DIFFERENT ACCOUNT STARTS FROM NOTHING (diff review): signing out and in as someone else on the
  // same page must not inherit the previous account's votes (a ▲ press would send a retraction).
  React.useEffect(() => {
    setMineState({}); setMyReviews({}); setSignedIn(null); setReady(false); setFailed(false)
    refresh()
  }, [refresh, userId])

  /** A mutation continuation from a previous account's session (a late response) must not write here. */
  const stale = (at?: number) => at !== undefined && at !== epochRef.current

  const setMine = React.useCallback((id: string, value: number, prev: number, at?: number) => {
    if (stale(at)) return
    setMineState((m) => ({ ...m, [id]: value }))
    // Optimistic only for the visitor's own row; whether it COUNTS publicly is the server's call
    // (eligibility), so the next refresh settles the number.
    setCounts((c) => {
      const cur = c[id] ?? { up: 0, down: 0 }
      const up = cur.up - (prev === 1 ? 1 : 0) + (value === 1 ? 1 : 0)
      const down = cur.down - (prev === -1 ? 1 : 0) + (value === -1 ? 1 : 0)
      return { ...c, [id]: { up: Math.max(0, up), down: Math.max(0, down) } }
    })
  }, [])
  const undoCount = React.useCallback((id: string, value: number, prev: number, at?: number) => {
    if (stale(at)) return
    setCounts((c) => {
      const cur = c[id] ?? { up: 0, down: 0 }
      const up = cur.up - (value === 1 ? 1 : 0) + (prev === 1 ? 1 : 0)
      const down = cur.down - (value === -1 ? 1 : 0) + (prev === -1 ? 1 : 0)
      return { ...c, [id]: { up: Math.max(0, up), down: Math.max(0, down) } }
    })
  }, [])
  const setMineOnly = React.useCallback((id: string, value: number, at?: number) => { if (!stale(at)) setMineState((m) => ({ ...m, [id]: value })) }, [])
  // The same arithmetic as school votes, on the review's live count.
  const shift = (cur: { up: number; down: number } | undefined, from: number, to: number) => {
    const c = cur ?? { up: 0, down: 0 }
    return { up: Math.max(0, c.up - (from === 1 ? 1 : 0) + (to === 1 ? 1 : 0)), down: Math.max(0, c.down - (from === -1 ? 1 : 0) + (to === -1 ? 1 : 0)) }
  }
  const setMyReview = React.useCallback((id: string, value: number, prev: number, at?: number) => {
    if (stale(at)) return
    setMyReviews((m) => ({ ...m, [id]: value }))
    setReviewCounts((c) => (c[id] ? { ...c, [id]: shift(c[id], prev, value) } : c))
  }, [])
  const setMyReviewOnly = React.useCallback((id: string, value: number, at?: number) => { if (!stale(at)) setMyReviews((m) => ({ ...m, [id]: value })) }, [])
  const undoReviewCount = React.useCallback((id: string, value: number, prev: number, at?: number) => {
    if (stale(at)) return
    setReviewCounts((c) => (c[id] ? { ...c, [id]: shift(c[id], value, prev) } : c))
  }, [])

  const value = React.useMemo(
    () => ({ counts, mine, myReviews, reviewCounts, signedIn, ready, failed, epoch, setMine, setMineOnly, undoCount, setMyReview, setMyReviewOnly, undoReviewCount, refresh }),
    [counts, mine, myReviews, reviewCounts, signedIn, ready, failed, epoch, setMine, setMineOnly, undoCount, setMyReview, setMyReviewOnly, undoReviewCount, refresh],
  )
  // ⛔ THE WHOLE SUBTREE REMOUNTS ON AN ACCOUNT CHANGE (diff review): every vote control, report draft,
  // acknowledgement dialog and local count delta belongs to one account, and a late response from the
  // previous one lands on an unmounted component instead of the new account's screen.
  return <Ctx.Provider value={value}><React.Fragment key={epoch}>{children}</React.Fragment></Ctx.Provider>
}

export function useSchoolLive(): LiveState {
  const v = React.useContext(Ctx)
  if (!v) throw new Error('useSchoolLive must be used inside SchoolLiveProvider')
  return v
}

/**
 * The "I've worked or interviewed here" acknowledgement, once PER ACCOUNT (diff review: per browser let a
 * second account on the same device skip it). A reminder of the rule, not proof — the rule's teeth are
 * the read-time eligibility and moderation.
 */
const ackKey = (userId: string) => `eno:schools:vote-ack:v2:${userId}`
export function readVoteAck(userId: string): boolean {
  try { return localStorage.getItem(ackKey(userId)) === '1' } catch { return false }
}
export function writeVoteAck(userId: string) {
  try { localStorage.setItem(ackKey(userId), '1') } catch { /* private mode: they will be asked again */ }
}
