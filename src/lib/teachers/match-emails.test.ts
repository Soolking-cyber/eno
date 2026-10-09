import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAILABLE_TEACHER_WHERE, MATCH_EMAIL_BODY_LIMIT, MATCH_EMAIL_RULES, emailConsented, emailPlanLine, isVisaWorded, loadCooling,
  loadPendingMatchRows, mailableMatchWhere, matchEmailJob, matchEmailResult, planMatchEmails, type PendingMatchRow,
} from './match-emails'
import { AI_NOTICE_VERSION } from './profile'
import { JUDGE_PROMPT_VERSION, TEACHING_JOB_WHERE } from './match-io'

// The ONE rule the plan the owner approves and the cron that sends share (plan review E2). What it must hold: only
// current-notice consent, only v2 verdicts judged after that consent, the cooldown before the teacher cap, the visa
// filter before the per-email cap, and nothing a teacher has already been sent.
const CONSENT = new Date('2026-10-09T00:00:00Z')
const AFTER = new Date('2026-10-10T00:00:00Z')
let n = 0
const row = (o: Partial<PendingMatchRow> & { teacher?: string; title?: string; attributes?: string | null; consentAt?: Date | null } = {}): PendingMatchRow => {
  const { teacher = 't1', title = 'IELTS Instructor', attributes = null, consentAt = CONSENT, ...rest } = o
  n++
  return {
    id: `m${String(n).padStart(4, '0')}`, score: 80, reasons: ['IELTS trainer'], createdAt: AFTER, teacherProfileId: teacher,
    teacherProfile: { matchEmailOptInAt: consentAt },
    listing: { id: `l${n}`, title, city: 'Hà Nội', affiliateUrl: null, attributes },
    ...rest,
  }
}

describe('isVisaWorded — the folded substring test, plus the words a sponsorship hides behind', () => {
  it.each([
    '#VisaSponsorship', 'Visa provided', 'e-visa support', 'workpermit', 'Work-Permit included', 'work permit + housing',
    'hỗ trợ giấy phép lao động', 'giay phep lao dong', 'cấp thẻ tạm trú', 'thị thực', '비자 지원', '签证',
  ])('drops %s', (t) => expect(isVisaWorded(t)).toBe(true))
  it.each(['IELTS Instructor', 'English teacher — District 7', 'Kindergarten teacher, 25M', '', null])('keeps %s', (t) => {
    expect(isVisaWorded(t)).toBe(false)
  })
})

describe('emailConsented — the email opt-in counts only under the current AI notice (D5)', () => {
  it('needs the switch AND the current version', () => {
    expect(emailConsented({ matchEmailOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION })).toBe(true)
    expect(emailConsented({ matchEmailOptIn: true, matchEmailNoticeVersion: null })).toBe(false) // the Gemini-era tick
    expect(emailConsented({ matchEmailOptIn: true, matchEmailNoticeVersion: '2026-01-01' })).toBe(false)
    expect(emailConsented({ matchEmailOptIn: false, matchEmailNoticeVersion: AI_NOTICE_VERSION })).toBe(false)
  })
})

