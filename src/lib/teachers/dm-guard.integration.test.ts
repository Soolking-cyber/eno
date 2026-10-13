import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

/**
 * ⛔ THE TEACHER DM LADDER ON A REAL POSTGRES, THROUGH THE PRODUCTION PATH (codex + Opus, gate 2026-10-13). The unit tests
 * fake the database, so they cannot show that the raw SQL is valid against the real schema and functions — a cast, a
 * quoted name or a kv_* signature wrong there would fail EVERY first contact or EVERY message into a teacher thread —
 * nor that the locks hold under concurrency:
 *   · "2 until reply": insertMessage runs SendOpts.alongside — the guard's lock and re-check — in the message's own
 *     transaction, BEFORE its insert;
 *   · openTeacherThread: the account lock, the recount, the pool's lock and its kv_get / kv_incrby counter.
 * Nothing here is faked but `server-only` and `after()`: the real db client, insertMessage, sendToTeacherGuarded and
 * openTeacherThread. The scratch database also needs the kv_* functions (scripts/rate-limit-pg.mjs).
 *
 * OPT-IN, and only against a SCRATCH database whose NAME ends in `_it`, holding the pushed Prisma schema — it writes
 * rows and leaves them:
 *   DM_GUARD_IT=1 DATABASE_URL=postgresql://<you>@localhost:5432/dm_ladder_it npx vitest run src/lib/teachers/dm-guard.integration.test.ts
 * ⛔ "localhost" PROVES NOTHING HERE: production is reached through an SSH tunnel on a localhost port (Opus, gate
 * 2026-10-13). So the guard is the database's NAME — `_it`, in the URL and again from current_database() before the
 * first write — never the host.
 */
const DB_NAME = /^postgres(?:ql)?:\/\/[^/]+\/([^/?#]+)/.exec(process.env.DATABASE_URL ?? '')?.[1] ?? ''
const RUN = process.env.DM_GUARD_IT === '1' && /_it$/.test(DB_NAME)

vi.mock('server-only', () => ({}))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: (fn: () => unknown) => { void fn() } }))

describe.skipIf(!RUN)('"2 until reply" on a real Postgres', () => {
  // Imported only when it runs: a skipped file must not build a db client.
  let db: typeof import('@/lib/db').db
  let insertMessage: typeof import('@/lib/messages').insertMessage
  let quota: typeof import('./dm-quota')
  const buyer = randomUUID()
  const teacher = randomUUID()
  let convo: { id: string; buyerProfileId: string; sellerProfileId: string; listingId: null }

  beforeAll(async () => {
    ;({ db } = await import('@/lib/db'))
    // Asked of the server itself before anything is written: a URL can be rewritten by a pooler or a tunnel.
    const [{ name }] = await db.$queryRaw<Array<{ name: string }>>`select current_database() as name`
    if (!/_it$/.test(name)) throw new Error(`refusing to write: connected to "${name}", not a scratch *_it database`)
    ;({ insertMessage } = await import('@/lib/messages'))
    quota = await import('./dm-quota')
    await db.profile.createMany({ data: [{ id: buyer }, { id: teacher }] })
    const seller = await db.seller.create({ data: { name: 'IT teacher' }, select: { id: true } })
    const c = await db.conversation.create({ data: { buyerProfileId: buyer, sellerId: seller.id, sellerProfileId: teacher }, select: { id: true } })
    convo = { id: c.id, buyerProfileId: buyer, sellerProfileId: teacher, listingId: null }
  }, 60_000) // a cold import of @/lib/messages alone takes ~7 s — past the 10 s hook default with the rest
  afterAll(async () => { await db?.$disconnect() })

  const thread = () => ({ conversationId: convo.id, buyerProfileId: buyer, teacherProfileId: teacher })
  const send = (text: string) => quota.sendToTeacherGuarded(thread(), (alongside) => insertMessage(convo, buyer, text, { alongside }))
  const count = (who: string) => db.message.count({ where: { conversationId: convo.id, senderProfileId: who } })

  it('ten sends at once into a thread holding one unanswered message: exactly one lands, nine are refused', async () => {
    await insertMessage(convo, buyer, 'Hello — are you taking new students?')
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => send(`again ${i}`)))
    expect(results.filter((r) => r.sent)).toHaveLength(1)
    expect(results.filter((r) => !r.sent)).toHaveLength(9)
    expect(await count(buyer)).toBe(2)
  })

  it('a guard abort is told from any other failure by its own signature', async () => {
    const err: unknown = await insertMessage(convo, buyer, 'a third', { alongside: quota.teacherUnansweredGuard(convo.id, buyer, teacher) })
      .then(() => null, (e: unknown) => e)
    expect(quota.teacherGuardAbort(err)).toBe('cap')
    expect(quota.teacherGuardAbort(new Error('connection reset'))).toBeNull()
    expect(await count(buyer)).toBe(2)
  })

  it('⛔ a double tap on a NEW teacher: the same opener twice at once into an empty thread lands ONCE; the other is a repeat (codex + Opus, gate 2026-10-13)', async () => {
    const s2 = await db.seller.create({ data: { name: 'IT teacher 2' }, select: { id: true } })
    const c2 = await db.conversation.create({ data: { buyerProfileId: buyer, sellerId: s2.id, sellerProfileId: teacher }, select: { id: true } })
    const convo2 = { id: c2.id, buyerProfileId: buyer, sellerProfileId: teacher, listingId: null }
    const opener = 'Hello, I am looking for a teacher — are you open to talking?'
    const tap = () => quota.sendToTeacherGuarded({ conversationId: c2.id, buyerProfileId: buyer, teacherProfileId: teacher, repeatOf: opener },
      (alongside) => insertMessage(convo2, buyer, opener, { alongside }))
    const results = await Promise.all([tap(), tap()])
    expect(results.filter((r) => r.sent)).toHaveLength(1)
    expect(results.filter((r) => !r.sent)).toEqual([{ sent: false, reason: 'repeat' }])
    expect(await db.message.count({ where: { conversationId: c2.id } })).toBe(1)
    // At the cap a repeat is still a repeat (the thread opens), never "held": a second message lands, then the opener.
    await insertMessage(convo2, buyer, 'We are in District 2.')
    expect(await tap()).toEqual({ sent: false, reason: 'cap' })
    await insertMessage(convo2, buyer, opener, { alongside: [] }) // the newest is now the opener again (2 + 1 unguarded)
    expect(await tap()).toEqual({ sent: false, reason: 'repeat' })
  })

  it('once the teacher has written anything, ten at once all land', async () => {
    await insertMessage(convo, teacher, 'Hi! Yes, I am.')
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => send(`open ${i}`)))
    expect(results.every((r) => r.sent)).toBe(true)
    expect(await count(buyer)).toBe(12)
  })
})

