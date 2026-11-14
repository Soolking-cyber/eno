import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import vnUnits from '@/data/vn-units.json'
import { REVIEW_SEATS, SEAT_ACCOUNT_TYPES, SEAT_FLAGS, findAuthUser, seatAccountType, seatFromArgv } from '../../scripts/review-seats.mjs'
import {
  LISTING, MESSAGES, REVIEWER_EMAIL, SEED_TAG, SELLER, TRUST_BASE, TRUST_TIER, listedIn, parseArgs, threadCounters,
} from '../../scripts/seed-app-review-thread.mjs'
import {
  INSERT_COLUMNS, LISTINGS as AI_LISTINGS, SEAT as AI_SEAT, SEAT_QUERY as AI_SEAT_QUERY, SEED_STATUSES as AI_SEED_STATUSES, STOREFRONT as AI_STOREFRONT,
  SEED_TAG as AI_SEED_TAG, SEED_VERIFIED as AI_SEED_VERIFIED, parseArgs as aiParseArgs, rowFor as aiRowFor, seatFromRows as aiSeatFromRows,
} from '../../scripts/seed-ai-review-listings.mjs'
import { assertCleanContactName, assertCleanTexts, assertPublishable, minPhotosFor } from './publish-guard'
import { findSevereAbuse } from './severe-abuse-words'
import {
  CATEGORY_BY_SLUG, SUBCATEGORY_FALLBACK, isLicenceCheckSlot, isPostableCategory, isPostableSubcategory, listingMoneyFor,
  resolveListingType, subcategoriesFor, suggestSubcategory,
} from './taxonomy'
import { GUEST_SELLER_TRUST, TRUST } from './trust-math'
import { isListingImageUrl } from './listing-image'
import { VN_PROVINCES } from './vn-areas'
import { LISTING_REMOVED } from './listing-removed'

