import { describe, expect, it } from 'vitest'
import {
  JOB_BOARDS, JOB_SELLER_IDS, isExpiredJob, jobExternalId, jobNativeId, jobProvinces, jobStageProblem, jobType, mapStagedJob,
  normaliseJobUrl, parseJobPay, pdpTombstoneTags, unshout, type StagedJob,
} from './job-listing'
import { IMPORT_SELLERS } from './import-sellers'

// 2026-09-25 12:00 in Vietnam.
const NOW = Date.parse('2026-09-25T05:00:00Z')
const base: StagedJob = {
  key: 'k', url: 'https://www.careerlink.vn/tim-viec-lam/giao-vien-tieng-anh-da-nang/3629784?source=site', source: 'careerlink-teach',
  title: 'GIÁO VIÊN TIẾNG ANH [ ĐÀ NẴNG ]', employer: 'TẬP ĐOÀN GIÁO DỤC RES', city: 'Da Nang',
  salary: '10,000,000–30,000,000 VND / month', employment: 'FULL_TIME', datePosted: '2026-09-23T02:00:00.000Z',
  applyBy: '2026-10-23', category: 'teaching', coverPath: 'covers/k.png',
}
const map = (over: Partial<StagedJob> = {}) => mapStagedJob({ ...base, ...over }, NOW)

describe('mapStagedJob — a real CareerLink row', () => {
  it('maps to a clean reference listing', () => {
    const r = map()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const j = r.job
    expect(j.externalId).toBe('careerlink:3629784')
    expect(j.affiliateUrl).toBe('https://www.careerlink.vn/tim-viec-lam/giao-vien-tieng-anh-da-nang/3629784') // ?source=site stripped
    expect(j.sellerId).toBe('careerlink-vn-import-seller-0001')
    expect(j.title).toBe('Giáo Viên Tiếng Anh [Đà Nẵng] — Tập Đoàn Giáo Dục RES')
    expect(j.city).toBe('Đà Nẵng')
    // A RANGE is not a price: the card would state its floor as the pay. The filter still gets it.
    expect(j.price).toBe(0)
    expect(j.priceUnit).toBe('VND/month')
    expect(j.salaryM).toBe(10)
    expect(j.subcategorySlug).toBe('teaching')
    expect(j.attributes).toEqual({
      employer: 'Tập Đoàn Giáo Dục RES', salaryText: '10,000,000–30,000,000 VND / month', jobtype: 'fulltime',
      english: 'required', postedOn: '2026-09-23', applyBy: '2026-10-07', source: 'CareerLink.vn',
    })
    expect(j.description).toMatch(/^English-teaching job at Tập Đoàn Giáo Dục RES in Đà Nẵng \(full-time\), posted on CareerLink\.vn on 2026-09-23; apply by 2026-10-07\. Salary: 10,000,000–30,000,000 VND \/ month\.\n\n/)
    expect(j.description).toContain('never charges a fee')
    expect(j.descriptionVi).toContain('Mức lương: 10,000,000–30,000,000 VND / month.')
    expect(j.descriptionVi).toContain('(toàn thời gian)')
    // A single stated figure IS the price.
    const one = map({ salary: '50,000,000 VND / month' })
    expect(one.ok && [one.job.price, one.job.salaryM]).toEqual([50_000_000, 50])
  })

  it('caps apply-by at 14 days after posting, and refuses a job already closed', () => {
    const r = map({ applyBy: '2026-12-31' })
    expect(r.ok && r.job.applyBy).toBe('2026-10-07')
    expect(map({ applyBy: '2026-09-24' })).toEqual({ ok: false, reason: 'closed' })
    expect(map({ datePosted: '2026-09-10T00:00:00Z', applyBy: '2026-10-01' })).toEqual({ ok: false, reason: 'tooOld' })
    // Posted 14 days ago: today is its last listed day.
    const last = map({ datePosted: '2026-09-11T06:00:00Z', applyBy: '2026-10-01' })
    expect(last.ok && last.job.applyBy).toBe('2026-09-25')
    expect(map({ applyBy: 'soon' })).toEqual({ ok: false, reason: 'badDate' })
  })
})

