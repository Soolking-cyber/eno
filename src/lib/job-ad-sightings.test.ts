import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { mapStagedJob, type MappedJob, type StagedJob } from './job-listing'
import {
  JOB_AD_SIGHTING_UPSERT_SQL, SIGHTING_CHUNK, SIGHTING_FIELDS, isCalendarDay, jobAdSightingOf, namesAPerson, recordJobAdSightings,
  sightingUpsertParams, sightingsToLog, workPermitSupportOf, type JobAdSighting, type SightingDb,
} from './job-ad-sightings'

/**
 * D3, the job-ad history log (src/lib/job-ad-sightings.ts): the mapping and its never-store rules, the write's batching, its
 * never-throw contract and its row-by-row retry against a fake client, the DDL pinned to schema.prisma, and — in PGlite —
 * the DDL script's own statements and the upsert EXECUTED: first and repeat sightings, a stage imported twice, a stage
 * imported late, a re-post, and a bad row that loses only itself — through the importer's real Prisma client too.
 */

// 2026-10-19 12:00 in Vietnam.
const NOW = Date.parse('2026-10-19T05:00:00Z')
const STAGED_AT = '2026-10-19T00:02:58.826Z'

/** A TEAST row as exportJobs stages it (data/jobs-stage, 2026-10-19). */
const teast: StagedJob = {
  key: 'k1', url: 'https://teast.co/job/power-english-esl-7f3a?utm_source=x', source: 'teast',
  title: 'ESL Teacher', employer: 'Power English', city: 'Ho Chi Minh City', salary: '40,000,000 VND / month', employment: 'PART_TIME',
  datePosted: '2026-10-07T02:00:00.000Z', applyBy: '2026-10-21', category: 'teaching', coverPath: 'covers/k1.png',
}
/** A shouted CareerLink row with a pay RANGE (job-listing.test.ts's base row, re-dated). */
const careerlink: StagedJob = {
  key: 'k2', url: 'https://www.careerlink.vn/tim-viec-lam/giao-vien-tieng-anh-da-nang/3629784?source=site', source: 'careerlink-teach',
  title: 'GIÁO VIÊN   TIẾNG ANH [ ĐÀ NẴNG ]', employer: 'TẬP ĐOÀN GIÁO DỤC RES', city: 'Da Nang', salary: '10,000,000–30,000,000 VND / month',
  employment: 'FULL_TIME', datePosted: '2026-10-13T02:00:00.000Z', applyBy: '2026-11-30', category: 'english', coverPath: 'covers/k2.png',
}
/** The live VTJ row whose pay line carries "Visa/TRC support" (2026-10-14): the job stays, the line goes. */
const visaPayLine: StagedJob = {
  key: 'k3', url: 'https://vietnamteachingjobs.com/jobs/view/apollo-hanoi-teacher-2026', source: 'vtj',
  title: 'English Teacher', employer: 'Apollo Education and Training Organization', city: 'Hanoi',
  salary: 'Competitive guaranteed salary, Work Permit & Visa/TRC support; Additional Supplement & bonuses', employment: null,
  datePosted: '2026-10-14T02:00:00.000Z', applyBy: '2026-10-28', category: 'teaching', coverPath: 'covers/k3.png',
}

const mapped = (s: StagedJob): MappedJob => {
  const r = mapStagedJob(s, NOW)
  if (!r.ok) throw new Error(`fixture refused by mapStagedJob: ${r.reason}`)
  return r.job
}
const sightingOf = (s: StagedJob): JobAdSighting => {
  const row = jobAdSightingOf(s, mapped(s))
  if (!row) throw new Error('fixture refused by jobAdSightingOf')
  return row
}
/** Malformed values that reach the log from a stage the importer treats as untrusted (verify review, 2026-10-19): an emoji
 *  across the 200-unit cut, a NUL, an impossible day. Each would make Postgres refuse a whole statement. */
const emojiAtCut = `ESL Teacher ${'x'.repeat(187)}\u{1F525} VUS`
const nulTitle = 'ESL\u0000 Teacher Hanoi'