describe('planMatchEmails', () => {
  it('one email per teacher, best score first, at most perEmail jobs', () => {
    const rows = [row({ score: 71 }), ...Array.from({ length: 7 }, (_, i) => row({ score: 90 - i })), row({ teacher: 't2', score: 99 })]
    const p = planMatchEmails(rows, new Set())
    expect(p.rules).toBe(MATCH_EMAIL_RULES.version)
    expect(p.teachers.map((t) => t.teacherProfileId)).toEqual(['t2', 't1'])
    const t1 = p.teachers[1].matches
    expect(t1).toHaveLength(MATCH_EMAIL_RULES.perEmail)
    expect(t1.map((m) => m.score)).toEqual([90, 89, 88, 87, 86])
    expect(p.counts).toMatchObject({ teachers: 2, jobs: 6, cooling: 0, visaDropped: 0, beforeConsent: 0, overCap: 0, truncated: false })
  })

  it('⛔ applies the cooldown BEFORE the maxTeachers slice — a cooling teacher never takes a place', () => {
    const rows = Array.from({ length: MATCH_EMAIL_RULES.maxTeachers + 1 }, (_, i) => row({ teacher: `t${String(i).padStart(3, '0')}`, score: 100 - (i % 30) }))
    const cooling = new Set(['t000', 't001'])
    const p = planMatchEmails(rows, cooling)
    expect(p.teachers).toHaveLength(MATCH_EMAIL_RULES.maxTeachers - 1)
    expect(p.teachers.some((t) => cooling.has(t.teacherProfileId))).toBe(false)
    expect(p.counts.cooling).toBe(2)
    expect(p.counts.overCap).toBe(0)
  })

  it('caps the teachers at maxTeachers and says how many wait', () => {
    const rows = Array.from({ length: MATCH_EMAIL_RULES.maxTeachers + 4 }, (_, i) => row({ teacher: `t${i}` }))
    const p = planMatchEmails(rows, new Set())
    expect(p.counts.teachers).toBe(MATCH_EMAIL_RULES.maxTeachers)
    expect(p.counts.overCap).toBe(4)
  })

  it('⛔ drops visa-worded jobs BEFORE the per-email cap, so they cannot crowd out clean matches', () => {
    const visa = Array.from({ length: 6 }, (_, i) => row({ score: 99 - i, title: i % 2 ? 'Teacher #VisaSponsorship' : 'Teacher — workpermit provided' }))
    const korean = row({ score: 98, title: 'English teacher', attributes: JSON.stringify({ salaryText: '비자 지원' }) })
    const clean = Array.from({ length: 3 }, (_, i) => row({ score: 70 + i }))
    const p = planMatchEmails([...visa, korean, ...clean], new Set())
    expect(p.teachers[0].matches.map((m) => m.score)).toEqual([72, 71, 70])
    expect(p.counts.visaDropped).toBe(7)
  })

  it('⛔ never plans a match judged before the teacher’s current email consent — or with no consent time', () => {
    const before = row({ createdAt: new Date('2026-10-08T23:59:59Z') })
    const noConsent = row({ teacher: 't2', consentAt: null })
    const ok = row({ teacher: 't3' })
    const p = planMatchEmails([before, noConsent, ok], new Set())
    expect(p.teachers.map((t) => t.teacherProfileId)).toEqual(['t3'])
    expect(p.counts.beforeConsent).toBe(2)
  })

  it('a lead’s row (no teacher) is never an email', () => {
    expect(planMatchEmails([row({ teacherProfileId: null })], new Set()).teachers).toEqual([])
  })

  it('is deterministic: the same rows in any order give the same plan', () => {
    const rows = [row({ score: 80 }), row({ score: 80 }), row({ teacher: 't2', score: 85 }), row({ score: 95 })]
    const a = planMatchEmails(rows, new Set())
    const b = planMatchEmails([...rows].reverse(), new Set())
    expect(b.teachers.map((t) => [t.teacherProfileId, t.matches.map((m) => m.id)])).toEqual(a.teachers.map((t) => [t.teacherProfileId, t.matches.map((m) => m.id)]))
  })

  it('reports a full row read as truncated', () => {
    const rows = Array.from({ length: MATCH_EMAIL_RULES.maxRows }, () => row())
    expect(planMatchEmails(rows, new Set()).counts.truncated).toBe(true)
  })
})

