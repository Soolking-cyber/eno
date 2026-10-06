import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import vnUnits from '@/data/vn-units.json'
import { REVIEW_SEATS, SEAT_FLAGS, findAuthUser, seatFromArgv } from '../../scripts/review-seats.mjs'
import {
  LISTING, MESSAGES, REVIEWER_EMAIL, SEED_TAG, SELLER, TRUST_BASE, TRUST_TIER, listedIn, parseArgs, threadCounters,
} from '../../scripts/seed-app-review-thread.mjs'
import { assertCleanContactName, assertCleanTexts, assertPublishable, minPhotosFor } from './publish-guard'
import { findSevereAbuse } from './severe-abuse-words'
import { CATEGORY_BY_SLUG, isPostableCategory, isPostableSubcategory, listingMoneyFor, resolveListingType, suggestSubcategory } from './taxonomy'
import { GUEST_SELLER_TRUST, TRUST } from './trust-math'
import { isListingImageUrl } from './listing-image'
import { VN_PROVINCES } from './vn-areas'

/**
 * The App Store review seat (docs/ios-appstore-release.md P11): the seat table both scripts read
 * (scripts/review-seats.mjs) and the pure half of the demo-thread seed (scripts/seed-app-review-thread.mjs).
 * Nothing here touches a database — both files import with no env and no client.
 *
 * The seed writes one PUBLIC listing straight into production, past every screen the app runs on a
 * publish. So its content is held here to the app's own rules — the publish gate, the taxonomy, the area
 * table, the chat filter — and a copy edit the app would refuse fails this suite instead of shipping.
 */

const seats = Object.entries(REVIEW_SEATS) as [string, (typeof REVIEW_SEATS)[keyof typeof REVIEW_SEATS]][]

describe('review seats — one table for both scripts', () => {
  it('keeps the Play and lawyer seats exactly as register-play-reviewer.mjs always wrote them', () => {
    // The credential file is built from these lines, so a drift here changes what an operator pastes.
    expect(REVIEW_SEATS.play).toEqual({
      email: 'play-review@eno.forum',
      sellerName: 'eno Play review (internal)',
      displayName: 'Play review',
      credFile: '.env.play-reviewer.local',
      envPrefix: 'PLAY',
      credHeader: '# Google Play Console → App content → Sign in details',
      credNote: '# Paste these into the Play form. Treat as a live credential; rotate if it leaks.',
      handOff: 'paste the password into Play Console',
    })
    expect(REVIEW_SEATS.lawyer).toMatchObject({
      email: 'lawyer-review@eno.vn',
      sellerName: 'eno legal review (internal)',
      displayName: 'Legal review',
      credFile: '.env.lawyer-review.local',
      envPrefix: 'LAWYER',
      credHeader: '# Legal review sign-in for eno.vn (email + password, eno.vn/signin)',
      credNote: '# Hand to the lawyer only, over a private channel. Treat as a live credential; rotate if it leaks.',
    })
  })

  it('gives App Store review its own @eno.vn seat — not the Play seat', () => {
    expect(REVIEW_SEATS.apple.email).toBe('app-review@eno.vn')
    expect(REVIEW_SEATS.apple.email).not.toBe(REVIEW_SEATS.play.email)
    expect(REVIEW_SEATS.apple.credFile).toBe('.env.app-review.local')
    expect(REVIEW_SEATS.apple.envPrefix).toBe('APPLE')
  })

  it('never lets two seats share an address, a public name, a credential file or an env prefix', () => {
    for (const field of ['email', 'sellerName', 'displayName', 'credFile', 'envPrefix'] as const) {
      const values = seats.map(([, s]) => s[field])
      expect(new Set(values).size, field).toBe(values.length)
    }
    // Lowercase, because the password route's partner lookup is an EXACT match on the stored email.
    for (const [key, s] of seats) expect(s.email, key).toBe(s.email.toLowerCase())
  })

  it('writes every credential to a repo-root file the gitignore covers', () => {
    const ignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8').split('\n').map((l) => l.trim())
    expect(ignore).toContain('.env*.local')
    for (const [key, s] of seats) expect(s.credFile, key).toMatch(/^\.env\.[a-z-]+\.local$/)
  })

  it('names a seat only with an exact --for=<seat>; no flag is the Play seat', () => {
    expect(seatFromArgv([])).toEqual({ key: 'play', seat: REVIEW_SEATS.play })
    expect(seatFromArgv(['--apply'])).toEqual({ key: 'play', seat: REVIEW_SEATS.play })
    expect(seatFromArgv(['--for=lawyer'])).toEqual({ key: 'lawyer', seat: REVIEW_SEATS.lawyer })
    expect(seatFromArgv(['--for=apple', '--apply'])).toEqual({ key: 'apple', seat: REVIEW_SEATS.apple })
    expect([...SEAT_FLAGS].sort()).toEqual(['apple', 'lawyer'])
  })

  it('⛔ fails closed on a mistyped or repeated --for instead of falling through to the Play seat', () => {
    for (const argv of [
      ['--for', 'apple'], // a space, not "="
      ['--for=Apple'],
      ['--for='],
      ['--for=play'], // no flag IS the Play seat; the flag was never a way to name it
      ['--for=ios'],
      ['--for=apple', '--for=lawyer'],
      ['--for=apple', '--for=apple'],
    ]) {
      const r = seatFromArgv(argv)
      expect(r.seat, argv.join(' ')).toBeUndefined()
      expect(r.error, argv.join(' ')).toMatch(/--for=lawyer and --for=apple/)
    }
  })
})

