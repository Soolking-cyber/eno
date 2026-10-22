import { beforeEach, describe, expect, it, vi } from 'vitest'

// A party's statement CLAIMS the evidence it attaches (security review 2026-10-22, item 11): the uploads' pending
// tombstones are cleared once the DisputeMessage holds them, so the sweep never weighs them. A second statement from the
// same party is refused (one-shot) and claims nothing; a statement with no images claims nothing.

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({ existing: false, created: [] as Row[], cleared: [] as Row[][] }))

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('./push', () => ({ sendPushToProfile: async () => {} }))
vi.mock('@/lib/core/storage-tombstones', () => ({ clearTombstones: async (refs: Row[]) => { h.cleared.push(refs); return refs.length } }))
vi.mock('./db', () => {
  const tx = {
    $executeRaw: async () => 1,
    disputeMessage: {
      findFirst: async () => (h.existing ? { id: 'm0' } : null),
      create: async ({ data }: { data: Row }) => { h.created.push(data); return { id: 'm1', createdAt: new Date() } },
    },
    report: { update: async () => ({}) },
  }
  return { db: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx), seller: { findUnique: async () => null } } }
})

const { addPartyStatementOnce } = await import('./dispute')
const REPORT = { id: 'case-1', reporterProfileId: null, targetProfileId: null, targetSellerId: null }
const PATHS = ['disputes/case-1/1.webp', 'disputes/case-1/2.webp']

beforeEach(() => { h.existing = false; h.created = []; h.cleared = [] })

describe('addPartyStatementOnce — attaching evidence claims it', () => {
  it('clears the tombstones of exactly the images the statement holds', async () => {
    expect(await addPartyStatementOnce(REPORT, { senderProfileId: 'p1', senderRole: 'reporter', body: 'Here is the receipt', images: PATHS })).toMatchObject({ id: 'm1' })
    expect(h.cleared).toEqual([PATHS.map((path) => ({ bucket: 'evidence', path }))])
  })

  it('a refused second statement claims nothing; a statement without images claims nothing', async () => {
    h.existing = true
    expect(await addPartyStatementOnce(REPORT, { senderProfileId: 'p1', senderRole: 'reporter', body: 'again', images: PATHS })).toBeNull()
    h.existing = false
    await addPartyStatementOnce(REPORT, { senderProfileId: 'p2', senderRole: 'respondent', body: 'No images' })
    expect(h.cleared).toEqual([])
  })
})