describe('mapStagedJob — refusals', () => {
  it('refuses a source outside the closed map and a link off the board', () => {
    expect(map({ source: 'vieclam24h-teach' })).toEqual({ ok: false, reason: 'unknownSource' })
    expect(map({ url: 'https://evil.example/tim-viec-lam/x/3629784' })).toEqual({ ok: false, reason: 'badUrl' })
    expect(map({ url: 'http://www.careerlink.vn/tim-viec-lam/x/3629784' })).toEqual({ ok: false, reason: 'badUrl' })
    expect(map({ url: 'https://www.careerlink.vn/viec-lam/k/english' })).toEqual({ ok: false, reason: 'noJobId' })
  })

  it('drops a parse that read page chrome (the 2026-09-25 ESL Boards row)', () => {
    const bad = {
      source: 'eslboards', url: 'https://www.eslboards.com/job/ila-vietnam-is-hiring-eslefl-teacher-8086',
      title: 'Find Your Next ESL Teaching Job', employment: 'html>',
      employer: '/ila-vietnam-323" class="block shrink-0 w-20 h-20',
    }
    expect(map(bad)).toEqual({ ok: false, reason: 'badTitle' })
    expect(map({ ...bad, title: 'ILA Vietnam is hiring ESL/EFL Teacher' })).toEqual({ ok: false, reason: 'badEmployer' })
  })

  it('drops a multi-country recruiter ad (the TEFL Heaven row)', () => {
    expect(map({
      source: 'eslcafe', url: 'https://www.eslcafe.com/postajob-detail/over-100-paid-positions-in-japan-south-korea-159', city: null,
      title: 'Over 100 Paid Positions in Japan, South Korea, Thailand, Vietnam, Cambodia, Barcelona, Madrid',
    })).toEqual({ ok: false, reason: 'multiCountry' })
  })

  it('screens the source text: contact details, discrimination, adult venues, fees', () => {
    expect(map({ title: 'English teacher — call 0901 234 567' })).toMatchObject({ ok: false, reason: 'contactInText' })
    expect(map({ title: 'English teacher, email jobs@example.com' })).toMatchObject({ ok: false, reason: 'contactInText' })
    expect(map({ title: 'Native teacher, Caucasian only' })).toEqual({ ok: false, reason: 'discriminatory' })
    expect(map({ title: 'Giáo viên tiếng Anh, nữ dưới 30 tuổi' })).toEqual({ ok: false, reason: 'discriminatory' })
    expect(map({ title: 'English speaking hostess for karaoke' })).toEqual({ ok: false, reason: 'adultVenue' })
    expect(map({ title: 'English teacher, training fee required' })).toEqual({ ok: false, reason: 'fee' })
    expect(map({ title: 'English Teacher | Competitive Salary + Visa Support' })).toEqual({ ok: false, reason: 'visaMention' })
    expect(map({ title: 'ESL Teacher, work visas sponsored' })).toEqual({ ok: false, reason: 'visaMention' })
    expect(map({ title: 'Giáo viên tiếng Anh, hỗ trợ thị thực' })).toEqual({ ok: false, reason: 'visaMention' })
    // A salary under a number is not an age limit.
    expect(map({ salary: 'under 20,000,000 VND / month' }).ok).toBe(true)
  })

  it('refuses a job with no place in Vietnam it can name', () => {
    expect(map({ city: null, title: 'English Teacher', url: 'https://www.careerlink.vn/tim-viec-lam/english-teacher/3629784' })).toEqual({ ok: false, reason: 'noCity' })
  })
})

describe('places, pay, type, text', () => {
  it('maps places to the post-2025 province names, merged provinces included', () => {
    expect(jobProvinces('Ho Chi Minh City')).toEqual(['Hồ Chí Minh'])
    expect(jobProvinces('Hồ Chí Minh')).toEqual(['Hồ Chí Minh'])
    expect(jobProvinces('Hải Dương')).toEqual(['Hải Phòng'])
    expect(jobProvinces('Bắc Ninh')).toEqual(['Bắc Ninh'])
    expect(jobProvinces('Ho Chi Minh City, Hanoi, Vietnam')).toEqual(['Hồ Chí Minh', 'Hà Nội'])
    expect(jobProvinces('Vinh Long')).toEqual(['Vĩnh Long'])
    expect(jobProvinces('Vinh, Nghe An')).toEqual(['Nghệ An'])
    // The city field decides; the title is only a fallback.
    expect(jobProvinces('Da Nang', 'Teacher in Hanoi')).toEqual(['Đà Nẵng'])
    expect(jobProvinces(null, 'Native Part-time English Teacher – Public Schools | HCM, Binh Duong & Vung Tau')).toEqual(['Hồ Chí Minh'])
    expect(jobProvinces('Remote')).toEqual([])
  })

  it('reads only VND pay it can state honestly', () => {
    expect(parseJobPay('15,000,000–20,000,000 VND / month')).toEqual({ price: 0, priceUnit: 'VND/month', salaryM: 15 })
    expect(parseJobPay('From 12,000,000 VND/month')).toEqual({ price: 0, priceUnit: 'VND/month', salaryM: 12 })
    expect(parseJobPay('50,000,000 VND / month')).toEqual({ price: 50_000_000, priceUnit: 'VND/month', salaryM: 50 })
    expect(parseJobPay('500,000–570,000 VND/hour')).toEqual({ price: 0, priceUnit: 'VND/hour', salaryM: null })
    expect(parseJobPay('550.000 VNĐ/giờ')).toEqual({ price: 550_000, priceUnit: 'VND/hour', salaryM: null })
    expect(parseJobPay('Up to 550.000 VNĐ/Hour - Gross')).toBeNull()
    expect(parseJobPay('$1,500–2,000 / month')).toBeNull()
    expect(parseJobPay('Competitive')).toBeNull()
    expect(parseJobPay('15 VND / month')).toBeNull()
    expect(parseJobPay(null)).toBeNull()
  })

  it('maps employment types to the jobtype facet', () => {
    expect(jobType('FULL_TIME', '')).toBe('fulltime')
    expect(jobType('Full Time', '')).toBe('fulltime')
    expect(jobType(null, 'Part-time ESL Teacher')).toBe('parttime')
    expect(jobType(null, 'Primary Class Teacher (Maternity cover)')).toBe('temporary')
    expect(jobType(null, 'English Teacher')).toBeNull()
  })

  it('recases only a shouted string', () => {
    expect(unshout('GIÁO VIÊN TIẾNG ANH (DẠY CHƯƠNG TRÌNH IELTS) FULLTIME')).toBe('Giáo Viên Tiếng Anh (Dạy Chương Trình IELTS) Fulltime')
    expect(unshout('CÔNG TY TNHH AZ MỸ VIỆT')).toBe('Công Ty TNHH AZ Mỹ Việt')
    expect(unshout('English Teacher – Ho Chi Minh City')).toBe('English Teacher – Ho Chi Minh City')
  })
})