describe('jobAdSightingOf — a mapped ad → its history row', () => {
  it('keeps the parsed facts, as the importer parsed them', () => {
    expect(sightingOf(teast)).toEqual({
      externalId: 'teast:power-english-esl-7f3a', board: 'teast', listingId: null, title: 'ESL Teacher', city: 'Hồ Chí Minh',
      employer: 'Power English', employmentType: 'parttime', salaryMin: 40_000_000, salaryMax: 40_000_000, salaryCurrency: 'VND',
      salaryPeriod: 'month', workPermitSupport: false, category: 'teaching', subcategory: 'teaching', postedOn: '2026-10-07',
      applyBy: '2026-10-21',
    })
  })

  it('normalises: the role title un-shouted and whitespace-collapsed (WITHOUT the listing title\'s " — employer"), the employer un-shouted, the province, the jobtype, a pay range, the capped apply-by', () => {
    const job = mapped(careerlink)
    expect(job.title).toBe('Giáo Viên Tiếng Anh [Đà Nẵng] — Tập Đoàn Giáo Dục RES') // the listing's
    expect(jobAdSightingOf(careerlink, job)).toMatchObject({
      externalId: 'careerlink:3629784', board: 'careerlink', title: 'Giáo Viên Tiếng Anh [Đà Nẵng]', city: 'Đà Nẵng',
      employer: 'Tập Đoàn Giáo Dục RES', employmentType: 'fulltime', salaryMin: 10_000_000, salaryMax: 30_000_000, salaryPeriod: 'month',
      category: 'english', subcategory: 'teaching', postedOn: '2026-10-13',
      applyBy: '2026-10-27', // the posting said 2026-11-30: capped at 14 days after posting, as the listing's
    })
    // A title past 200 characters is cut where the listing title is.
    const long = sightingOf({ ...teast, title: `ESL Teacher ${'x'.repeat(205)}` })
    expect(long.title).toHaveLength(200)
  })

  it('⛔ never half a character, never a control character: an emoji across the cut loses its lone half, a NUL or a C0/C1 control goes — before the screens', () => {
    const cut = sightingOf({ ...teast, title: emojiAtCut })
    expect(cut.title).toHaveLength(199)
    expect(cut.title).toBe(`ESL Teacher ${'x'.repeat(187)}`)
    expect(cut.title).not.toMatch(/[\uD800-\uDFFF]/)
    // A pair the cut does not split is kept whole.
    expect(sightingOf({ ...teast, title: `\u{1F525}VUS\u{1F525} Hiring ESL Teachers` }).title).toBe('\u{1F525}VUS\u{1F525} Hiring ESL Teachers')
    expect(sightingOf({ ...teast, title: nulTitle }).title).toBe('ESL Teacher Hanoi')
    expect(sightingOf({ ...teast, employer: 'Power\u0007 English\u0000\u009b' }).employer).toBe('Power English')
    // A control character cannot split a word the screens look for: stripped first, the word is whole and refused — the
    // row for a visa word, the employer alone for a phone number.
    const job = mapped(teast)
    expect(jobAdSightingOf({ ...teast, title: 'ESL Teacher + Vi\u0000sa Support' }, job)).toBeNull()
    expect(jobAdSightingOf(teast, { ...job, attributes: { ...job.attributes, employer: 'Power English 0901\u0000234\u0000567' } })).toMatchObject({ employer: null, title: 'ESL Teacher' })
  })

  it('reads only the pay the importer reads: an hourly range, an open "from", and nothing from USD or "competitive"', () => {
    expect(sightingOf({ ...teast, salary: '500,000–570,000 VND/hour' })).toMatchObject({ salaryMin: 500_000, salaryMax: 570_000, salaryCurrency: 'VND', salaryPeriod: 'hour' })
    expect(sightingOf({ ...teast, salary: 'From 12,000,000 VND/month' })).toMatchObject({ salaryMin: 12_000_000, salaryMax: null, salaryPeriod: 'month' })
    for (const salary of ['USD 1,900 – 2,350 per month (gross)', 'Competitive salary', 'Up to 60.000.000 VND/ month', null]) {
      expect(sightingOf({ ...teast, salary }), String(salary)).toMatchObject({ salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null })
    }
  })

  it('⛔ carries a key, the listing and parsed facts ONLY — never the ad\'s text, the pay line as written, the link or the cover', () => {
    const row = sightingOf(teast)
    expect(Object.keys(row).sort()).toEqual([...SIGHTING_FIELDS].sort())
    const json = JSON.stringify(row)
    const job = mapped(teast)
    for (const text of [job.description, job.descriptionVi, job.affiliateUrl, job.attributes.salaryText!, job.coverPath]) expect(json).not.toContain(text)
    // …and the statement's JSON is built from SIGHTING_FIELDS alone, whatever else a caller's object carries.
    const smuggled = { ...row, description: job.description, salaryText: 'x', url: job.affiliateUrl } as JobAdSighting
    const [, rows] = sightingUpsertParams([smuggled], STAGED_AT)
    expect(Object.keys(JSON.parse(rows)[0]).sort()).toEqual([...SIGHTING_FIELDS].sort())
  })

  it('⛔ never a visa or TRC field: a pay line that mentions one is not read for pay — its work-permit support is kept as the BOOLEAN alone — and the ad is still logged', () => {
    const row = sightingOf(visaPayLine)
    expect(row).toMatchObject({ externalId: 'vtj:apollo-hanoi-teacher-2026', salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null, employmentType: null })
    // The RAW line says the employer supports the work permit: true — and not one word of the line is kept.
    expect(row.workPermitSupport).toBe(true)
    expect(JSON.stringify(row)).not.toMatch(/visa|trc|residen|work permit|competitive|supplement/i)
    expect(Object.values(row).filter((v) => typeof v === 'boolean')).toEqual([true])
    // A title or employer with a visa word never gets this far (mapStagedJob drops the ad) …
    expect(mapStagedJob({ ...teast, title: 'ESL Teacher + Visa Support' }, NOW)).toEqual({ ok: false, reason: 'visaMention' })
    // … and a caller that skipped the screens still cannot store one.
    const job = mapped(teast)
    for (const title of ['ESL Teacher + Visa Support', 'ESL Teacher, TRC provided', 'ESL Teacher — hỗ trợ thẻ tạm trú']) {
      expect(jobAdSightingOf({ ...teast, title }, job), title).toBeNull()
    }
    expect(jobAdSightingOf(teast, { ...job, attributes: { ...job.attributes, employer: 'Visa Sponsor Academy' } })).toBeNull()
    // The key too: some boards' ids are the ad's URL slug — one naming a visa word is not stored either. A long numeric id
    // is not a phone number, and stays.
    expect(jobAdSightingOf(teast, { ...job, externalId: 'teast:esl-teacher-visa-support-7f3a' })).toBeNull()
    expect(jobAdSightingOf(teast, { ...job, externalId: 'careerlink:0901234567' })).toMatchObject({ externalId: 'careerlink:0901234567' })
    // A contact in the employer line blanks the employer; the ad is still logged.
    for (const employer of ['Power English (www.powerenglish.vn)', 'Power English - hr@powerenglish.vn', 'Power English 0901 234 567'])
      expect(jobAdSightingOf(teast, { ...job, attributes: { ...job.attributes, employer } }), employer).toMatchObject({ employer: null, title: 'ESL Teacher' })
    expect(jobAdSightingOf(teast, { ...job, attributes: { ...job.attributes, salaryText: '40,000,000 VND / month + visa' } }))
      .toMatchObject({ salaryMin: null, salaryPeriod: null })
  })

  it('⛔ never a contact: a phone, an email or a link in the title refuses the row; in the employer line it blanks the employer', () => {
    const job = mapped(teast)
    expect(jobAdSightingOf({ ...teast, title: 'ESL Teacher call 0901 234 567' }, job)).toBeNull()
    expect(jobAdSightingOf(teast, { ...job, attributes: { ...job.attributes, employer: 'hr@powerenglish.vn' } })).toMatchObject({ employer: null })
    expect(jobAdSightingOf(teast, { ...job, attributes: { ...job.attributes, employer: 'Power English (www.powerenglish.vn)' } })).toMatchObject({ employer: null })
  })

  it('⛔ never a person\'s name: every shape the verify review stored as an employer is left out — through mapStagedJob, as the importer runs — the ad kept', () => {
    for (const employer of ['Ms Ngân English', 'MS NGÂN ENGLISH', 'CHỊ HOA', 'ANH TUẤN', 'CÔ LAN', 'Cô giáo Lan', 'Thầy giáo Minh', 'Chị Hoa (Tutor)',
      'Chị Hoa - Gia sư', 'Thầy Minh - Gia sư IELTS', 'Ms.Hoa English', 'Mrs.Linh', 'Nguyễn Thị Lan', 'John Smith',
      // round-2 review (2026-10-20): a Vietnamese title before a four-word full name
      'Chị Nguyễn Thị Mai Anh', 'Cô Nguyễn Thị Mai Anh', 'Thầy giáo Nguyễn Văn Minh Tuấn', 'Cô Trần Ngọc Bảo Châu - Gia sư']) {
      const job = mapped({ ...teast, employer })
      expect(namesAPerson(job.attributes.employer!), employer).toBe(true)
      expect(jobAdSightingOf({ ...teast, employer }, job), employer).toMatchObject({ employer: null, title: 'ESL Teacher' })
    }
  })

  it('namesAPerson: a title and a name, or a bare name — after a trailing descriptor is cut and on dots as well as spaces', () => {
    for (const e of ['Ms Ngân English', 'Mr. John Smith', 'Dr. Lee English Centre', 'Miss Hoa', 'Chị Hoa', 'Cô Mai Anh', 'Anh Tuấn', 'Thầy Nam English Class',
      // the verify review's strings (2026-10-19)
      'CHỊ HOA', 'ANH TUẤN', 'CÔ LAN', 'Cô giáo Lan', 'Thầy giáo Minh', 'Chị Hoa (Tutor)', 'Chị Hoa - Gia sư', 'Thầy Minh - Gia sư IELTS', 'Ms.Hoa English',
      'Mrs.Linh', 'Nguyễn Thị Lan', 'John Smith',
      // the same shapes, written other ways
      'CÔ GIÁO LAN', 'Cô Giáo Lan', 'Chị Hoa, gia sư tiếng Anh', 'Mr John | Tutor', 'Nguyen Thi Lan', 'NGUYỄN THỊ LAN', 'Lê An', 'Trần Văn Bình',
      'Đỗ Minh Quân', 'Jenny Nguyen', 'Linh Tran', 'Sarah Johnson',
      // a Vietnamese title before a four-word full name that starts with a common surname (round-2 review, 2026-10-20)
      'Chị Nguyễn Thị Mai Anh', 'Cô Nguyễn Thị Mai Anh', 'Thầy giáo Nguyễn Văn Minh Tuấn', 'Cô Trần Ngọc Bảo Châu - Gia sư',
      // in any case: a name typed in lower case (commit-gate review, 2026-10-20)
      'chị hoa', 'ms hoa', 'Ms hoa', 'cô giáo lan', 'Nguyễn thị lan', 'nguyễn thị lan', 'nguyen thi lan', 'mr. john smith',
      // surnames past the sixteen most common (commit-gate review, 2026-10-20)
      'Trịnh Thị Lan', 'Đinh Văn Nam', 'Mai Anh Tuấn', 'Lâm Ngọc Hà', 'Trương Minh Tâm', 'Cao Thị Hồng']) {
      expect(namesAPerson(e), e).toBe(true)
    }
    for (const e of ['Power English', 'VUS - The English Center', 'VUS The English Center', 'Anh Ngữ Việt Mỹ', 'Anh Văn Việt Mỹ', 'Anh Quốc Academy', 'ANH NGỮ SCHOLA',
      'Tiểu học Nguyễn Siêu', 'Bà Rịa Vũng Tàu', 'Mr', 'Drew School', 'Công Ty TNHH AZ Mỹ Việt', 'EMASI Nam Long',
      // institutions that start with a surname or a given name, or are two capitalised words
      'Nguyen Sieu School', 'Lê Quý Đôn High School', 'Hoàng Gia Academy', 'Hồ Chí Minh City Open University', 'Ho Chi Minh City', 'Phan Thiết',
      'Trần Đại Nghĩa Gifted High School', 'Peter Pan Kindergarten', 'Alice English Club', 'Language Link Vietnam', 'Point Avenue', 'Wall Street English',
      'Byan Teach', 'Dong Tay Education', 'Swinburne Việt Nam', 'Seameo Retrac', 'Wilmar CLV', 'Sentia', 'Nam Uc Scotch AGS',
      'Global E-School, Son Tra, Da Nang', 'Inter-Continental Language Center', "Fisher's Superkids Academy", 'Công Ty TNHH Đào Tạo Huy Hoàng',
      'Trường Đại Học Kinh Tế - Tài Chính Thành Phố Hồ Chí Minh', 'EMASI Nam Long - EMASI International Bilingual Schools', '(Confidential)', '-',
      // Vietnamese words that FOLD to an English given name (bến → ben, dân → dan) are not one
      'Bến Thành Tourist', 'Dân Trí', 'Nhà Hàng Lê', 'Cửa Hàng Đồ Gỗ',
      // a title before four words that do not start with a surname is a business, not a person
      'Anh Em Sài Gòn Café', 'Cô Ba Sài Gòn Bakery',
      // …and in lower case
      'trung tâm anh ngữ abc', 'anh ngữ việt mỹ', 'công ty tnhh az mỹ việt', 'power english', 'the english corner', 'tiểu học nguyễn siêu']) {
      expect(namesAPerson(e), e).toBe(false)
    }
  })

  it('refuses a fact that is not one: an unknown category or a malformed posting day; an impossible apply-by is left out, the ad kept', () => {
    const job = mapped(teast)
    expect(jobAdSightingOf({ ...teast, category: 'sales' }, job)).toBeNull()
    for (const postedOn of ['7 Oct', '2026-02-30', '2026-11-31', '0000-01-01']) {
      expect(jobAdSightingOf(teast, { ...job, attributes: { ...job.attributes, postedOn } }), postedOn).toBeNull()
    }
    for (const applyBy of ['soon', '2026-11-31', '2026-10-32', '2026-02-29']) {
      expect(jobAdSightingOf(teast, { ...job, applyBy }), applyBy).toMatchObject({ applyBy: null, postedOn: '2026-10-07' })
    }
    // "2026-10-32" passes mapStagedJob's shape check and its cap (the importer treats the stage as untrusted): left out here.
    const late = { ...teast, datePosted: '2026-10-19T02:00:00.000Z', applyBy: '2026-10-32' }
    expect(mapped(late).applyBy).toBe('2026-10-32')
    expect(sightingOf(late)).toMatchObject({ applyBy: null, postedOn: '2026-10-19' })
  })

  it('isCalendarDay: the shape and the calendar (a round trip), and no year 0000', () => {
    for (const d of ['2026-10-07', '2028-02-29', '2026-12-31']) expect(isCalendarDay(d), d).toBe(true)
    for (const d of ['2026-11-31', '2026-02-29', '2026-10-32', '2026-13-01', '0000-01-01', '2026-1-7', '7 Oct', '', null, undefined]) {
      expect(isCalendarDay(d), String(d)).toBe(false)
    }
  })
})

