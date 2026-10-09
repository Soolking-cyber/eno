import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EMAIL_TEACHER_SELECT, EXISTING_MATCH_SELECT, EXPORT_JOB_SELECT, EXPORT_TEACHER_SELECT, IMPORT_LISTING_SELECT, IMPORT_TEACHER_SELECT,
  JUDGE_MODEL, JUDGE_PROMPT_VERSION, MATCH_CHECK_SELECT, MATCH_CONSENT_RULE, MATCH_IO_VERSION, MATCH_MIN_SCORE, MATCH_RETENTION_DAYS,
  MATCH_TEACHER_FIELDS, PENDING_MATCH_SELECT, STAFF_LIST_FILE, TEACHING_JOB_WHERE, applyOutputLines, buildMatchExport, checkFailure,
  consentMarker, consentStateOf, csvCell, importPlanDoc, isHaikuV2, isTeachingJob, parseMatchOutput, planMatchImport, provinceToCitySlug,
  retentionWheres, staffListLine, stripNameWords, toMatchJob, toMatchTeacher, withStaffList,
  type ExportTeacherRow, type ImportListingRow, type ImportTeacherRow, type MatchOutput,
} from './match-io'
import { planMatchEmails } from './match-emails'
import { AI_NOTICE_VERSION } from './profile'
import { renderTeacherMatches } from '@/lib/emails/teacher-matches'

const pair = (over: Record<string, unknown> = {}) => ({ teacherProfileId: 't1', listingId: 'l1', score: 90, match: true, reasons: [], concerns: [], decision: 'match', modelVersions: {}, ...over })

describe('parseMatchOutput — nothing is written from an output it does not trust', () => {
  it('accepts a well-formed run', () => {
    expect(parseMatchOutput({ version: 1, generatedAt: 'x', pairs: [pair(), pair({ teacherProfileId: undefined, leadId: 'L', decision: 'reject_sample', match: false, score: 20 })] }).pairs).toHaveLength(2)
  })
  it('refuses a pair with both or neither owner (the one-owner CHECK, enforced before the DB sees it)', () => {
    expect(() => parseMatchOutput({ version: 1, pairs: [pair({ leadId: 'L' })] })).toThrow()
    expect(() => parseMatchOutput({ version: 1, pairs: [pair({ teacherProfileId: undefined })] })).toThrow()
  })
  it('refuses a "match" below the bar or not judged a match', () => {
    expect(() => parseMatchOutput({ version: 1, pairs: [pair({ score: MATCH_MIN_SCORE - 1 })] })).toThrow()
    expect(() => parseMatchOutput({ version: 1, pairs: [pair({ match: false })] })).toThrow()
  })
  it('refuses an unknown version', () => {
    expect(() => parseMatchOutput({ version: 2, pairs: [] })).toThrow()
  })
})

describe('staff CSV cells', () => {
  it('neutralises spreadsheet formulas and quotes', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+84 901')).toBe(`"'+84 901"`)
    expect(csvCell(null)).toBe('""')
  })
})

describe('provinceToCitySlug', () => {
  it('maps stored provinces back to the teacher city slugs', () => {
    expect(provinceToCitySlug('Hồ Chí Minh')).toBe('ho-chi-minh-city')
    expect(provinceToCitySlug('Hà Nội')).toBe('ha-noi')
    expect(provinceToCitySlug('Đà Nẵng')).toBe('da-nang')
    expect(provinceToCitySlug('Cà Mau')).toBeNull()
  })
})

describe('renderTeacherMatches', () => {
  const out = renderTeacherMatches({
    jobs: [{ title: 'IELTS Instructor', city: 'Hà Nội', pay: '30M', url: 'https://eno.vn/listings/j', reasons: ['IELTS trainer'], applyAtSource: true }],
    origin: 'https://eno.vn', unsubscribeUrl: 'https://eno.vn/unsubscribe?token=t&list=teacher-matches', recipientName: 'Marco Reyes', siteName: 'eno.vn',
  })
  it('names the job, links it, and carries the list-specific unsubscribe', () => {
    expect(out.subject).toContain('IELTS Instructor')
    expect(out.html).toContain('https://eno.vn/listings/j')
    expect(out.html).toContain('list=teacher-matches')
    expect(out.text).toContain('list=teacher-matches')
  })
  it('escapes and never mentions visas', () => {
    expect(out.html + out.text).not.toMatch(/visa/i)
  })
})

describe('the consent marker the pipeline checks (plan review E1)', () => {
  it('names the gate and the AI notice it was applied under', () => {
    expect(consentMarker()).toEqual({ rule: MATCH_CONSENT_RULE, aiNotice: AI_NOTICE_VERSION })
    expect(MATCH_CONSENT_RULE).toBe('ai-match-opt-in-v1')
    // The shapes did not change: the pipeline keeps reading version 1.
    expect(MATCH_IO_VERSION).toBe(1)
  })
})

