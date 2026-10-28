import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * The one-time "Zalo for urgent cover" invite (owner, 2026-10-29) — the parts that need no database: the owner's words,
 * the channel rule, the bell's registration, the read-only list kept in step with the code. The claim, the guard and the
 * races run on a real Postgres in zalo-invite.it.test.ts.
 */
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: {} }))

const { composeCoverZaloInvite, COVER_ZALO_URL, ZALO_INVITE_TYPE, ZALO_INVITE_TITLE, ZALO_INVITE_BELL_BODY, ZALO_INVITE_CHAT_BODY } = await import('./zalo-invite-copy')
const { planOf, inviteWhere } = await import('./zalo-invite')
const { COVER_CONSENT_VERSION } = await import('./cover')
const { HOME_HIDDEN_TEACHER_LISTING_IDS } = await import('./constants')
const { JOB_DM_DEFAULT_ON, JOB_DM_NOTICE_VERSION } = await import('./job-dms/constants')
const { isVisaWorded } = await import('./match-emails')
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('the message — the owner\'s approved words', () => {
  const later = composeCoverZaloInvite({ firstName: 'Anna Maria Smith', first: false })
  const first = composeCoverZaloInvite({ firstName: 'Anna', first: true })

  it('says why (urgent cover is hard to reach) and what to do, with the page — optional, cover only, removable', () => {
    for (const s of [
      'Thanks for being open to cover lessons on eno.',
      "When a class needs urgent cover, it's often hard to reach the right teacher in time.",
      "That's why we're adapting eno to help teachers and schools work better together.",
      'You can now add your Zalo number to your cover settings.',
      'A school that needs urgent cover can then see it and contact you straight away, without waiting for a reply here.',
      `It's optional, only used for cover, and you can remove it any time: ${COVER_ZALO_URL}`,
    ]) expect(later).toContain(s)
    expect(COVER_ZALO_URL).toBe('https://eno.vn/teachers/cover-zalo')
  })

  it('greets by first name only, as every desk message; how to stop — once as the intro when it is the first desk message', () => {
    expect(later.startsWith('Hi Anna, this is Alex from eno.vn.\n')).toBe(true)
    expect(later.endsWith('Reply STOP to stop these messages.')).toBe(true)
    expect(first).toMatch(/^Hi Anna, this is Alex from eno\.vn\. Job messages are on for your eno\.vn teacher profile, so we send you jobs and cover lessons that fit it\. To stop them, reply STOP or switch them off at https:\/\/eno\.vn\/teachers\/job-messages\n/)
    expect(first).not.toContain('Reply STOP to stop these messages.')
    expect(composeCoverZaloInvite({ firstName: null, first: false }).startsWith('Hi, this is Alex')).toBe(true)
    // a name field is never a way to put a number or markup in eno's message (compose.ts's cleaning)
    expect(composeCoverZaloInvite({ firstName: '0901234567 <a href=x>', first: false }).split('\n')[0]).toBe('Hi, this is Alex from eno.vn.')
  })

  it('⛔ no visa wording on eno.vn, and the bell rows name no one but eno\'s desk', () => {
    expect(isVisaWorded(later) || isVisaWorded(first)).toBe(false)
    expect(ZALO_INVITE_TYPE).toBe('teacher_zalo_invite')
    for (const s of [ZALO_INVITE_TITLE, ZALO_INVITE_BELL_BODY, ZALO_INVITE_CHAT_BODY]) expect(s).toMatch(/ · /)
    expect(ZALO_INVITE_CHAT_BODY).toContain('Alex')
  })
})