describe('workPermitSupportOf — the work-permit flag, as a boolean only', () => {
  it('true when an item says the employer provides, supports, sponsors, arranges, covers or helps with it — English and Vietnamese', () => {
    for (const text of [
      'ESL Teacher – Da Nang, Vietnam | Up to VND 470K/hour + Work Permit Support', // a staged title (eslgorilla, 2026-09-21)
      'Work permit support', 'Work permit provided', 'Full work permit sponsorship', 'We sponsor your work permit', 'Help with the work permit',
      'Assistance with work permit application', 'Work permit costs covered by the school', 'Benefits: housing, work permit, health insurance',
      'Free housing + work permit', 'Labour permit arranged', '#WorkPermitSupport', 'workpermit included',
      'Hỗ trợ giấy phép lao động', 'Hỗ trợ làm GPLĐ', 'Cung cấp giấy phép làm việc', 'Bảo lãnh giấy phép lao động',
      'Công ty làm giấy phép lao động cho giáo viên', 'ho tro giay phep lao dong',
    ]) expect(workPermitSupportOf(text), text).toBe(true)
  })

  it('null when it names a work permit without saying so: a requirement, a "no", a bare mention, a line cut short — or a negation or the candidate\'s own arranging anywhere in the item', () => {
    for (const text of [
      'Must hold a valid work permit', 'Work permit required', 'Work permit holders preferred', 'Candidates with a work permit only',
      'No work permit support', 'Work permit support not available', 'Must have work permit, housing support provided',
      'Work permit; housing support', 'Work permit. Housing support provided.', 'Salary 20M + work permit', 'Comprehensive work permit and',
      'Phải có giấy phép lao động', 'Yêu cầu có giấy phép lao động', 'Không hỗ trợ giấy phép lao động', 'Đã có GPLĐ',
      // round-2 review (2026-10-20): a contraction, a cue a few words away, the candidate's own doing — each also holds a support word
      "We don't sponsor work permits", 'We cannot sponsor work permits', "We can't provide a work permit", 'Unable to sponsor work permits',
      "School doesn't provide work permit", 'Teachers must arrange their own work permit', 'Candidates are responsible for arranging their work permit',
      'Work permit costs are not reimbursed', 'Work permit at your own cost, free housing', 'Chúng tôi không thể hỗ trợ giấy phép lao động',
      'Giáo viên tự lo giấy phép lao động',
    ]) expect(workPermitSupportOf(text), text).toBeNull()
  })

  it('false when it names none; any text that says support wins over one that only names it', () => {
    for (const text of ['ESL Teacher', '40,000,000 VND / month', 'Work from home', 'Permit to teach', 'Giấy phép kinh doanh', '', null, undefined]) {
      expect(workPermitSupportOf(text), String(text)).toBe(false)
    }
    expect(workPermitSupportOf()).toBe(false)
    expect(workPermitSupportOf('Must hold a work permit', 'Work permit support for renewals')).toBe(true)
    expect(workPermitSupportOf('ESL Teacher', 'Work permit required')).toBeNull()
  })

  it('jobAdSightingOf reads it from the RAW title and pay line — the pay line before mapStagedJob drops it — and refreshes nothing else', () => {
    expect(sightingOf({ ...teast, title: 'ESL Teacher + Work Permit Support' }).workPermitSupport).toBe(true)
    expect(sightingOf({ ...teast, salary: '40,000,000 VND / month; must hold a work permit' })).toMatchObject({ workPermitSupport: null, salaryMin: 40_000_000 })
    expect(sightingOf(visaPayLine).workPermitSupport).toBe(true)
    expect(mapped(visaPayLine).attributes.salaryText).toBeUndefined() // the line itself was dropped for the listing
  })
})

