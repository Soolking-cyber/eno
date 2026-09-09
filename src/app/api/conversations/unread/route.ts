import { getAdmin } from '@/lib/admin'
import { SUPPORT_SELLER_ID } from '@/lib/support-thread'
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
  const [asBuyer, asSeller, asSupport] = await Promise.all([
    db.conversation.aggregate({ where: { buyerProfileId: meId, ...notDesk }, _sum: { buyerUnread: true } }),
    db.conversation.aggregate({ where: { sellerProfileId: meId, ...notDesk }, _sum: { sellerUnread: true } }),
    /**
     * ⛔ THE THIRD AGGREGATE MIRRORS THE THIRD `OR` IN THE LIST. The comment above says it exactly:
     * both aggregates, or the badge counts threads the inbox refuses to show. The inverse is just
     * as bad and is what shipped — the inbox now shows support threads while the badge ignored
     * them, so a customer's message sat unread with nothing anywhere saying so.
     */
    (async () => (await getAdmin())
      /**
       * ⛔ NO EDITION SCOPE ON THIS ONE, AND IT MUST MATCH THE LIST EXACTLY. Two drafts got this
       * wrong in opposite directions and two reviewers caught the pair disagreeing:
       *   · `{ sellerId: SUPPORT_SELLER_ID, ...notDesk }` — a SPREAD, and edition-scope.ts already
       *     documents that trap in as many words ("Object spread overwrites on key collision, so
       *     the obvious usage silently loses"). `notDesk` IS `{ sellerId: … }` whenever an edition
       *     hides anyone, which eno.forum does, so the support filter was discarded outright and
       *     the badge summed sellerUnread across EVERY seller.
       *   · `AND: [{ sellerId }, notDesk]` — no longer wrong, but no longer the same question the
       *     LIST asks: that exempts the desk from the scope entirely. A badge that counts a
       *     different set from the inbox is the phantom this file's own header warns about.
       * `SUPPORT_SELLER_ID` is build-scoped, so naming it IS the edition scope; nothing further to
       * intersect with, and the list branch says exactly this.
       */
      ? db.conversation.aggregate({ where: { sellerId: SUPPORT_SELLER_ID }, _sum: { sellerUnread: true } })
      : { _sum: { sellerUnread: 0 } })(),
  ])
  const unread = (asBuyer._sum.buyerUnread ?? 0) + (asSeller._sum.sellerUnread ?? 0) + (asSupport._sum.sellerUnread ?? 0)
  return NextResponse.json({ unread })
}
