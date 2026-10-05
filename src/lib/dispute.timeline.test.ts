import { describe, expect, it, vi } from 'vitest'

// ── disputeTimeline × the content pointer (App Store gate `ugc-safety`, plan R5) ─────────────────────
// A review / help-reply / help-post report names its content in a SYSTEM row that starts with a
// `[[reported <kind> <id>]]` token (src/lib/reported-content-pointer.ts). The token is for the server;
// both case rooms render the timeline's `body`, so it must arrive already stripped.

const rows = [
  { id: 'm1', senderRole: 'system', body: '[[reported review cmreview0000001]] Review on “Shop”, 1/5, by Lan: “bad”', images: null, createdAt: new Date('2026-10-05T01:00:00Z') },
  { id: 'm2', senderRole: 'system', body: 'Evidence window extended until 2026-10-08T00:00:00.000Z', images: null, createdAt: new Date('2026-10-05T02:00:00Z') },
  // A party typing the token is just text — only a system row is a pointer.
  { id: 'm3', senderRole: 'reporter', body: '[[reported review cmreview0000001]] see above', images: null, createdAt: new Date('2026-10-05T03:00:00Z') },
]
vi.mock('@/lib/db', () => ({ db: { disputeMessage: { findMany: async () => rows } } }))
vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin: () => { throw new Error('no storage') }, EVIDENCE_BUCKET: 'evidence' }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: async () => 0 }))

const { disputeTimeline } = await import('./dispute')

describe('disputeTimeline', () => {
  const report = { id: 'case-1', detail: null, createdAt: new Date('2026-10-05T00:00:00Z'), status: 'open', resolvedAt: null } as never

  it('a MODERATOR reads a content case\'s pointer row as its description, and nothing else changes', async () => {
    const items = await disputeTimeline(report, { audience: 'admin' })
    expect(items.map((i) => [i.id, i.kind, i.body])).toEqual([
      ['m1', 'system', 'Review on “Shop”, 1/5, by Lan: “bad”'],
      ['m2', 'system', 'Evidence window extended until 2026-10-08T00:00:00.000Z'],
      ['m3', 'message', '[[reported review cmreview0000001]] see above'],
    ])
  })

  it('a PARTY (the default) gets only the kind of content — the reported text can carry what eno.vn must not show', async () => {
    const items = await disputeTimeline(report)
    expect(items.map((i) => [i.id, i.body, i.about])).toEqual([
      ['m1', '', 'review'],
      ['m2', 'Evidence window extended until 2026-10-08T00:00:00.000Z', undefined],
      // A person's message is never a pointer, whatever it starts with.
      ['m3', '[[reported review cmreview0000001]] see above', undefined],
    ])
    // The admin room never gets the marker; it reads the description.
    expect((await disputeTimeline(report, { audience: 'admin' })).some((i) => 'about' in i)).toBe(false)
  })
})