describe('findAuthUser — pages until found, and never reads "ran out" as "free"', () => {
  const user = (i: number, email = `u${i}@example.com`) => ({ id: `id-${i}`, email })
  const fake = (pages: Array<Array<{ id: string; email: string }>> | 'error') => {
    const seen: number[] = []
    const admin = {
      auth: {
        admin: {
          listUsers: async ({ page }: { page: number; perPage: number }) => {
            seen.push(page)
            if (pages === 'error') return { data: null, error: { message: 'boom' } }
            return { data: { users: pages[page - 1] ?? [] }, error: null }
          },
        },
      },
    }
    return { admin, seen }
  }

  it('finds an address on a later page, case-insensitively', async () => {
    const { admin, seen } = fake([[user(1), user(2)], [user(3, 'App-Review-Seller@eno.vn')]])
    expect(await findAuthUser(admin, 'app-review-seller@eno.vn')).toEqual(user(3, 'App-Review-Seller@eno.vn'))
    expect(seen).toEqual([1, 2])
  })

  it('answers null only when a page comes back empty', async () => {
    const { admin } = fake([[user(1)]])
    expect(await findAuthUser(admin, 'nobody@eno.vn')).toBeNull()
  })

  it('throws on a listUsers error and after 50 full pages without a hit', async () => {
    await expect(findAuthUser(fake('error').admin, 'x@eno.vn')).rejects.toThrow(/listUsers failed: boom/)
    const full = Array.from({ length: 50 }, (_, p) => [user(p)])
    await expect(findAuthUser(fake(full).admin, 'x@eno.vn')).rejects.toThrow(/exhausted 50 pages/)
  })
})

describe('the App Review demo thread — who', () => {
  it('makes the Apple seat the buyer and an ordinary, separate address the seller', () => {
    expect(REVIEWER_EMAIL).toBe(REVIEW_SEATS.apple.email)
    expect(SELLER.email).toBe(SELLER.email.toLowerCase())
    // A seat is a partner-flagged password account; the counterpart must be an ordinary person.
    for (const [key, s] of seats) {
      expect(SELLER.email, key).not.toBe(s.email)
      expect(SELLER.storefrontName, key).not.toBe(s.sellerName)
    }
    expect(SEED_TAG).toMatch(/\S/)
  })

  it('uses names the publish gate accepts as a contact name (they are public)', () => {
    expect(() => assertCleanContactName(SELLER.storefrontName)).not.toThrow()
    expect(() => assertCleanContactName(SELLER.displayName)).not.toThrow()
  })

  it('reads ADMIN_EMAILS the way src/lib/admin.ts does — exact, trimmed, case-insensitive, no domain match', () => {
    expect(listedIn(' Support@eno.forum , app-review@eno.vn ', [REVIEWER_EMAIL, SELLER.email])).toEqual([REVIEWER_EMAIL])
    expect(listedIn('eno.vn,@eno.vn', [REVIEWER_EMAIL, SELLER.email])).toEqual([])
    expect(listedIn(undefined, [SELLER.email])).toEqual([])
  })

  it('starts the demo seller at the v2 base trust, as a fresh storefront — not the column default 100', () => {
    expect(TRUST_BASE).toBe(TRUST.BASE)
    expect({ trustScore: TRUST_BASE, trustTier: TRUST_TIER }).toEqual(GUEST_SELLER_TRUST)
  })
})

