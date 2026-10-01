import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── POST /api/admin/listings — the batch "activate" / "verify" under the seller identity gate ───────
//
// An admin act HOLDS rather than refuses (owner, 2026-09-23): a listing whose owner the gate refuses
// is parked with identityHold=true and verified=false, and the console is told how many. Four things
// are pinned, because each is a way this batch could go wrong silently:
//   · gate off → the write and the response body are exactly what they were before the gate;
//   · a gated row that was about to go public is parked, and `held` reports it;
//   · a gated row that is ALREADY public, or already pulled, is never turned into a takedown or into
//     something verifying would republish;
//   · `held` counts only what THIS request parked, and only those ids go to the re-check — a row the
//     gate had parked BEFORE the request is reported apart (`alreadyHeld`), never as activated/held.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  held: [] as string[],
  calls: [] as Array<{ m: string; args: Row }>,
  /** Successive db.listing.updateMany counts; default 0. */
  counts: [] as number[],
  /** Successive db.listing.updateManyAndReturn row sets; default []. */
  returns: [] as Row[][],
  /** db.listing.findMany result — verify's read of the gated rows before it parks. */
  before: [] as Row[],
  /** Ids whose owner the post-write re-check (settleHolds) finds verified NOW; it releases those it is given. */
  releasable: [] as string[],
  settleCalls: [] as string[][],
  /** Every path the route purged. */
  purged: [] as string[],
  alreadyRemoved: [] as string[],
  bumped: [] as Array<[string, number]>,
  /** How many open reports the in-transaction report.updateMany closes (delete only). */
  openReports: 0,
  /** What the post-commit reporter lookup returns; `null` = it throws. */
  resolvedRows: [] as Row[] | null,
  notified: [] as Array<[string, string, string]>,
  /** Report ids whose reporter notice throws. */
  notifyFails: [] as string[],
  /** Whether a call ran INSIDE the delete's transaction callback. */
  inTx: false,
}))

vi.mock('@/lib/admin', () => ({
  getAdmin: async () => 'mod@eno.vn',
  getCurrentProfile: async () => { throw new Error('admin must not resolve a profile') },
  getCurrentProfileId: async () => { throw new Error('admin must not resolve a profile id') },
}))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      updateMany: async (a: Row) => { h.calls.push({ m: 'updateMany', args: a }); return { count: h.counts.shift() ?? 0 } },
      updateManyAndReturn: async (a: Row) => { h.calls.push({ m: 'updateManyAndReturn', args: a }); return h.returns.shift() ?? [] },
      findMany: async (a: Row) => { h.calls.push({ m: 'findMany', args: a }); return h.before },
      deleteMany: async (a: Row) => { h.calls.push({ m: 'deleteMany', args: a }); return { count: 0 } },
    },
    report: {
      // Outside a transaction only the post-commit reporter lookup reads reports.
      findMany: async (a: Row) => { h.calls.push({ m: 'report.findMany', args: { ...a, inTx: h.inTx } }); if (h.resolvedRows === null) throw new Error('db down'); return h.resolvedRows },
      updateMany: async () => { throw new Error('report writes must run inside the transaction') },
    },
    // The callback form `delete` uses: the tombstones, their audit rows and the report closures commit together.
    $transaction: async (fn: (tx: unknown) => unknown, opts?: Row) => {
      h.calls.push({ m: '$transaction', args: opts ?? {} })
      const tx = { report: { updateMany: async (a: Row) => { h.calls.push({ m: 'tx.report.updateMany', args: { ...a, inTx: h.inTx } }); return { count: h.openReports } } } }
      h.inTx = true
      try { return await fn(tx) } finally { h.inTx = false }
    },
  },
}))
vi.mock('@/lib/dispute', () => ({
  notifyDispute: async (profileId: string, reportId: string, key: string) => {
    if (h.notifyFails.includes(reportId)) throw new Error('notify exploded')
    h.notified.push([profileId, reportId, key])
  },
}))
// ⛔ "delete" is a TOMBSTONE (src/lib/core/listing-tombstone.ts has its own tests): recorded here.
vi.mock('@/lib/core/listing-tombstone', () => ({
  tombstoneListingsTx: async (_tx: unknown, ids: string[], opts: Row) => {
    h.calls.push({ m: 'tombstone', args: { ids, ...opts, inTx: h.inTx } })
    // Like the real one, only rows not already removed come back — `h.alreadyRemoved` simulates those.
    return ids.filter((id) => !h.alreadyRemoved.includes(id)).map((id) => ({ id, brandSlug: id === 'a' ? 'apple' : null }))
  },
}))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({
  partitionByIdentityGate: async (ids: string[]) => ({ allowed: ids.filter((i) => !h.held.includes(i)), held: ids.filter((i) => h.held.includes(i)) }),
  // Like the real one: counts only among the ids it is GIVEN (it re-reads those rows).
  settleHolds: async (ids: string[]) => { h.settleCalls.push(ids); return ids.filter((i) => h.releasable.includes(i)).length },
}))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: (path: string) => { h.purged.push(path) } }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {} }))
vi.mock('@/lib/brand', () => ({ bumpBrandCount: async (slug: string, n: number) => { h.bumped.push([slug, n]) } }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ ok: true }) }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: () => {} }))

