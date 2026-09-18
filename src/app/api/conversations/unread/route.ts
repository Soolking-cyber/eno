import { isCurrentUserAdminByClaims } from '@/lib/admin'
import { conversationUnread } from '@/lib/unread'
import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Total unread messages across the current user's conversations — drives the
// header/mobile-nav badge. Sums the denormalized per-side counters (no N+1).
//
// ⚠️ WS6 — NOT MIGRATED, AND IT MUST NOT BE. A GUEST GETS 200 {"unread":0}, not a 401.
// `curl` it with no cookie and that is what comes back; `auth: 'userId'` would answer
// `{"error":"auth_required"}` 401 instead. The wrapper has no "authenticate if possible" mode, so
// the two-line preamble stays hand-written here. (WS6 audit, 2026-08-06.)
//
// ⚠️ THE REASON IS THE BYTES, NOT A CLIENT. An earlier draft justified this with "the badge is
// polled from the header on every page, including logged-out ones" — and the review checked all
// three callers, none of which does that: `src/context/chat-context.tsx:76`,
// `apps/ios/…/InboxView.swift:201` and `apps/android/…/Auth.kt:34` each return early when signed
// out, so no guest request is ever made. The skip still stands, because a public endpoint's
// response is a contract whether or not today's clients exercise it. A wire fact outlives a client
// refactor; a client fact does not — which is why blockers here are written as wire facts.
export async function GET() {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ unread: 0 })

  /**
   * ⛔ THE SUM ITSELF LIVES IN `src/lib/unread.ts` NOW — it is not duplicated here, and the reason is
   * the bug this endpoint was hardened against on 2026-09-18. The edition scope and the
   * deleted-thread filter were added HERE and nowhere else, while `/api/notifications` kept its own
   * inline copy of the same aggregates — and that copy is the one that actually feeds the badge. The
   * endpoint that was fixed was not the endpoint that was broken. Three surfaces asking one question
   * must call one function; read that file before changing what "unread" means.
   *
   * ⛔ THE SAME ORACLE AS `/api/notifications`, AND THAT IS THE POINT. This route asked `getAdmin()`
   * (an auth-server round trip, revocation-aware) while the poll asked
   * `isCurrentUserAdminByClaims()` (the verified JWT) — so a just-promoted or just-demoted operator
   * got one badge counting desk threads and the other not, until the token rolled. A reviewer named
   * it as the exact disagreement this module exists to prevent, reintroduced one layer up: it is no
   * use sharing the QUERY if the two callers disagree about the question.
   * ⚠️ REVOCATION IS THE RIGHT WORRY IN THE WRONG PLACE. `getAdmin()` stays the gate everywhere
   * access is actually granted — reading a desk thread, answering it, the admin pages. This decides
   * whether a NUMBER includes some rows, and a stale-by-one-token-lifetime count opens no door.
   */
  const unread = await conversationUnread(meId, { includeSupportDesk: await isCurrentUserAdminByClaims() })
  return NextResponse.json({ unread })
}
