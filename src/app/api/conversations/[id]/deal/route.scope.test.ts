import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ THE DESK AND EDITION EXCLUSIONS, PINNED IN SOURCE (the concierge.test.ts pattern). A value test can only prove a
 * check that exists; a check someone deletes is caught by nothing else. eno's own desks (the rental / jobs / support
 * desks by seller, the visa / trip desk by storefront AND by listing — one storefront sells both) and the edition boundary
 * must stay in every path that can open or show a service deal.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
const route = read('src/app/api/conversations/[id]/deal/route.ts')
const server = read('src/lib/service-deal-server.ts')
const rules = read('src/lib/service-deal.ts')
const threadGet = read('src/app/api/conversations/[id]/route.ts')

describe('the deal route carries every exclusion', () => {
  it('the edition boundary: a seller hidden here is a 404', () => {
    expect(route).toMatch(/if \(await isSellerHiddenHere\(convo\.seller\.id\)\) throw new ApiError\('not_found', 404\)/)
  })

  it('scope = serviceDealInScope over the thread kind and the desk check by seller AND listing', () => {
    expect(route).toMatch(/await threadKind\(\{ listingId: convo\.listing\.id \}\)/)
    expect(route).toMatch(/await isEnoDeskThread\(convo\.seller\.id, convo\.listing\?\.id \?\? null\)/)
    expect(route).toMatch(/serviceDealInScope\(\{[\s\S]*?threadKind: kindOfThread,[\s\S]*?enoDesk,[\s\S]*?\}\)/)
    expect(route).toMatch(/if \(!kind \|\| !convo\.listing\) refuse\('not_reviewable'\)/)
  })

  it('the seller is BOTH the thread\'s seller profile and the storefront\'s owner', () => {
    expect(route).toMatch(/if \(!convo\.sellerProfileId \|\| me\.id !== convo\.sellerProfileId \|\| me\.id !== convo\.seller\.ownerId\) throw new ApiError\('forbidden', 403\)/)
  })
})

describe('the desk check itself', () => {
  it('the listing-less team desks by seller id', () => {
    expect(server).toMatch(/new Set<string>\(\[\.\.\.RENTAL_DESK_SELLER_IDS, JOBS_DESK_SELLER_ID, SUPPORT_SELLER_ID\]\)/)
  })

  it('the visa / trip desk by storefront AND by listing (visa catalogue, trip anchor) — and it fails CLOSED', () => {
    expect(server).toMatch(/desks\.includes\(sellerId\) \|\| trip === listingId \|\| visa\.some\(\(l\) => l\.id === listingId\)/)
    expect(server).toMatch(/catch \(e\) \{[\s\S]*?return true\s*\}/)
  })

  it('the pure scope rule: an ordinary listing thread only, never a desk, never taken down', () => {
    expect(rules).toMatch(/if \(!s\.listing \|\| s\.threadKind !== 'listing' \|\| s\.enoDesk\) return null/)
    expect(rules).toMatch(/if \(s\.listing\.complianceStatus === 'taken_down'\) return null/)
  })

  it('the thread GET asks the same rule, never on a desk thread or the support operator\'s side', () => {
    expect(threadGet).toMatch(/const dealThread = \(iAmBuyer \|\| iAmSeller\) && !isDeskThread && kind === 'listing' && !!convo\.listing\n/)
    expect(threadGet).toMatch(/const dealKindHere = dealThread\s*\?\s*serviceDealInScope\(/)
    expect(threadGet).toMatch(/threadKind: kind,/)
    // ⛔ THE ROW DECIDES on the buyer side, but only on such a thread — the row is never read on a desk / support thread.
    expect(threadGet).toMatch(/if \(iAmBuyer && !iAmSeller && dealThread && convo\.listing && \(dealKindHere \|\| !hasReviewed\)\) \{/)
    // The seller's control follows the stored deal (2026-11-11): the row is read on every ordinary listing thread.
    expect(threadGet).toMatch(/\} else if \(iAmSeller && dealThread\) \{/)
  })
})

describe('the review round of 2026-11-11 (codex + opus): pinned in the source', () => {
  const retarget = read('src/app/api/conversations/route.ts')
  const page = read('src/app/[lang]/messages/[id]/page.tsx')
  const reviewPost = read('src/app/api/sellers/[id]/reviews/route.ts')
  it('a retarget moves the thread under its row lock and re-checks the deal there; the confirm takes the same lock', () => {
    expect(retarget).toMatch(/SELECT 1 FROM "Conversation" WHERE "id" = \$\{candidate\.id\} FOR UPDATE/)
    // Inside the transaction the table's presence is asked first (a caught error would still abort a Postgres transaction).
    expect(retarget).toContain('if (await threadHoldsDealTx(tx, candidate.id)) return false')
    expect(server).toContain("SELECT to_regclass('public.\"DealConfirmation\"') IS NOT NULL AS present")
    expect(retarget).toContain('await threadHoldsDeal(candidate.id).catch(() => true)')
    expect(route).toMatch(/SELECT "listingId" FROM "Conversation" WHERE "id" = \$\{id\} FOR UPDATE/)
    expect(route).toContain("throw new ApiError('listing_changed', 409)")
  })
  it('every window is judged on the database clock at the write (dbNow), the review lock too', () => {
    expect(route.match(/await dbNow\(tx\)/g)?.length).toBe(3)
    expect(reviewPost).toContain('await lockDealRow(tx, conversationId)\n        const txNow = await dbNow(tx)')
    // The row's lock before the clock, and the clock is clock_timestamp() (now() is the transaction's start, before any wait).
    expect(route.match(/await lockDealRow\(tx, id\)\n\s*const t = await dbNow\(tx\)/g)?.length).toBe(2)
    expect(server).toContain('SELECT clock_timestamp() AS now')
    // The decline asserts the 30-day window too, on the same clock.
    expect(route).toContain('confirmedAt: { not: null, lte: undoCutoff(t), gte: new Date(t.getTime() - SERVICE_DEAL.REVIEW_WINDOW_DAYS * DAY_MS) }')
    expect(reviewPost).toContain('lte: undoCutoff(txNow)')
  })
  it('a licence hold reads like a takedown on the row path, and the scope excludes unpublished / held listings', () => {
    expect(server).toContain("const closed = (l: { verified?: boolean | null; verificationNotes?: string | null }) => l.verified === false || l.verificationNotes === LICENCE_HELD_NOTE")
    expect(rules).toContain("if (s.listing.verified === false || s.listing.verificationNotes === 'licence:held') return null")
    expect(reviewPost).toContain('verificationNotes: true')
  })
  it('the "did you…?" question only when the SERVICE path opens the card (an accepted offer or a sale wins)', () => {
    expect(page).toContain("dealKind={serviceReview && !(thread?.mayReviewSale === true || (hasAcceptedOffer && thread?.mayReviewOffer === true)) ? (thread.dealKind ?? 'service') : null}")
    // …and the card is keyed by that question, so it remounts when an offer starts to qualify under an open question.
    expect(page).toContain("key={serviceReview && !(thread?.mayReviewSale === true || (hasAcceptedOffer && thread?.mayReviewOffer === true)) ? `deal:${thread.dealKind ?? ''}` : 'deal:none'}")
  })
})