const { POST } = await import('./route')

async function post(body: unknown) {
  const res = await POST(new Request('https://eno.vn/api/admin/listings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never)
  return { status: res.status, text: await res.text() }
}
const updates = () => h.calls.filter((c) => c.m === 'updateMany').map((c) => c.args)
/** Every write in order, tagged with the method — the gated branches use both forms. */
const writes = () => h.calls.filter((c) => c.m.startsWith('updateMany')).map((c) => [c.m, c.args])

beforeEach(() => {
  h.notifyFails = []
  h.purged = []
  h.held = []
  h.calls = []
  h.counts = []
  h.returns = []
  h.before = []
  h.releasable = []
  h.settleCalls = []
})

describe('activate', () => {
  it('⛔ gate off (nobody held): one write, and the body is byte-for-byte the old one', async () => {
    h.counts = [2]
    const r = await post({ action: 'activate', ids: ['a', 'b'] })
    expect(r.text).toBe('{"ok":true,"affected":2}')
    expect(updates()).toEqual([{ where: { id: { in: ['a', 'b'] }, status: { not: 'removed' } }, data: { status: 'active' } }])
  })

  it('a refused owner: rows about to go public are PARKED; unverified or already-live rows are left un-held', async () => {
    h.held = ['b']
    h.counts = [1] // allowed
    h.returns = [[], [{ id: 'b' }]] // rest, parked
    const r = await post({ action: 'activate', ids: ['a', 'b'] })
    // `affected` excludes the parked row — the same meaning `verify` gives it.
    expect(r.text).toBe('{"ok":true,"affected":1,"held":1}')
    expect(h.settleCalls).toEqual([['b']])
    expect(writes()).toEqual([
      ['updateMany', { where: { id: { in: ['a'] }, status: { not: 'removed' } }, data: { status: 'active' } }],
      // Not public either way (unverified), or public already (active) — status only, no hold.
      ['updateManyAndReturn', { where: { id: { in: ['b'] }, OR: [{ verified: false }, { status: 'active' }], status: { not: 'removed' } }, data: { status: 'active' }, select: { verified: true, identityHold: true } }],
      // Verified and NOT yet active: activating would publish it → parked, and the ids come back.
      ['updateManyAndReturn', { where: { id: { in: ['b'] }, verified: true, status: { notIn: ['active', 'removed'] } }, data: { status: 'active', verified: false, identityHold: true }, select: { id: true } }],
    ])
  })

  it('a gated row that is merely unverified, or already live, counts as affected — as it would ungated', async () => {
    h.held = ['b', 'c']
    h.counts = [1]
    h.returns = [[{ verified: false, identityHold: false }, { verified: true, identityHold: false }], []]
    const r = await post({ action: 'activate', ids: ['a', 'b', 'c'] })
    expect(r.text).toBe('{"ok":true,"affected":3}')
    expect(h.settleCalls).toEqual([]) // nothing parked → nothing to re-check
  })
})

describe('activate — a row the gate had ALREADY parked before this request', () => {
  it('⛔ is neither activated nor held-now: reported as `alreadyHeld`, and never handed to the re-check', async () => {
    // 'b' was parked earlier (verified=false, identityHold=true); 'c' is parked by THIS request.
    h.held = ['b', 'c']
    h.counts = [1]
    h.returns = [[{ verified: false, identityHold: true }], [{ id: 'c' }]]
    const r = await post({ action: 'activate', ids: ['a', 'b', 'c'] })
    expect(r.text).toBe('{"ok":true,"affected":1,"held":1,"alreadyHeld":1}')
    expect(h.settleCalls).toEqual([['c']])
  })

  it('⛔ its owner verifying mid-request cannot cancel out a row parked here ("2 activated, 0 held")', async () => {
    // The old code re-checked the whole gated set: 'b' (another owner, verified meanwhile) was
    // counted as a release and subtracted from the one row actually parked, 'c', which then showed
    // up nowhere. Only 'c' reaches the re-check now, and its owner is still refused.
    h.held = ['b', 'c']
    h.counts = [1]
    h.returns = [[{ verified: false, identityHold: true }], [{ id: 'c' }]]
    h.releasable = ['b']
    const r = await post({ action: 'activate', ids: ['a', 'b', 'c'] })
    expect(r.text).toBe('{"ok":true,"affected":1,"held":1,"alreadyHeld":1}')
  })
})

describe('activate — a verification that raced the park', () => {
  it('a row the post-write re-check released counts as affected, not held', async () => {
    h.held = ['b']
    h.counts = [1] // allowed
    h.returns = [[], [{ id: 'b' }]] // rest, parked
    h.releasable = ['b']
    const r = await post({ action: 'activate', ids: ['a', 'b'] })
    expect(r.text).toBe('{"ok":true,"affected":2}')
  })

  it('⛔ gate off: the re-check is never called', async () => {
    h.counts = [2]
    await post({ action: 'activate', ids: ['a', 'b'] })
    expect(h.settleCalls).toEqual([])
  })
})

describe('verify ("Publish")', () => {
  it('⛔ gate off: one write, the old body', async () => {
    h.counts = [3]
    const r = await post({ action: 'verify', ids: ['a', 'b', 'c'] })
    expect(r.text).toBe('{"ok":true,"affected":3}')
    expect(updates()).toEqual([{ where: { id: { in: ['a', 'b', 'c'] }, status: { not: 'removed' } }, data: { verified: true, identityHold: false } }])
  })

  it('⛔ a publish for an owner the gate ALLOWS clears identityHold — a live row never carries a hold', async () => {
    // 'a' was parked while the gate refused its owner; the gate now allows them (switched off, or the
    // release missed). Publishing it with the hold still set left a LIVE row that the next takedown
    // forgetting the column, or a release, would mis-handle.
    h.counts = [1]
    await post({ action: 'verify', ids: ['a'] })
    expect(updates()).toEqual([{ where: { id: { in: ['a'] }, status: { not: 'removed' } }, data: { verified: true, identityHold: false } }])
    expect(h.settleCalls).toEqual([])
  })

  it('a refused owner: the unverified rows are HELD (identityHold), already-verified ones are left alone', async () => {
    h.held = ['b', 'c']
    h.counts = [1] // allowed
    h.before = [{ verified: false, identityHold: false }, { verified: true, identityHold: false }] // 'c' was already verified
    h.returns = [[{ id: 'b' }]] // parked
    const r = await post({ action: 'verify', ids: ['a', 'b', 'c'] })
    expect(r.text).toBe('{"ok":true,"affected":2,"held":1}')
    expect(h.settleCalls).toEqual([['b']])
    expect(writes()).toEqual([
      ['updateMany', { where: { id: { in: ['a'] }, status: { not: 'removed' } }, data: { verified: true, identityHold: false } }],
      ['updateManyAndReturn', { where: { id: { in: ['b', 'c'] }, verified: false, identityHold: false, status: { not: 'removed' } }, data: { identityHold: true }, select: { id: true } }],
    ])
  })

  it('⛔ a row ALREADY held before the request is not re-parked, not counted as held, not re-checked', async () => {
    // 'b' parked earlier; 'c' unverified → parked now; 'd' already verified. b's owner verified
    // meanwhile (releasable) — under the old code that release cancelled c's hold out of the count.
    h.held = ['b', 'c', 'd']
    h.counts = [1]
    h.before = [{ verified: false, identityHold: true }, { verified: false, identityHold: false }, { verified: true, identityHold: false }]
    h.returns = [[{ id: 'c' }]]
    h.releasable = ['b']
    const r = await post({ action: 'verify', ids: ['a', 'b', 'c', 'd'] })
    expect(r.text).toBe('{"ok":true,"affected":2,"held":1,"alreadyHeld":1}')
    expect(h.settleCalls).toEqual([['c']])
  })

  it('a row parked here and released by the re-check counts as published, not held', async () => {
    h.held = ['b']
    h.counts = [1]
    h.before = [{ verified: false, identityHold: false }]
    h.returns = [[{ id: 'b' }]]
    h.releasable = ['b']
    const r = await post({ action: 'verify', ids: ['a', 'b'] })
    expect(r.text).toBe('{"ok":true,"affected":2}')
  })
})

describe('unverify — a takedown', () => {
  it('⛔ clears identityHold too, or verifying would republish what the moderator pulled', async () => {
    h.counts = [1]
    await post({ action: 'unverify', ids: ['a'] })
    expect(updates()).toEqual([{ where: { id: { in: ['a'] }, status: { not: 'removed' } }, data: { verified: false, identityHold: false } }])
  })
})

describe('"delete" is a tombstone, never a hard delete (Law 122/2025 Art 17.1(e))', () => {
  it('tombstones the batch as THIS admin, counts only rows it removed, and never calls deleteMany', async () => {
    h.calls = []; h.alreadyRemoved = ['c']; h.bumped = []
    const r = await post({ action: 'delete', ids: ['a', 'b', 'c'] })
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text)).toEqual({ ok: true, affected: 2 })
    expect(h.calls.filter((c) => c.m === 'deleteMany')).toHaveLength(0)
    expect(h.calls.find((c) => c.m === 'tombstone')?.args).toMatchObject({ ids: ['a', 'b', 'c'], reason: 'admin_removed', actor: { kind: 'admin', email: 'mod@eno.vn' } })
    // Brand counts move only for rows this request actually removed.
    expect(h.bumped).toEqual([['apple', -1]])
    h.alreadyRemoved = []
  })
})