describe('the queries — what the plan and the send read', () => {
  const fakeDb = () => {
    const calls: { kind: string; args: Record<string, unknown> }[] = []
    const db = { teacherJobMatch: { findMany: async (args: Record<string, unknown>) => { calls.push({ kind: 'findMany', args }); return [] } } }
    return { db: db as unknown as Parameters<typeof loadCooling>[0], calls }
  }
  const NOW = Date.parse('2026-10-20T00:00:00Z')

  it('pending: v2 verdicts only, current-notice email consent, live teacher, a live TEACHING job, fresh and never emailed', async () => {
    const { db, calls } = fakeDb()
    await loadPendingMatchRows(db, NOW, new Set())
    const where = calls[0].args.where as Record<string, unknown>
    expect(where).toEqual({
      decision: 'match', emailedAt: null, createdAt: { gt: new Date(NOW - MATCH_EMAIL_RULES.freshMs) },
      modelVersions: { path: ['prompt'], equals: JUDGE_PROMPT_VERSION },
      teacherProfile: { matchEmailOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION, status: 'live', listing: { status: 'active', verified: true } },
      // ⛔ The export's job set — not just any live listing (gate review, 2026-10-08 — codex).
      listing: { status: 'active', verified: true, listingType: 'job', category: { slug: 'jobs' }, subcategorySlug: 'teaching' },
    })
    expect(where).toEqual(mailableMatchWhere(NOW))
    expect(where.listing).toBe(TEACHING_JOB_WHERE)
    expect(where.teacherProfile).toBe(MAILABLE_TEACHER_WHERE)
    expect(calls[0].args.take).toBe(MATCH_EMAIL_RULES.maxRows)
    expect(calls[0].args.select).toMatchObject({ createdAt: true, teacherProfile: { select: { matchEmailOptInAt: true } } })
  })

  it('⛔ pending leaves the teachers in cooldown out IN THE QUERY, before the row cap (gate review, 2026-10-08 — codex)', async () => {
    const { db, calls } = fakeDb()
    await loadPendingMatchRows(db, NOW, new Set(['t9', 't8']))
    expect((calls[0].args.where as Record<string, unknown>).teacherProfileId).toEqual({ notIn: ['t9', 't8'] })
  })

  it('⛔ …so a cooling teacher’s unmailed rows can never fill the read and starve everyone else', async () => {
    // A database that honours what the query asks: notIn, the order, the cap.
    const table: PendingMatchRow[] = [
      ...Array.from({ length: MATCH_EMAIL_RULES.maxRows }, (_, i) => row({ teacher: 'busy', score: 99, createdAt: new Date(AFTER.getTime() + i) })),
      row({ teacher: 'waiting', score: 71 }),
    ]
    const db = {
      teacherJobMatch: {
        findMany: async (args: { where: { teacherProfileId?: { notIn: string[] } }; take: number }) =>
          table.filter((r) => !args.where.teacherProfileId?.notIn.includes(r.teacherProfileId!))
            .sort((a, b) => b.score - a.score || a.createdAt.getTime() - b.createdAt.getTime()).slice(0, args.take),
      },
    } as unknown as Parameters<typeof loadPendingMatchRows>[0]
    const cooling = new Set(['busy']) // emailed yesterday: its other 5000 matches wait
    const plan = planMatchEmails(await loadPendingMatchRows(db, NOW, cooling), cooling)
    expect(plan.teachers.map((t) => t.teacherProfileId)).toEqual(['waiting'])
    expect(plan.counts).toMatchObject({ teachers: 1, cooling: 1, truncated: false })
  })

  it('the claim’s where: the same rule, with the teacher narrowed to the consent grant the plan saw', () => {
    const grant = new Date('2026-10-09T00:00:00Z')
    const w = mailableMatchWhere(NOW, { ...MAILABLE_TEACHER_WHERE, matchEmailOptInAt: grant })
    expect(w).toEqual({ ...mailableMatchWhere(NOW), teacherProfile: { ...MAILABLE_TEACHER_WHERE, matchEmailOptInAt: grant } })
  })

  it('cooling: teachers emailed within the cooldown', async () => {
    const { db, calls } = fakeDb()
    await loadCooling(db, NOW)
    expect(calls[0].args.where).toEqual({ emailedAt: { gt: new Date(NOW - MATCH_EMAIL_RULES.cooldownMs) }, teacherProfileId: { not: null } })
  })
})

