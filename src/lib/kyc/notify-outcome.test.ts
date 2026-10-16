import { describe, it, expect, beforeEach, vi } from 'vitest'

type Tp = { fullName: string; identityMarkOn: boolean; identityMarkWithdrawnAt: Date | null; status?: string; listing?: { status: string; verified: boolean } | null }
const h = vi.hoisted(() => ({
  s: {
    profile: { email: 'anna@example.com', locale: 'en' } as { email: string | null; locale: string | null; teacherProfile?: Tp | null } | null,
    // "Identity verified" (src/lib/teachers/identity-mark.ts identityMarkState): its answer, a failure, and its calls.
    markState: { shown: false, reason: 'unverified' } as { shown: boolean; reason: string | null },
    markThrows: false,
    markCalls: [] as unknown[],
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
// The whole edition surface, not just SITE_NAME: the email layout reads IS_MARKETPLACE and
// site-legal.ts reads EDITION at module scope to pick the footer's operator.
vi.mock('@/lib/edition', () => ({ SITE_NAME: 'eno.forum', IS_SERVICES: true, IS_MARKETPLACE: false, EDITION: 'services' }))
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
vi.mock('@/lib/teachers/identity-mark', () => ({
  identityMarkState: async (m: unknown) => {
    h.s.markCalls.push(m)
    if (h.s.markThrows) throw new Error('identity read down')
    return h.s.markState
  },
}))

const { notifyIdentityOutcome, teacherMarkLine } = await import('./notify-outcome')

beforeEach(() => {
  h.s.profile = { email: 'anna@example.com', locale: 'en' }
  h.s.bells = []; h.s.bellFails = false
  h.s.pushes = []; h.s.pushFails = false
  h.s.mails = []
  h.s.markState = { shown: false, reason: 'unverified' }; h.s.markThrows = false; h.s.markCalls = []
})

describe('notifyIdentityOutcome', () => {
  it('approved: bell + push + email, all pointing at the hub', async () => {
    await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'B' })
    expect(h.s.bells[0]).toMatchObject({ recipientId: 'p1', type: 'verification', url: '/dashboard/verification', title: 'Your identity is verified' })
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

/**
 * ⚖️ A TEACHER'S APPROVAL TELLS THEM ABOUT "IDENTITY VERIFIED" (owner, 2026-10-15; AUTOMATIC since 2026-10-16): the bell,
 * the push and the email say — in ONE sentence (the email module's teacherMarkSentence) — that the mark now shows and can
 * be hidden, that the teacher HID it and can show it again, or that the NAME holds it back ("see why") — from the very
 * reason the form shows (teacherMarkLine) — and every one leads to the switch (/teachers/edit?step=finish), never the
 * verify flow. Never "switch it on": there is nothing to opt into. A failed read, an identity-side reason or no profile
 * says nothing about the mark. A refusal, and every account without a teacher profile, is unchanged.
 */
describe('notifyIdentityOutcome — a teacher\'s approval', () => {
  /** Never touched: the automatic default — not hidden. */
  const TP: Tp = { fullName: 'Anna Eriksson', identityMarkOn: false, identityMarkWithdrawnAt: null, status: 'live', listing: { status: 'active', verified: true } }
  const HID = new Date('2026-10-12T02:00:00.000Z')
  const URL = '/teachers/edit?step=finish'
  const NOW_EN = '“Identity verified” now shows on your teacher profile. You can hide it there at any time.'
  const NOW_VI = 'Nhãn “Đã xác minh danh tính” đã hiển thị trên hồ sơ giáo viên của bạn. Bạn có thể ẩn nhãn này trong hồ sơ bất cứ lúc nào.'
  const CAN_EN = 'You have hidden “Identity verified” on your teacher profile — you can show it again there.'
  const CAN_VI = 'Bạn đã ẩn nhãn “Đã xác minh danh tính” trên hồ sơ giáo viên — bạn có thể hiển thị lại trong hồ sơ.'
  const NOT_YET_EN = '“Identity verified” is not showing on your teacher profile yet — see why in Photo & publish.'
  const NOT_YET_VI = 'Nhãn “Đã xác minh danh tính” chưa hiển thị trên hồ sơ giáo viên của bạn — xem lý do trong bước Ảnh & đăng.'

  it('⛔ the mark shows (automatically): "now shows … You can hide it there at any time." — bell, push and email, all to the switch', async () => {
    h.s.profile = { email: 'anna@example.com', locale: 'en', teacherProfile: TP }
    h.s.markState = { shown: true, reason: null }
    await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'B' })
    expect(h.s.bells[0]).toMatchObject({ title: 'Your identity is verified', body: NOW_EN, url: URL })
    expect(h.s.pushes[0].payload).toMatchObject({ body: NOW_EN, url: URL })
    expect(h.s.mails[0].text).toContain(NOW_EN)
    expect(h.s.mails[0].html).toContain('https://eno.forum/teachers/edit?step=finish')
    // The predicate is asked about THIS account's teacher profile, with its own inputs — the name and the hide.
    expect(h.s.markCalls).toEqual([{ profileId: 'p1', fullName: 'Anna Eriksson', identityMarkOn: false, identityMarkWithdrawnAt: null }])
  })

  it('⛔ "now shows" never for a profile the public cannot see (hidden, or not in the feed): the plain approval and the hub', async () => {
    for (const tp of [{ ...TP, status: 'hidden' }, { ...TP, listing: { status: 'hidden', verified: true } }, { ...TP, listing: { status: 'active', verified: false } }, { ...TP, listing: null }]) {
      h.s.bells.length = 0; h.s.pushes.length = 0; h.s.mails.length = 0
      h.s.profile = { email: 'anna@example.com', locale: 'en', teacherProfile: tp }
      h.s.markState = { shown: true, reason: null }
      await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'B' })
      expect(h.s.bells[0], JSON.stringify(tp)).toMatchObject({ body: 'You will not be asked to do this again unless your document expires or is replaced.', url: '/dashboard/verification' })
      expect(h.s.mails[0].text).not.toContain(NOW_EN)
    }
  })

  it('HIDDEN by the teacher: "You have hidden … — you can show it again there." — the same three, the same link', async () => {
    h.s.profile = { email: 'anna@example.com', locale: 'en', teacherProfile: { ...TP, identityMarkWithdrawnAt: HID } }
    h.s.markState = { shown: false, reason: 'hidden' }
    await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'B' })
    expect(h.s.bells[0]).toMatchObject({ body: CAN_EN, url: URL })
    expect(h.s.pushes[0].payload).toMatchObject({ body: CAN_EN, url: URL })
    expect(h.s.mails[0].text).toContain(CAN_EN)
    expect(h.s.markCalls).toEqual([{ profileId: 'p1', fullName: 'Anna Eriksson', identityMarkOn: false, identityMarkWithdrawnAt: HID }])
  })

  // Commit gate, 2026-10-16: the NAME holds the mark back (not within the ID) — no switch can fix that.
  it('the NAME holds it back: "not showing … yet — see why in Photo & publish" — never "switch it on", never "you have hidden"', async () => {
    for (const [tp, reason] of [[TP, 'name_mismatch'], [{ ...TP, identityMarkWithdrawnAt: HID }, 'no_name']] as const) {
      h.s.bells = []; h.s.pushes = []; h.s.mails = []
      h.s.profile = { email: 'anna@example.com', locale: 'en', teacherProfile: tp }
      h.s.markState = { shown: false, reason }
      await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'B' })
      expect(h.s.bells[0], reason).toMatchObject({ body: NOT_YET_EN, url: URL })
      expect(h.s.pushes[0].payload).toMatchObject({ body: NOT_YET_EN, url: URL })
      expect(h.s.mails[0].text).toContain(NOT_YET_EN)
      expect(JSON.stringify([h.s.bells, h.s.pushes, h.s.mails])).not.toMatch(/switch it on|You have hidden|You can now show/)
    }
  })

  it('an identity-side reason (the approval raced a revocation) says NOTHING about the mark: the plain approval', async () => {
    h.s.profile = { email: 'anna@example.com', locale: 'en', teacherProfile: TP }
    h.s.markState = { shown: false, reason: 'revoked' }
    await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'B' })
    expect(h.s.bells[0]).toMatchObject({ body: 'You will not be asked to do this again unless your document expires or is replaced.', url: '/dashboard/verification' })
    expect(JSON.stringify([h.s.bells, h.s.pushes, h.s.mails])).not.toContain('Identity verified')
  })

  it('teacherMarkLine — every reason the form can show maps to one line, or to none', () => {
    expect(teacherMarkLine({ shown: true, reason: null })).toBe('now')
    expect(teacherMarkLine({ shown: false, reason: 'hidden' })).toBe('can')
    expect(teacherMarkLine({ shown: false, reason: 'no_name' })).toBe('notYet')
    expect(teacherMarkLine({ shown: false, reason: 'name_mismatch' })).toBe('notYet')
    for (const reason of ['unverified', 'pending', 'expired', 'revoked', 'no_profile'] as const) expect(teacherMarkLine({ shown: false, reason }), reason).toBeNull()
  })

  it('in Vietnamese — "xác minh", never "xác thực"; never the verify flow', async () => {
    h.s.profile = { email: 'a@b.c', locale: 'vi', teacherProfile: TP }
    h.s.markState = { shown: true, reason: null }
    await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'A' })
    expect(h.s.bells[0].body).toBe(NOW_VI)
    expect(h.s.mails[0].text).toContain(NOW_VI)
    h.s.bells = []; h.s.mails = []; h.s.markState = { shown: false, reason: 'name_mismatch' }
    await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'A' })
    expect(h.s.bells[0].body).toBe(NOT_YET_VI)
    h.s.bells = []; h.s.markState = { shown: false, reason: 'hidden' }
    h.s.profile = { email: 'a@b.c', locale: 'vi', teacherProfile: { ...TP, identityMarkWithdrawnAt: HID } }
    await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'A' })
    expect(h.s.bells[0].body).toBe(CAN_VI)
    expect(JSON.stringify([h.s.bells, h.s.pushes, h.s.mails])).not.toMatch(/xác thực|dashboard\/account\/verify|dashboard\/verification/)
  })

  it('⛔ the bell, the push and the email say the SAME sentence — one copy (teacherMarkSentence)', async () => {
    for (const [state, sentence] of [[{ shown: true, reason: null }, NOW_EN], [{ shown: false, reason: 'hidden' }, CAN_EN], [{ shown: false, reason: 'no_name' }, NOT_YET_EN]] as const) {
      h.s.bells = []; h.s.pushes = []; h.s.mails = []
      h.s.profile = { email: 'anna@example.com', locale: 'en', teacherProfile: TP }
      h.s.markState = { ...state }
      await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'B' })
      expect([h.s.bells[0].body, h.s.pushes[0].payload.body]).toEqual([sentence, sentence])
      expect(h.s.mails[0].text).toContain(sentence)
    }
  })

  // A failure leaves "now shows", "not yet" and "you have hidden it" all unknown (commit gate, 2026-10-16).
  it('a failed read says NOTHING about the mark: the plain approval and the hub — and the notification still goes', async () => {
    h.s.profile = { email: 'anna@example.com', locale: 'en', teacherProfile: TP }
    h.s.markThrows = true
    await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'B' })
    expect(h.s.bells[0]).toMatchObject({ body: 'You will not be asked to do this again unless your document expires or is replaced.', url: '/dashboard/verification' })
    expect(h.s.pushes[0].payload.url).toBe('/dashboard/verification')
    expect(h.s.mails).toHaveLength(1)
    expect(JSON.stringify([h.s.bells, h.s.pushes, h.s.mails])).not.toContain('Identity verified')
  })

  it('a teacher\'s REFUSAL is unchanged — the reason, the hub, no word about the mark, no read', async () => {
    h.s.profile = { email: 'anna@example.com', locale: 'en', teacherProfile: TP }
    await notifyIdentityOutcome('p1', 'rejected', { reason: 'manual', note: 'Photo is blurred', tier: 'B' })
    expect(h.s.bells[0]).toMatchObject({ body: 'Photo is blurred', url: '/dashboard/verification' })
    expect(h.s.pushes[0].payload.url).toBe('/dashboard/verification')
    expect(JSON.stringify([h.s.bells, h.s.mails])).not.toContain('Identity verified')
    expect(h.s.markCalls).toEqual([])
  })

  it('no teacher profile: exactly the old copy and the hub — and no read', async () => {
    h.s.profile = { email: 'anna@example.com', locale: 'en', teacherProfile: null }
    await notifyIdentityOutcome('p1', 'approved', { reason: null, note: null, tier: 'B' })
    expect(h.s.bells[0]).toMatchObject({ body: 'You will not be asked to do this again unless your document expires or is replaced.', url: '/dashboard/verification' })
    expect(h.s.mails[0].text).toContain('Thanks for selling on eno.forum.')
    expect(h.s.markCalls).toEqual([])
  })
})