describe('⛔ "delete" closes the removed listings\' OPEN reports with them (2026-10-01 review)', () => {
  // The old deleteMany cascaded the reports, which is what took the cases out of the queue. Kept rows
  // left open sat in the moderation queue, held every later seller delete (targetSellerId) as a hide and
  // blocked the retention scrub — so they close in the SAME transaction, exactly as moderate 'reject' does.
  beforeEach(() => { h.calls = []; h.notified = []; h.openReports = 0; h.resolvedRows = []; h.alreadyRemoved = [] })

  it('resolves only the rows THIS request removed, as confirmed by this admin (labelled a removal closure), inside the tombstone transaction', async () => {
    h.alreadyRemoved = ['c']
    h.openReports = 2
    h.resolvedRows = [{ id: 'r1', reporterProfileId: 'p1' }, { id: 'r2', reporterProfileId: null }]
    const r = await post({ action: 'delete', ids: ['a', 'b', 'c'] })
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text)).toEqual({ ok: true, affected: 2, resolved: 2 })
    const upd = h.calls.find((c) => c.m === 'tx.report.updateMany')!.args
    expect(upd.inTx).toBe(true)
    expect(upd.where).toEqual({ listingId: { in: ['a', 'b'] }, status: 'open' })
    // `listing-removed:<admin>` — the uncharged-confirm label (trust-math.ts), still naming this admin.
    expect(upd.data).toMatchObject({ status: 'confirmed', resolvedBy: 'listing-removed:mod@eno.vn' })
    expect(upd.data.resolvedAt).toBeInstanceOf(Date)
    // ⚠️ No trust charge rides the decision: the status write is all there is.
    expect(Object.keys(upd.data).sort()).toEqual(['resolvedAt', 'resolvedBy', 'status'])
    // The tombstones were written in the same transaction, before the closures.
    const order = h.calls.map((c) => c.m)
    expect(order.indexOf('tombstone')).toBeLessThan(order.indexOf('tx.report.updateMany'))
    expect(h.calls.find((c) => c.m === 'tombstone')!.args.inTx).toBe(true)
  })

  it('tells each reporter whose case THIS request closed — matched by the resolve stamp — and skips anonymous ones', async () => {
    h.openReports = 2
    h.resolvedRows = [{ id: 'r1', reporterProfileId: 'p1' }, { id: 'r2', reporterProfileId: null }]
    await post({ action: 'delete', ids: ['a', 'b'] })
    const read = h.calls.find((c) => c.m === 'report.findMany')!.args
    const upd = h.calls.find((c) => c.m === 'tx.report.updateMany')!.args
    expect(read.inTx).toBe(false)
    expect(read.where).toEqual({ listingId: { in: ['a', 'b'] }, status: 'confirmed', resolvedBy: 'listing-removed:mod@eno.vn', resolvedAt: upd.data.resolvedAt })
    expect(h.notified).toEqual([['p1', 'r1', 'decided_upheld_reporter']])
  })

  it('one reporter\'s failed notice does not abandon the others (per-reporter best effort)', async () => {
    h.openReports = 3
    h.resolvedRows = [{ id: 'r1', reporterProfileId: 'p1' }, { id: 'r2', reporterProfileId: 'p2' }, { id: 'r3', reporterProfileId: 'p3' }]
    h.notifyFails = ['r1']
    const r = await post({ action: 'delete', ids: ['a', 'b'] })
    expect(r.status).toBe(200)
    expect(h.notified).toEqual([['p2', 'r2', 'decided_upheld_reporter'], ['p3', 'r3', 'decided_upheld_reporter']])
  })

  it('no open report → no lookup, no notice, and the body is exactly what it always was', async () => {
    const r = await post({ action: 'delete', ids: ['a'] })
    expect(JSON.parse(r.text)).toEqual({ ok: true, affected: 1 })
    expect(h.calls.filter((c) => c.m === 'report.findMany')).toHaveLength(0)
    expect(h.notified).toEqual([])
  })

  it('nothing removed (all already tombstones) → their reports are left exactly as they are', async () => {
    h.alreadyRemoved = ['a', 'b']
    h.openReports = 5
    const r = await post({ action: 'delete', ids: ['a', 'b'] })
    expect(JSON.parse(r.text)).toEqual({ ok: true, affected: 0 })
    expect(h.calls.filter((c) => c.m === 'tx.report.updateMany')).toHaveLength(0)
  })

  it('a failed reporter notice never fails the removal (the decision has landed)', async () => {
    h.openReports = 1
    h.resolvedRows = null
    const r = await post({ action: 'delete', ids: ['a'] })
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text)).toEqual({ ok: true, affected: 1, resolved: 1 })
  })

  it('the other actions never touch reports', async () => {
    for (const action of ['hide', 'activate', 'feature', 'unfeature', 'verify', 'unverify']) {
      h.calls = []; h.held = []; h.counts = [1]; h.returns = []
      await post({ action, ids: ['a'] })
      expect(h.calls.filter((c) => c.m.includes('report')), action).toHaveLength(0)
    }
  })
})