describe('consentStateOf — every live teacher, counted once, by where the AI-notice consent stands', () => {
  const base = { matchEmailOptIn: false, matchEmailNoticeVersion: null, staffContactOptIn: false, staffContactNoticeVersion: null }
  it('current: either opt-in under the current notice (aiMatchConsented) — the only state exported', () => {
    expect(consentStateOf({ ...base, matchEmailOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION })).toBe('current')
    expect(consentStateOf({ ...base, staffContactOptIn: true, staffContactNoticeVersion: AI_NOTICE_VERSION, matchEmailOptIn: true })).toBe('current')
  })
  it('otherVersion: an opt-in on under another notice — or none (the Gemini-era tick with no version)', () => {
    expect(consentStateOf({ ...base, matchEmailOptIn: true, matchEmailNoticeVersion: '2027-01-01' })).toBe('otherVersion')
    expect(consentStateOf({ ...base, matchEmailOptIn: true })).toBe('otherVersion')
    expect(consentStateOf({ ...base, staffContactOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION })).toBe('otherVersion')
  })
  it('none: no opt-in switched on — a version left behind on a switch that is off does not count', () => {
    expect(consentStateOf(base)).toBe('none')
    expect(consentStateOf({ ...base, matchEmailNoticeVersion: AI_NOTICE_VERSION, staffContactNoticeVersion: AI_NOTICE_VERSION })).toBe('none')
  })
})

describe('isHaikuV2 — only Claude Haiku 5.5 under the v2 prompt lands', () => {
  it('accepts the pinned judge (with or without a date suffix) and refuses every other', () => {
    expect(isHaikuV2({ modelVersions: { judge: JUDGE_MODEL, effort: 'medium', route: 'subscription', prompt: JUDGE_PROMPT_VERSION } })).toBe(true)
    expect(isHaikuV2({ modelVersions: { judge: `${JUDGE_MODEL}-20261001`, prompt: JUDGE_PROMPT_VERSION } })).toBe(true)
    expect(isHaikuV2({ modelVersions: { judge: 'claude-opus-5-5 (subscription)', prompt: JUDGE_PROMPT_VERSION } })).toBe(false)
    expect(isHaikuV2({ modelVersions: { judge: 'gemini-3.8-flash', prompt: JUDGE_PROMPT_VERSION } })).toBe(false)
    expect(isHaikuV2({ modelVersions: { judge: JUDGE_MODEL, prompt: 'teachers-judge-v1' } })).toBe(false)
    expect(isHaikuV2({ modelVersions: {} })).toBe(false)
    expect(isHaikuV2({ modelVersions: null })).toBe(false)
    expect(isHaikuV2({})).toBe(false)
  })
})

describe('stripNameWords — the teacher’s own name out of the free text (best effort)', () => {
  it('replaces whole words of the name, case- and accent-insensitively, a run of them once', () => {
    expect(stripNameWords('Hi, I am Marco Reyes. marco teaches IELTS; REYES too.', 'Marco Reyes')).toBe('Hi, I am [name]. [name] teaches IELTS; [name] too.')
    expect(stripNameWords('Xin chào, tôi là Nguyễn Thị Lan — Lan dạy tiếng Anh.', 'Nguyen Thi Lan')).toBe('Xin chào, tôi là [name] — [name] dạy tiếng Anh.')
    expect(stripNameWords('Đặng Minh here', 'đặng minh')).toBe('[name] here')
  })
  it('leaves parts of other words, one-letter initials and texts without the name alone', () => {
    expect(stripNameWords('Marcopolo English Centre, J. Smith', 'Marco J Reyes')).toBe('Marcopolo English Centre, J. Smith')
    expect(stripNameWords('IELTS trainer', '')).toBe('IELTS trainer')
    expect(stripNameWords('', 'Marco Reyes')).toBe('')
  })
})

describe('toMatchTeacher — exactly what the judge reads about a teacher', () => {
  const row = {
    id: 'tp1', updatedAt: new Date('2026-10-09T01:02:03Z'), fullName: 'Marco Reyes', headline: 'Marco Reyes — IELTS trainer',
    bio: 'I am Marco, 8 years teaching.', nationality: 'PH', nativeSpeaker: false, currentCity: '', preferredCities: ['ha-noi', 'online'],
    openToOnline: true, subjects: ['ielts'], ageGroups: ['adults'], jobTypes: ['full-time'], yearsExperience: 8, degreeLevel: 'bachelor',
    degreeMajor: 'English', certificates: [{ type: 'celta', provider: 'Cambridge', year: 2020 }, { hours: 120 }], expectedSalaryM: 30,
    availableFrom: new Date('2026-11-01T00:00:00Z'),
  } satisfies ExportTeacherRow
  // Extra columns a future select might add — they must never ride along.
  const withContact = { ...row, phone: '+84901234567', email: 'marco@example.com', photoUrl: 'https://x/p.webp', private: { phone: '+849' } }

  it('carries the listed fields and nothing else — no name, phone, email, photo, video or CV', () => {
    const t = toMatchTeacher(withContact)
    expect(Object.keys(t).sort()).toEqual([...MATCH_TEACHER_FIELDS].sort())
    const json = JSON.stringify(t)
    for (const leak of ['Marco', 'Reyes', '+849', 'marco@example.com', 'p.webp', 'Cambridge']) expect(json, leak).not.toContain(leak)
  })
  it('maps the mirrors as before — and passes an empty currentCity through as ""', () => {
    expect(toMatchTeacher(row)).toEqual({
      id: 'tp1', updatedAt: '2026-10-09T01:02:03.000Z', headline: '[name] — IELTS trainer', bio: 'I am [name], 8 years teaching.',
      nationality: 'PH', nativeSpeaker: false, currentCity: '', cities: ['ha-noi', 'online'], openToOnline: true, subjects: ['ielts'],
      ageGroups: ['adults'], jobTypes: ['full-time'], yearsExperience: 8, degreeLevel: 'bachelor', degreeMajor: 'English',
      certificates: ['celta'], expectedSalaryM: 30, availableFrom: '2026-11-01',
    })
  })
})