describe.skipIf(!RUN)('the ladder opening NEW teacher threads on a real Postgres', () => {
  let db: typeof import('@/lib/db').db
  let quota: typeof import('./dm-quota')
  let sellerId = ''
  const listings: string[] = []
  // A fresh connection per test: the pool's kv counters outlive a run (2 days), and a re-run on the same day must not
  // inherit them — so a random /64 of the IPv6 documentation prefix (RFC 3849): 2³² of them, where 250 IPv4 addresses
  // collided within a few runs.
  const hex4 = () => Math.floor(Math.random() * 0x10000).toString(16)
  const freshIp = () => `2001:db8:${hex4()}:${hex4()}::1`
  const account = async () => { const id = randomUUID(); await db.profile.create({ data: { id } }); return id }
  const open = (profileId: string, listingId: string, ip: string) =>
    quota.openTeacherThread({ profileId, listingId, sellerId, sellerProfileId: null, ip })

  beforeAll(async () => {
    ;({ db } = await import('@/lib/db'))
    const [{ name }] = await db.$queryRaw<Array<{ name: string }>>`select current_database() as name`
    if (!/_it$/.test(name)) throw new Error(`refusing to write: connected to "${name}", not a scratch *_it database`)
    quota = await import('./dm-quota')
    const cat = await db.category.upsert({
      where: { slug: 'it-teachers' }, update: {},
      create: { slug: 'it-teachers', name: 'IT teachers', nameVi: 'IT teachers', icon: 'x', color: 'x' },
      select: { id: true },
    })
    ;({ id: sellerId } = await db.seller.create({ data: { name: 'IT teachers' }, select: { id: true } }))
    for (let i = 0; i < 8; i++) {
      const l = await db.listing.create({
        data: { title: `Teacher ${i}`, description: 'x', price: 0, city: 'HCMC', location: 'HCMC', images: '[]', categoryId: cat.id, sellerId, listingType: 'teacher' },
        select: { id: true },
      })
      listings.push(l.id)
    }
  }, 60_000)
  afterAll(async () => { await db?.$disconnect() })

  it('an unverified account opens three new teachers; the fourth is refused for its OWN limit, and the pool counted three', async () => {
    const ip = freshIp()
    const me = await account()
    for (const l of listings.slice(0, 3)) expect((await open(me, l, ip)).outcome).toBe('created')
    expect(await open(me, listings[3], ip)).toMatchObject({ outcome: 'refused', standing: { tier: 'unverified', used: 3, remaining: 0, reason: 'limit' } })
    // Re-opening one of the three is never counted.
    expect((await open(me, listings[0], ip)).outcome).toBe('existing')
    const day = quota.vnDayWindow(new Date()).day
    const [{ v }] = await db.$queryRaw<Array<{ v: unknown }>>`select kv_get(${quota.poolKeyFor(ip, day)}) as v`
    expect(Number(v)).toBe(3)
  })

  it('unverified accounts on ONE connection share six: the seventh new chat is refused for the pool', async () => {
    const ip = freshIp()
    const [a, b, c] = [await account(), await account(), await account()]
    for (const l of listings.slice(0, 3)) expect((await open(a, l, ip)).outcome).toBe('created')
    for (const l of listings.slice(0, 3)) expect((await open(b, l, ip)).outcome).toBe('created')
    expect(await open(c, listings[0], ip)).toMatchObject({ outcome: 'refused', standing: { used: 0, remaining: 0, reason: 'pool' } })
    // Another connection is another pool.
    expect((await open(c, listings[0], freshIp())).outcome).toBe('created')
  })

  it('five opens AT ONCE by one account: exactly three are created — the lock recounts each under the others', async () => {
    const me = await account()
    const results = await Promise.all(listings.slice(0, 5).map((l) => open(me, l, freshIp())))
    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(3)
    expect(results.filter((r) => r.outcome === 'refused')).toHaveLength(2)
  })

  it('a double tap on ONE new teacher: one thread, created once and found once', async () => {
    const me = await account()
    const ip = freshIp()
    const [x, y] = await Promise.all([open(me, listings[7], ip), open(me, listings[7], ip)])
    expect([x.outcome, y.outcome].sort()).toEqual(['created', 'existing'])
    expect((x as { id: string }).id).toBe((y as { id: string }).id)
  })
})
