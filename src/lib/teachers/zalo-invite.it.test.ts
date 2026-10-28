/**
 * THE ONE-TIME "ZALO FOR URGENT COVER" INVITE ON A REAL POSTGRES (owner, 2026-10-29 — src/lib/teachers/zalo-invite.ts):
 * the claim's compare-and-set, the guard that aborts the chat batch, the locks, the bell committed with the message —
 * against the SCRATCH database of zalo.it.test.ts (with scripts/teacher-cover-zalo-invite-ddl.mjs run on it).
 *
 *   ZALO_IT_DATABASE_URL=postgresql://$(whoami)@localhost:5432/zalo_it npx vitest run --no-file-parallelism \
 *     src/lib/teachers/zalo-invite.it.test.ts src/lib/teachers/zalo.it.test.ts      # one at a time: both truncate zalo_it
 *
 * ⛔ GUARDED BY THE DATABASE NAME (/_it$/ in the URL AND current_database()), never by "localhost". Skipped without it.
 * kv (the run lock, the desk's mode) is an in-memory stand-in: kv_store's functions are not in a schema-only database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const URL_ = process.env.ZALO_IT_DATABASE_URL ?? ''
const ON = /\/[a-z0-9_]+_it(\?.*)?$/.test(URL_)
if (ON) process.env.DATABASE_URL = URL_

const h = vi.hoisted(() => ({ kv: new Map<string, unknown>() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    get: async (k: string) => h.kv.get(k) ?? null,
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => { if (o?.nx && h.kv.has(k)) return null; h.kv.set(k, v); return 'OK' },
    del: async (k: string) => { h.kv.delete(k) },
    incrby: async (k: string, by: number) => { const n = Number(h.kv.get(k) ?? 0) + by; h.kv.set(k, n); return n },
  },
  rateLimit: async () => ({ success: true }),
}))
// The quiet hours are the clock's; here every run is at noon.
vi.mock('./job-dms/run', async (orig) => ({ ...(await orig<typeof import('./job-dms/run')>()), isQuiet: () => false }))

describe.skipIf(!ON)('zalo-invite.ts on a real Postgres (zalo_it)', () => {
  let db: typeof import('@/lib/db').db
  let inv: typeof import('./zalo-invite')
  let COVER_CONSENT_VERSION: string
  let JOBS_DESK_SELLER_ID: string
  let JOB_DM_DEFAULT_ON: string
  let JOB_DMS_MODE_KEY: string
  const OP = '99999999-9999-4999-8999-999999999999' // the jobs desk's operator (support@eno.forum)
  const A = '11111111-1111-4111-8111-111111111111' // job messages on
  const B = '22222222-2222-4222-8222-222222222222' // never chose — and no TeacherPrivate row
  const C = '33333333-3333-4333-8333-333333333333' // job messages paused
  const accounts = [[A, 'tp-a', 'L-a', 'Anna Smith'], [B, 'tp-b', 'L-b', 'Ben'], [C, 'tp-c', 'L-c', 'Cara']] as const

  beforeAll(async () => {
    ;({ db } = await import('@/lib/db'))
    const [{ current_database: name }] = await db.$queryRaw<{ current_database: string }[]>`select current_database()`
    if (!/_it$/.test(name)) throw new Error(`refusing to run against ${name}`)
    // kv_store as rate-limit-pg.mjs makes it: the chat guard reads the desk's mode there, inside its own transaction.
    await db.$executeRawUnsafe(`create unlogged table if not exists kv_store (key text primary key, value jsonb not null, expires_at timestamptz)`)
    inv = await import('./zalo-invite')
    ;({ COVER_CONSENT_VERSION } = await import('./cover'))
    ;({ JOBS_DESK_SELLER_ID, JOB_DM_DEFAULT_ON, JOB_DMS_MODE_KEY } = await import('./job-dms/constants'))
  }, 60_000)
  afterAll(async () => { await db?.$disconnect() })

  beforeEach(async () => {
    h.kv.clear()
    await setMode('live')
    await db.$executeRawUnsafe(`TRUNCATE "Message", "Conversation", "Notification", "TeacherJobDmConsent", "TeacherZaloReveal", "TeacherPrivate", "TeacherProfile", "Listing", "Seller", "Category", "Profile" CASCADE`)
    const now = new Date()
    await db.profile.create({ data: { id: OP, email: 'support@eno.forum', accountType: 'individual', displayName: 'eno', unsubscribeToken: 'u-op' } })
    await db.category.create({ data: { id: 'cat-teachers', name: 'Teachers', nameVi: 'Giáo viên', slug: 'teachers', icon: 'x', color: '#000' } })
    // The desk's Seller row (desk.ts creates it once per process — the truncate above took it)
    await db.seller.create({ data: { id: JOBS_DESK_SELLER_ID, name: 'Alex · eno.vn' } })
    for (const [acct, tpId, listingId, fullName] of accounts) {
      await db.profile.create({ data: { id: acct, email: `${acct}@it.test`, accountType: 'individual', displayName: fullName, unsubscribeToken: `u-${acct}` } })
      await db.seller.create({ data: { id: `seller-${acct}`, name: fullName, ownerId: acct } })
      await db.listing.create({ data: { id: listingId, title: 'Teacher', description: 'x', price: 0, location: 'Hà Nội', city: 'Hà Nội', images: '[]', categoryId: 'cat-teachers', sellerId: `seller-${acct}`, status: 'active', verified: true, listingType: 'teacher' } })
      await db.teacherProfile.create({ data: {
        id: tpId, profileId: acct, fullName, headline: 'x', nationality: 'GB', currentCity: 'ha-noi', consentPublicAt: now, status: 'live', listingId,
        coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['ha-noi'], coverRateVnd: 300_000, coverConsentAt: now, coverConsentVersion: COVER_CONSENT_VERSION,
      } })
    }
    await db.teacherPrivate.createMany({ data: [{ teacherProfileId: 'tp-a', phone: '0901234567' }, { teacherProfileId: 'tp-c', phone: '0901234568' }] })
    const on = new Date(now.getTime() - 86_400_000)
    await db.teacherJobDmConsent.create({ data: { profileId: A, optIn: true, optInAt: on, noticeVersion: JOB_DM_DEFAULT_ON } })
    await db.teacherJobDmConsent.create({ data: { profileId: C, optIn: true, optInAt: on, noticeVersion: JOB_DM_DEFAULT_ON, pausedAt: now } })
  })

  /** The desk's mode — in the stand-in (run.ts readMode) AND in kv_store (the chat guard). */
  const setMode = async (m: 'live' | 'shadow') => {
    h.kv.set(JOB_DMS_MODE_KEY, m)
    await db.$executeRaw`insert into kv_store (key, value) values (${JOB_DMS_MODE_KEY}, to_jsonb(${m}::text)) on conflict (key) do update set value = excluded.value`
  }
  const invitedAt = async (tp: string) => (await db.teacherPrivate.findUnique({ where: { teacherProfileId: tp }, select: { coverZaloInvitedAt: true } }))?.coverZaloInvitedAt ?? null
  const bells = (acct: string) => db.notification.findMany({ where: { recipientId: acct, type: 'teacher_zalo_invite' } })
  const deskMessages = (acct: string) => db.message.findMany({ where: { conversation: { buyerProfileId: acct, sellerId: JOBS_DESK_SELLER_ID } }, orderBy: { createdAt: 'asc' } })
  const deskThread = async (acct: string) => db.conversation.create({ data: { buyerProfileId: acct, sellerId: JOBS_DESK_SELLER_ID, sellerProfileId: OP, listingId: null } })

  it('a run never overlaps the job-messages run: its lock held → busy, nothing read or sent', async () => {
    h.kv.set('job-dms:run', 'another run')
    expect(await inv.runCoverZaloInvite({ dryRun: false })).toMatchObject({ stopped: 'busy', chat: 0, bell: 0 })
    expect(await db.notification.count()).toBe(0)
  })

  it('⛔ the queue never stalls behind those it cannot tell yet: with the paused first, the rest are still reached; `left` counts who is still owed it', async () => {
    // C (paused) is the OLDEST profile now
    await db.teacherProfile.update({ where: { id: 'tp-c' }, data: { createdAt: new Date(Date.now() - 365 * 86_400_000) } })
    const r = await inv.runCoverZaloInvite({ dryRun: false })
    expect(r).toMatchObject({ chat: 1, bell: 1, paused: 1, left: 1 })
  })

  it('⛔ the bell path waits for a reply written after the read (it may be a STOP)', async () => {
    const t = await deskThread(B)
    const read = new Date(Date.now() - 1000)
    await db.message.create({ data: { conversationId: t.id, senderProfileId: B, body: 'stop please' } })
    const b = (await inv.loadCandidates(10)).find((c) => c.profileId === B)!
    expect(await inv.inviteByBell(b, read, new Date())).toBe('held')
    expect(await bells(B)).toHaveLength(0)
  })

  it('a dry run counts who would be told and how — and writes nothing', async () => {
    const r = await inv.runCoverZaloInvite({ dryRun: true })
    expect(r).toMatchObject({ dryRun: true, eligible: 3, chat: 1, bell: 1, paused: 1, live: true })
    expect(await db.notification.count()).toBe(0)
    expect(await db.message.count()).toBe(0)
    expect(await invitedAt('tp-a')).toBeNull()
  })

  it('job messages on: ONE desk message (with the first-message intro) + its bell + the claim, in one go; then never again', async () => {
    const privAt = (await db.teacherPrivate.findUnique({ where: { teacherProfileId: 'tp-a' } }))!.updatedAt
    const r = await inv.runCoverZaloInvite({ dryRun: false })
    expect(r).toMatchObject({ chat: 1, bell: 1, paused: 1, held: 0, failed: 0 })
    const msgs = await deskMessages(A)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.senderProfileId).toBe(OP)
    expect(msgs[0]!.body).toMatch(/^Hi Anna, this is Alex from eno\.vn\. Job messages are on/)
    expect(msgs[0]!.body).toContain('https://eno.vn/teachers/cover-zalo')
    const [bell] = await bells(A)
    expect(bell).toMatchObject({ url: `/messages/${msgs[0]!.conversationId}`, conversationId: msgs[0]!.conversationId })
    // it is that day's cover-lesson message: the job-messages run sends no cover message on top of it today
    expect(await db.teacherJobDmDay.findMany({ where: { profileId: A }, select: { kind: true, conversationId: true } })).toEqual([{ kind: 'cover', conversationId: msgs[0]!.conversationId }])
    expect(await invitedAt('tp-a')).not.toBeNull()
    // the existing private row's updatedAt is left as it was (the download dates the contact details by it)
    expect((await db.teacherPrivate.findUnique({ where: { teacherProfileId: 'tp-a' } }))!.updatedAt.getTime()).toBe(privAt.getTime())
    // never chose → the in-app bell, and its private row is created for the claim
    expect((await bells(B))[0]).toMatchObject({ url: '/teachers/cover-zalo' })
    expect(await invitedAt('tp-b')).not.toBeNull()
    expect(await deskMessages(B)).toHaveLength(0)
    // paused → nothing at all
    expect(await bells(C)).toHaveLength(0)
    expect(await invitedAt('tp-c')).toBeNull()
    // a second run tells no one again (the run lock is released by a raw delete from kv_store — not in this stand-in)
    expect(h.kv.has('job-dms:run')).toBe(true)
    h.kv.delete('job-dms:run')
    const again = await inv.runCoverZaloInvite({ dryRun: false })
    expect(again).toMatchObject({ eligible: 1, chat: 0, bell: 0, paused: 1 })
    expect(await db.notification.count({ where: { type: 'teacher_zalo_invite' } })).toBe(2)
    expect(await db.message.count()).toBe(1)
  })

  it('a desk message already waiting for a reply: the bell, never the chat (it would use the last slot)', async () => {
    const t = await deskThread(A)
    await db.message.create({ data: { conversationId: t.id, senderProfileId: OP, body: 'Hi Anna, this is Alex — a job.' } })
    await inv.runCoverZaloInvite({ dryRun: false })
    expect(await deskMessages(A)).toHaveLength(1)
    expect((await bells(A))[0]).toMatchObject({ url: '/teachers/cover-zalo' })
  })

  it('the teacher replied after the last desk message: the chat — no intro, a STOP line', async () => {
    const t = await deskThread(A)
    await db.message.create({ data: { conversationId: t.id, senderProfileId: OP, body: 'a job', createdAt: new Date(Date.now() - 3_600_000) } })
    await db.message.create({ data: { conversationId: t.id, senderProfileId: A, body: 'thanks!', createdAt: new Date(Date.now() - 1_800_000) } })
    await inv.runCoverZaloInvite({ dryRun: false })
    const msgs = await deskMessages(A)
    expect(msgs).toHaveLength(3)
    expect(msgs[2]!.body).toMatch(/^Hi Anna, this is Alex from eno\.vn\.\n\nThanks for being open/)
    expect(msgs[2]!.body).toMatch(/Reply STOP to stop these messages\.$/)
  })

  it('⛔ a STOP typed since the last job-messages run is honoured FIRST — job messages off, then the bell, never the chat', async () => {
    const t = await deskThread(A)
    await db.message.create({ data: { conversationId: t.id, senderProfileId: OP, body: 'a job', createdAt: new Date(Date.now() - 3_600_000) } })
    await db.message.create({ data: { conversationId: t.id, senderProfileId: A, body: 'STOP', createdAt: new Date(Date.now() - 60_000) } })
    await inv.runCoverZaloInvite({ dryRun: false })
    expect((await db.teacherJobDmConsent.findUnique({ where: { profileId: A } }))?.optIn).toBe(false)
    const msgs = await deskMessages(A)
    expect(msgs.map((m) => m.body).some((b) => b.includes('cover-zalo'))).toBe(false)
    expect((await bells(A))[0]).toMatchObject({ url: '/teachers/cover-zalo' })
  })

  it('a jobs or cover message already went today: the bell — never a third desk message that day', async () => {
    const { vnToday } = await import('./job-dms/gates')
    const t = await deskThread(A)
    await db.message.create({ data: { conversationId: t.id, senderProfileId: OP, body: 'a job', createdAt: new Date(Date.now() - 3_600_000) } })
    await db.message.create({ data: { conversationId: t.id, senderProfileId: A, body: 'thanks', createdAt: new Date(Date.now() - 1_800_000) } })
    await db.teacherJobDmDay.create({ data: { profileId: A, day: vnToday(new Date()), kind: 'jobs', conversationId: t.id } })
    await inv.runCoverZaloInvite({ dryRun: false })
    expect(await deskMessages(A)).toHaveLength(2)
    expect((await bells(A))[0]).toMatchObject({ url: '/teachers/cover-zalo' })
  })

  it('the desk not sending live (a crash fell back to shadow): the bell', async () => {
    await setMode('shadow')
    await inv.runCoverZaloInvite({ dryRun: false })
    expect(await deskMessages(A)).toHaveLength(0)
    expect((await bells(A))[0]).toMatchObject({ url: '/teachers/cover-zalo' })
  })

  it('never a teacher with a number, one who switched it off, or one with cover off', async () => {
    await db.teacherPrivate.update({ where: { teacherProfileId: 'tp-a' }, data: { coverZalo: '0901234567', coverZaloAt: new Date() } })
    await db.teacherPrivate.create({ data: { teacherProfileId: 'tp-b', coverZaloWithdrawnAt: new Date() } })
    await db.teacherProfile.update({ where: { id: 'tp-c' }, data: { coverOpen: false } })
    const r = await inv.runCoverZaloInvite({ dryRun: false })
    expect(r.eligible).toBe(0)
    expect(await db.notification.count()).toBe(0)
  })

  it('⛔ the guard aborts the WHOLE chat batch when something changed since the plan — no message, no bell, no claim, no empty thread', async () => {
    const [cand] = (await inv.loadCandidates(10)).filter((c) => c.profileId === A)
    await db.teacherProfile.update({ where: { id: 'tp-a' }, data: { coverOpen: false } }) // cover off after the plan
    expect(await inv.inviteInChat(cand!, OP, new Date(), new Date())).toBe('held')
    expect(await db.message.count()).toBe(0)
    expect(await db.notification.count()).toBe(0)
    expect(await invitedAt('tp-a')).toBeNull()
    expect(await db.conversation.count()).toBe(0)
  })

  it('⛔ the desk switched to shadow after the plan: the chat batch aborts — nothing sent', async () => {
    const a = (await inv.loadCandidates(10)).find((c) => c.profileId === A)!
    await db.$executeRaw`update kv_store set value = to_jsonb('shadow'::text) where key = ${JOB_DMS_MODE_KEY}`
    expect(await inv.inviteInChat(a, OP, new Date(), new Date())).toBe('held')
    expect(await db.message.count()).toBe(0)
  })

  it('a teacher who leaves the set mid-run never makes the run skip another (no offset paging)', async () => {
    // A's private row gets a number between the load and the send: A is 'gone' — B and the rest are still reached
    const seen = new Set<string>()
    const first = await inv.loadCandidates(1, seen)
    first.forEach((c) => seen.add(c.teacherProfileId))
    await db.teacherPrivate.update({ where: { teacherProfileId: first[0]!.teacherProfileId }, data: { coverZalo: '0901234567', coverZaloAt: new Date() } })
    const next = await inv.loadCandidates(10, seen)
    expect(next.map((c) => c.teacherProfileId).sort()).toEqual(['tp-a', 'tp-b', 'tp-c'].filter((t) => t !== first[0]!.teacherProfileId).sort())
  })

  it('⛔ two invites racing for one teacher (chat and bell, bell and bell): exactly one is delivered', async () => {
    const cands = await inv.loadCandidates(10)
    const a = cands.find((c) => c.profileId === A)!
    const b = cands.find((c) => c.profileId === B)!
    const [x, y] = await Promise.all([inv.inviteInChat(a, OP, new Date(), new Date()), inv.inviteByBell(a, new Date(), new Date())])
    expect([x, y].filter((o) => o === 'chat' || o === 'bell')).toHaveLength(1)
    expect(await bells(A)).toHaveLength(1)
    const [p, q] = await Promise.all([inv.inviteByBell(b, new Date(), new Date()), inv.inviteByBell(b, new Date(), new Date())])
    expect([p, q].sort()).toEqual(['bell', 'gone'])
    expect(await bells(B)).toHaveLength(1)
  })
})