describe('toMatchJob — public listing fields only', () => {
  it('maps the province, the pay and the link', () => {
    const j = toMatchJob({
      id: 'l1', title: 'IELTS Instructor', description: 'x'.repeat(4000), city: 'Hà Nội', salaryM: 30,
      attributes: JSON.stringify({ salaryText: '30M' }), affiliateUrl: 'https://jobs.example/1', postedAt: new Date('2026-10-01T00:00:00Z'),
    }, 'https://eno.vn')
    expect(j).toMatchObject({ id: 'l1', city: 'ha-noi', cityName: 'Hà Nội', pay: '30M', linked: true, url: 'https://eno.vn/listings/l1' })
    expect(j.description).toHaveLength(3000)
  })
})

// ═══ THE CONTRACT WITH ~/eno-lead-pipeline (its src/teachers/runFiles.ts fails CLOSED on any other shape) ═══════════════

/** The pipeline's acceptance of an export (runFiles.ts checkConsent + lastJsonObject), replicated to the letter. */
function pipelineAcceptsExport(stdout: string, inputFile: unknown): string {
  const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'))
  let decl: Record<string, unknown> | null = null
  for (let i = lines.length - 1; i >= 0 && !decl; i--) {
    try { const v = JSON.parse(lines[i]); if (v && typeof v === 'object' && 'byConsent' in v) decl = v } catch { /* not JSON */ }
  }
  const bc = (decl?.byConsent ?? null) as Record<string, unknown> | null
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const current = n(bc?.current)
  if (current === null || n(bc?.otherVersion) === null || n(bc?.none) === null) return 'refused: no consent declaration'
  const inp = inputFile as { teachers?: unknown; jobs?: unknown }
  if (!Array.isArray(inp.teachers) || !Array.isArray(inp.jobs)) return 'refused: no teachers / jobs lists'
  if (inp.teachers.length > current) return 'refused: more teachers than current'
  return 'ok'
}

const NOW = new Date('2026-10-12T03:00:00Z')
const teacherRow = (id: string, consent: Partial<{ matchEmailOptIn: boolean; matchEmailNoticeVersion: string | null; staffContactOptIn: boolean; staffContactNoticeVersion: string | null }>) => ({
  id, updatedAt: new Date('2026-10-10T00:00:00Z'), fullName: 'Ann Taylor', headline: 'Ann Taylor — IELTS', bio: 'I am Ann, eight years of IELTS.',
  nationality: 'GB', nativeSpeaker: true, currentCity: 'ha-noi', preferredCities: ['ha-noi'], openToOnline: false, subjects: ['ielts'],
  ageGroups: ['adults'], jobTypes: ['full-time'], yearsExperience: 4, degreeLevel: null, degreeMajor: null, certificates: [], expectedSalaryM: null,
  availableFrom: null, matchEmailOptIn: false, matchEmailNoticeVersion: null, staffContactOptIn: false, staffContactNoticeVersion: null, ...consent,
})
const jobRow = { id: 'j1', title: 'IELTS teacher', description: 'Adults, Hanoi.', city: 'Hà Nội', salaryM: 40, attributes: null, affiliateUrl: null, postedAt: new Date('2026-10-07T00:00:00Z') }