/**
 * The review seats: the seat table every seat script reads (scripts/review-seats.mjs), the pure half of the App Store
 * demo-thread seed (scripts/seed-app-review-thread.mjs, docs/ios-appstore-release.md P11) and the pure half of the AI
 * seat's demo-listing seed (scripts/seed-ai-review-listings.mjs). Nothing here touches a database — all three files
 * import with no env and no client.
 *
 * Both seeds write listings straight into production, past every screen the app runs on a publish. So their content
 * is held here to the app's own rules — the publish gate, the taxonomy, the area table, the chat filter — and a copy
 * edit the app would refuse fails this suite instead of shipping.
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
    expect(seatFromArgv(['--for=ai'])).toEqual({ key: 'ai', seat: REVIEW_SEATS.ai })
    expect([...SEAT_FLAGS].sort()).toEqual(['ai', 'apple', 'lawyer'])
    // Every flag names a seat, and every seat but the Play one (no flag) has its flag.
    expect([...SEAT_FLAGS, 'play'].sort()).toEqual(Object.keys(REVIEW_SEATS).sort())
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
      ['--for', 'ai'],
      ['--for=AI'],
      ['--for=ai '],
      ['--for=openai'],
      ['--for=ai', '--for=apple'],
    ]) {
      const r = seatFromArgv(argv)
      expect(r.seat, argv.join(' ')).toBeUndefined()
      expect(r.error, argv.join(' ')).toMatch(/--for=lawyer and --for=apple/)
    }
  })
})

describe('the AI seat — AI-app marketplace review (ChatGPT apps, Muse, Claude)', () => {
  it('has its own @eno.vn seat, written as the house style writes the others', () => {
    expect(REVIEW_SEATS.ai).toEqual({
      email: 'ai-review@eno.vn',
      sellerName: 'eno AI app review (internal)',
      displayName: 'AI app review',
      credFile: '.env.ai-review.local',
      envPrefix: 'AI',
      accountType: 'business',
      credHeader: '# AI app reviews (OpenAI ChatGPT, Muse, Claude): sign-in for eno.vn (email + password, eno.vn/signin)',
      credNote: "# Paste only into the review forms' test-account fields. Treat as a live credential; rotate if it leaks.",
      handOff: "ONLY once the app refuses review seats any teacher contact (register-play-reviewer.mjs header) is LIVE: paste the password into the AI app review forms' test-account fields (ChatGPT, Muse, Claude) — nowhere else",
    })
    // A domain eno controls, never the Play seat's identifier-only @eno.forum, and never a staff address.
    expect(REVIEW_SEATS.ai.email).toMatch(/^[a-z-]+@eno\.vn$/)
    expect(REVIEW_SEATS.ai.email).not.toMatch(/^(support|admin|alex|contact)@/)
    // The credential lines are comments: the file is an env file, so a stray line must not parse as a variable.
    for (const line of [REVIEW_SEATS.ai.credHeader, REVIEW_SEATS.ai.credNote]) expect(line).toMatch(/^# /)
  })

  it('makes ONLY the AI seat a business account — every other seat has no accountType and is created individual', () => {
    for (const [key, s] of seats) {
      expect(Object.hasOwn(s, 'accountType'), key).toBe(key === 'ai')
      expect(seatAccountType(s), key).toEqual({ accountType: key === 'ai' ? 'business' : 'individual' })
    }
    expect([...SEAT_ACCOUNT_TYPES].sort()).toEqual(['business', 'individual'])
  })

  it('⛔ refuses any accountType but exactly individual or business — never a silent fallback', () => {
    const base = { email: 'x@eno.vn' }
    for (const accountType of ['Business', ' business', 'business ', 'BUSINESS', 'admin', '', null, undefined, ['business'], { v: 'business' }, 1, true]) {
      const r = seatAccountType({ ...base, accountType })
      expect(r.accountType, JSON.stringify(accountType)).toBeUndefined()
      expect(r.error, JSON.stringify(accountType)).toMatch(/accountType must be exactly 'individual' or 'business'.*nothing was written/)
    }
    expect(seatAccountType({ ...base, accountType: 'individual' })).toEqual({ accountType: 'individual' })
    expect(seatAccountType({ ...base, accountType: 'business' })).toEqual({ accountType: 'business' })
    expect(seatAccountType(base)).toEqual({ accountType: 'individual' })
    expect(seatAccountType(undefined).error).toBeTruthy()
  })

  it('uses public names the publish gate accepts as a contact name (they show on /sellers/<id> and in chat)', () => {
    expect(() => assertCleanContactName(REVIEW_SEATS.ai.sellerName)).not.toThrow()
    expect(() => assertCleanContactName(REVIEW_SEATS.ai.displayName)).not.toThrow()
    expect(REVIEW_SEATS.ai.sellerName).toMatch(/\(internal\)$/)
  })
})

describe('the AI seat demo listings — whose', () => {
  it('belong to the AI seat, found by its EXACT stored email — no lower(), no ILIKE, no domain match', () => {
    expect(AI_SEAT).toBe(REVIEW_SEATS.ai)
    expect(AI_SEAT_QUERY.values).toEqual(['ai-review@eno.vn'])
    expect(AI_SEAT_QUERY.text).toMatch(/where p\.email = \$1\s*$/)
    expect(AI_SEAT_QUERY.text).not.toMatch(/lower\(|ilike|\blike\b|%/i)
  })

  it('⛔ refuses unless exactly one account with exactly the seat\'s storefront answers', () => {
    const row = { id: 'p1', accountType: 'business', enforcementState: 'good_standing', sellerId: 's1', sellerName: AI_SEAT.sellerName, officialPartner: true, trustScore: 100, trustTier: 'standard' }
    expect(aiSeatFromRows([row])).toEqual({ seat: row })
    expect(aiSeatFromRows([]).refusal).toMatch(/No Profile for ai-review@eno\.vn[\s\S]*--for=ai --apply/)
    expect(aiSeatFromRows([row, { ...row, sellerId: 's2' }]).refusal).toMatch(/2 rows/)
    expect(aiSeatFromRows([{ ...row, sellerId: null, sellerName: null }]).refusal).toMatch(/owns no storefront/)
    expect(aiSeatFromRows([{ ...row, sellerName: 'Someone else\'s shop' }]).refusal).toMatch(/not the seat's row/)
  })

  it('are tagged, so a re-run finds them in any status, and never collide with the Apple seed', () => {
    expect(AI_LISTINGS).toHaveLength(3)
    const ids = AI_LISTINGS.map((l) => l.externalId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id.startsWith(`${AI_SEED_TAG}:`), id).toBe(true)
      expect(id).not.toBe(LISTING.externalId)
    }
    // The re-run guard is a left() prefix, so the tag must carry no LIKE wildcard either way.
    expect(AI_SEED_TAG).toMatch(/^[a-z-]+$/)
    expect(AI_SEED_TAG).not.toBe(SEED_TAG)
  })
})

describe('the AI seat demo listings — hidden, unverified, and still the shop\'s own', () => {
  const ctx = { sellerId: 's1', categoryId: 'cat1', sellerTrustScore: 100, id: 'cfixed' }

  it('are written hidden and verified false — off every public surface, no made-up sale, and not published by a relist', () => {
    expect([...AI_SEED_STATUSES]).toEqual(['hidden'])
    expect(AI_SEED_VERIFIED).toBe(false)
    expect(AI_LISTINGS.map((l) => l.status)).toEqual(['hidden', 'hidden', 'hidden'])
    for (const l of AI_LISTINGS) {
      const row = aiRowFor(l, ctx)
      expect(row.status, l.externalId).toBe(l.status)
      expect(row.status, l.externalId).not.toBe('active')
      expect(row.verified, l.externalId).toBe(false)
      // …and not a tombstone: the owner-scoped reads (MCP list_listings / get_listing / analytics_*) AND NOT_REMOVED.
      expect(row.status).not.toBe(LISTING_REMOVED)
    }
  })

  it('⛔ refuses to build a row with any status outside the seed set — an active typo never reaches the INSERT', () => {
    for (const status of ['active', 'Active', 'sold', 'removed', '', undefined]) {
      expect(() => aiRowFor({ ...AI_LISTINGS[0], status }, ctx), String(status)).toThrow(/status must be one of/)
    }
  })

  it('gives the storefront a location and a bio that pass the same text screens, and say what the shop is', () => {
    expect(AI_STOREFRONT.location).toBeTruthy()
    expect(AI_STOREFRONT.bio).toMatch(/test shop/i)
    expect(AI_STOREFRONT.bio).toMatch(/not for sale/i)
    expect(() => assertCleanTexts([AI_STOREFRONT.location, AI_STOREFRONT.bio])).not.toThrow()
  })

  it('writes exactly the INSERT\'s columns, in its order, with the storefront\'s trust mirrored', () => {
    for (const l of AI_LISTINGS) {
      const row = aiRowFor(l, ctx)
      expect(Object.keys(row)).toEqual([...INSERT_COLUMNS])
      expect(row).toMatchObject({ id: 'cfixed', sellerId: 's1', categoryId: 'cat1', sellerTrustScore: 100, externalId: l.externalId, price: l.price })
      expect(JSON.parse(row.images)).toEqual([...l.images])
    }
    expect(aiRowFor(AI_LISTINGS[0], { ...ctx, id: undefined }).id).toMatch(/^c[0-9a-f]{24}$/)
  })

  it('dry-runs by default, writes only with --apply, and refuses any other argument', () => {
    expect(aiParseArgs([])).toEqual({ apply: false })
    expect(aiParseArgs(['--apply'])).toEqual({ apply: true })
    for (const argv of [['--aply'], ['apply'], ['--gate=off'], ['--for=ai'], ['--apply', '--force']]) {
      expect(aiParseArgs(argv).error, argv.join(' ')).toMatch(/unknown argument/)
    }
  })
})

describe('the AI seat demo listings — each passes the app\'s own publish screens', () => {
  // The seat's storefront is created by register-play-reviewer.mjs with the column defaults: tier 'standard'.
  const SEAT_TIER = 'standard'

  for (const l of AI_LISTINGS) {
    describe(l.externalId, () => {
      it('clears the publish gate: photos, banned words, contact details, location', () => {
        expect(() => assertPublishable({
          trustTier: SEAT_TIER,
          images: [...l.images],
          texts: [l.title, l.description, l.titleVi, l.descriptionVi],
          categorySlug: l.categorySlug,
          district: l.district,
        })).not.toThrow()
        expect(() => assertCleanTexts([l.location, l.condition, l.city])).not.toThrow()
        for (const t of [l.title, l.titleVi, l.description, l.descriptionVi]) expect(findSevereAbuse(t), t).toBeNull()
        expect(l.title.length).toBeLessThanOrEqual(140)
        expect(l.description.length).toBeLessThanOrEqual(5000)
      })

      it('carries the photo minimum in DISTINCT, same-origin seed photos that exist', () => {
        expect(l.images.length).toBeGreaterThanOrEqual(minPhotosFor(l.categorySlug))
        expect(new Set(l.images).size).toBe(l.images.length)
        for (const p of l.images) {
          expect(p, p).toMatch(/^\/listings\/[a-z-]+\.png$/)
          expect(existsSync(join(process.cwd(), 'public', p)), p).toBe(true)
          // Not a storage object (see the Apple listing's test above): nothing can ever delete these files.
          expect(isListingImageUrl(p), p).toBe(false)
        }
      })

      it('is filed where the app would file it, in an aisle eno.vn lets an ordinary seller post to — never a licence aisle', () => {
        const cat = CATEGORY_BY_SLUG[l.categorySlug]
        expect(cat).toBeDefined()
        expect(isPostableCategory(l.categorySlug)).toBe(true)
        expect(cat.subcategories.map((s) => s.slug)).toContain(l.subcategorySlug)
        expect(isPostableSubcategory(l.categorySlug, l.subcategorySlug, true)).toBe(true)
        expect(isLicenceCheckSlot(l.categorySlug, l.subcategorySlug)).toBe(false)
        expect(resolveListingType(l.categorySlug, l.listingType)).toBe(l.listingType)
        expect(l.listingType).toBe('sell')
        // createListingCore's own resolution with no pick: the title's keyword, then title + description, else the
        // category's catch-all or first postable subcategory.
        const subs = subcategoriesFor(l.categorySlug).filter((s) => isPostableSubcategory(l.categorySlug, s.slug, true))
        const suggested = suggestSubcategory(l.categorySlug, l.title) ?? suggestSubcategory(l.categorySlug, `${l.title} ${l.description}`)
        const fallback = subs.find((s) => s.slug === SUBCATEGORY_FALLBACK[l.categorySlug])?.slug ?? subs[0]?.slug ?? null
        expect((suggested && subs.some((s) => s.slug === suggested) ? suggested : null) || fallback).toBe(l.subcategorySlug)
        expect(l.condition).toBe('used')
      })

      it('relies on column defaults that match what the app would stamp (VND, ₫)', () => {
        const money = listingMoneyFor({ categorySlug: l.categorySlug, subcategorySlug: l.subcategorySlug, listingType: l.listingType })
        expect([money.priceUnit, money.currency]).toEqual(['VND', '₫'])
        expect(Number.isInteger(l.price) && l.price > 0 && l.price <= 1e12).toBe(true)
      })

      it('stores the area as the wizard does: the 2025 ward name as district and location, the province name as city', () => {
        const province = VN_PROVINCES.find((p) => p.name === l.city)
        expect(province, l.city).toBeDefined()
        const wards = (vnUnits as Array<{ code: string; wards?: { name: string }[] }>).find((u) => u.code === province!.code)?.wards ?? []
        expect(wards.map((w) => w.name)).toContain(l.district)
        expect(l.location).toBe(l.district)
        // The pick-up place the text names is the one the row is filed under.
        expect(l.description).toContain(`Pick-up in ${l.district},`)
        expect(l.descriptionVi).toContain(`Nhận hàng tại ${l.district},`)
      })

      it('says plainly, in both languages and in the title an AI reviewer reads first, that it is a demo and not for sale', () => {
        expect(l.title).toMatch(/\(demo\)$/)
        expect(l.titleVi).toMatch(/\(tin mẫu\)$/)
        expect(l.description).toMatch(/demo listing/i)
        expect(l.description).toMatch(/not for sale/i)
        expect(l.description).toMatch(/AI app reviewers/)
        expect(l.descriptionVi).toMatch(/tin đăng mẫu/i)
        expect(l.descriptionVi).toMatch(/không bán/i)
      })
    })
  }
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
    expect(isPostableSubcategory(LISTING.categorySlug, LISTING.subcategorySlug, true)).toBe(true)
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