describe('sightingsToLog — a moderator\'s removal is final in the log too', () => {
  it('drops every ad whose stored listing is removed; keeps active, hidden, sold and not-yet-stored ones', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((k) => ({ externalId: `teast:${k}` }))
    const stored = [
      { externalId: 'teast:a', status: 'active' }, { externalId: 'teast:b', status: 'removed' }, { externalId: 'teast:c', status: 'hidden' },
      { externalId: 'teast:d', status: 'sold' }, { externalId: null, status: 'removed' },
    ]
    expect(sightingsToLog(rows, stored).map((r) => r.externalId)).toEqual(['teast:a', 'teast:c', 'teast:d', 'teast:e'])
    expect(sightingsToLog(rows, [])).toEqual(rows)
  })
})

describe('recordJobAdSightings — batched, never throws, and one bad row loses only itself', () => {
  const fakeDb = (impl: (sql: string, ...v: unknown[]) => Promise<number>) => {
    const calls: unknown[][] = []
    const db: SightingDb = { $executeRawUnsafe: async (sql, ...v) => { calls.push([sql, ...v]); return impl(sql, ...v) } }
    return { db, calls }
  }
  const rowsOf = (n: number): JobAdSighting[] => Array.from({ length: n }, (_, i) => ({ ...sightingOf(teast), externalId: `teast:ad-${i}` }))
  const keysOf = (json: unknown) => (JSON.parse(json as string) as { externalId: string }[]).map((r) => r.externalId)
  /** Prisma 7's raw-query failure through the pg driver adapter (client runtime: P2010, the SQLSTATE in meta and message). */
  const prismaDataError = (code: string, message: string) => Object.assign(new Error(`Raw query failed. Code: \`${code}\`. Message: \`${message}\``),
    { code: 'P2010', meta: { driverAdapterError: { name: 'DriverAdapterError', cause: { kind: 'postgres', originalCode: code, originalMessage: message } } } })

  it('one statement per SIGHTING_CHUNK ads, at the stage\'s own time (as ISO), keys deduplicated — the first kept', async () => {
    const { db, calls } = fakeDb(async (_sql, _at, json) => JSON.parse(json as string).length)
    const rows = rowsOf(SIGHTING_CHUNK * 2 + 1)
    const dup = { ...rows[0]!, title: 'a later copy' }
    const out = await recordJobAdSightings(db, [...rows, dup], '2026-10-19T07:02:58.826+07:00', vi.fn())
    expect(out).toEqual({ ok: true, ads: SIGHTING_CHUNK * 2 + 1, written: SIGHTING_CHUNK * 2 + 1 })
    expect(calls.map((c) => JSON.parse(c[2] as string).length)).toEqual([SIGHTING_CHUNK, SIGHTING_CHUNK, 1])
    for (const c of calls) expect(c.slice(0, 2)).toEqual([JOB_AD_SIGHTING_UPSERT_SQL, STAGED_AT])
    expect(JSON.parse(calls[0]![2] as string)[0].title).toBe('ESL Teacher')
  })

  it('writes nothing for no ads', async () => {
    const { db, calls } = fakeDb(async () => 0)
    expect(await recordJobAdSightings(db, [], STAGED_AT, vi.fn())).toEqual({ ok: true, ads: 0, written: 0 })
    expect(calls).toHaveLength(0)
  })

  it('⛔ a missing table, any other error or a bad stagedAt is warned and RETURNED — never thrown, never retried row by row; earlier chunks stay written', async () => {
    const missing = Object.assign(new Error('Raw query failed. Code: `42P01`. Message: `relation "JobAdSighting" does not exist`'), { code: 'P2010' })
    const warn = vi.fn()
    const gone = fakeDb(async () => { throw missing })
    let r = await recordJobAdSightings(gone.db, rowsOf(3), STAGED_AT, warn)
    expect(r).toEqual({ ok: false, ads: 3, written: 0, error: 'the JobAdSighting table does not exist yet — run scripts/job-ad-sightings-ddl.mjs', refused: [] })
    expect(gone.calls).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('job-ad history log NOT written (3 ads')

    let n = 0
    const flaky = fakeDb(async () => { if (n++) throw new Error('Connection terminated unexpectedly'); return SIGHTING_CHUNK })
    r = await recordJobAdSightings(flaky.db, rowsOf(SIGHTING_CHUNK + 5), STAGED_AT, vi.fn())
    expect(r).toEqual({ ok: false, ads: SIGHTING_CHUNK + 5, written: SIGHTING_CHUNK, error: 'Connection terminated unexpectedly', refused: [] })
    expect(flaky.calls).toHaveLength(2)

    const untouched = fakeDb(async () => 1)
    // Not a date; a day that is not on the calendar and an hour 24, both of which Date.parse would move to another day.
    for (const bad of ['not a date', '2026-02-30T00:02:58.826Z', '2026-10-19T24:00:00Z', '2026-10-19']) {
      r = await recordJobAdSightings(untouched.db, rowsOf(2), bad, vi.fn())
      expect(r, bad).toMatchObject({ ok: false, ads: 2, written: 0, refused: [] })
    }
    expect(untouched.calls).toHaveLength(0)
  })

  it('⛔ a chunk refused for a VALUE (SQLSTATE class 22) is sent again one row at a time: the bad rows are named, every other row written', async () => {
    const bad = new Set(['teast:ad-1', 'teast:ad-3'])
    // However the code arrives: Prisma's meta and message, the bare message, or the driver's own code (pg, PGlite).
    for (const error of [prismaDataError('22P02', 'invalid input syntax for type json'),
      new Error('Raw query failed. Code: `22008`. Message: `date/time field value out of range`'),
      Object.assign(new Error('unsupported Unicode escape sequence'), { code: '22P05' })]) {
      const { db, calls } = fakeDb(async (_sql, _at, json) => {
        const keys = keysOf(json)
        if (keys.some((k) => bad.has(k))) throw error
        return keys.length
      })
      const warn = vi.fn()
      const r = await recordJobAdSightings(db, rowsOf(5), STAGED_AT, warn)
      expect(r, error.message).toMatchObject({ ok: false, ads: 5, written: 3, refused: ['teast:ad-1', 'teast:ad-3'] })
      expect(!r.ok && r.error).toContain('2 of 5 ads NOT written')
      expect(!r.ok && r.error).toContain('"teast:ad-1", "teast:ad-3"')
      expect(calls.map((c) => keysOf(c[2]).length)).toEqual([5, 1, 1, 1, 1, 1])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]![0]).toContain('job-ad history log: 2 of 5 ads NOT written')
    }
  })

  it('a refused row in a chunk of one is not sent twice; the other chunks are written as ever', async () => {
    const { db, calls } = fakeDb(async (_sql, _at, json) => {
      const keys = keysOf(json)
      if (keys.includes(`teast:ad-${SIGHTING_CHUNK}`)) throw prismaDataError('22008', 'date/time field value out of range')
      return keys.length
    })
    const r = await recordJobAdSightings(db, rowsOf(SIGHTING_CHUNK + 1), STAGED_AT, vi.fn())
    expect(r).toMatchObject({ ok: false, written: SIGHTING_CHUNK, refused: [`teast:ad-${SIGHTING_CHUNK}`] })
    expect(calls).toHaveLength(2)
  })

  it('a connection lost DURING the row-by-row retry ends the write as any other error — the rows refused so far still named', async () => {
    let retries = 0
    const { db } = fakeDb(async (_sql, _at, json) => {
      const keys = keysOf(json)
      if (keys.length > 1) throw prismaDataError('22P02', 'invalid input syntax for type json')
      if (keys[0] === 'teast:ad-0') throw prismaDataError('22P02', 'invalid input syntax for type json')
      if (++retries > 1) throw new Error('Connection terminated unexpectedly')
      return 1
    })
    const r = await recordJobAdSightings(db, rowsOf(4), STAGED_AT, vi.fn())
    expect(r).toEqual({ ok: false, ads: 4, written: 1, error: 'Connection terminated unexpectedly', refused: ['teast:ad-0'] })
  })
})