describe('matchEmailJob — one job as the email shows it', () => {
  it('links the job, takes the pay from the posting, and keeps at most two reasons with no visa wording', () => {
    const j = matchEmailJob(row({ reasons: ['Visa help offered', 'IELTS 8.0', ' ', 'CELTA', 'Kids experience'], attributes: JSON.stringify({ salaryText: '30–35M' }) }), 'https://eno.vn')
    expect(j.url).toMatch(/^https:\/\/eno\.vn\/listings\/l\d+$/)
    expect(j.pay).toBe('30–35M')
    expect(j.reasons).toEqual(['IELTS 8.0', 'CELTA'])
    expect(j.applyAtSource).toBe(false)
  })
  it('a malformed attributes blob means no pay, never a crash', () => {
    expect(matchEmailJob(row({ attributes: '{oops' }), 'https://eno.vn').pay).toBeNull()
  })
})

// ═══ THE CONTRACT WITH ~/eno-lead-pipeline: the email plan and the send read the SAME rule, and the answer fits ══════════
describe('contract 4 — email-plan: a JSON line with teachers and rules, by the cron’s own selection', () => {
  it('prints the plan’s counts, `teachers` and `rules` at the top level (the send guard reads them there)', () => {
    const line = JSON.parse(JSON.stringify(emailPlanLine(planMatchEmails([row(), row({ teacher: 't2' })], new Set()))))
    expect(line).toMatchObject({ rules: MATCH_EMAIL_RULES.version, teachers: 2, jobs: 2, cooling: 0, visaDropped: 0, beforeConsent: 0 })
  })
  it('⛔ the script’s email-plan and the cron route call the SAME functions — never a copy of the rule', () => {
    const root = join(__dirname, '..', '..', '..')
    const script = readFileSync(join(root, 'scripts', 'teachers-match.ts'), 'utf8')
    const route = readFileSync(join(root, 'src', 'app', 'api', 'cron', 'teacher-match-emails', 'route.ts'), 'utf8')
    for (const fn of ['loadPendingMatchRows', 'loadCooling', 'planMatchEmails']) {
      expect(script, `script ${fn}`).toMatch(new RegExp(`\\b${fn}\\(`))
      expect(route, `route ${fn}`).toMatch(new RegExp(`\\b${fn}\\(`))
    }
    expect(route).toMatch(/from '@\/lib\/teachers\/match-emails'/)
    expect(script).toMatch(/from '\.\.\/src\/lib\/teachers\/match-emails'/)
    // No second selection in the route: no visa regex, no where on decision/emailedAt of its own.
    expect(route).not.toMatch(/VISA_WORD|decision: 'match'|createdAt: \{ gt/)
  })
})

describe('contract 5 — the cron’s answer: { ok, rules, teachers, sent, failed, unknown, skipped } under 200 bytes', () => {
  it('has exactly those fields on a normal run', () => {
    expect(Object.keys(matchEmailResult({ teachers: 2, sent: 2, failed: 0, unknown: 0, skipped: 0, stopped: null, left: 0 })))
      .toEqual(['ok', 'rules', 'teachers', 'sent', 'failed', 'unknown', 'skipped'])
  })
  it('⛔ stays under the limit in the WORST case — every count at the cap, the longest stop reason, the teachers left', () => {
    const n = MATCH_EMAIL_RULES.maxTeachers
    const worst = matchEmailResult({ teachers: n, sent: n, failed: n, unknown: n, skipped: n, stopped: 'x'.repeat(500), left: n })
    const body = JSON.stringify(worst)
    expect(MATCH_EMAIL_BODY_LIMIT).toBe(200)
    expect(Buffer.byteLength(body)).toBeLessThan(MATCH_EMAIL_BODY_LIMIT)
    expect(worst).toMatchObject({ ok: false, stopped: 'x'.repeat(32), left: n })
  })
  it('ok only when nothing failed, nothing is unclear and the run was not stopped', () => {
    expect(matchEmailResult({ teachers: 1, sent: 1, failed: 0, unknown: 0, skipped: 3, stopped: null, left: 0 }).ok).toBe(true)
    expect(matchEmailResult({ teachers: 1, sent: 0, failed: 0, unknown: 1, skipped: 0, stopped: null, left: 0 }).ok).toBe(false)
    expect(matchEmailResult({ teachers: 2, sent: 1, failed: 0, unknown: 0, skipped: 0, stopped: 'deadline', left: 1 })).toMatchObject({ ok: false, stopped: 'deadline', left: 1 })
  })
})
