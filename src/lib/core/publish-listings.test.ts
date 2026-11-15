import { beforeEach, describe, expect, it, vi } from 'vitest'
import { licenceClearedWhere } from '@/lib/licence-stamp'
import { NOT_A_REVIEW_SEATS_LISTING } from '@/lib/review-seat-accounts'
import { NOT_PHOTO_HELD } from '@/lib/listing-photo-hold'

// publishListings (core/publish-listings.ts, moved out of api/admin/listings 2026-11-15): the photo hold's half. An admin
// Publish leaves photo-held rows out and counts them; the photo release is the one call that publishes such a row — only
// while it carries the mark — and its park drops the mark (A11). The route's own tests pin the rest (route.test.ts,
// route.licence.test.ts), the in-memory release flow listing-photo-pass.test.ts.

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  calls: [] as Array<{ m: string; args: Row }>,
  photoHeld: [] as string[],
  idHeld: [] as string[],
  counts: [] as number[],
  returns: [] as Row[][],
  passSoon: [] as string[][],
}))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      updateMany: async (a: Row) => { h.calls.push({ m: 'updateMany', args: a }); return { count: h.counts.shift() ?? 0 } },
      updateManyAndReturn: async (a: Row) => { h.calls.push({ m: 'updateManyAndReturn', args: a }); return h.returns.shift() ?? [] },
      findMany: async (a: Row) => { h.calls.push({ m: 'findMany', args: a }); return [{ verified: false, identityHold: false }] },
    },
    $queryRaw: async (q: TemplateStringsArray, ...v: unknown[]) => { h.calls.push({ m: 'queryRaw', args: { sql: q.join('?'), v } }); return [] },
    $transaction: async (fn: (tx: unknown) => unknown) => { h.calls.push({ m: 'tx', args: {} }); return fn((await import('@/lib/db')).db) },
  },
}))
vi.mock('@/lib/core/licence-check', () => ({ licenceBlockedIds: async () => new Set() }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({
  partitionByIdentityGate: async (ids: string[]) => { h.calls.push({ m: 'partition', args: { ids } }); return { allowed: ids.filter((i) => !h.idHeld.includes(i)), held: ids.filter((i) => h.idHeld.includes(i)) } },
  settleHolds: async () => 0,
}))
vi.mock('@/lib/listing-photo-hooks', () => ({
  photoHeldIds: async (ids: string[]) => { h.calls.push({ m: 'photoHeldIds', args: { ids } }); return new Set(ids.filter((i) => h.photoHeld.includes(i))) },
  photoPassSoon: (ids: string[]) => { h.passSoon.push(ids) },
}))

const { publishListings } = await import('./publish-listings')
const GUARD = licenceClearedWhere(['desk'])
const ONLY = { reports: { none: { status: { in: ['open', 'confirmed'] } } } }
const writes = () => h.calls.filter((c) => c.m.startsWith('updateMany'))

beforeEach(() => { h.calls = []; h.photoHeld = []; h.idHeld = []; h.counts = []; h.returns = []; h.passSoon = [] })

describe('publishListings — the photo hold', () => {
  it('⛔ an admin Publish leaves photo-held rows out (neither published nor parked), counts them, and both writes AND the guard', async () => {
    h.photoHeld = ['b']
    h.idHeld = ['c']
    h.counts = [1]
    h.returns = [[{ id: 'c' }]]
    const r = await publishListings(['a', 'b', 'c'], ['desk'])
    expect(r).toEqual({ affected: 1, held: 1, alreadyHeld: 0, licenceCheck: 0, photoCheck: 1 })
    expect(h.calls.find((c) => c.m === 'partition')!.args.ids).toEqual(['a', 'c'])
    expect(writes().map((w) => w.args.where.AND)).toEqual([[GUARD, NOT_A_REVIEW_SEATS_LISTING, NOT_PHOTO_HELD], [GUARD, NOT_A_REVIEW_SEATS_LISTING, NOT_PHOTO_HELD]])
    expect(writes()[1].args.data).toEqual({ identityHold: true })
    // What went out goes through the photo pass.
    expect(h.passSoon).toEqual([['a', 'c']])
  })

  it('⛔ the photo release publishes only a row still carrying the mark, with its conditions, and never asks the pass again', async () => {
    h.counts = [1]
    const r = await publishListings(['a'], ['desk'], { photoRelease: true, onlyIf: ONLY })
    expect(r).toMatchObject({ affected: 1, photoCheck: 0 })
    expect(h.calls.some((c) => c.m === 'photoHeldIds')).toBe(false)
    expect(writes()[0].args).toEqual({
      where: { id: { in: ['a'] }, status: { not: 'removed' }, AND: [GUARD, NOT_A_REVIEW_SEATS_LISTING, { verificationNotes: 'photo:held' }, ONLY] },
      data: { verified: true, identityHold: false, verificationNotes: null },
    })
    expect(h.passSoon).toEqual([])
  })

  it('⛔ the release locks its owners\' Profile rows FOR SHARE in the transaction, before the publish (an enforcement hold waits)', async () => {
    h.counts = [1]
    await publishListings(['a'], ['desk'], { photoRelease: true, onlyIf: ONLY })
    expect(h.calls.map((c) => c.m).filter((m) => ['tx', 'queryRaw', 'updateMany'].includes(m))).toEqual(['tx', 'queryRaw', 'updateMany'])
    const lock = h.calls.find((c) => c.m === 'queryRaw')!.args
    expect(lock.sql).toMatch(/FROM "Profile".*FOR SHARE OF p/)
    expect(lock.v).toEqual([['a']])
    // An admin Publish takes no lock.
    h.calls = []; h.counts = [1]
    await publishListings(['a'], ['desk'])
    expect(h.calls.some((c) => c.m === 'tx' || c.m === 'queryRaw')).toBe(false)
  })

  it('⛔ A11: a release the identity gate parks drops the photo mark in the park write — the gate owns the row from then', async () => {
    h.idHeld = ['a']
    h.returns = [[{ id: 'a' }]]
    const r = await publishListings(['a'], ['desk'], { photoRelease: true, onlyIf: ONLY })
    expect(r).toMatchObject({ affected: 0, held: 1 })
    expect(writes()[0].args.where.AND).toEqual([GUARD, NOT_A_REVIEW_SEATS_LISTING, { verificationNotes: 'photo:held' }, ONLY])
    expect(writes()[0].args.data).toEqual({ identityHold: true, verificationNotes: null })
  })
})