// ── the DDL, pinned to schema.prisma ────────────────────────────────────────────────────────────────────────────────────
const ddlScript = readFileSync(join(process.cwd(), 'scripts/job-ad-sightings-ddl.mjs'), 'utf8')
const ddlCode = ddlScript.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
/** The script's statements, in order (each a backtick string inside STATEMENTS, its comments left out), and its SHAPE assertion. */
const DDL_STATEMENTS = [.../const STATEMENTS = \[([\s\S]*?)\n\]\n/.exec(ddlCode)![1]!.matchAll(/`([^`]*)`/g)].map((m) => m[1]!)
const DDL_SHAPE = [.../const SHAPE = \[([\s\S]*?)\]\.join/.exec(ddlScript)![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const modelBody = /^model JobAdSighting \{([\s\S]*?)^\}/m.exec(schema)![1]!
/** The model's fields, in order: name, Prisma type, attributes. */
const modelFields = modelBody.split('\n').map((l) => /^\s+(\w+)\s+(\S+)(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
  .map((m) => ({ name: m[1]!, type: m[2]!, attrs: m[3]!.trim() }))
/** The columns the statement fills itself rather than from the writer's JSON. */
const KEPT_BY_THE_STATEMENT = ['firstSeenAt', 'lastSeenAt', 'seenCount', 'lastPostedOn']

/** Prisma's own DDL for a scalar field (what `migrate diff` prints). */
function prismaDdl(type: string, attrs: string): string {
  const base = type.replace(/\?$/, '')
  const sql = base === 'String' ? 'TEXT' : base === 'Int' ? 'INTEGER' : base === 'Boolean' ? 'BOOLEAN'
    : base === 'DateTime' ? (/@db\.Date\b/.test(attrs) ? 'DATE' : 'TIMESTAMP(3)') : null
  if (!sql) throw new Error(`no DDL mapping for ${type}`)
  const dflt = /@default\(([^)]*)\)/.exec(attrs)?.[1]
  return `${sql}${type.endsWith('?') ? '' : ' NOT NULL'}${dflt ? ` DEFAULT ${dflt}` : ''}`
}

describe('scripts/job-ad-sightings-ddl.mjs ↔ prisma/schema.prisma ↔ the upsert', () => {
  it('creates exactly the model\'s columns, in its order, with Prisma\'s own types — the key and the index Prisma names', () => {
    const create = DDL_STATEMENTS[0]!
    const cols = [...create.matchAll(/^\s*"(\w+)" ([A-Z0-9() ]+?),?$/gm)].map((m) => [m[1], m[2]])
    expect(cols).toEqual(modelFields.map((f) => [f.name, prismaDdl(f.type, f.attrs)]))
    expect(cols).toContainEqual(['workPermitSupport', 'BOOLEAN'])
    expect(cols).toContainEqual(['lastPostedOn', 'DATE NOT NULL'])
    expect(modelFields.find((f) => f.attrs.includes('@id'))?.name).toBe('externalId')
    expect(create).toContain('CONSTRAINT "JobAdSighting_pkey" PRIMARY KEY ("externalId")')
    expect(modelBody).toMatch(/^\s+@@index\(\[board, firstSeenAt\]\)$/m)
    expect(DDL_STATEMENTS[1]).toBe('CREATE INDEX IF NOT EXISTS "JobAdSighting_board_firstSeenAt_idx" ON public."JobAdSighting"("board", "firstSeenAt")')
  })

  it('the SHAPE the script asserts is the model\'s, column for column', () => {
    const pgType = (f: { type: string; attrs: string }) => {
      const base = f.type.replace(/\?$/, '')
      return base === 'String' ? 'text' : base === 'Int' ? 'integer' : base === 'Boolean' ? 'boolean'
        : /@db\.Date\b/.test(f.attrs) ? 'date' : 'timestamp without time zone'
    }
    expect(DDL_SHAPE).toEqual(modelFields.map((f) => `${f.name}:${pgType(f)}:${f.type.endsWith('?') ? 'YES' : 'NO'}`))
  })

  it('⛔ is FK-free and additive only — no relation in the model; no DROP, ALTER COLUMN, TRUNCATE or foreign key in the statements, no Listing anywhere', () => {
    expect(modelBody).not.toContain('@relation')
    expect(DDL_STATEMENTS).toHaveLength(4)
    expect(DDL_STATEMENTS.join('\n')).not.toMatch(/\bdrop\b|alter\s+column|\btruncate\b|\breferences\b|foreign\s+key/i)
    expect(ddlCode).not.toMatch(/\bdrop\b|"Listing"/i)
  })

  it('⛔ runs in ONE transaction under a lock_timeout, switches RLS on with NO policy, and revokes anon, authenticated and PUBLIC', () => {
    const at = (s: string) => ddlCode.indexOf(s)
    expect(at("client.query('BEGIN')")).toBeGreaterThan(-1)
    expect(at("client.query('BEGIN')") < at("SET LOCAL lock_timeout = '5s'") && at("SET LOCAL lock_timeout = '5s'") < at('for (const [label, sql] of STATEMENTS)') &&
      at('for (const [label, sql] of STATEMENTS)') < at("client.query('COMMIT')")).toBe(true)
    expect(DDL_STATEMENTS[2]).toBe('ALTER TABLE public."JobAdSighting" ENABLE ROW LEVEL SECURITY')
    for (const role of ['anon', 'authenticated', 'PUBLIC']) expect(DDL_STATEMENTS[3]).toContain(`REVOKE ALL ON public."JobAdSighting" FROM ${role}`)
    expect(ddlCode).not.toMatch(/create\s+policy|\bgrant\b/i)
  })

  it('the upsert writes exactly the model\'s columns: SIGHTING_FIELDS plus the four it keeps itself — refreshes every fact, and widens the posting days', () => {
    const insert = /INSERT INTO "JobAdSighting" AS s \(([^)]*)\)/.exec(JOB_AD_SIGHTING_UPSERT_SQL)![1]!.match(/"(\w+)"/g)!.map((c) => c.slice(1, -1))
    expect(insert).toEqual(modelFields.map((f) => f.name))
    expect(insert.filter((c) => !KEPT_BY_THE_STATEMENT.includes(c))).toEqual([...SIGHTING_FIELDS])
    const recordset = /AS r\(([^)]*)\)/.exec(JOB_AD_SIGHTING_UPSERT_SQL)![1]!.match(/"(\w+)"/g)!.map((c) => c.slice(1, -1))
    expect(recordset).toEqual([...SIGHTING_FIELDS])
    // A first sighting's latest posting day is its posting day.
    expect(JOB_AD_SIGHTING_UPSERT_SQL).toContain('r."postedOn", r."postedOn", r."applyBy"')
    for (const f of SIGHTING_FIELDS.filter((x) => !['externalId', 'board', 'listingId', 'postedOn'].includes(x))) {
      expect(JOB_AD_SIGHTING_UPSERT_SQL, f).toContain(`"${f}" = CASE WHEN excluded."lastSeenAt" > s."lastSeenAt" THEN excluded."${f}" ELSE s."${f}" END`)
    }
    expect(JOB_AD_SIGHTING_UPSERT_SQL).toContain('"postedOn" = LEAST(s."postedOn", excluded."postedOn")')
    expect(JOB_AD_SIGHTING_UPSERT_SQL).toContain('"lastPostedOn" = GREATEST(s."lastPostedOn", excluded."lastPostedOn")')
    expect(JOB_AD_SIGHTING_UPSERT_SQL).not.toContain('"postedOn" = CASE')
    expect(JOB_AD_SIGHTING_UPSERT_SQL).not.toContain('${')
  })
})

describe('scripts/import-jobs.ts — the one ingest path, wired', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/import-jobs.ts'), 'utf8')
  it('maps a sighting for exactly the ads it keeps, and writes them once — on --apply only, after the listing writes, before the retire step', () => {
    expect(src.indexOf('jobAdSightingOf(j, r.job)')).toBeGreaterThan(src.indexOf('keep.push({ ...r.job, coverPath: coverFile })'))
    expect(src.match(/recordJobAdSightings\(/g)).toHaveLength(1)
    const at = (s: string) => src.indexOf(s)
    expect(at('if (!APPLY) {') < at('for (const p of toCreate)') && at('for (const p of toCreate)') < at('recordJobAdSightings(db,') &&
      at('recordJobAdSightings(db,') < at('const retire =')).toBe(true)
    expect(src).toContain('stage.stagedAt)')
  })

  it('⛔ a history row it cannot make never stops the run: the mapping is inside a try, its catch warns', () => {
    expect(src).toMatch(/try \{\s+const sighting = jobAdSightingOf\(j, r\.job\)\s+if \(sighting\) sighted\.push\(sighting\)\s+else unlogged\+\+\s+\} catch \(e\) \{\s+unlogged\+\+\s+console\.warn\(`  ! job-ad history log: /)
    // …and a kept ad the log's own screens refused is counted in the plan line, never dropped in silence.
    expect(src).toContain("${unlogged ? ` (${unlogged} kept ads not logged: a fact failed the log's screens)` : ''}")
  })

  it('⛔ an ad whose listing a moderator removed is left out of the write, the plan line and the dry-run sample alike', () => {
    const filter = 'const toLog = sightingsToLog(sighted, stored)'
    expect(src.indexOf(filter)).toBeGreaterThan(src.indexOf('const stored = '))
    expect(src).toContain('recordJobAdSightings(db, toLog.map(')
    expect(src).toMatch(/history log {7}\$\{toLog\.length\} ads → JobAdSighting/)
    expect(src).toContain('JSON.stringify({ ...toLog[0], listingId:')
    // Past the filter, the unfiltered list is read for one thing only: how many it left out.
    const after = src.slice(src.indexOf(filter) + filter.length)
    expect([...after.matchAll(/\bsighted\b(?!\.length)/g)]).toHaveLength(0)
    expect(src.indexOf(filter)).toBeLessThan(src.indexOf('history log       ${toLog.length}'))
  })
})