describe('contract 1 — export: the consent declaration on stdout, and only `current` teachers in the file', () => {
  const opted = [
    teacherRow('t1', { matchEmailOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION }),
    teacherRow('t2', { staffContactOptIn: true, staffContactNoticeVersion: AI_NOTICE_VERSION }),
    teacherRow('t3', { matchEmailOptIn: true, matchEmailNoticeVersion: '2026-01-01' }), // another notice
    teacherRow('t4', { staffContactOptIn: true }), // the Gemini-era tick, no version
  ]
  const { input, declaration } = buildMatchExport({ opted, notOptedIn: 3, jobs: [jobRow], origin: 'https://eno.vn', generatedAt: NOW })
  const stdout = `${JSON.stringify(declaration)}\n`

  it('declares byConsent {current, otherVersion, none} over EVERY live teacher, plus consentVersion', () => {
    expect(declaration).toEqual({
      export: { teachers: 2, jobs: 1 }, byConsent: { current: 2, otherVersion: 2, none: 3 },
      consentVersion: AI_NOTICE_VERSION, consentRule: MATCH_CONSENT_RULE,
    })
    expect(stdout.trim().split('\n')).toHaveLength(1) // ONE line
  })
  it('the file holds ONLY the current teachers — and the pipeline accepts the pair', () => {
    expect(input.teachers.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(input.teachers.length).toBe(declaration.byConsent.current)
    expect(input.version).toBe(1)
    expect(input.consent).toEqual({ rule: MATCH_CONSENT_RULE, aiNotice: AI_NOTICE_VERSION })
    expect(pipelineAcceptsExport(stdout, JSON.parse(JSON.stringify(input)))).toBe('ok')
  })
  it('⛔ no name or contact data in the rows: only the listed fields, the name taken out of the free text', () => {
    for (const t of input.teachers) expect(Object.keys(t).sort()).toEqual([...MATCH_TEACHER_FIELDS].sort())
    const json = JSON.stringify(input)
    expect(json).not.toMatch(/fullName|"phone"|"email"|photoUrl|videoUrl|cvPath|cvFileName|matchEmailOptIn|staffContactOptIn/)
    expect(json).not.toMatch(/Ann|Taylor/)
    expect(input.teachers[0].headline).toBe('[name] — IELTS')
    // (Contact details never reach the free text at all: the save refuses them — publish-guard contact_in_text.)
    expect(input.teachers[0].bio).toBe('I am [name], eight years of IELTS.')
    // The export SELECTS nothing it must not send (the name only to strip it).
    for (const k of ['photoUrl', 'videoUrl', 'private', 'profile', 'listing']) expect(EXPORT_TEACHER_SELECT, k).not.toHaveProperty(k)
  })
  it('the pipeline refuses the OLD export line, and a file with more teachers than `current`', () => {
    expect(pipelineAcceptsExport(`export: 4 teachers × 1 teaching jobs → /x\n`, input)).toBe('refused: no consent declaration')
    expect(pipelineAcceptsExport(stdout, { ...input, teachers: [...input.teachers, input.teachers[0]] })).toBe('refused: more teachers than current')
  })
  it('nobody opted in under the current notice: a valid empty export, not a failure', () => {
    const empty = buildMatchExport({ opted: [opted[2]], notOptedIn: 5, jobs: [], origin: 'https://eno.vn', generatedAt: NOW })
    expect(empty.declaration.byConsent).toEqual({ current: 0, otherVersion: 1, none: 5 })
    expect(empty.input.teachers).toEqual([])
    expect(pipelineAcceptsExport(JSON.stringify(empty.declaration), empty.input)).toBe('ok')
  })
})

describe('contract 2 — import: the dry run’s plan file, and the apply’s lines', () => {
  const v2 = { judge: JUDGE_MODEL, effort: 'medium', route: 'subscription', prompt: JUDGE_PROMPT_VERSION }
  const p = (o: Record<string, unknown>) => ({ listingId: 'l1', score: 88, match: true, reasons: ['IELTS 8.0'], concerns: [], decision: 'match' as const, modelVersions: v2, ...o })
  const output: MatchOutput = {
    version: 1, generatedAt: 'x', pairs: [
      p({ teacherProfileId: 't1' }),
      p({ teacherProfileId: 't1' }), // repeated: counted once
      p({ teacherProfileId: 't1', listingId: 'l2', score: 30, match: false, decision: 'reject_sample' }),
      p({ teacherProfileId: 't2', score: 80 }), // replaces an unused Gemini-era verdict
      p({ teacherProfileId: 't3' }), // consent gone since the export
      p({ teacherProfileId: 't1', listingId: 'l9' }), // the job went away
      p({ teacherProfileId: 't1', listingId: 'l3' }), // already judged by v2
      p({ leadId: 'L1', score: 20, match: false, decision: 'reject_sample' }), // an FB lead: counted, never written
    ],
  }
  const listing = (id: string, o: Partial<ImportListingRow> = {}): ImportListingRow => ({
    id, title: `Job ${id}`, affiliateUrl: null, city: 'Hà Nội', attributes: JSON.stringify({ salaryText: '30M' }), seller: { name: 'School', phone: '+84 28 1234' },
    status: 'active', verified: true, listingType: 'job', subcategorySlug: 'teaching', category: { slug: 'jobs' }, ...o,
  })
  const teacher = (id: string, o: Partial<ImportTeacherRow>): ImportTeacherRow => ({
    id, fullName: `Name ${id}`, listingId: `tl-${id}`, matchEmailOptIn: false, matchEmailNoticeVersion: null, matchEmailOptInAt: new Date('2026-10-09T00:00:00Z'),
    staffContactOptIn: false, staffContactNoticeVersion: null, private: { phone: '+84 901', email: `${id}@example.com` }, ...o,
  })
  const plan = planMatchImport({
    output, now: NOW, origin: 'https://eno.vn',
    listings: [listing('l1'), listing('l2'), listing('l3')],
    teachers: [
      teacher('t1', { matchEmailOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION, staffContactOptIn: true, staffContactNoticeVersion: AI_NOTICE_VERSION }),
      teacher('t2', { matchEmailOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION }),
      teacher('t3', { matchEmailOptIn: true, matchEmailNoticeVersion: null }),
    ],
    existing: [
      { id: 'old-gemini', teacherProfileId: 't2', listingId: 'l1', modelVersions: { judge: 'gemini-3.8-flash' }, emailedAt: null, staffStatus: null },
      { id: 'v2-row', teacherProfileId: 't1', listingId: 'l3', modelVersions: v2, emailedAt: null, staffStatus: null },
    ],
  })

  it('plans once, the same for the dry run and the apply: consent re-checked, leads and dead jobs skipped, old verdicts replaced', () => {
    expect(plan.foreign).toBe(0)
    expect(plan.summary).toEqual({ pairs: 8, stillLive: 4, new: 3, newMatches: 2, rejectSamples: 1, superseded: 1, skippedLeads: 1 })
    expect(plan.supersede).toEqual(['old-gemini'])
    expect(plan.fresh.map((x) => `${x.teacherProfileId}|${x.listingId}`)).toEqual(['t1|l1', 't1|l2', 't2|l1'])
    expect(plan.byConsent).toEqual({ email: 2, staffCallOnly: 0 })
    // The staff list: staff-call consent under the current notice only — t2 is email-only.
    expect(plan.staffRows.map((x) => x.teacherProfileId)).toEqual(['t1'])
    expect(plan.newEmailRows.map((r) => r.teacherProfileId)).toEqual(['t1', 't2'])
  })

  it('⛔ the plan file carries import.{new,newMatches,rejectSamples}, email.{teachers,rules}, csvRows, purge, sample — and no personal data', () => {
    const doc = importPlanDoc(plan, planMatchEmails(plan.newEmailRows, new Set()), { leadRows: 4, rejectSamples: 1, withdrawn: 2 })
    const round = JSON.parse(JSON.stringify(doc))
    expect(round.import).toMatchObject({ new: 3, newMatches: 2, rejectSamples: 1 })
    expect(round.email).toMatchObject({ rules: 'teacher-match-emails/v2', teachers: 2, jobs: 2 })
    expect(round.csvRows).toBe(1)
    expect(round.purge).toEqual({ leadRows: 4, rejectSamples: 1, withdrawn: 2 })
    expect(round.sample).toEqual([
      { teacher: 'A', consent: 'email + staff call', score: 88, job: 'Job l1', province: 'Hà Nội', pay: '30M', jobUrl: 'https://eno.vn/listings/l1', linked: false },
      { teacher: 'B', consent: 'email', score: 80, job: 'Job l1', province: 'Hà Nội', pay: '30M', jobUrl: 'https://eno.vn/listings/l1', linked: false },
    ])
    const json = JSON.stringify(round)
    for (const leak of ['Name t1', 'example.com', '+84 901', 'IELTS 8.0', 'tl-t1']) expect(json, leak).not.toContain(leak)
  })

  it('⛔ a pair naming a listing outside the exported job set is never written, mailed or listed (gate review, 2026-10-08)', () => {
    // The import's query re-applies TEACHING_JOB_WHERE; the planner checks the rows it is given again (isTeachingJob), so a
    // malformed or hallucinated id that happens to be some other live listing never lands as a "teaching job".
    const t1 = teacher('t1', { matchEmailOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION, staffContactOptIn: true, staffContactNoticeVersion: AI_NOTICE_VERSION })
    const odd = planMatchImport({
      output: { version: 1, generatedAt: 'x', pairs: ['visa', 'wanted', 'flat', 'esl', 'l1'].map((id) => p({ teacherProfileId: 't1', listingId: id })) },
      listings: [
        listing('visa', { title: 'Express service', listingType: 'service', category: { slug: 'services' }, subcategorySlug: 'visa-services' }),
        listing('wanted', { listingType: 'wanted' }), // a teacher's own post in jobs › teaching
        listing('flat', { listingType: 'rent', category: { slug: 'property' }, subcategorySlug: 'rentals' }),
        listing('esl', { subcategorySlug: 'job-other' }),
        listing('l1'),
      ],
      teachers: [t1], existing: [], now: NOW, origin: 'https://eno.vn',
    })
    expect(odd.fresh.map((x) => x.listingId)).toEqual(['l1'])
    expect(odd.staffRows.map((x) => x.listingId)).toEqual(['l1'])
    expect(odd.newEmailRows.map((r) => r.listing.id)).toEqual(['l1'])
    expect(odd.summary).toMatchObject({ pairs: 5, stillLive: 1, new: 1, newMatches: 1 })
  })

  it('a pair from any other judge is counted — the caller refuses the whole output (exit 3)', () => {
    const gem = planMatchImport({ output: { ...output, pairs: [...output.pairs, p({ teacherProfileId: 't1', modelVersions: { judge: 'claude-opus-5-5', prompt: JUDGE_PROMPT_VERSION } })] }, listings: [], teachers: [], existing: [], now: NOW, origin: 'https://eno.vn' })
    expect(gem.foreign).toBe(1)
  })

  /** The pipeline's parseApplyOutput, replicated: JSON lines merged; `csv` from the JSON, else the "staff list:" line. */
  function pipelineParsesApply(text: string) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    const json: Record<string, unknown> = {}
    for (const l of lines) if (l.startsWith('{')) Object.assign(json, JSON.parse(l))
    const staff = lines.map((l) => /^staff list: (\d+) rows? → (.+)$/.exec(l)).find(Boolean)
    const c = json.csv as { rows?: unknown; file?: unknown } | null | undefined
    const csv = c && typeof c.rows === 'number' ? { rows: c.rows, file: String(c.file) } : staff ? { rows: Number(staff[1]), file: staff[2] } : null
    return { import: json.import ?? null, csv, purge: json.purge ?? json.purged ?? null }
  }

  it('⛔ --apply prints "staff list: N rows → <file>" and ONE JSON line with csv, import and the purge counts', () => {
    const csv = { file: '/Users/x/eno-teacher-matches/teacher-matches-2026-10-12-0123456789ab.csv', rows: 1 }
    const purge = { leadRows: 4, rejectSamples: 1, withdrawn: 2, csvFiles: 0 }
    const lines = applyOutputLines({ summary: plan.summary, byConsent: plan.byConsent, csv, purge })
    expect(lines[0]).toBe('import: 8 pairs, 4 still live and consented, 3 new (2 matches)')
    expect(lines[1]).toBe(`staff list: 1 rows → ${csv.file}`)
    expect(lines.filter((l) => l.startsWith('{'))).toHaveLength(1)
    expect(pipelineParsesApply(lines.join('\n'))).toEqual({ import: plan.summary, csv, purge })
  })

  it('no staff-call matches: no file, csv null — and the pipeline reads "none"', () => {
    const lines = applyOutputLines({ summary: plan.summary, byConsent: plan.byConsent, csv: null, purge: { leadRows: 0, rejectSamples: 0, withdrawn: 0, csvFiles: 0 } })
    expect(lines[1]).toBe(staffListLine(null))
    expect(pipelineParsesApply(lines.join('\n')).csv).toBeNull()
  })
})

