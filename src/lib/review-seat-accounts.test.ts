import { describe, expect, it } from 'vitest'
import { REVIEW_SEATS } from '../../scripts/review-seats.mjs'
import { NOT_A_REVIEW_SEATS_LISTING, STORE_REVIEW_SEAT_EMAILS, REVIEW_SEAT_HELD_NOTE, isReviewSeatEmail, notAReviewSeatsListingSql } from './review-seat-accounts'

/**
 * The app's copy of the STORE-review seats' addresses (review-seat-accounts.ts) held to the table the account scripts read
 * (scripts/review-seats.mjs, imported as it stands — no database, no env).
 *
 * ⚠️ ONE ADDRESS IS ON ITS WAY: the AI seat (`ai-review@eno.vn`) is guarded before its row lands in the table, so on main
 * the table's store seats are two and the copy three. Once the row lands this list is redundant (delete it then); the
 * rules below hold either way.
 */
const ON_ITS_WAY = ['ai-review@eno.vn']
/**
 * ⛔ THE SEATS LEFT OUT ON PURPOSE, each with its reason (round 4, 2026-11-14). A new key here is a decision, not a fix.
 */
const OUT_ON_PURPOSE: Record<string, string> = {
  lawyer: 'one trusted person, not a store\'s review team, who OWNS A REAL STOREFRONT — Luật Hoàng Phi (scripts/seed-hoangphi.ts) — and answers its buyer chats: a teacher asking that firm about a work permit must be answered, and its listings publish normally',
}
const seats = Object.entries(REVIEW_SEATS as Record<string, { email: string }>)
const storeSeats = seats.filter(([key]) => !(key in OUT_ON_PURPOSE)).map(([, s]) => s.email.toLowerCase())

describe('the copy and the table (scripts/review-seats.mjs)', () => {
  it('guards every seat the table defines except the ones out on purpose', () => {
    expect(storeSeats.length).toBeGreaterThanOrEqual(2)
    for (const email of storeSeats) expect(STORE_REVIEW_SEAT_EMAILS, email).toContain(email)
  })

  it('⛔ leaves the lawyer seat OUT, on purpose and with the reason — no guard catches it', () => {
    expect(Object.keys(OUT_ON_PURPOSE)).toEqual(['lawyer'])
    expect(OUT_ON_PURPOSE.lawyer).toMatch(/Luật Hoàng Phi/)
    for (const key of Object.keys(OUT_ON_PURPOSE)) expect(REVIEW_SEATS, key).toHaveProperty(key) // a reason for a seat that still exists
    const lawyer = (REVIEW_SEATS as Record<string, { email: string }>).lawyer.email
    expect(lawyer).toBe('lawyer-review@eno.vn')
    expect(STORE_REVIEW_SEAT_EMAILS).not.toContain(lawyer)
    for (const form of [lawyer, ` ${lawyer.toUpperCase()}\n`]) expect(isReviewSeatEmail(form), form).toBe(false)
    expect(JSON.stringify(NOT_A_REVIEW_SEATS_LISTING)).not.toContain('lawyer')
    expect(notAReviewSeatsListingSql('l.')).not.toContain('lawyer')
    expect(notAReviewSeatsListingSql()).not.toContain('lawyer')
  })

  it('holds nothing but store-review addresses: the table\'s, or the AI seat still on its way', () => {
    for (const email of STORE_REVIEW_SEAT_EMAILS) expect([...storeSeats, ...ON_ITS_WAY], email).toContain(email)
    expect(STORE_REVIEW_SEAT_EMAILS).toContain('ai-review@eno.vn')
    expect([...STORE_REVIEW_SEAT_EMAILS].sort()).toEqual(['ai-review@eno.vn', 'app-review@eno.vn', 'play-review@eno.forum'])
    expect(new Set(STORE_REVIEW_SEAT_EMAILS).size).toBe(STORE_REVIEW_SEAT_EMAILS.length)
  })

  it('is frozen, lowercase and trimmed — what the compare below assumes', () => {
    expect(Object.isFrozen(STORE_REVIEW_SEAT_EMAILS)).toBe(true)
    for (const email of STORE_REVIEW_SEAT_EMAILS) expect(email).toBe(email.trim().toLowerCase())
  })
})