describe('ids and urls', () => {
  const id = (board: keyof typeof JOB_BOARDS, url: string) => jobNativeId(board, normaliseJobUrl(url)!)
  it("extracts each board's own job id", () => {
    expect(id('eslboards', 'https://www.eslboards.com/job/ila-vietnam-is-hiring-eslefl-teacher-8086/')).toBe('8086')
    expect(id('nordanglia', 'https://careers.nordanglia.com/job/Ho-Chi-Minh-City-Primary-Class-Teacher-%28Maternity-cover%29/1439310233/')).toBe('1439310233')
    expect(id('teast', 'https://teast.co/job/english-teacher-JtRtLBdSI4zXUDhvEyn4')).toBe('english-teacher-JtRtLBdSI4zXUDhvEyn4')
    expect(id('eslcafe', 'https://www.eslcafe.com/postajob-detail/full-time-english-maths-and-science-teacher---3')).toBe('full-time-english-maths-and-science-teacher---3')
    expect(id('vtj', 'https://vietnamteachingjobs.com/jobs/view/danang-vietnam-part-time-esl-teacher-1')).toBe('danang-vietnam-part-time-esl-teacher-1')
    expect(id('eslgorilla', 'https://eslgorilla.com/jobs/english-teacher-ho-chi-minh-vietnam')).toBe('english-teacher-ho-chi-minh-vietnam')
    expect(id('careerlink', 'https://www.careerlink.vn/tim-viec-lam/x/3612880?utm_source=fb#top')).toBe('3612880')
    expect(id('careerlink', 'https://careerlink.vn.evil.example/tim-viec-lam/x/3612880')).toBeNull()
  })

  it('one posting with and without tracking params is one row', () => {
    const a = map({ url: 'https://www.careerlink.vn/tim-viec-lam/giao-vien/3629784?source=site&utm_campaign=x' })
    const b = map({ url: 'https://WWW.careerlink.vn/tim-viec-lam/giao-vien/3629784/' })
    expect(a.ok && b.ok && a.job.externalId === b.job.externalId && a.job.affiliateUrl === b.job.affiliateUrl).toBe(true)
  })
})

describe('stage, expiry, sellers', () => {
  it('refuses a stale or malformed stage by its own stagedAt', () => {
    expect(jobStageProblem({ stagedAt: '2026-09-25T00:00:00Z', days: 7, jobs: [] }, NOW)).toBeNull()
    expect(jobStageProblem({ stagedAt: '2026-09-21T00:00:00Z', days: 7, jobs: [] }, NOW)).toMatch(/h old/)
    expect(jobStageProblem({ stagedAt: 'x', jobs: [] }, NOW)).toMatch(/stagedAt/)
    expect(jobStageProblem([], NOW)).toMatch(/jobs array/)
  })

  it('expires on the Vietnamese calendar day after apply-by, and on an unreadable date', () => {
    expect(isExpiredJob(JSON.stringify({ applyBy: '2026-09-25' }), NOW)).toBe(false)
    expect(isExpiredJob(JSON.stringify({ applyBy: '2026-09-24' }), NOW)).toBe(true)
    expect(isExpiredJob(JSON.stringify({}), NOW)).toBe(true)
    expect(isExpiredJob('not json', NOW)).toBe(true)
  })

  it('every job seller is in IMPORT_SELLERS', () => {
    expect(JOB_SELLER_IDS.filter((id) => !(IMPORT_SELLERS as readonly string[]).includes(id))).toEqual([])
  })

  it('maps a gone posting to the row it would have created', () => {
    expect(jobExternalId('careerlink-english', 'https://www.careerlink.vn/tim-viec-lam/x/3612880?source=site')).toEqual({ sellerId: 'careerlink-vn-import-seller-0001', externalId: 'careerlink:3612880' })
    expect(jobExternalId('vieclam24h-teach', 'https://vieclam24h.vn/x')).toBeNull()
  })

  it('tombstones both language variants of the PDP', () => {
    expect(pdpTombstoneTags('abc')).toEqual(['eno:isrtag:_N_T_/en/listings/abc', 'eno:isrtag:_N_T_/vi/listings/abc'])
  })
})