describe('contract 3 — check: exit 3 for a missing column, 4 for the connection; every column the steps read', () => {
  it('maps the errors to the exit codes', () => {
    expect(checkFailure({ code: 'P2022', meta: { column: 'TeacherProfile.matchEmailOptInAt' } })).toEqual({ exit: 3, code: 'P2022' })
    expect(checkFailure({ name: 'DriverAdapterError', cause: { originalCode: '42703' } })).toEqual({ exit: 3, code: '42703' })
    expect(checkFailure(new Error('column TeacherProfile.matchEmailNoticeVersion does not exist (42703)')).exit).toBe(3)
    expect(checkFailure({ code: 'P2021' }).exit).toBe(3) // a table
    expect(checkFailure({ code: 'P1001' })).toEqual({ exit: 4, code: 'P1001' })
    expect(checkFailure(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5433'), { code: 'ECONNREFUSED' })).exit).toBe(4)
    expect(checkFailure(new Error('socket hang up'))).toEqual({ exit: 4, code: 'unknown' })
  })

  // Which model a relation in a select reads.
  const REL: Record<string, Record<string, keyof typeof MATCH_CHECK_SELECT>> = {
    teacherProfile: { private: 'teacherPrivate', profile: 'profile', listing: 'listing' },
    teacherJobMatch: { teacherProfile: 'teacherProfile', listing: 'listing' },
    listing: { seller: 'seller', category: 'category' },
  }
  function uncovered(model: keyof typeof MATCH_CHECK_SELECT, select: Record<string, unknown>, at = model as string): string[] {
    const check = MATCH_CHECK_SELECT[model] as Record<string, unknown>
    return Object.entries(select).flatMap(([k, v]) => {
      if (v === true) return k in check ? [] : [`${at}.${k}`]
      const rel = REL[model]?.[k]
      return rel ? uncovered(rel, (v as { select: Record<string, unknown> }).select, `${at}.${k}`) : [`${at}.${k} (unknown relation)`]
    })
  }
  it('⛔ reads every column the export, the import, the email plan and the cron select', () => {
    expect([
      ...uncovered('teacherProfile', EXPORT_TEACHER_SELECT), ...uncovered('listing', EXPORT_JOB_SELECT),
      ...uncovered('listing', IMPORT_LISTING_SELECT), ...uncovered('teacherProfile', IMPORT_TEACHER_SELECT),
      ...uncovered('teacherJobMatch', EXISTING_MATCH_SELECT), ...uncovered('teacherJobMatch', PENDING_MATCH_SELECT),
      ...uncovered('teacherProfile', EMAIL_TEACHER_SELECT),
    ]).toEqual([])
  })
  it('…and every column they FILTER on (a missing one fails the query just the same)', () => {
    const where = {
      // matchEmailOptInAt: the cron's claim names the consent grant the plan saw (gate review, 2026-10-08).
      teacherProfile: ['status', 'listingId', 'matchEmailOptIn', 'matchEmailOptInAt', 'matchEmailNoticeVersion', 'staffContactOptIn', 'staffContactNoticeVersion', 'lastMatchedAt'],
      listing: ['status', 'verified', 'listingType', 'subcategorySlug', 'categoryId', 'postedAt'],
      category: ['slug'],
      teacherJobMatch: ['decision', 'emailedAt', 'createdAt', 'modelVersions', 'leadId', 'staffStatus', 'score'],
    } as const
    for (const [model, cols] of Object.entries(where)) {
      for (const c of cols) expect(MATCH_CHECK_SELECT[model as keyof typeof MATCH_CHECK_SELECT], `${model}.${c}`).toHaveProperty(c, true)
    }
  })
})

const SCRIPT_TEXT = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'teachers-match.ts'), 'utf8')