describe('⛔ a TOMBSTONE is not actionable from the console (2026-10-01 review)', () => {
  // "Hide" used to turn a removed row into the seller's 'hidden' (relistable, back in their dashboard);
  // "Activate" + "Publish" republished a moderator's removal — with no audit row either way.
  it.each(['hide', 'activate', 'feature', 'unfeature', 'verify', 'unverify'])('%s: every write and every read it counts excludes removed rows', async (action) => {
    h.held = action === 'activate' || action === 'verify' ? ['b'] : []
    h.counts = [1]
    h.returns = [[], []]
    await post({ action, ids: ['a', 'b'] })
    const touched = h.calls.filter((c) => c.m === 'updateMany' || c.m === 'updateManyAndReturn' || c.m === 'findMany')
    expect(touched.length).toBeGreaterThan(0)
    for (const c of touched) {
      const st = c.args.where.status
      // Either `not: 'removed'` or a notIn list that names it — never an unguarded write.
      expect(st?.not === 'removed' || (Array.isArray(st?.notIn) && st.notIn.includes('removed')), `${action} ${c.m} ${JSON.stringify(c.args.where)}`).toBe(true)
    }
  })

  it('"delete" (remove) stays the tombstone writer, which skips already-removed rows itself', async () => {
    h.alreadyRemoved = ['a']
    const r = await post({ action: 'delete', ids: ['a', 'b'] })
    expect(JSON.parse(r.text)).toEqual({ ok: true, affected: 1 })
    h.alreadyRemoved = []
  })
})

describe('takedowns purge each listing\'s own page (audit #2)', () => {
  it('⛔ a bulk hide / unverify / delete purges /listings/<id> for every id, not only "/"', async () => {
    for (const action of ['hide', 'unverify', 'delete']) {
      h.purged = []; h.calls = []; h.counts = []; h.returns = []
      const r = await post({ action, ids: ['a', 'b'] })
      expect(r.status, `${action}: ${r.text}`).toBe(200)
      expect(h.purged).toEqual(expect.arrayContaining(['/', '/listings/a', '/listings/b']))
    }
  })
})