describe('planOf — which way a teacher is told', () => {
  const k = (o: Partial<{ optIn: boolean; noticeVersion: string | null; pausedAt: Date | null }>) => ({ optIn: true, noticeVersion: JOB_DM_DEFAULT_ON, pausedAt: null, ...o })
  it('chat ONLY with job messages consented, the desk live and nothing waiting for a reply', () => {
    expect(planOf({ consent: k({}) }, { live: true, unanswered: 0 })).toBe('chat')
    expect(planOf({ consent: k({ noticeVersion: JOB_DM_NOTICE_VERSION }) }, { live: true, unanswered: 0 })).toBe('chat')
    expect(planOf({ consent: k({}) }, { live: true, unanswered: 1 })).toBe('bell')
    expect(planOf({ consent: k({}) }, { live: false, unanswered: 0 })).toBe('bell')
    expect(planOf({ consent: k({ optIn: false }) }, { live: true, unanswered: 0 })).toBe('bell')
    expect(planOf({ consent: k({ noticeVersion: 'old' }) }, { live: true, unanswered: 0 })).toBe('bell')
    expect(planOf({ consent: null }, { live: true, unanswered: 0 })).toBe('bell')
    // a jobs or cover message already went today: never a third on that day
    expect(planOf({ consent: k({}) }, { live: true, unanswered: 0, sentToday: true })).toBe('bell')
  })
  it('⛔ paused = nothing at all (a reply may have asked us to stop)', () => {
    expect(planOf({ consent: k({ pausedAt: new Date() }) }, { live: true, unanswered: 0 })).toBe('paused')
  })
})

describe('who — and the read-only list kept in step', () => {
  it('cover on under the current notice; no number, no switch-off, no invite yet', () => {
    const w = inviteWhere()
    expect(w).toMatchObject({ status: 'live', coverOpen: true, coverConsentVersion: COVER_CONSENT_VERSION })
    expect(w.OR).toEqual([{ private: { is: null } }, { private: { is: { coverZalo: null, coverZaloWithdrawnAt: null, coverZaloInvitedAt: null } } }])
  })
  it('⛔ the chat guard\'s SQL copies defaultOnTeacherWhere() — live, an active verified listing, never the demo: change both', async () => {
    const { defaultOnTeacherWhere } = await import('./job-dms/consent')
    expect(defaultOnTeacherWhere()).toEqual({ status: 'live', listing: { status: 'active', verified: true }, NOT: { listingId: { in: [...HOME_HIDDEN_TEACHER_LISTING_IDS] } } })
    const src = read('src/lib/teachers/zalo-invite.ts')
    expect(src).toContain(`tp.status = 'live'`)
    expect(src).toContain(`l.status = 'active' and l.verified and not (tp."listingId" = any(\${demoIds()}::text[]))`)
  })
    it('scripts/cover-zalo-invite-list.sql reads the same cover version and leaves out the same demo profile — read-only', async () => {
    const sql = read('scripts/cover-zalo-invite-list.sql')
    expect(sql).toContain(`tp."coverConsentVersion" = '${COVER_CONSENT_VERSION}'`)
    expect(sql).toContain(`tp."listingId" NOT IN (${HOME_HIDDEN_TEACHER_LISTING_IDS.map((id) => `'${id}'`).join(', ')})`)
    const { JOB_DM_ON_VERSIONS } = await import('./job-dms/consent')
    expect([...JOB_DM_ON_VERSIONS]).toEqual([JOB_DM_NOTICE_VERSION, JOB_DM_DEFAULT_ON])
    expect(sql).toContain(`k."noticeVersion" IN ('${JOB_DM_NOTICE_VERSION}', '${JOB_DM_DEFAULT_ON}')`)
    expect(sql).toMatch(/BEGIN READ ONLY;[\s\S]*ROLLBACK;\s*$/)
    expect(sql.replace(/--.*$/gm, '')).not.toMatch(/\b(insert|update|delete|alter|drop|create|truncate|grant)\b/i)
  })
})

describe('the bell knows the type', () => {
  it('titled in the reader\'s language, the cap icon, machine-translatable (eno\'s copy only)', () => {
    const bell = read('src/components/marketplace/notification-bell.tsx')
    expect(bell).toContain("n.type === 'teacher_zalo_invite' ? tr('Zalo for urgent cover', 'Zalo cho dạy thay khẩn')")
    expect(bell).toContain("n.type === 'teacher_zalo_invite' ? GraduationCap")
    expect(read('src/lib/notification-text.ts')).toMatch(/'teacher_checkin', 'teacher_zalo_invite',\s*\]\)/)
  })
})