describe('the job set — ONE definition, exported, imported and mailed through (gate review, 2026-10-08 — codex)', () => {
  const row = { status: 'active', verified: true, listingType: 'job', subcategorySlug: 'teaching', category: { slug: 'jobs' } }
  it('TEACHING_JOB_WHERE: a live, verified job in jobs › teaching — and isTeachingJob is the same rule on a row', () => {
    expect(TEACHING_JOB_WHERE).toEqual({ status: 'active', verified: true, listingType: 'job', category: { slug: 'jobs' }, subcategorySlug: 'teaching' })
    expect(isTeachingJob(row)).toBe(true)
    for (const o of [{ status: 'sold' }, { verified: false }, { listingType: 'wanted' }, { subcategorySlug: null }, { category: { slug: 'services' } }]) {
      expect(isTeachingJob({ ...row, ...o }), JSON.stringify(o)).toBe(false)
    }
  })
  it('⛔ the script exports AND imports through it — never an inline copy of the set', () => {
    expect(SCRIPT_TEXT).toContain('where: TEACHING_JOB_WHERE,')
    expect(SCRIPT_TEXT).toContain('where: { id: { in: listingIds }, ...TEACHING_JOB_WHERE }, select: IMPORT_LISTING_SELECT')
    expect(SCRIPT_TEXT).not.toMatch(/subcategorySlug: 'teaching'/)
  })
})

