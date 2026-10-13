import { beforeEach, describe, expect, it, vi } from 'vitest'
// The REAL badge test decides "business verified" — a seller fixture either passes isBusinessVerified or it does not.
import { sellerIdentityHash } from '@/lib/business-verification'

// The chip a teacher sees about who is writing (DM ladder, owner 2026-10-13): the PUBLIC verification facts, never the
// DM rung. The identity status and the profile row are fakes; the badge predicate is real.
const h = vi.hoisted(() => ({
  identity: 'unverified' as string,
  profile: null as null | { accountType: string | null; seller: Record<string, unknown> | null },
  reads: [] as string[],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/compliance/recompute-verification', () => ({ verificationStatusForDecision: async () => h.identity }))
vi.mock('@/lib/db', () => ({ db: { profile: { findUnique: async ({ where }: { where: { id: string } }) => { h.reads.push(where.id); return h.profile } } } }))

const { writerVerified } = await import('./writer-verified')

const DAY_MS = 86_400_000
const IDENT = { name: 'Saigon English Centre', legalName: 'CONG TY TNHH SAIGON ENGLISH CENTRE', legalAddress: '12 Le Loi, Ben Nghe, Quan 1', idNumber: null, taxCode: '0312345678' }
/** A seller whose public "Business verified" badge is live: stamped hash = live hash, window open, tax registry verified. */
const liveBadge = (over: Record<string, unknown> = {}) => ({
  ...IDENT, taxCheckedAt: new Date(), taxRegisteredName: IDENT.legalName, taxActive: true,
  verifiedIdentityHash: sellerIdentityHash(IDENT), verifiedUntil: new Date(Date.now() + 90 * DAY_MS), ...over,
})

beforeEach(() => { h.identity = 'unverified'; h.profile = { accountType: 'individual', seller: null }; h.reads = [] })

describe('writerVerified — what the teacher is shown about the writer', () => {
  it('⛔ a business whose PUBLIC badge is live reads "business" even when the owner\'s own identity check lapsed or never was (pre-review, 2026-10-13)', async () => {
    h.profile = { accountType: 'business', seller: liveBadge() }
    for (const identity of ['unverified', 'expired', 'pending', 'verified']) {
      h.identity = identity
      expect(await writerVerified('p1'), identity).toBe('business')
    }
  })

  it('the badge is the storefront\'s predicate: a business account AND a live badge — an expired badge or a personal account is not', async () => {
    h.identity = 'verified'
    h.profile = { accountType: 'business', seller: liveBadge({ verifiedUntil: new Date(Date.now() - DAY_MS) }) }
    expect(await writerVerified('p1')).toBe('identity')
    h.profile = { accountType: 'individual', seller: liveBadge() }
    expect(await writerVerified('p1')).toBe('identity')
  })

  it('identity verified without a badge reads "identity"; anything else "unverified"', async () => {
    h.identity = 'verified'
    expect(await writerVerified('p1')).toBe('identity')
    for (const identity of ['unverified', 'pending', 'expired', 'rejected']) {
      h.identity = identity
      expect(await writerVerified('p1'), identity).toBe('unverified')
    }
  })

  it('⛔ a revoked identity reads "unverified", badge or not — and the profile is not even read', async () => {
    h.identity = 'revoked'
    h.profile = { accountType: 'business', seller: liveBadge() }
    expect(await writerVerified('p1')).toBe('unverified')
    expect(h.reads).toEqual([])
  })
})