// ── the statements, EXECUTED ─────────────────────────────────────────────────────────────────────────────────────────────
type Pg = {
  query: <T = Record<string, unknown>>(text: string, values?: unknown[], options?: { rowMode?: 'array' | 'object' }) =>
    Promise<{ rows: T[]; fields: { name: string; dataTypeID: number }[]; affectedRows?: number }>
  exec: (sql: string) => Promise<unknown>
  close: () => Promise<void>
}
const pglite = await (async (): Promise<{ PGlite: { create: () => Promise<Pg> } } | null> => {
  const specifier = '@electric-sql/pglite'
  try { return (await import(/* @vite-ignore */ specifier)) as { PGlite: { create: () => Promise<Pg> } } } catch { return null }
})()

/**
 * ⛔ THE DDL AND THE UPSERT, EXECUTED. PGlite is Postgres 17 compiled to WASM, in-process — no server, no port (production is
 * 17.6). The fixture is Supabase's default privileges (every new public table handed to anon and authenticated; one more
 * grant to PUBLIC here), so the script's REVOKE is proven against grants that exist. The session runs in Vietnam time, so
 * the UTC storage of the stage's time is proven too. A missing PGlite skips this block locally and FAILS it in CI. The last
 * test drives the importer's real PrismaClient and @prisma/adapter-pg over this PGlite (a stand-in pg.Pool), so the error
 * shape the row-by-row retry reads is the client's own, not a fake one.
 */