describe('withStaffList — the staff list around the database write (gate review, 2026-10-08 — codex)', () => {
  const FILE = '/x/eno-teacher-matches/teacher-matches-2026-10-12-run1.csv'
  const fakeFs = () => {
    const log: string[] = []
    const files = new Map<string, string>()
    const fs = {
      write: (f: string, body: string) => { log.push(`write ${f}`); files.set(f, body) },
      rename: (from: string, to: string) => { log.push(`rename ${from} → ${to}`); files.set(to, files.get(from) ?? ''); files.delete(from) },
      exists: (f: string) => files.has(f),
    }
    return { log, files, fs }
  }

  it('writes `.pending` BEFORE the transaction (a crash after the commit keeps the list) and renames it only AFTER the commit', async () => {
    const { log, files, fs } = fakeFs()
    expect(await withStaffList({ file: FILE, body: 'a,b\n' }, fs, async () => { log.push('commit'); return 7 })).toBe(7)
    expect(log).toEqual([`write ${FILE}.pending`, 'commit', `rename ${FILE}.pending → ${FILE}`])
    expect([...files]).toEqual([[FILE, 'a,b\n']])
  })

  it('⛔ a failed write leaves only the unconfirmed `.pending` list — never one that looks applied', async () => {
    const { log, files, fs } = fakeFs()
    await expect(withStaffList({ file: FILE, body: 'a,b\n' }, fs, async () => { log.push('commit'); throw new Error('foreign key') })).rejects.toThrow('foreign key')
    expect(log).toEqual([`write ${FILE}.pending`, 'commit'])
    expect([...files.keys()]).toEqual([`${FILE}.pending`])
    // …which the 90-day sweep deletes with the applied lists.
    expect(STAFF_LIST_FILE.test('teacher-matches-2026-10-12-run1.csv.pending')).toBe(true)
    expect(STAFF_LIST_FILE.test('teacher-matches-2026-10-12-run1.csv')).toBe(true)
    expect(STAFF_LIST_FILE.test('notes.csv')).toBe(false)
  })

  it('⛔ a re-apply with nothing new to list PROMOTES the `.pending` a crashed apply left after its commit (codex, 2026-10-09)', async () => {
    const { log, files, fs } = fakeFs()
    files.set(`${FILE}.pending`, 'a,b\n') // the previous apply: written, committed, died before the rename
    await withStaffList({ file: FILE, body: null }, fs, async () => { log.push('commit') })
    expect(log).toEqual(['commit', `rename ${FILE}.pending → ${FILE}`])
    expect([...files]).toEqual([[FILE, 'a,b\n']])
    // …nothing to promote: just the write; and a failed commit promotes nothing.
    const b = fakeFs()
    await withStaffList({ file: FILE, body: null }, b.fs, async () => { b.log.push('commit') })
    expect(b.log).toEqual(['commit'])
    const c = fakeFs()
    c.files.set(`${FILE}.pending`, 'a,b\n')
    await expect(withStaffList({ file: FILE, body: null }, c.fs, async () => { throw new Error('connection reset') })).rejects.toThrow()
    expect([...c.files.keys()]).toEqual([`${FILE}.pending`])
  })

  it('no staff rows: no file at all — just the write', async () => {
    const { log, fs } = fakeFs()
    await withStaffList(null, fs, async () => { log.push('commit') })
    expect(log).toEqual(['commit'])
  })

  it('the script writes the list through it, around the transaction, and sweeps with STAFF_LIST_FILE', () => {
    const at = SCRIPT_TEXT.indexOf('await withStaffList(')
    expect(at).toBeGreaterThan(-1)
    expect(SCRIPT_TEXT.indexOf('db.$transaction([', at)).toBeGreaterThan(at)
    // No list is written outside it (the plan file is the only other write).
    expect(SCRIPT_TEXT.match(/writeFileSync\(/g)).toHaveLength(3) // export input, the dry run's plan, withStaffList's write
    expect(SCRIPT_TEXT).toContain('STAFF_LIST_FILE.test(f)')
  })
})

describe('retentionWheres — what the import deletes (VN PDP Law 91/2025; /privacy: deleted when the purpose is fulfilled)', () => {
  const COOLDOWN = 3 * 86_400_000
  const R = retentionWheres(NOW, COOLDOWN)
  const cutoff = new Date(NOW.getTime() - MATCH_RETENTION_DAYS * 86_400_000)

  it('leads and reject samples after 90 days; ⛔ EVERY row of a teacher with BOTH opt-ins off, at any age (gate review, 2026-10-08 — Opus)', () => {
    expect(MATCH_RETENTION_DAYS).toBe(90)
    expect(R).toEqual({
      leadRows: { createdAt: { lt: cutoff }, leadId: { not: null } },
      rejectSamples: { createdAt: { lt: cutoff }, leadId: null, decision: 'reject_sample' },
      withdrawn: {
        teacherProfileId: { not: null }, teacherProfile: { matchEmailOptIn: false, staffContactOptIn: false },
        OR: [{ emailedAt: null }, { emailedAt: { lt: new Date(NOW.getTime() - COOLDOWN) } }],
      },
    })
  })

  it('⚠️ a withdrawn teacher\'s row emailed INSIDE the cooldown stays until it ends — loadCooling reads it (commit gate, 2026-10-09)', () => {
    const { OR } = R.withdrawn as { OR: { emailedAt: null | { lt: Date } }[] }
    const deletes = (emailedAt: Date | null) => OR.some((c) => (c.emailedAt === null ? emailedAt === null : !!emailedAt && emailedAt < c.emailedAt.lt))
    expect(deletes(null)).toBe(true) // never emailed: goes at once
    expect(deletes(new Date(NOW.getTime() - COOLDOWN - 1))).toBe(true) // emailed before the window: goes
    expect(deletes(new Date(NOW.getTime() - COOLDOWN + 60_000))).toBe(false) // emailed inside it: kept for loadCooling
    // The script passes the cooldown the send uses — the same number loadCooling reads.
    expect(SCRIPT_TEXT).toContain('retentionWheres(now, MATCH_EMAIL_RULES.cooldownMs)')
  })

  it('withdrawn reads the two SWITCHES, never the notice version — a checkout ahead of prod must not purge consenting teachers', () => {
    expect(JSON.stringify(R.withdrawn)).not.toMatch(/NoticeVersion|OptInAt|WithdrawnAt/)
  })

  it('⛔ the script counts every one in the dry run’s plan and deletes every one on --apply', () => {
    for (const k of Object.keys(R)) {
      expect(SCRIPT_TEXT, `count ${k}`).toContain(`${k}: await db.teacherJobMatch.count({ where: R.${k} })`)
      expect(SCRIPT_TEXT, `delete ${k}`).toContain(`${k}: (await db.teacherJobMatch.deleteMany({ where: R.${k} })).count`)
    }
  })
})

describe('the script itself — stdout is the contract, so nothing else may reach it', () => {
  const script = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'teachers-match.ts'), 'utf8')
  it('never console.log()s, and loads .env quietly (dotenv 17 prints to stdout otherwise)', () => {
    expect(script).not.toMatch(/console\.log\(/)
    expect(script).toContain('config({ quiet: true })')
    expect(script).not.toMatch(/import 'dotenv\/config'/)
  })
  it('builds every line from the pinned builders, and reads through the shared selects', () => {
    for (const name of ['buildMatchExport', 'EXPORT_TEACHER_SELECT', 'planMatchImport', 'importPlanDoc', 'applyOutputLines', 'MATCH_CHECK_SELECT', 'checkFailure', 'emailPlanLine', 'loadPendingMatchRows', 'loadCooling', 'planMatchEmails']) {
      expect(script, name).toContain(name)
    }
  })
  it('keeps the old callers’ subcommands and flags', () => {
    for (const k of ["export: doExport", "import: doImport", "'--out'", "'--src'", "'--csv-dir'", "'--apply'", "'--plan-out'", "'--run-id'", "check: doCheck", "'email-plan': doEmailPlan"]) {
      expect(script, k).toContain(k)
    }
  })
})
