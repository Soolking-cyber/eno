'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { handleExternalClick } from '@/lib/native-browser'
import { cn } from '@/lib/utils'

/** The only address it will show: the one goplusRoomPageUrl builds (goplus-listing.ts — server-only, so the shape is
 *  restated here, and api/listings/[id]/goplus-link/route.test.ts holds the two together), whatever the answer says. */
export const GOPLUS_ROOM_PAGE = /^https:\/\/goplus\.com\.vn\/phong\/[a-f0-9]{24}$/

/**
 * A GoPlus room's own page on goplus.com.vn — for the GoPlus account and eno's admins ONLY (owner, 2026-10-30: "available
 * only for admins goplus email and suport email product page … and in chat … but user shouldnt see the links").
 *
 * It holds no URL of its own. Signed in, it asks GET /api/listings/[id]/goplus-link, which answers the URL to those
 * accounts and `null` to everyone else, so neither the cached listing page nor the chat payload ever carries it. It renders
 * NOTHING until that answer says so: for a guest, a renter, or while it asks. An answer belongs to the viewer and the room
 * it was asked for: switch account, or room, and nothing of it shows; a late answer for the one before is dropped. Every
 * ask starts from nothing, so an answer from an earlier visit never shows while this one is out, or after it fails, and a
 * "no" takes back a link shown before (access revoked, then back on the room: commit review, codex).
 * In the app the link opens the in-app browser over eno (native-browser.ts); on the web, a new tab.
 */
export function GoplusRoomLink({ listingId, className }: { listingId: string; className?: string }) {
  const { tr } = useLanguage()
  const { user, loading } = useAuth()
  const viewer = loading ? null : (user?.id ?? null)
  const key = `${viewer}:${listingId}`
  const [answer, setAnswer] = useState<{ key: string; url: string | null } | null>(null)
  useEffect(() => {
    setAnswer(null)
    if (!viewer) return
    let live = true
    fetch(`/api/listings/${encodeURIComponent(listingId)}/goplus-link`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { url?: unknown } | null) => {
        if (live) setAnswer({ key, url: typeof d?.url === 'string' && GOPLUS_ROOM_PAGE.test(d.url) ? d.url : null })
      })
      .catch(() => {})
    return () => { live = false }
  }, [viewer, listingId, key])
  const href = answer?.key === key ? answer.url : null
  if (!href) return null
  return (
    <p className={cn('text-sm text-body', className)}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleExternalClick}
        className="font-semibold text-accent-foreground underline-offset-2 hover:underline"
      >
        {/* "on GoPlus", not "this room": the same link sits on a GoPlus shopfront (commercial space) too. */}
        {tr('View on GoPlus', 'Xem trên GoPlus')}
        <span className="sr-only"> {tr('(opens in a new tab)', '(mở trong tab mới)')}</span>
      </a>
    </p>
  )
}
