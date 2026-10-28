/**
 * "ZALO FOR URGENT COVER" ON A REAL POSTGRES (owner, 2026-10-28 — src/lib/teachers/zalo.ts). The rules that only prove
 * themselves on a real database — the advisory locks, the unique key that makes a re-open free, two taps racing for the
 * last slot, a withdrawal racing a reveal, the bell committed with the ledger row — run here against a SCRATCH database.
 *
 *   createdb zalo_it && psql -d zalo_it -c 'create extension pg_trgm' \
 *     && npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script | psql -d zalo_it -v ON_ERROR_STOP=1
 *   ZALO_IT_DATABASE_URL=postgresql://$(whoami)@localhost:5432/zalo_it npx vitest run src/lib/teachers/zalo.it.test.ts
 *
 * ⛔ GUARDED BY THE DATABASE NAME (/_it$/ in the URL AND current_database()), never by "localhost": production is
 * reached through an SSH tunnel on localhost (scratch-db rule). Skipped without the variable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const URL_ = process.env.ZALO_IT_DATABASE_URL ?? ''
const ON = /\/[a-z0-9_]+_it(\?.*)?$/.test(URL_)
if (ON) process.env.DATABASE_URL = URL_

const h = vi.hoisted(() => ({ tier: new Map<string, string>(), blocked: new Set<string>() }))
vi.mock('server-only', () => ({}))
// The tier is the DM ladder's (identity + business verification rows) — its own tests prove it; here it is a dial.
vi.mock('./dm-quota', async (orig) => ({
  ...(await orig<typeof import('./dm-quota')>()),
  teacherDmTier: async (id: string) => {
    const t = h.tier.get(id) ?? 'unverified'
    return { tier: t, limit: 0, next: t === 'identity' ? 'verify_business' : 'verify_identity', nextLimit: null, needsPhone: false, pooled: false }
  },
}))
vi.mock('@/lib/user-blocks', () => ({ isBlockedBetween: async (a: string, b: string) => h.blocked.has(`${a}|${b}`) || h.blocked.has(`${b}|${a}`) }))

describe.skipIf(!ON)('zalo.ts on a real Postgres (zalo_it)', () => {
  let db: typeof import('@/lib/db').db
  let z: typeof import('./zalo')
  let rules: typeof import('./zalo-rules')
  let COVER_CONSENT_VERSION: string
  const T = '11111111-1111-4111-8111-111111111111'
  const S1 = '22222222-2222-4222-8222-222222222222'
  const S2 = '33333333-3333-4333-8333-333333333333'
  const S3 = '44444444-4444-4444-8444-444444444444'
  const P = '55555555-5555-4555-8555-555555555555' // a personal (individual) account
  const T2 = '66666666-6666-4666-8666-666666666666'
  const LISTING = 'zalo-it-listing-1'
  const LISTING2 = 'zalo-it-listing-2'
  let ipN = 0
  /** A fresh connection per test: the pool is per connection per day (random /64s, the scratch-db rule). */
  const ip = () => `2001:db8:${(++ipN).toString(16)}::1`

  beforeAll(async () => {
    ;({ db } = await import('@/lib/db'))
    const [{ current_database: name }] = await db.$queryRaw<{ current_database: string }[]>`select current_database()`
    if (!/_it$/.test(name)) throw new Error(`refusing to run against ${name}`)
    z = await import('./zalo')
    rules = await import('./zalo-rules')
    ;({ COVER_CONSENT_VERSION } = await import('./cover'))
  }, 60_000)
  afterAll(async () => { await db?.$disconnect() })

  beforeEach(async () => {
    h.tier.clear(); h.blocked.clear()
    await db.$executeRawUnsafe(`TRUNCATE "TeacherZaloReveal", "Notification", "TeacherPrivate", "TeacherProfile", "Listing", "Seller", "Category", "compliance_audit", "Profile" CASCADE`)
    const now = new Date()
    for (const [id, type, name] of [[T, 'individual', 'Teacher'], [T2, 'individual', 'Teacher 2'], [S1, 'business', 'School One'], [S2, 'business', 'School Two'], [S3, 'business', 'School Three'], [P, 'individual', 'Person']] as const) {
      await db.profile.create({ data: { id, email: `${id}@it.test`, accountType: type, businessName: type === 'business' ? name : null, displayName: name, unsubscribeToken: `u-${id}` } })
    }
    await db.category.create({ data: { id: 'cat-teachers', name: 'Teachers', nameVi: 'Giáo viên', slug: 'teachers', icon: 'x', color: '#000' } })
    for (const [acct, listingId, tpId] of [[T, LISTING, 'tp-1'], [T2, LISTING2, 'tp-2']] as const) {
      await db.seller.create({ data: { id: `seller-${acct}`, name: 'Teacher', ownerId: acct } })
      await db.listing.create({ data: { id: listingId, title: 'Teacher', description: 'x', price: 0, location: 'Hà Nội', city: 'Hà Nội', images: '[]', categoryId: 'cat-teachers', sellerId: `seller-${acct}`, status: 'active', verified: true, listingType: 'teacher' } })
      await db.teacherProfile.create({ data: {
        id: tpId, profileId: acct, fullName: 'Teacher', headline: 'x', nationality: 'GB', currentCity: 'ha-noi', consentPublicAt: now, status: 'live', listingId,
        coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['ha-noi'], coverRateVnd: 300_000, coverConsentAt: now, coverConsentVersion: COVER_CONSENT_VERSION,
      } })
      await db.teacherPrivate.create({ data: { teacherProfileId: tpId, phone: '0901234567' } })
    }
  })

  const switchOn = async (acct: string, zalo = '0901 234 567') => {
    const s = await z.readCoverZalo(acct)
    return z.saveCoverZalo(acct, { on: true, zalo, zaloNotice: rules.COVER_ZALO_NOTICE_VERSION, base: s.base }, null)
  }

  it('the teacher switches it on with a VN mobile under the current notice — stored canonical, logged, prefilled from the phone', async () => {
    expect((await z.readCoverZalo(T)).phoneSuggestion).toBe('0901234567')
    const s = await switchOn(T, '+84 90 123 4567')
    expect(s.on).toBe(true)
    expect(s.zalo).toBe('0901234567')
    const audit = await db.complianceAudit.findMany({ where: { subjectId: T }, select: { action: true, detail: true } })
    expect(audit.map((a) => a.action)).toEqual(['teacher.zalo.on'])
    expect(JSON.stringify(audit)).not.toContain('0901234567') // never the number in the log
  })

  it('refuses: a stale notice, a landline/foreign number, cover off, and a base from another window — and never refuses OFF', async () => {
    const base = (await z.readCoverZalo(T)).base
    await expect(z.saveCoverZalo(T, { on: true, zalo: '0901234567', zaloNotice: '2000-01-01', base }, null)).rejects.toBeInstanceOf(z.ZaloNoticeChangedError)
    await expect(z.saveCoverZalo(T, { on: true, zalo: '02438251234', zaloNotice: rules.COVER_ZALO_NOTICE_VERSION, base }, null)).rejects.toBeInstanceOf(z.ZaloInvalidError)
    await expect(z.saveCoverZalo(T, { on: true, zalo: '+44 7700 900123', zaloNotice: rules.COVER_ZALO_NOTICE_VERSION, base }, null)).rejects.toBeInstanceOf(z.ZaloInvalidError)
    await switchOn(T)
    // Tab A loaded the "on" state; tab B switches off; tab A's switch-on of a new number must not undo it.
    const stale = (await z.readCoverZalo(T)).base
    await z.saveCoverZalo(T, { on: false }, null)
    await expect(z.saveCoverZalo(T, { on: true, zalo: '0912345678', zaloNotice: rules.COVER_ZALO_NOTICE_VERSION, base: stale }, null)).rejects.toBeInstanceOf(z.ZaloChangedError)
    expect((await z.readCoverZalo(T)).zalo).toBeNull()
    await db.teacherProfile.update({ where: { id: 'tp-1' }, data: { coverOpen: false } })
    await expect(switchOn(T)).rejects.toMatchObject({ field: 'cover' })
  })

  it('⛔ a tab loaded for a deleted profile cannot switch Zalo on for the profile made after it; two grants never share an instant', async () => {
    const stale = (await z.readCoverZalo(T)).base
    expect(stale.profile).toBe('tp-1')
    await expect(z.saveCoverZalo(T, { on: true, zalo: '0901234567', zaloNotice: rules.COVER_ZALO_NOTICE_VERSION, base: { ...stale, profile: 'tp-gone' } }, null)).rejects.toBeInstanceOf(z.ZaloChangedError)
    await switchOn(T)
    const first = (await db.teacherPrivate.findUnique({ where: { teacherProfileId: 'tp-1' } }))!.coverZaloAt!
    await switchOn(T, '0912345678')
    const second = (await db.teacherPrivate.findUnique({ where: { teacherProfileId: 'tp-1' } }))!.coverZaloAt!
    expect(second.getTime()).toBeGreaterThan(first.getTime())
  })

  it('switching off deletes the number and stamps the withdrawal; cover off (the save paths\' hook) does the same', async () => {
    await switchOn(T)
    const off = await z.saveCoverZalo(T, { on: false }, null)
    expect(off.on).toBe(false)
    expect((await db.teacherPrivate.findUnique({ where: { teacherProfileId: 'tp-1' } }))?.coverZalo).toBeNull()
    await switchOn(T)
    await db.$transaction((tx) => z.withdrawZaloForCoverOff(tx, { profileId: T, teacherProfileId: 'tp-1', coverOpen: false }))
    const row = await db.teacherPrivate.findUnique({ where: { teacherProfileId: 'tp-1' } })
    expect(row?.coverZalo).toBeNull()
    expect(row?.coverZaloWithdrawnAt).not.toBeNull()
    expect((await db.complianceAudit.findMany({ where: { subjectId: T }, orderBy: { id: 'asc' } })).map((a) => a.action))
      .toEqual(['teacher.zalo.on', 'teacher.zalo.off', 'teacher.zalo.on', 'teacher.zalo.off'])
  })

  it('a school reveals it: the number and a zalo.me link; the teacher gets ONE bell and the record; re-opening is free', async () => {
    await switchOn(T)
    const a = ip()
    const r = await z.revealZalo(S1, LISTING, a)
    expect(r).toMatchObject({ ok: true, zalo: '0901234567', href: 'https://zalo.me/0901234567' })
    const again = await z.revealZalo(S1, LISTING, a)
    expect(again).toMatchObject({ ok: true, zalo: '0901234567' })
    expect(await db.teacherZaloReveal.count()).toBe(1)
    const bells = await db.notification.findMany({ where: { recipientId: T } })
    expect(bells).toHaveLength(1)
    expect(bells[0]!.type).toBe('teacher_zalo_seen')
    expect(bells[0]!.body).toContain('The school account “School One” saw your Zalo number')
    expect((await z.readCoverZalo(T)).seenBy.map((s) => s.name)).toEqual(['School One'])
    const st = await z.zaloStanding(S1, LISTING, a)
    expect(st).toMatchObject({ available: true, revealed: true, used: 1, remaining: 0 })
  })

  it('caps: an unverified school sees ONE new number a day; a verified one twenty; a personal account none', async () => {
    await switchOn(T); await switchOn(T2, '0912345678')
    expect(await z.revealZalo(S1, LISTING, ip())).toMatchObject({ ok: true })
    expect(await z.revealZalo(S1, LISTING2, ip())).toMatchObject({ ok: false, reason: 'limit', standing: { next: 'verify_identity' } })
    h.tier.set(S2, 'business')
    expect(await z.revealZalo(S2, LISTING, ip())).toMatchObject({ ok: true })
    expect(await z.revealZalo(S2, LISTING2, ip())).toMatchObject({ ok: true, standing: { tier: 'verified', limit: 20, used: 2 } })
    // A personal account learns nothing about the teacher — the same null as a teacher who offers no Zalo (no oracle).
    expect(await z.revealZalo(P, LISTING, ip())).toBeNull()
    expect(await z.zaloStanding(P, LISTING, ip())).toMatchObject({ available: false, reason: 'business_only', next: 'switch_to_business' })
  })

  it('throwaway accounts: one connection shares two reveals a day below business verification', async () => {
    await switchOn(T); await switchOn(T2, '0912345678')
    const shared = ip()
    expect(await z.revealZalo(S1, LISTING, shared)).toMatchObject({ ok: true })
    expect(await z.revealZalo(S2, LISTING2, shared)).toMatchObject({ ok: true })
    expect(await z.revealZalo(S3, LISTING, shared)).toMatchObject({ ok: false, reason: 'pool' })
    // A verified school on the same connection is not pooled.
    h.tier.set(S3, 'business')
    expect(await z.revealZalo(S3, LISTING, shared)).toMatchObject({ ok: true })
  })

  it('a NEW grant (a changed number) is a new disclosure: counted again and rung again', async () => {
    await switchOn(T)
    h.tier.set(S2, 'business')
    await z.revealZalo(S2, LISTING, ip())
    await switchOn(T, '0912345678')
    const r = await z.revealZalo(S2, LISTING, ip())
    expect(r).toMatchObject({ ok: true, zalo: '0912345678', standing: { used: 2 } })
    expect(await db.notification.count({ where: { recipientId: T } })).toBe(2)
  })

  it('no oracle: not live, Zalo off, cover off, blocked, the teacher themself, the demo — all one null', async () => {
    expect(await z.revealZalo(S1, LISTING, ip())).toBeNull() // Zalo never switched on
    await switchOn(T)
    h.blocked.add(`${T}|${S1}`)
    expect(await z.revealZalo(S1, LISTING, ip())).toBeNull()
    h.blocked.clear()
    expect(await z.revealZalo(T, LISTING, ip())).toBeNull()
    await db.listing.update({ where: { id: LISTING }, data: { status: 'hidden' } })
    expect(await z.revealZalo(S1, LISTING, ip())).toBeNull()
    expect((await z.zaloStanding(S1, LISTING, ip())).available).toBe(false)
    expect(await db.teacherZaloReveal.count()).toBe(0)
  })

  it('⛔ two taps racing for the last slot: exactly one reveal, one row, one bell', async () => {
    await switchOn(T); await switchOn(T2, '0912345678')
    const [a, b] = await Promise.all([z.revealZalo(S1, LISTING, ip()), z.revealZalo(S1, LISTING2, ip())])
    expect([a, b].filter((r) => r?.ok).length).toBe(1)
    expect([a, b].filter((r) => r && !r.ok && r.reason === 'limit').length).toBe(1)
    expect(await db.teacherZaloReveal.count({ where: { viewerProfileId: S1 } })).toBe(1)
    expect(await db.notification.count()).toBe(1)
  })

  it('⛔ a withdrawal racing a reveal: either the reveal saw the number first, or it sees none — never after the switch-off', async () => {
    await switchOn(T)
    h.tier.set(S2, 'business')
    const [r] = await Promise.all([z.revealZalo(S2, LISTING, ip()), z.saveCoverZalo(T, { on: false }, null)])
    const rows = await db.teacherZaloReveal.findMany({ select: { revealedAt: true } })
    const withdrawnAt = (await db.teacherPrivate.findUnique({ where: { teacherProfileId: 'tp-1' } }))!.coverZaloWithdrawnAt!
    if (r?.ok) expect(rows[0]!.revealedAt.getTime()).toBeLessThanOrEqual(withdrawnAt.getTime())
    else expect(rows).toHaveLength(0)
    expect(await z.revealZalo(S2, LISTING, ip())).toBeNull()
  })

  it('⛔ a teacher deleting their profile never hands a school its spent reveal back — and the sweep keeps only what /privacy says', async () => {
    await switchOn(T); await switchOn(T2, '0912345678')
    const a = ip()
    expect(await z.revealZalo(S1, LISTING, a)).toMatchObject({ ok: true })
    await db.teacherProfile.delete({ where: { id: 'tp-1' } })
    expect(await z.revealZalo(S1, LISTING2, ip())).toMatchObject({ ok: false, reason: 'limit' })
    // The next day: the pool code is erased, the orphaned count deleted.
    const later = new Date(Date.now() + 86_400_000 + 3_600_000)
    await db.teacherZaloReveal.create({ data: { viewerProfileId: S2, viewerName: 'School Two', teacherProfileId: 'tp-2', grantAt: new Date(), day: '2000-01-01', poolKey: 'old-pool' } })
    const swept = await z.sweepZalo(later)
    expect(swept.countsDeleted).toBe(1)
    expect(swept.poolKeysErased).toBeGreaterThanOrEqual(1)
    expect(await db.teacherZaloReveal.count({ where: { teacherProfileId: null } })).toBe(0)
    expect(await db.teacherZaloReveal.count({ where: { poolKey: 'old-pool' } })).toBe(0)
  })

  it('the sweep deletes a number whose cover is switched OFF — whoever did it — and logs it; a cover-notice bump only makes it dormant', async () => {
    await switchOn(T)
    await db.teacherProfile.update({ where: { id: 'tp-1' }, data: { coverConsentVersion: '2000-01-01' } }) // a notice bump
    expect((await z.sweepZalo()).numbersDeleted).toBe(0)
    expect(await z.revealZalo(S1, LISTING, ip())).toBeNull() // dormant: never revealed under a stale cover consent
    await db.teacherProfile.update({ where: { id: 'tp-1' }, data: { coverOpen: false } }) // switched off outside the saves
    expect((await z.sweepZalo()).numbersDeleted).toBe(1)
    expect((await db.teacherPrivate.findUnique({ where: { teacherProfileId: 'tp-1' } }))?.coverZalo).toBeNull()
    expect((await db.complianceAudit.findMany({ where: { subjectId: T }, orderBy: { id: 'desc' }, take: 1 }))[0]?.action).toBe('teacher.zalo.off')
  })

  it('the school\'s account goes, the teacher\'s record of who saw it stays', async () => {
    await switchOn(T)
    await z.revealZalo(S1, LISTING, ip())
    await db.profile.delete({ where: { id: S1 } })
    expect((await z.readCoverZalo(T)).seenBy.map((s) => s.name)).toEqual(['School One'])
  })
})
