import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/disputes/[id] — a CONTENT case (App Store gate `ugc-safety`, plan R5: a report on a review or a
 * Help-centre reply/post) has no respondent, so the payload says so (`contentCase: true`) and the case page
 * stops promising the reporter "the other side" a reply. Known by its POINTER ROW (the timeline's `about`),
 * not by empty target columns, and not gated: a case filed while the gate was on keeps its copy if the gate
 * goes off. Every other case gets the payload exactly as before, with no such key.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ report: {} as Row, timeline: [] as Row[] }))

vi.mock('@/lib/db', () => ({ db: { listing: { findUnique: async () => null } } }))
vi.mock('@/lib/admin', () => ({
  getAdmin: async () => null,
  getCurrentProfile: async () => { throw new Error('userId mode must not load a Profile') },
  getCurrentProfileId: async () => 'rep1',
}))
vi.mock('@/lib/dispute', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadDisputeForParty: async () => ({ report: h.report, role: 'reporter' }),
  partyHasSubmitted: async () => false,
  counterpartyName: async () => null,
  disputeTimeline: async () => h.timeline,
}))
vi.mock('@/lib/log', () => ({ logError: () => {}, logWarn: () => {}, logInfo: () => {} }))

const { GET } = await import('./route')

const BASE = {
  id: 'r1', reason: 'offensive', status: 'open', reporterProfileId: 'rep1',
  targetProfileId: null, targetSellerId: null, listingId: null, conversationId: null,
  evidenceUntil: new Date(Date.now() + 3600_000), createdAt: new Date('2026-10-05T00:00:00Z'),
  resolvedAt: null, resolvedBy: null, decisionNote: null, appealedAt: null,
}

async function get() {
  const res = await GET(new Request('https://www.eno.forum/api/disputes/r1'), { params: Promise.resolve({ id: 'r1' }) })
  return (await res.json()) as Row
}

const POINTER = { id: 'm1', kind: 'system', role: 'system', body: '', images: [], at: '2026-10-05T00:00:00.000Z', about: 'review' }
beforeEach(() => { h.report = { ...BASE }; h.timeline = [POINTER] })
afterEach(() => vi.unstubAllEnvs())

describe('contentCase', () => {
  it('gate ON: a case with a content pointer is a content case', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    expect((await get()).contentCase).toBe(true)
  })

  it('a case with no target but NO pointer row is not (empty columns alone prove nothing)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.timeline = []
    expect('contentCase' in (await get())).toBe(false)
  })

  it('gate ON: a chat, person, shop or listing case is not — and carries no such key', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.timeline = [{ ...POINTER, about: undefined, body: 'Evidence window extended' }]
    for (const t of [{ conversationId: 'c1', targetProfileId: 'p1' }, { targetProfileId: 'p1' }, { targetSellerId: 's1' }, { listingId: 'l1', targetSellerId: 's1' }]) {
      h.report = { ...BASE, ...t }
      expect('contentCase' in (await get())).toBe(false)
    }
  })

  it('gate OFF: a content case filed earlier keeps it; every other case still carries no key', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect((await get()).contentCase).toBe(true)
    h.report = { ...BASE, conversationId: 'c1', targetProfileId: 'p1' }
    h.timeline = []
    expect('contentCase' in (await get())).toBe(false)
  })
})