describe('the App Review demo thread — the listing passes the app\'s own publish screens', () => {
  it('clears the publish gate: photos, banned words, contact details, location', () => {
    expect(() => assertPublishable({
      trustTier: TRUST_TIER,
      images: [...LISTING.images],
      texts: [LISTING.title, LISTING.description, LISTING.titleVi, LISTING.descriptionVi],
      categorySlug: LISTING.categorySlug,
      district: LISTING.district,
    })).not.toThrow()
    // The secondary fields createListingCore screens as well (location, condition, city).
    expect(() => assertCleanTexts([LISTING.location, LISTING.condition, LISTING.city])).not.toThrow()
  })

  it('carries the goods photo minimum in DISTINCT, same-origin seed photos that exist', () => {
    expect(LISTING.images.length).toBeGreaterThanOrEqual(minPhotosFor(LISTING.categorySlug))
    expect(minPhotosFor(LISTING.categorySlug)).toBe(3)
    expect(new Set(LISTING.images).size).toBe(LISTING.images.length)
    for (const p of LISTING.images) {
      expect(existsSync(join(process.cwd(), 'public', p)), p).toBe(true)
      // Not a storage object: erasure and the storage sweeps resolve keys with listingObjectKey, which
      // answers null for anything isListingImageUrl rejects — so nothing can ever delete these files.
      expect(isListingImageUrl(p), p).toBe(false)
    }
  })

  it('files it where the post wizard would, in an aisle eno.vn lets an ordinary seller post to', () => {
    const cat = CATEGORY_BY_SLUG[LISTING.categorySlug]
    expect(cat).toBeDefined()
    expect(isPostableCategory(LISTING.categorySlug)).toBe(true)
    expect(cat.subcategories.map((s) => s.slug)).toContain(LISTING.subcategorySlug)
    expect(isPostableSubcategory(LISTING.categorySlug, LISTING.subcategorySlug, true, { officialPartner: false })).toBe(true)
    expect(resolveListingType(LISTING.categorySlug, LISTING.listingType)).toBe(LISTING.listingType)
    // The app's own keyword classifier puts the title in the same aisle.
    expect(suggestSubcategory(LISTING.categorySlug, LISTING.title)).toBe(LISTING.subcategorySlug)
    expect(LISTING.condition).toBe('used')
  })

  it('relies on column defaults that match what the app would stamp (VND, ₫)', () => {
    const money = listingMoneyFor({ categorySlug: LISTING.categorySlug, subcategorySlug: LISTING.subcategorySlug, listingType: LISTING.listingType })
    expect([money.priceUnit, money.currency]).toEqual(['VND', '₫'])
    expect(Number.isInteger(LISTING.price) && LISTING.price > 0 && LISTING.price <= 1e12).toBe(true)
  })

  it('stores the area as the wizard does: the 2025 ward name as district and location, the province name as city', () => {
    const province = VN_PROVINCES.find((p) => p.name === LISTING.city)
    expect(province, LISTING.city).toBeDefined()
    const wards = (vnUnits as Array<{ code: string; wards?: { name: string }[] }>).find((u) => u.code === province!.code)?.wards ?? []
    expect(wards.map((w) => w.name)).toContain(LISTING.district)
    expect(LISTING.location).toBe(LISTING.district)
  })

  it('says plainly, in both languages, that it is a demo and not for sale', () => {
    expect(LISTING.description).toMatch(/demo listing/i)
    expect(LISTING.description).toMatch(/not for sale/i)
    expect(LISTING.descriptionVi).toMatch(/tin đăng mẫu/i)
    expect(LISTING.descriptionVi).toMatch(/không bán/i)
  })
})

describe('the App Review demo thread — the messages', () => {
  it('are plain, short, and pass the chat filter and the contact screens', () => {
    expect(MESSAGES[0].from).toBe('buyer')
    for (const m of MESSAGES) {
      expect(['buyer', 'seller']).toContain(m.from)
      expect(m.body.trim()).toBe(m.body)
      expect(m.body.length).toBeGreaterThan(0)
      // insertMessage cuts the inbox preview at 140 — the seed stores the body as the preview verbatim.
      expect(m.body.length).toBeLessThanOrEqual(140)
      expect(findSevereAbuse(m.body), m.body).toBeNull()
    }
    expect(() => assertCleanTexts(MESSAGES.map((m) => m.body))).not.toThrow()
  })

  it('leave the counters the app would: the seat has the seller\'s reply unread', () => {
    expect(threadCounters(MESSAGES)).toEqual({ buyerUnread: 1, sellerUnread: 0, lastText: MESSAGES[MESSAGES.length - 1].body })
    expect(threadCounters([{ from: 'buyer', body: 'a' }])).toEqual({ buyerUnread: 0, sellerUnread: 1, lastText: 'a' })
    expect(threadCounters([{ from: 'buyer', body: 'a' }, { from: 'buyer', body: 'b' }])).toMatchObject({ buyerUnread: 0, sellerUnread: 2 })
    expect(threadCounters([{ from: 'buyer', body: 'a' }, { from: 'seller', body: 'b' }, { from: 'seller', body: 'c' }])).toMatchObject({ buyerUnread: 2, sellerUnread: 0 })
  })
})

describe('the App Review demo thread — the command line', () => {
  it('dry-runs by default and writes only with --apply --gate=off', () => {
    expect(parseArgs([])).toEqual({ apply: false, gate: null })
    expect(parseArgs(['--gate=on'])).toEqual({ apply: false, gate: 'on' }) // a dry run may show the refusal
    expect(parseArgs(['--apply', '--gate=off'])).toEqual({ apply: true, gate: 'off' })
    expect(parseArgs(['--gate=off', '--apply'])).toEqual({ apply: true, gate: 'off' })
  })

  it('⛔ refuses --apply without --gate=off, with --gate=on, and any unknown argument', () => {
    expect(parseArgs(['--apply']).error).toMatch(/--gate=off/)
    expect(parseArgs(['--apply', '--gate=on']).error).toMatch(/Refusing with --gate=on/)
    for (const argv of [['--aply'], ['--gate'], ['--gate', 'off'], ['--gate=maybe'], ['--gate=on', '--gate=off'], ['--for=apple']]) {
      expect(parseArgs(argv).error, argv.join(' ')).toBeTruthy()
    }
  })
})
