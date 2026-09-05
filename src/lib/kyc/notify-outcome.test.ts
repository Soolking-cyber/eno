import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  s: {
    profile: { email: 'anna@example.com', locale: 'en' } as { email: string | null; locale: string | null } | null,
    bells: [] as Record<string, unknown>[],
    bellFails: false,
    pushes: [] as { id: string; payload: Record<string, unknown> }[],
    pushFails: false,
    mails: [] as { to: string; subject: string; html: string; text: string }[],
  },
}))

vi.mock('@/lib/db', () => ({
  db: {
    profile: { findUnique: async () => h.s.profile },
    notification: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (h.s.bellFails) throw new Error('bell down')
        h.s.bells.push(data)
        return { id: 'n1' }
      },
    },
  },
}))
vi.mock('@/lib/edition', () => ({ SITE_NAME: 'eno.forum' }))
vi.mock('@/lib/mail', () => ({
  sendMail: async (m: { to: string; subject: string; html: string; text: string }) => { h.s.mails.push(m); return true },
}))
vi.mock('@/lib/push', () => ({
  sendPushToProfile: async (id: string, payload: Record<string, unknown>) => {
    if (h.s.pushFails) throw new Error('push down')
    h.s.pushes.push({ id, payload })
    return 1
  },
}))
// ⚠️ OUTSIDE A REQUEST SCOPE `after()` throws and the notifier awaits the delivery inline — which is
// exactly the path a unit test exercises. Make it throw, as the real one does here.
vi.mock('next/server', () => ({ after: () => { throw new Error('no request scope') } }))

const { notifyIdentityOutcome } = await import('./notify-outcome')

beforeEach(() => {
  h.s.profile = { email: 'anna@example.com', locale: 'en' }
  h.s.bells = []; h.s.bellFails = false
  h.s.pushes = []; h.s.pushFails = false
  h.s.mails = []
})

describe('notifyIdentityOutcome', () => {
  it('approved: bell + push + email, all pointing at the hub', async () => {
    await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'B' })
    expect(h.s.bells[0]).toMatchObject({ recipientId: 'p1', type: 'system', url: '/dashboard/verification', title: 'Your identity is verified' })
    expect(h.s.pushes[0].payload).toMatchObject({ url: '/dashboard/verification', tag: 'identity-p1' })
    expect(h.s.mails[0].to).toBe('anna@example.com')
    expect(h.s.mails[0].subject).toBe('Your identity is verified on eno.forum')
  })

  it('rejected: the bell carries the note, the PUSH does not, the email does', async () => {
    await notifyIdentityOutcome('p1', 'rejected', { reason: 'manual', note: 'Name on passport differs from account', tier: 'B' })
    expect(h.s.bells[0].body).toBe('Name on passport differs from account')
    expect(JSON.stringify(h.s.pushes[0].payload)).not.toContain('differs')
    expect(h.s.pushes[0].payload.body).toBe('Open verification to see why.')
    expect(h.s.mails[0].text).toContain('Name on passport differs from account')
  })

  it('a long note is cut on a word boundary with an ellipsis in the bell, whole in the email', async () => {
    const note = ('Name on the passport differs from the account ').repeat(6).trim()
    await notifyIdentityOutcome('p1', 'rejected', { reason: 'manual', note, tier: 'B' })
    const bell = h.s.bells[0].body as string
    expect(bell.length).toBeLessThanOrEqual(140)
    expect(bell.endsWith('…')).toBe(true)
    expect(bell.slice(0, -1).endsWith(' ')).toBe(false)
    expect(h.s.mails[0].text).toContain(note)
  })

  it('speaks Vietnamese to a vi locale', async () => {
    h.s.profile = { email: 'a@b.c', locale: 'vi-VN' }
    await notifyIdentityOutcome('p1', 'rejected', { reason: 'document_expires_soon', note: null, tier: 'B' })
    expect(h.s.bells[0].title).toBe('Xác minh danh tính chưa được chấp nhận')
    expect(h.s.mails[0].text).toContain('sáu tháng')
  })

  it('no stored locale: a CCCD holder is spoken to in Vietnamese, a passport holder in English', async () => {
    h.s.profile = { email: 'a@b.c', locale: null }
    await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'A' })
    expect(h.s.bells[0].title).toBe('Danh tính đã được xác minh')
    h.s.bells = []
    await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'B' })
    expect(h.s.bells[0].title).toBe('Your identity is verified')
  })

  it('⚠️ three independent channels: a dead bell or push never costs the email', async () => {
    h.s.bellFails = true; h.s.pushFails = true
    await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'B' })
    expect(h.s.bells).toEqual([])
    expect(h.s.mails).toHaveLength(1)
  })

  it('no email on file: bell and push still go, nothing is thrown', async () => {
    h.s.profile = { email: null, locale: null }
    await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'B' })
    expect(h.s.bells).toHaveLength(1)
    expect(h.s.pushes).toHaveLength(1)
    expect(h.s.mails).toEqual([])
  })
})
