import { editionSellerScope } from '@/lib/edition-scope'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
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

  // ⚠️ BOTH aggregates, or the badge counts threads the inbox refuses to show — a permanent phantom
  // that somebody eventually "fixes" by un-hiding the thread.
  // Per-edition now — see the note in src/lib/edition-scope.ts on editionHiddenSellerIds.
  // One rule for both the hide-list and the allow-list — see editionSellerScope.
  const notDesk = await editionSellerScope()
  const [asBuyer, asSeller] = await Promise.all([
    db.conversation.aggregate({ where: { buyerProfileId: meId, ...notDesk }, _sum: { buyerUnread: true } }),
    db.conversation.aggregate({ where: { sellerProfileId: meId, ...notDesk }, _sum: { sellerUnread: true } }),
  ])
  const unread = (asBuyer._sum.buyerUnread ?? 0) + (asSeller._sum.sellerUnread ?? 0)
  return NextResponse.json({ unread })
}