describe.skipIf(!pglite && !process.env.CI)(`the DDL and JOB_AD_SIGHTING_UPSERT_SQL — run in PGlite${pglite ? '' : ' (SKIPPED: @electric-sql/pglite is not installed)'}`, () => {
  let pg: Pg
  /** recordJobAdSightings runs against PGlite exactly as against production's PrismaClient. */
  const db: SightingDb = { $executeRawUnsafe: async (sql, ...v) => (await pg.query(sql, v)).affectedRows ?? 0 }
  const TABLE = `'public."JobAdSighting"'`
  const API_GRANTS = `SELECT r.rolname FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
      AND (has_table_privilege(r.rolname, %T, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
           OR has_any_column_privilege(r.rolname, %T, 'SELECT,INSERT,UPDATE,REFERENCES'))
    UNION ALL SELECT 'PUBLIC' FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = %T::regclass AND a.grantee = 0`
  const grantsOn = async (table: string) => (await pg.query<{ rolname: string }>(API_GRANTS.replaceAll('%T', table))).rows.map((r) => r.rolname).sort()

  beforeAll(async () => {
    if (!pglite) throw new Error('@electric-sql/pglite is not installed — this block must run in CI')
    pg = await pglite.PGlite.create()
    await pg.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC;
      SET TimeZone = 'Asia/Ho_Chi_Minh';
      CREATE TABLE public.grant_probe (x int);
    `)
    for (const sql of DDL_STATEMENTS) await pg.exec(sql)
  }, 120_000) // PGlite's WASM start takes seconds, and minutes on a loaded machine (as price-stat.sql.test.ts allows)
  afterAll(async () => { await pg?.close() })

  type Row = Record<string, unknown>
  const read = async (key: string): Promise<Row | undefined> => (await pg.query<Row>(
    `SELECT "externalId", board, "firstSeenAt"::text AS "firstSeenAt", "lastSeenAt"::text AS "lastSeenAt", "seenCount", "listingId", title, city,
       employer, "employmentType", "salaryMin", "salaryMax", "salaryCurrency", "salaryPeriod", "workPermitSupport", category, subcategory,
       "postedOn"::text AS "postedOn", "lastPostedOn"::text AS "lastPostedOn", "applyBy"::text AS "applyBy"
     FROM "JobAdSighting" WHERE "externalId" = $1`, [key])).rows[0]
  const upsert = async (rows: JobAdSighting[], at: string) => (await pg.query(JOB_AD_SIGHTING_UPSERT_SQL, sightingUpsertParams(rows, at))).affectedRows

  it('the fixture is real: a table made without the script IS open to anon, authenticated and PUBLIC', async () => {
    expect(await grantsOn(`'public.grant_probe'`)).toEqual(['PUBLIC', 'anon', 'authenticated'])
  })

  it('⛔ makes the table the script asserts (SHAPE), RLS on — and closed to anon, authenticated and PUBLIC', async () => {
    const cols = await pg.query<{ s: string }>(`SELECT column_name || ':' || data_type || ':' || is_nullable AS s FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'JobAdSighting' ORDER BY ordinal_position`)
    expect(cols.rows.map((r) => r.s)).toEqual(DDL_SHAPE)
    expect((await pg.query<{ on: boolean }>(`SELECT relrowsecurity AS on FROM pg_class WHERE oid = ${TABLE}::regclass`)).rows).toEqual([{ on: true }])
    expect((await pg.query(`SELECT 1 FROM pg_policies WHERE tablename = 'JobAdSighting'`)).rows).toEqual([])
    expect(await grantsOn(TABLE)).toEqual([])
    expect((await pg.query<{ i: string }>(`SELECT indexname AS i FROM pg_indexes WHERE tablename = 'JobAdSighting' ORDER BY 1`)).rows.map((r) => r.i))
      .toEqual(['JobAdSighting_board_firstSeenAt_idx', 'JobAdSighting_pkey'])
  })

  it('every statement runs again without error (idempotent), and the table stays closed', async () => {
    for (const sql of DDL_STATEMENTS) await pg.exec(sql)
    expect(await grantsOn(TABLE)).toEqual([])
  })

  it('a first sighting inserts — seenCount 1, first and last seen the stage\'s time, stored as UTC whatever the session\'s zone; lastPostedOn = postedOn', async () => {
    const row = sightingOf(teast)
    expect(await upsert([row], STAGED_AT)).toBe(1)
    expect(await read(row.externalId)).toEqual({
      ...row, firstSeenAt: '2026-10-19 00:02:58.826', lastSeenAt: '2026-10-19 00:02:58.826', seenCount: 1, lastPostedOn: '2026-10-07',
    })
    // Nulls land as NULL (no employer, no pay); the work-permit flag lands as the boolean it is.
    const bare = { ...sightingOf(visaPayLine), employer: null }
    await upsert([bare], STAGED_AT)
    expect(await read(bare.externalId)).toMatchObject({ employer: null, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null, workPermitSupport: true })
  })

  it('a later stage moves lastSeenAt, counts once, refreshes the facts (work permit support included) — and a listing id, once known, is never erased', async () => {
    const key = sightingOf(teast).externalId
    await upsert([{ ...sightingOf(teast), listingId: 'cm-listing-1' }], '2026-10-20T00:01:00.000Z')
    expect(await read(key)).toMatchObject({ firstSeenAt: '2026-10-19 00:02:58.826', lastSeenAt: '2026-10-20 00:01:00', seenCount: 2, listingId: 'cm-listing-1', workPermitSupport: false })
    const raised = sightingOf({ ...teast, salary: '45,000,000 VND / month + work permit support', employment: 'FULL_TIME' })
    expect(raised.workPermitSupport).toBe(true)
    expect(await upsert([{ ...raised, listingId: null }], '2026-10-21T00:01:00.000Z')).toBe(1)
    expect(await read(key)).toMatchObject({
      lastSeenAt: '2026-10-21 00:01:00', seenCount: 3, listingId: 'cm-listing-1', salaryMin: 45_000_000, employmentType: 'fulltime', workPermitSupport: true,
    })
  })

  it('the same stage again changes nothing — except a listing id it can now fill in, without counting', async () => {
    const key = sightingOf(teast).externalId
    const before = await read(key)
    expect(await upsert([sightingOf(teast)], '2026-10-21T00:01:00.000Z')).toBe(0)
    expect(await read(key)).toEqual(before)

    const fresh = sightingOf({ ...teast, url: 'https://teast.co/job/fresh-ad-1' })
    await upsert([fresh], '2026-10-21T00:01:00.000Z')
    expect(await upsert([{ ...fresh, listingId: 'cm-listing-2' }], '2026-10-21T00:01:00.000Z')).toBe(1)
    expect(await read(fresh.externalId)).toMatchObject({ seenCount: 1, listingId: 'cm-listing-2', lastSeenAt: '2026-10-21 00:01:00' })
  })

  it('an older stage imported late moves firstSeenAt back and counts, never rewriting the facts; one inside the range is a no-op', async () => {
    const key = sightingOf(teast).externalId
    const older = { ...sightingOf({ ...teast, salary: '30,000,000 VND / month' }), title: 'An older title' }
    expect(older.workPermitSupport).toBe(false)
    expect(await upsert([older], '2026-10-18T00:01:00.000Z')).toBe(1)
    expect(await read(key)).toMatchObject({
      firstSeenAt: '2026-10-18 00:01:00', lastSeenAt: '2026-10-21 00:01:00', seenCount: 4, title: 'ESL Teacher', salaryMin: 45_000_000, workPermitSupport: true,
    })
    expect(await upsert([older], '2026-10-20T12:00:00.000Z')).toBe(0)
    expect(await read(key)).toMatchObject({ seenCount: 4, title: 'ESL Teacher' })
  })

  it('⛔ a RE-POST under the same link keeps its first sighting: postedOn stays the first posting day, lastPostedOn moves to the re-post, the facts follow it', async () => {
    const url = 'https://teast.co/job/reposted-ad-1'
    const first = sightingOf({ ...teast, url })
    expect(await upsert([first], '2026-10-08T00:01:00.000Z')).toBe(1)
    const repost = sightingOf({ ...teast, url, title: 'ESL Teacher (re-posted)', datePosted: '2026-10-15T02:00:00.000Z' })
    expect(repost.postedOn).toBe('2026-10-15')
    expect(await upsert([repost], '2026-10-16T00:01:00.000Z')).toBe(1)
    expect(await read(first.externalId)).toMatchObject({
      firstSeenAt: '2026-10-08 00:01:00', lastSeenAt: '2026-10-16 00:01:00', seenCount: 2, postedOn: '2026-10-07', lastPostedOn: '2026-10-15', title: 'ESL Teacher (re-posted)',
    })
    // An older stage carrying an earlier posting day widens postedOn back and counts — and rewrites no fact.
    const earlier = sightingOf({ ...teast, url, title: 'An even older title', datePosted: '2026-10-05T06:00:00.000Z' })
    expect(await upsert([earlier], '2026-10-06T00:01:00.000Z')).toBe(1)
    expect(await read(first.externalId)).toMatchObject({
      firstSeenAt: '2026-10-06 00:01:00', seenCount: 3, postedOn: '2026-10-05', lastPostedOn: '2026-10-15', title: 'ESL Teacher (re-posted)',
    })
    // A stage inside the seen range that carries a later posting day widens lastPostedOn — without counting or refreshing.
    const between = sightingOf({ ...teast, url, title: 'In between', datePosted: '2026-10-17T02:00:00.000Z' })
    expect(await upsert([between], '2026-10-10T00:01:00.000Z')).toBe(1)
    expect(await read(first.externalId)).toMatchObject({
      firstSeenAt: '2026-10-06 00:01:00', lastSeenAt: '2026-10-16 00:01:00', seenCount: 3, postedOn: '2026-10-05', lastPostedOn: '2026-10-17', title: 'ESL Teacher (re-posted)',
    })
    // …and the same again is a no-op.
    expect(await upsert([between], '2026-10-10T00:01:00.000Z')).toBe(0)
  })

  it('recordJobAdSightings, end to end: the count it reports — and a missing table returned, not thrown', async () => {
    const ads = [sightingOf({ ...teast, url: 'https://teast.co/job/e2e-1' }), sightingOf({ ...teast, url: 'https://teast.co/job/e2e-2' })]
    expect(await recordJobAdSightings(db, ads, STAGED_AT, vi.fn())).toEqual({ ok: true, ads: 2, written: 2 })
    expect(await recordJobAdSightings(db, ads, STAGED_AT, vi.fn())).toEqual({ ok: true, ads: 2, written: 0 })
    await pg.exec('ALTER TABLE "JobAdSighting" RENAME TO "JobAdSighting_away"')
    try {
      const warn = vi.fn()
      expect(await recordJobAdSightings(db, ads, '2026-10-22T00:00:00.000Z', warn))
        .toEqual({ ok: false, ads: 2, written: 0, error: 'the JobAdSighting table does not exist yet — run scripts/job-ad-sightings-ddl.mjs', refused: [] })
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      await pg.exec('ALTER TABLE "JobAdSighting_away" RENAME TO "JobAdSighting"')
    }
  })

  it('⛔ the three malformed values, through jobAdSightingOf as the importer runs: each ad is STORED, cleaned — none voids the run', async () => {
    const stages = [
      { ...teast, url: 'https://teast.co/job/emoji-at-cut', title: emojiAtCut },
      { ...teast, url: 'https://teast.co/job/nul-title', title: nulTitle },
      { ...teast, url: 'https://teast.co/job/impossible-day', datePosted: '2026-10-19T02:00:00.000Z', applyBy: '2026-10-32' },
    ]
    const rows = stages.map(sightingOf)
    expect(await recordJobAdSightings(db, rows, STAGED_AT, vi.fn())).toEqual({ ok: true, ads: 3, written: 3 })
    expect(await read('teast:emoji-at-cut')).toMatchObject({ title: `ESL Teacher ${'x'.repeat(187)}` })
    expect(await read('teast:nul-title')).toMatchObject({ title: 'ESL Teacher Hanoi' })
    expect(await read('teast:impossible-day')).toMatchObject({ applyBy: null, postedOn: '2026-10-19' })
  })

  it('⛔ …and sent RAW (a caller that skipped jobAdSightingOf): Postgres refuses each (22P02, 22P05, 22008), and each loses ONLY ITS OWN row', async () => {
    const base = sightingOf(teast)
    const clean = (k: string): JobAdSighting => ({ ...base, externalId: `teast:raw-clean-${k}` })
    const bad: JobAdSighting[] = [
      { ...base, externalId: 'teast:raw-lone-surrogate', title: emojiAtCut.slice(0, 200) },
      { ...base, externalId: 'teast:raw-nul', title: nulTitle },
      { ...base, externalId: 'teast:raw-impossible-day', applyBy: '2026-11-31' },
    ]
    for (const row of bad) {
      await expect(pg.query(JOB_AD_SIGHTING_UPSERT_SQL, sightingUpsertParams([row], STAGED_AT)), row.externalId).rejects.toMatchObject({ code: expect.stringMatching(/^22/) })
    }
    const warn = vi.fn()
    const r = await recordJobAdSightings(db, [clean('1'), bad[0]!, clean('2'), bad[1]!, bad[2]!, clean('3')], STAGED_AT, warn)
    expect(r).toMatchObject({ ok: false, ads: 6, written: 3, refused: ['teast:raw-lone-surrogate', 'teast:raw-nul', 'teast:raw-impossible-day'] })
    expect(!r.ok && r.error).toContain('3 of 6 ads NOT written')
    expect(warn).toHaveBeenCalledTimes(1)
    for (const k of ['1', '2', '3']) expect(await read(`teast:raw-clean-${k}`), k).toMatchObject({ seenCount: 1, title: 'ESL Teacher' })
    for (const row of bad) expect(await read(row.externalId), row.externalId).toBeUndefined()
  })

  it('⛔ through the importer\'s REAL Prisma client and adapter-pg: each refused value loses only its own row, and a missing table is returned, not thrown', async () => {
    /** A pg.Pool that runs adapter-pg's one call (performIO: { text, values, rowMode: 'array' }) in this PGlite — no server,
     *  no port. Measured 2026-10-20 (Prisma 7.9.1): a refusal arrives as P2010, its SQLSTATE in meta.driverAdapterError. */
    class LitePool extends Pool {
      override async query(config: any): Promise<any> {
        const r = await pg.query(config.text, config.values, { rowMode: 'array' })
        return { rows: r.rows, fields: r.fields, rowCount: r.affectedRows ?? 0 }
      }
      override async end() {}
      // ⛔ Never a real server: adapter-pg takes a connection only for a transaction, which this write never opens.
      override async connect(): Promise<never> { throw new Error('LitePool opens no connection: every query runs in PGlite') }
    }
    const prisma = new PrismaClient({ adapter: new PrismaPg(new LitePool()) })
    try {
      const base = sightingOf(teast)
      const clean = (k: string): JobAdSighting => ({ ...base, externalId: `teast:prisma-clean-${k}` })
      // SQLSTATE class 22, each: 22P02 (a lone surrogate), 22P05 (a NUL), 22008 (an impossible day), 22003 (past an int4).
      const bad: JobAdSighting[] = [
        { ...base, externalId: 'teast:prisma-lone-surrogate', title: emojiAtCut.slice(0, 200) },
        { ...base, externalId: 'teast:prisma-nul', title: nulTitle },
        { ...base, externalId: 'teast:prisma-impossible-day', applyBy: '2026-11-31' },
        { ...base, externalId: 'teast:prisma-int-overflow', salaryMin: 3e9 },
      ]
      const warn = vi.fn()
      const r = await recordJobAdSightings(prisma, [clean('1'), bad[0]!, clean('2'), bad[1]!, bad[2]!, clean('3'), bad[3]!], STAGED_AT, warn)
      expect(r).toMatchObject({ ok: false, ads: 7, written: 3 })
      expect(!r.ok && r.refused).toEqual(bad.map((b) => b.externalId))
      expect(warn).toHaveBeenCalledTimes(1)
      for (const k of ['1', '2', '3']) expect(await read(`teast:prisma-clean-${k}`), k).toMatchObject({ seenCount: 1, title: 'ESL Teacher' })
      for (const row of bad) expect(await read(row.externalId), row.externalId).toBeUndefined()

      await pg.exec('ALTER TABLE "JobAdSighting" RENAME TO "JobAdSighting_away"')
      try {
        expect(await recordJobAdSightings(prisma, [clean('1')], '2026-10-22T00:00:00.000Z', warn))
          .toEqual({ ok: false, ads: 1, written: 0, error: 'the JobAdSighting table does not exist yet — run scripts/job-ad-sightings-ddl.mjs', refused: [] })
        expect(warn).toHaveBeenCalledTimes(2)
      } finally {
        await pg.exec('ALTER TABLE "JobAdSighting_away" RENAME TO "JobAdSighting"')
      }
    } finally {
      await prisma.$disconnect()
    }
  }, 120_000) // the client's WASM query compiler loads on its first query: seconds, more on a loaded machine
})