describe('isReviewSeatEmail — exact, case-insensitive after trim, never a domain match', () => {
  it('knows every seat, in any case and with stray whitespace', () => {
    for (const email of STORE_REVIEW_SEAT_EMAILS) {
      expect(isReviewSeatEmail(email), email).toBe(true)
      expect(isReviewSeatEmail(` ${email.toUpperCase()}\n`), email).toBe(true)
    }
    expect(isReviewSeatEmail('AI-Review@Eno.VN')).toBe(true)
  })

  it('refuses everything else: the same domain, a near miss, a tag, a longer host, nothing', () => {
    for (const other of [
      'support@eno.vn', 'review@eno.vn', 'ai@eno.vn', 'x.app-review@eno.vn', 'app-review+1@eno.vn', 'app-review@eno.vn.example.com',
      'app-review@eno.forum', 'play-review@eno.vn', 'app review@eno.vn', 'eno.vn', '@eno.vn', '',
    ]) expect(isReviewSeatEmail(other), other).toBe(false)
    expect(isReviewSeatEmail(null)).toBe(false)
    expect(isReviewSeatEmail(undefined)).toBe(false)
    expect(isReviewSeatEmail(42 as unknown as string)).toBe(false)
  })
})

describe('NOT_A_REVIEW_SEATS_LISTING — the job set eno offers teachers, and every publish, leave out a seat\'s rows', () => {
  it('is every seat\'s address under NOT, NULL-SAFE and CASE-INSENSITIVE — so an ownerless or no-email owner is kept', () => {
    // ⛔ `not: null` (opus, round 2): without it the NOT over a NULL Profile.email is NULL and the row is DROPPED — a real
    // school on a phone-only, Facebook-no-email or WhatsApp-bridge account vanished from the job DMs and match emails
    // (src/lib/site-stats.ts:158-164 measured the same trap). With it Prisma compiles `NOT (email IN (…) AND email IS NOT
    // NULL AND …)`: FALSE, never NULL, for such an owner.
    // ⛔ `mode: 'insensitive'` (opus, round 3): the create hold (isReviewSeatEmail) ignores case, so this must too — compiled
    // offline against this repo's Prisma 7 client: `LOWER("j1"."email") IN (LOWER($n), …) AND "j1"."email" IS NOT NULL`.
    expect(NOT_A_REVIEW_SEATS_LISTING).toEqual({ NOT: { seller: { owner: { email: { in: [...STORE_REVIEW_SEAT_EMAILS], mode: 'insensitive', not: null } } } } })
  })
  it('the held mark is its own — never the licence check\'s, which licence-approve publishes by', () => {
    expect(REVIEW_SEAT_HELD_NOTE).toBe('review-seat:held')
    expect(REVIEW_SEAT_HELD_NOTE).not.toBe('licence:held')
  })
})

describe('notAReviewSeatsListingSql — the same owner test for a raw-SQL client', () => {
  it('NOT EXISTS over the seller\'s owner, every seat\'s address inlined as a plain literal', () => {
    const sql = notAReviewSeatsListingSql('l.')
    expect(sql).toBe(`NOT EXISTS (SELECT 1 FROM "Seller" rs JOIN "Profile" rp ON rp.id = rs."ownerId" WHERE rs.id = l."sellerId" AND lower(btrim(rp.email)) IN (${STORE_REVIEW_SEAT_EMAILS.map((e) => `'${e}'`).join(', ')}))`)
    for (const e of STORE_REVIEW_SEAT_EMAILS) expect(sql).toContain(`'${e}'`)
  })
  it('with no alias it names the table itself — never a bare "sellerId" a subquery table could capture', () => {
    expect(notAReviewSeatsListingSql()).toContain('WHERE rs.id = "Listing"."sellerId" AND')
  })
  it('refuses an alias that is not a plain identifier with its dot', () => {
    for (const bad of ['l', 'l."x".', "l'.", 'l; DROP', '1.']) expect(() => notAReviewSeatsListingSql(bad), bad).toThrow()
  })
})
