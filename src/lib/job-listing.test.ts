import { describe, expect, it } from 'vitest'
import {
  JOB_BOARDS, JOB_SELLER_IDS, JOB_TEXT_REFUSAL, hasEmployerVisaWord, hasVisaWord, isExpiredJob, isHiringPost, isLinkedJobReference, jobDenyReason, jobExternalId,
  jobNativeId, jobProvinces, jobStageProblem, jobTextDetail, jobTextProblem, jobType, mapStagedJob, normaliseJobUrl, parseJobPay,
  parseJobPayRange, pdpTombstoneTags, unshout, type StagedJob,
} from './job-listing'
import { JOB_TEXT_BLOCK_CODES } from './publish-guard'
import { IMPORT_SELLERS } from './import-sellers'
import { JOB_TEXT_ATTRIBUTES, detailRowLabel, facetsFor, subcategoriesFor } from './taxonomy'

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
    // "verified", never "vetted" / "kiểm duyệt" (2026-10-01): eno.vn has not VERIFIED the employer; the
    // statutory pre-display moderation is a different thing, and the old wording read as admitting it unmet.
    expect(j.description).toContain('has not verified this employer')
    expect(j.descriptionVi).toContain('chưa xác minh nhà tuyển dụng này')
    expect(j.descriptionVi).not.toContain('kiểm duyệt')
    expect(j.descriptionVi).toContain('Mức lương: 10,000,000–30,000,000 VND / month.')
    expect(j.descriptionVi).toContain('(toàn thời gian)')
    // A single stated figure IS the price.
    const one = map({ salary: '50,000,000 VND / month' })
    expect(one.ok && [one.job.price, one.job.salaryM]).toEqual([50_000_000, 50])
    // …and "Từ" (Vietnamese "from") before one figure is not: the card would state a floor as the pay. The posting's
    // own words stay in salaryText, and the Salary filter still finds the job by its floor (2026-10-20 — the ASCII \b).
    const tu = map({ salary: 'Từ 12.000.000 VNĐ/tháng' })
    expect(tu.ok && [tu.job.price, tu.job.priceUnit, tu.job.salaryM, tu.job.attributes.salaryText]).toEqual([0, 'VND/month', 12, 'Từ 12.000.000 VNĐ/tháng'])
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
    expect(map({ source: 'topcv' })).toEqual({ ok: false, reason: 'unknownSource' })
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
    // A visa in the pay/benefits line drops that LINE, not the job.
    const v = map({ title: 'Expat ESL Teachers Wanted in Vinh Long', employer: 'VUS The English Center', city: 'Vinh Long', salary: 'Starting from: 17$/hour to 20$/hour; Housing allowance; Comprehensive work permit and visa/TRC support' })
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.job.attributes.salaryText).toBeUndefined()
      expect(JSON.stringify(v.job)).not.toMatch(/visa/i)
    }
    // Past the 120-character cut, and as "eVisa", it still counts.
    const long = map({ salary: `${'x'.repeat(130)} + eVisa support` })
    expect(long.ok && long.job.attributes.salaryText).toBeUndefined()
    expect(map({ title: 'ESL Teacher (eVisa provided)' })).toEqual({ ok: false, reason: 'visaMention' })
    expect(map({ title: 'Giáo viên tiếng Anh, hỗ trợ THỊ THỰC' })).toEqual({ ok: false, reason: 'visaMention' })
    expect(map({ title: 'Giáo viên tiếng Anh, hỗ trợ thị thực hiện tại' })).toEqual({ ok: false, reason: 'visaMention' })
    expect(map({ title: 'Giáo viên tiếng Anh, hỗ trợ thị thực'.normalize('NFD') })).toEqual({ ok: false, reason: 'visaMention' })
    expect(map({ title: 'Tuyen giao vien tieng Anh, ho tro thi  thuc' })).toEqual({ ok: false, reason: 'visaMention' })
    expect(map({ title: 'Giáo viên, hỗ trợ thị-thực' })).toEqual({ ok: false, reason: 'visaMention' })
    // Fail-closed: "thì thực hiện" folds like the visa word and is dropped too (see hasVisaWord).
    expect(map({ title: 'Giáo viên tiếng Anh, thì thực hiện giảng dạy' })).toEqual({ ok: false, reason: 'visaMention' })
    // Fail-closed substring match: glued, non-Latin and look-alike words all drop.
    expect(map({ title: 'ESL Teacher #VisaSponsorship' })).toEqual({ ok: false, reason: 'visaMention' })
    expect(map({ title: 'Korean Teacher (비자 지원)' })).toEqual({ ok: false, reason: 'visaMention' })
    expect(map({ title: 'ESL teacher, revisa el horario' })).toEqual({ ok: false, reason: 'visaMention' })
    // The temporary residence card is the same line (2026-10-18: a live title read "…Work Permit and TRC Sponsorship").
    expect(map({ title: 'English Teacher - Danang - Work Permit and TRC Sponsorship' })).toEqual({ ok: false, reason: 'visaMention' })
    for (const title of ['ESL Teacher #TRCSponsorship', 'ESL Teacher (work permit + TRCs)', 'ESL Teacher, visa/TRC', 'ESL Teacher, WP_TRC',
      'ESL Teacher #WorkPermitTRC', 'ESL Teacher #WorkPermitTRCSupport', 'ESL Teacher, T.R.C provided', 'ESL Teacher, work permit and trc support',
      'ESL teacher #trcsponsorship', 'ESL teacher #workpermittrc', 'ESL teacher, t.r.c support', 
      'ESL Teacher, residence permit renewal',
      'ESL Teacher, Temporary Residence Card provided', 'ESL Teacher — WP & Temporary Resident Card provided', 'ESL Teacher, residence-card support',
      'ESL Teacher, residency permit help', 'ESL Teacher, residency sponsorship',
      'ESL Teacher, residence authorization', "ESL Teacher, Residents' card", 'ESL Teacher, resident status', 'ESL Teacher, permanent residence support',
      'ESL Teacher, temporary stay card',
      'ESL Teacher, stay permit', 'ESL Teacher #ResidentCard', 'Giáo viên tiếng Anh, hỗ trợ thẻ tạm trú', 'Giao vien, ho tro tam tru',
      'Giáo viên, hỗ trợ tạm trú'.normalize('NFD'), 'Giáo viên, hỗ trợ tạm-trú', 'Giáo viên, thẻ tạm_trú', 'Giáo viên #hotrotamtru', 'Giáo viên, thẻ thường trú',
      'Giáo viên tiếng Anh – hỗ trợ giấy phép lao động và tạm trú', 'Giáo viên tiếng Anh, GPLĐ, tạm trú', 'English teacher (在留カード)', 'English teacher, 居留许可', 'English teacher, 체류 지원',
      'Учитель английского, вид на жительство', 'Учитель английского, ВНЖ', 'Учитель английского, РВП']) {
      expect(map({ title }), title).toEqual({ ok: false, reason: 'visaMention' })
    }
    // Fail-closed, knowingly, like "revisa": informal Vietnamese "trc" (trước) drops too.
    expect(map({ title: 'Tuyển giáo viên, gửi CV trc 30/10' })).toEqual({ ok: false, reason: 'visaMention' })
    // …in a pay line it drops the LINE, as a visa does; "work permit" alone stays — a labour document.
    const trcPay = map({ salary: '$20/hour; work permit and TRC support' })
    expect(trcPay.ok && trcPay.job.attributes.salaryText).toBeUndefined()
    const permitPay = map({ salary: '$20/hour; work permit support' })
    expect(permitPay.ok && permitPay.job.attributes.salaryText).toBe('$20/hour; work permit support')
    // What folding would confuse stays: Vietnamese is matched with its tones ("tâm trực", "Trường Sơn", "thương trường",
    // "trụ sở" are not tạm/thường trú), and TRC is an upper-case acronym — "Ctr, Cần Thơ", "Str, Cau Giay", "Distr. Cầu
    // Giấy" and "Smart RC" hold "trc" once stripped and folded.
    for (const title of ['Giáo viên trung tâm trực tuyến', 'Giáo viên Trung tâm Trường Sơn', 'Giáo viên có kinh nghiệm thương trường',
      'Giáo viên tiếng Anh — Trung tâm, trụ sở tại Q1', 'Giáo viên có thể thường trực tại trung tâm', 'Giáo viên, hỗ trợ thường trực',
      'Giao vien co the thuong truc tai trung tam', 'Giáo viên tiếng Anh — cô Thường Trúc', 'ESL teacher, homestay permitted',
      'Resident Assistant and ESL Teacher (boarding)', 'Residents Support Officer — international school', "ESL teacher, President's Support Office",
      'Permanent residential teacher (boarding school)', 'Temporary residential summer-camp ESL teacher',
      'ESL teacher — housing in the staff residence. Support with lesson planning', 'Ưu tiên giáo viên có hộ khẩu thường trú tại TP.HCM',
      'Giáo viên tiếng Anh cư trú tại Hà Nội', 'English trainer for a Vice President, Card Services', 'Giáo viên có đăng ký tạm trú tại TP.HCM',
      'ESL tutor for a contemporary residence hall', 'ESL teacher, President Card holders welcome', 'TRCN-certified teachers welcome',
      'Residence Assistant — boarding ESL', 'Residence Support Officer and ESL tutor', 'Yêu cầu có đăng kí tạm trú tại TP.HCM',
      'ESL TEACHER, 12 NGUYEN TRAI STR.CAU GIAY', 'ESL teacher — Language Ctr, Cần Thơ', 'ESL teacher, 12 Nguyen Trai Str, Cau Giay',
      'ESL teacher, Distr. Cầu Giấy', 'ESL teacher — Smart RC club']) {
      expect(map({ title }).ok, title).toBe(true)
    }
    // …and a routine Vietnamese pay line keeps its text: "thưởng, trừ BHXH" (bonus, minus social insurance) is not thường trú.
    const bonusPay = map({ salary: 'Lương 25.000.000 + thưởng, trừ BHXH' })
    expect(bonusPay.ok && bonusPay.job.attributes.salaryText).toBe('Lương 25.000.000 + thưởng, trừ BHXH')
    // A fee demand in a dropped pay line still drops the job.
    expect(map({ salary: '15,000,000 VND / month, visa support, training fee required' })).toEqual({ ok: false, reason: 'fee' })
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
    // "Từ" is "from": no single price, in any case — JavaScript's ASCII-only \b never matched after "ừ" (2026-10-20).
    expect(parseJobPay('Từ 12.000.000 VNĐ/tháng')).toEqual({ price: 0, priceUnit: 'VND/month', salaryM: 12 })
    expect(parseJobPay('TỪ 12.000.000 VNĐ/THÁNG')).toEqual({ price: 0, priceUnit: 'VND/month', salaryM: 12 })
    expect(parseJobPay('từ 500.000 đ/giờ')).toEqual({ price: 0, priceUnit: 'VND/hour', salaryM: null })
    // …read on the line as READ — whitespace folded, then trimmed — so a leading space, a no-break space or a tab after
    // the word changes nothing, in either reading (the "from" flag is decided once, in readJobPay).
    for (const line of [' Từ 12.000.000 VNĐ/tháng', 'Từ\u00a012.000.000 VNĐ/tháng', 'From\t12,000,000 VND/month']) {
      expect(parseJobPay(line), JSON.stringify(line)).toEqual({ price: 0, priceUnit: 'VND/month', salaryM: 12 })
      expect(parseJobPayRange(line), JSON.stringify(line)).toEqual({ min: 12_000_000, max: null, currency: 'VND', period: 'month' })
    }
    expect(parseJobPay('50,000,000 VND / month')).toEqual({ price: 50_000_000, priceUnit: 'VND/month', salaryM: 50 })
    expect(parseJobPay('500,000–570,000 VND/hour')).toEqual({ price: 0, priceUnit: 'VND/hour', salaryM: null })
    expect(parseJobPay('550.000 VNĐ/giờ')).toEqual({ price: 550_000, priceUnit: 'VND/hour', salaryM: null })
    expect(parseJobPay('Up to 550.000 VNĐ/Hour - Gross')).toBeNull()
    expect(parseJobPay('$1,500–2,000 / month')).toBeNull()
    expect(parseJobPay('Competitive')).toBeNull()
    expect(parseJobPay('15 VND / month')).toBeNull()
    expect(parseJobPay(null)).toBeNull()
  })

  it('parseJobPayRange: the same reading, as its amounts (the D3 history log) — and it refuses exactly what parseJobPay refuses', () => {
    expect(parseJobPayRange('15,000,000–20,000,000 VND / month')).toEqual({ min: 15_000_000, max: 20_000_000, currency: 'VND', period: 'month' })
    expect(parseJobPayRange('50,000,000 VND / month')).toEqual({ min: 50_000_000, max: 50_000_000, currency: 'VND', period: 'month' })
    expect(parseJobPayRange('500,000–570,000 VND/hour')).toEqual({ min: 500_000, max: 570_000, currency: 'VND', period: 'hour' })
    expect(parseJobPayRange('550.000 VNĐ/giờ')).toEqual({ min: 550_000, max: 550_000, currency: 'VND', period: 'hour' })
    // "From" one amount has no top — in Vietnamese too, where an ASCII \b never matches after "ừ".
    expect(parseJobPayRange('From 12,000,000 VND/month')).toEqual({ min: 12_000_000, max: null, currency: 'VND', period: 'month' })
    expect(parseJobPayRange('Từ 12.000.000 VNĐ/tháng')).toEqual({ min: 12_000_000, max: null, currency: 'VND', period: 'month' })
    expect(parseJobPayRange('From 10,000,000 - 15,000,000 VND / month')).toEqual({ min: 10_000_000, max: 15_000_000, currency: 'VND', period: 'month' })
    // An upper amount past the period's bound is not a top.
    expect(parseJobPayRange('500,000–5,600,000 VND/hour')).toEqual({ min: 500_000, max: null, currency: 'VND', period: 'hour' })
    // Real refused lines from the staged corpus: a ceiling, USD, no amount, a junk figure, an hourly rate labelled monthly,
    // an amount past the hourly bound, "tr" shorthand — and nothing at all.
    const refusedLines = ['Up to 550.000 VNĐ/Hour - Gross', '$1,500–2,000 / month', 'Competitive', '15 VND / month', '450,000 VND / month',
      '5,040,000 VND / hour', '15tr-50tr ₫/tháng', 'USD 1,900 – 2,350 per month (gross)', null]
    for (const line of refusedLines) {
      expect(parseJobPayRange(line), String(line)).toBeNull()
      expect(parseJobPay(line), String(line)).toBeNull()
    }
    // The two readings agree on every line either reads: the listing's floor is the log's min, and the listing states a
    // price EXACTLY when the log reads one figure (max = min) — so "Từ …", which the log reads as open-ended, cannot be
    // read as an exact amount (parseJobPay did, until 2026-10-20, and the old check, `price === 0 || price === min`, let it
    // through — measured: with the old parseJobPay and only that check, this test passes).
    for (const line of ['15,000,000–20,000,000 VND / month', '50,000,000 VND / month', '500,000–570,000 VND/hour', 'From 12,000,000 VND/month', '470,000 VND / hour',
      'Từ 12.000.000 VNĐ/tháng', 'TỪ 12.000.000 VNĐ/THÁNG', 'từ 500.000 đ/giờ', 'Từ 10.000.000 - 15.000.000 VNĐ/tháng', '500,000–5,600,000 VND/hour']) {
      const pay = parseJobPay(line)!
      const range = parseJobPayRange(line)!
      expect(pay.priceUnit, line).toBe(`VND/${range.period}`)
      expect(pay.price === 0 || pay.price === range.min, line).toBe(true)
      expect(pay.price > 0, line).toBe(range.max === range.min)
      expect(pay.salaryM, line).toBe(range.period === 'month' ? Math.floor(range.min / 1_000_000) : null)
    }
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
    expect(id('vieclam24h', 'https://vieclam24h.vn/giao-duc-dao-tao/giao-vien-tieng-anh-trung-hoc-c14p1id200945072.html?open_from=1401_1_3')).toBe('200945072')
    expect(id('vietnamworks', 'https://www.vietnamworks.com/purchasing-executive-chinese-english-speaking-1790319292852111973-2111783-jv')).toBe('2111783')
    expect(id('vietnamworks', 'https://www.vietnamworks.com/dieu-phoi-chuong-trinh-esl-mam-non--2111649-jv/')).toBe('2111649')
    expect(id('vietnamworks', 'https://www.vietnamworks.com/nha-tuyen-dung/abc/x-2111649-jv')).toBeNull()
    expect(id('vietnamworks', 'https://www.vietnamworks.com.evil.example/x-2111649-jv')).toBeNull()
    expect(id('tesljobs', 'https://tesljobs.com/jobs/children-esl-teacher-da-nang-da-nang-vietnam-8QnXe6kEJTdV')).toBe('8QnXe6kEJTdV')
    expect(id('tesljobs', 'https://tesljobs.com/jobs/foreign-teacher-positions-ho-chi-minh-city-ho-chi-minh-city-vietnam-CXxjWe')).toBe('CXxjWe')
    expect(id('tesljobs', 'https://www.tesljobs.com/jobs/foreign-teacher-positions-vietnam-CXxjWe/')).toBe('CXxjWe')
    expect(id('tesljobs', 'https://tesljobs.com.evil.example/jobs/foreign-teacher-vietnam-CXxjWe')).toBeNull()
    expect(id('tesljobs', 'https://tesljobs.com/teaching-jobs/vietnam')).toBeNull()
    expect(id('tesljobs', 'https://tesljobs.com/jobs/esl-teachers-in-vietnam-vietnam-U_yj-lBU3SJM')).toBe('U_yj-lBU3SJM')
    expect(id('fpt', 'https://career.fpt.edu.vn/Job/Detail/79795')).toBe('79795')
    // 2026-10-12: ASQ keys on its ReferenceNumber (the slug before it carries commas and can change with the title).
    expect(id('asq', 'https://jobs.asq-international.com/job/esl-teachers-british-international-school-in-lao-cai,-vietnam-immediate-start-5964.aspx')).toBe('5964')
    expect(id('asq', 'https://jobs.asq-international.com/job/esl-teachers-british-international-school-in-lao-cai,-vietnam-immediate-start-5964/apply.aspx')).toBeNull()
    expect(id('asq', 'https://jobs.asq-international.com.evil.example/job/x-5964.aspx')).toBeNull()
    expect(id('languagelink', 'https://teachatlanguagelink.com/job/thai-nguyen-teacher-trainers-nov2026/')).toBe('thai-nguyen-teacher-trainers-nov2026')
    expect(id('languagelink', 'https://teachatlanguagelink.com/jobs/teaching-jobs/')).toBeNull()
    expect(id('languagelink', 'https://teachatlanguagelink.com/job/esl_teachers_hanoi/')).toBe('esl_teachers_hanoi')
    expect(id('languagelink', 'https://teachatlanguagelink.com/job/gi%e1%ba%a3ng-vi%c3%aan-ti%e1%ba%bfng-anh/')).toBe('giảng-viên-tiếng-anh')
    expect(id('languagelink', 'https://teachatlanguagelink.com/job/a/b')).toBeNull()
    expect(id('eslbase', 'https://www.eslbase.com/job/english-teaching-jobs-in-vietnam-with-vus-october-2026/')).toBe('english-teaching-jobs-in-vietnam-with-vus-october-2026')
    expect(id('eslbase', 'https://www.eslbase.com/tefl-jobs/?_jobs_country_filter=vietnam')).toBeNull()
    expect(id('eslbase', 'https://www.eslbase.com.evil.example/job/x')).toBeNull()
    expect(jobNativeId('wish', normaliseJobUrl('https://www.wishlistjobs.com/teaching-jobs-in-vietnam#job-post-25658')!, '#job-post-25658')).toBe('25658')
    expect(jobNativeId('wish', normaliseJobUrl('https://www.wishlistjobs.com/teaching-jobs-in-vietnam')!, '')).toBeNull()
    expect(jobNativeId('wish', normaliseJobUrl('https://www.wishlistjobs.com/teaching-jobs-in-thailand#job-post-1')!, '#job-post-1')).toBeNull()
    expect(id('tta', 'https://www.theteflacademy.com/blog/tefl-jobs/ila-is-hiring-part-time-esl-teachers-in-ho-chi-minh-city/')).toBe('ila-is-hiring-part-time-esl-teachers-in-ho-chi-minh-city')
    expect(id('rmit', 'https://rmit.wd3.myworkdayjobs.com/RMIT_Careers/job/Ho-Chi-Minh-City/Lecturer--Management_JR46455')).toBe('JR46455')
    expect(id('rmit', 'https://rmit.wd3.myworkdayjobs.com/RMIT_Careers/job/Ho-Chi-Minh-City/Lecturer--Management-Renamed_JR46455')).toBe('JR46455')
  })

  it('one posting with and without tracking params is one row', () => {
    const a = map({ url: 'https://www.careerlink.vn/tim-viec-lam/giao-vien/3629784?source=site&utm_campaign=x' })
    const b = map({ url: 'https://WWW.careerlink.vn/tim-viec-lam/giao-vien/3629784/' })
    expect(a.ok && b.ok && a.job.externalId === b.job.externalId && a.job.affiliateUrl === b.job.affiliateUrl).toBe(true)
  })
})

describe('anchor-only boards (WISHlistjobs)', () => {
  it('keys on the anchor and keeps it in the Apply link', () => {
    const r = map({ source: 'wish', url: 'https://www.wishlistjobs.com/teaching-jobs-in-vietnam#job-post-25658', title: 'Primary Class Teacher (Maternity cover)', employer: null, city: 'Ho Chi Minh City' })
    expect(r.ok && [r.job.externalId, r.job.affiliateUrl, r.job.sellerId]).toEqual(['wish:25658', 'https://www.wishlistjobs.com/teaching-jobs-in-vietnam#job-post-25658', 'wishlistjobs-com-import-seller-0001'])
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
    expect(jobExternalId('topcv', 'https://www.topcv.vn/x')).toBeNull()
    expect(jobExternalId('asq', 'https://jobs.asq-international.com/job/secondary-maths-teacher-international-school,-vietnam-october-2026-start-5950.aspx')).toEqual({ sellerId: 'asq-international-com-import-seller-0001', externalId: 'asq:5950' })
    expect(jobExternalId('languagelink', 'https://teachatlanguagelink.com/job/thai-nguyen-teacher-trainers-nov2026/')).toEqual({ sellerId: 'teachatlanguagelink-com-import-seller-0001', externalId: 'languagelink:thai-nguyen-teacher-trainers-nov2026' })
  })

  it('tombstones both language variants of the PDP', () => {
    expect(pdpTombstoneTags('abc')).toEqual(['eno:isrtag:_N_T_/en/listings/abc', 'eno:isrtag:_N_T_/vi/listings/abc'])
  })

  // Plan item 18 (2026-10-20): the listing page serves a linked job `noindex, follow` — (pdp)/listing-robots.test.ts runs
  // the page itself. The predicate: a JOB whose stored row links out, whatever the link; nothing else.
  it('isLinkedJobReference: what this module makes — a job that links out — and nothing else', () => {
    const r = map()
    if (!r.ok) throw new Error(r.reason)
    expect(isLinkedJobReference({ affiliateUrl: r.job.affiliateUrl, listingType: 'job' })).toBe(true) // import-jobs.ts mutableOf
    expect(isLinkedJobReference({ affiliateUrl: 'http://www.careerlink.vn/x/1', listingType: 'job' })).toBe(true)
    expect(isLinkedJobReference({ affiliateUrl: null, listingType: 'job' })).toBe(false) // an employer's own post
    expect(isLinkedJobReference({ affiliateUrl: '', listingType: 'job' })).toBe(false)
    expect(isLinkedJobReference({ affiliateUrl: r.job.affiliateUrl, listingType: 'wanted' })).toBe(false)
    expect(isLinkedJobReference({ affiliateUrl: 'https://rever.vn/x', listingType: 'rent' })).toBe(false)
    expect(isLinkedJobReference({ affiliateUrl: r.job.affiliateUrl, listingType: null })).toBe(false)
  })
})

/**
 * ⛔ THE SAME SCREENS ON JOB TEXT AN EMPLOYER WRITES (teacher visibility plan §3a item 6; approved in the plan, 2026-10-18 —
 * owner: "go with recommended"): jobTextProblem is what createListingCore / updateListingCore / the bulk core / a
 * re-activation run on a HIRING post — the importer's own matchers (hasVisaWord's patterns, "visa" and "thị thực" read as
 * words: hasEmployerVisaWord; JOB_DENY with honest negations taken out), never copies of them, on BOTH editions (no edition
 * switch exists to pass), AS THE READER SEES THE POST (the 2026-10-19 contract: the page's blocks, sentences within them),
 * and naming the words that tripped the rule. The core wiring: core/listings.job-text.test.ts and core/bulk.job-text.test.ts.
 */
describe('jobTextProblem — the importer’s screens on job text an employer writes', () => {
  // The title and the description — read in formatRichText's blocks ('rich'), as the cores pass it.
  const ad = (description: string, title = 'English teacher, District 7') => [['title', title], ['description', description, 'rich']] as const
  const hit = (description: string) => jobTextProblem(ad(description))

  it('visa or residence wording is refused — naming the field and the words — and "work permit" is fine', () => {
    expect(hit('Full-time, 25 hours a week. Visa support provided.')).toEqual({ code: 'job_residence_wording', field: 'description', snippet: 'Visa' })
    expect(jobTextProblem(ad('25 hours a week.', 'ESL teacher — TRC sponsorship'))).toEqual({ code: 'job_residence_wording', field: 'title', snippet: 'TRC' })
    expect(hit('Hỗ trợ làm giấy phép lao động và thẻ tạm trú.')).toEqual({ code: 'job_residence_wording', field: 'description', snippet: 'tạm trú' })
    expect(hit('Comprehensive work permit and visa/TRC support')).toMatchObject({ code: 'job_residence_wording', snippet: 'visa/TRC' })
    expect(hit('#VisaSponsorship available')).toMatchObject({ snippet: '#VisaSponsorship' })
    // A bracket left without its pair goes; a pair stays.
    expect(hit('Quận 7 (visa support)')).toMatchObject({ snippet: 'visa' })
    expect(hit('Visa (thị thực) hỗ trợ')).toMatchObject({ snippet: 'Visa (thị thực)' })
    expect(hit('We file your work permit before you start.')).toBeNull()
  })

  /**
   * ⛔ THE CONTRACT (2026-10-19 — it ends two rounds of opposite asks: "never join words across lines", then "per-line
   * splitting is bypassed, because the page joins a paragraph's lines"): A HIRING POST IS SCREENED EXACTLY AS THE READER SEES
   * IT. A paragraph is its lines joined with a space, as formatRichText prints it; each list item, heading and table row is
   * a block of its own; a one-line field is one block.
   */
  it('⛔ as the reader sees it: a phrase hard-wrapped inside one paragraph is whole; the same words as two list items are judged apart', () => {
    // Hard line breaks mid-sentence (text pasted from a PDF or a Word file) are spaces on the page.
    expect(hit('We support the work permit and temporary residence\ncard')).toEqual({ code: 'job_residence_wording', field: 'description', snippet: 'temporary residence card' })
    expect(hit('Hỗ trợ làm thẻ tạm\ntrú')).toEqual({ code: 'job_residence_wording', field: 'description', snippet: 'tạm trú' })
    expect(hit('Lương 25 triệu, hỗ trợ giấy phép lao động và thị\nthực.')).toEqual({ code: 'job_residence_wording', field: 'description', snippet: 'thị thực' })
    // …the same words as two list items are two blocks: each is judged on its own, and each passes.
    expect(hit('- Hỗ trợ làm thẻ tạm\n- trú')).toBeNull()
    expect(hit('- Tư vấn khóa học cho học viên, hỗ trợ tiếp thị\n- Thực hiện các công việc khác theo yêu cầu')).toBeNull()
    // The denylist reads its sentence the same way: across a line break inside a paragraph, never across two list items.
    expect(hit('No training fee\nwill be charged later')).toEqual({ code: 'job_candidate_fee', field: 'description', snippet: 'training fee will' })
    expect(hit('- No training fee\n- will be charged later')).toBeNull()
    // …while a real mention in its own item is still found, and named.
    expect(hit('- Hỗ trợ tiếp thị\n- Hỗ trợ visa cho giáo viên nước ngoài')).toEqual({ code: 'job_residence_wording', field: 'description', snippet: 'visa' })
    // ⚠️ The price of reading as the reader does, knowingly: lines with no bullet and no stop are ONE run-on paragraph on the
    // page, so a negation on its own line there is judged with its neighbours — a bullet or a full stop makes it a sentence.
    expect(hit('Lương cao\nKhông thu phí đào tạo\nCó hoa hồng')).toMatchObject({ code: 'job_candidate_fee', snippet: 'phí đào tạo' })
    expect(hit('- Lương cao\n- Không thu phí đào tạo\n- Có hoa hồng')).toBeNull()
    expect(hit('Lương cao.\nKhông thu phí đào tạo.\nCó hoa hồng.')).toBeNull()
  })

  it('every block the renderer makes is a block here: heading, tick and numbered items, a table row, a fact line folded back, bold', () => {
    expect(hit('# Visa support\nWe help every teacher.')).toMatchObject({ code: 'job_residence_wording', snippet: 'Visa' })
    expect(hit('✓ Hỗ trợ thị thực')).toMatchObject({ code: 'job_residence_wording', snippet: 'thị thực' })
    expect(hit('1. Hỗ trợ tạm trú')).toMatchObject({ code: 'job_residence_wording', snippet: 'tạm trú' })
    // Three fact lines are a table; each row is "label: value".
    expect(hit('Type: Full-time\nHours: 25 a week\nSupport: TRC and housing')).toMatchObject({ code: 'job_residence_wording', snippet: 'TRC' })
    // ONE fact line is prose again — folded back into its paragraph, where it joins the next line as on the page.
    expect(hit('Contract: temporary\nResidence hall on campus.')).toMatchObject({ code: 'job_residence_wording', snippet: 'temporary Residence' })
    // "**bold**" reads as the page prints it, without its asterisks.
    expect(hit('We offer **visa** support.')).toMatchObject({ code: 'job_residence_wording', snippet: 'visa' })
    // A one-line field is one block, whatever line breaks an API client sent.
    expect(jobTextProblem([['title', 'ESL teacher, temporary\nresidence card provided']])).toMatchObject({ code: 'job_residence_wording', field: 'title' })
    // Two sentences stay two: a full stop, a spaced dash in a title.
    expect(hit('Lương thưởng hấp dẫn, hỗ trợ tiếp thị. Thực hiện công việc theo ca.')).toBeNull()
    expect(jobTextProblem([['title', 'Nhân viên tiếp thị - Thực tập sinh']])).toBeNull()
  })

  it('⛔ the employer screen reads "visa" and "thị thực" as WORDS — a school’s own heading is no visa (owner, 2026-10-19)', () => {
    for (const ok of [
      'Vì sao nên chọn chúng tôi?', 'Vì sao bạn nên chọn trung tâm chúng tôi?', 'Previous classroom experience is advisable.',
      'Chuẩn bị cho kỳ thi thực hành.', 'Đơn vị sản xuất', 'Improvisation and drama classes', 'Davis Academy, Quận 7',
      'Hỗ trợ tiếp thị • Thực hiện báo cáo tuần', 'Lương 10tr - Thưởng theo tháng ★ Thực hiện báo cáo',
    ]) expect(hit(ok), ok).toBeNull()
    const refused: [string, string][] = [
      ['Visa support provided.', 'Visa'], ['We sponsor visas.', 'visas'], ['Help with the e-visa.', 'e-visa'], ['eVisa help', 'eVisa'],
      ['Visa-free entry', 'Visa-free'], ['Comprehensive work permit and visa/TRC support', 'visa/TRC'],
      ['#VisaSponsorship available', '#VisaSponsorship'], ['#visasupport available', '#visasupport'], ['VISASupport offered', 'VISASupport'],
      ['Hỗ trợ thị thực cho giáo viên', 'thị thực'], ['THỊ THỰC lao động', 'THỊ THỰC'], ['Hỗ trợ thị-thực', 'thị-thực'],
      // Unaccented writing — no mark anywhere in the block — reads the folded words.
      ['Ho tro thi thuc cho giao vien', 'thi thuc'],
    ]
    for (const [text, snippet] of refused) expect(hit(text), text).toEqual({ code: 'job_residence_wording', field: 'description', snippet })
    // ⚠️ KNOWN FALSE POSITIVE, fail-closed and fixable (the words are named): "thị thực" as words in "siêu thị thực phẩm".
    expect(hit('Gần siêu thị thực phẩm.')).toEqual({ code: 'job_residence_wording', field: 'description', snippet: 'thị thực' })
    // The importer keeps its substring test, unchanged: "Vì sao" still drops a staged posting there.
    expect(hasVisaWord('Vì sao nên chọn chúng tôi?')).toBe(true)
    expect(hasEmployerVisaWord('Vì sao nên chọn chúng tôi?')).toBe(false)
  })

  it('⛔ an attribute KEY is read as the identifier it is — glued or letter-spaced on the page, it is still visa wording (2026-10-19)', () => {
    const place = { categorySlug: 'jobs', subcategorySlug: 'teaching', listingType: 'job' }
    const row = (k: string) => [`attributes.${k}`, `${detailRowLabel(k, place).en}: yes`, 'line', k] as const
    for (const k of ['visasponsorship', 'VISA_SPONSORSHIP', 'visaSponsorship', 'eVisa', 'thithuc', 'TRC']) {
      const p = jobTextProblem([['title', 'English teacher'], row(k)])
      expect(p, k).toMatchObject({ code: 'job_residence_wording', field: `attributes.${k}` })
      // The snippet is the label as the page prints it, so the wizard can find the row it names.
      expect(`${detailRowLabel(k, place).en}: yes`.includes(p!.snippet), k).toBe(true)
    }
    // No key eno itself writes on a job trips the glued reading — every jobs facet, every subcategory, every job text fact.
    const keys = new Set<string>(Object.keys(JOB_TEXT_ATTRIBUTES))
    for (const sub of [null, ...subcategoriesFor('jobs').map((c) => c.slug)]) for (const f of facetsFor('jobs', sub)) keys.add(f.key)
    expect(keys.size).toBeGreaterThan(5)
    for (const k of keys) expect(jobTextProblem([row(k)]), k).toBeNull()
  })

  it('⛔ a held-Shift typo is still the word — "VIsa", "VISa", "E-VIsa": the glued-word split is never the only reading (round 4)', () => {
    // The ACRONYMWord split reads "VIsa" as "V Isa"; as typed it is one word, and the importer's substring refuses it too.
    const refused: [string, string][] = [
      ['VIsa support', 'VIsa'], ['VISa support', 'VISa'], ['VIsa support provided.', 'VIsa'], ['We offer VIsa sponsorship', 'VIsa'],
      ['Work permit & VIsa', 'VIsa'], ['VIsas sponsored', 'VIsas'], ['E-VIsa help', 'E-VIsa'], ['ViSa support', 'ViSa'],
      ['#VIsaSupport available', '#VIsaSupport'], ['WorkPermitVIsa', 'WorkPermitVIsa'],
      // A hashtag read glued as typed: an unaccented camelCase "#HoTroThiThuc" (hỗ trợ thị thực) is the word it holds.
      ['#HoTroThiThuc', '#HoTroThiThuc'],
    ]
    for (const [text, snippet] of refused) {
      expect(hit(text), text).toEqual({ code: 'job_residence_wording', field: 'description', snippet })
      expect(hasVisaWord(text), text).toBe(true)
    }
    // …and every honest case stays: shouted, title-cased, "visa" inside a longer word, a name, "vis-à-vis".
    for (const ok of [
      'VÌ SAO NÊN CHỌN CHÚNG TÔI?', 'Vì Sao Nên Chọn Chúng Tôi?', 'ADVISABLE', 'IMPROVISATION', 'DAVIS ACADEMY', 'Visagio consulting',
      'VISAGIO', 'Teaching vis-à-vis the parents', 'ViSaigon English Club', 'ĐƠN VỊ SẢN XUẤT',
    ]) expect(hit(ok), ok).toBeNull()
    // A camelCase hashtag is read split (review, 2026-10-19): "#VìSaoChọnChúngTôi" is "#vi sao chon…", no visa — while
    // "#HoTroThiThuc" (unmarked, split "#ho tro thi thuc") and "#VisaSponsorship" still are.
    expect(hit('#VìSaoChọnChúngTôi')).toBeNull()
    expect(hit('#HoTroThiThuc')).toMatchObject({ code: 'job_residence_wording' })
    expect(hit('#VisaSponsorship')).toMatchObject({ code: 'job_residence_wording' })
    // ⚠️ KNOWN FALSE POSITIVE, fail-closed and fixable: a LOWER-CASE hashtag holding "visa" once folded.
    expect(hit('#vìsao')).toMatchObject({ code: 'job_residence_wording' })
  })

  it('⚠️ out of scope — moderation’s job: letters split by punctuation or spaces; a spaced "T. R. C." stays caught (a shared pattern)', () => {
    for (const spelled of ['V·I·S·A support', 'Vi|sa support', 'v.i.s.a support', 'Hỗ trợ thị·thực']) expect(hit(spelled), spelled).toBeNull()
    for (const spelled of ['Work permit and T. R. C.', 'e-visa', 'Visa - TRC']) expect(hit(spelled), spelled).toMatchObject({ code: 'job_residence_wording' })
  })

  it('the residence permit and card by their other names, and an extension of the stay (both screens — measured first)', () => {
    for (const text of ['Hỗ trợ giấy phép cư trú', 'Hỗ trợ làm thẻ cư trú', 'Hỗ trợ gia hạn tạm trú', 'Hỗ trợ gia hạn lưu trú']) {
      expect(hit(text), text).toMatchObject({ code: 'job_residence_wording' })
      expect(hasVisaWord(text), text).toBe(true)
    }
    // Where someone lives, or a hotel stay, is not a residence permit.
    for (const text of ['Giáo viên cư trú tại Hà Nội', 'Có chỗ lưu trú cho giáo viên ở xa']) {
      expect(hit(text), text).toBeNull()
      expect(hasVisaWord(text), text).toBe(false)
    }
  })

  it('the snippet is the poster’s own words around every hit in the block, edge punctuation trimmed', () => {
    expect(hit('Training fee required.')).toEqual({ code: 'job_candidate_fee', field: 'description', snippet: 'Training fee required' })
    expect(jobTextProblem(ad('Evening shifts.', 'English-speaking hostess for a karaoke bar'))).toEqual({ code: 'job_adult_venue', field: 'title', snippet: 'hostess for a karaoke' })
    expect(hit('Yêu cầu: nữ dưới 30 tuổi, ngoại hình ưa nhìn.')).toMatchObject({ code: 'job_discrimination', snippet: 'nữ dưới 30 tuổi, ngoại hình ưa nhìn' })
    // Two hits close together both show — one fix clears the line.
    expect(hit('Visa and TRC support')).toMatchObject({ snippet: 'Visa and TRC' })
    // A word run past 80 characters is cut, with "…".
    const long = `#Visa${'x'.repeat(120)}`
    expect(hit(long)?.snippet).toBe(`${long.slice(0, 79)}…`)
    expect(jobTextDetail({ code: 'job_residence_wording', field: 'description', snippet: 'Vì sao: x' })).toBe('description:Vì sao: x')
  })

  it('⛔ two hits far apart in one block give the FIRST hit’s own words — contiguous in the block, never a cut "first … last" (Opus, round 3)', () => {
    const middle = ' We teach small classes of adults and teenagers in the evenings, with lesson plans written by our academic team.'
    const paragraph = `Visa support for every teacher.${middle}${middle}\nWe also help with the TRC.`
    expect(hit(paragraph)).toEqual({ code: 'job_residence_wording', field: 'description', snippet: 'Visa' })
    // …and so for the denylist, inside one long sentence.
    const sentence = `Training fee required, ${'with weekly lessons and evening classes for adults and children, '.repeat(2)}and a deposit required`
    expect(hit(sentence)).toEqual({ code: 'job_candidate_fee', field: 'description', snippet: 'Training fee' })
    // The words the refusal names are one run of the block — so the field, read as the page reads it, still holds them.
    const { snippet } = hit(paragraph)!
    expect(paragraph.replace(/\s+/g, ' ')).toContain(snippet)
  })

  it('⛔ the way a form writes a negation is no extra word: a leading marker or number, a closed set of labels (Opus, round 3)', () => {
    for (const honest of [
      '1. No fees', '- Không thu phí đào tạo', 'Benefits: no training fee', 'Quyền lợi: không thu phí', 'a) No training fee', 'b) No deposit',
      '• No deposit', '✅ Không đặt cọc', '2) Phúc lợi: không thu phí đào tạo', 'Chế độ phúc lợi: không thu phí đào tạo', 'Notes: no fees',
      'We offer: no training fee', 'Lưu ý: không thu phí đào tạo.', 'Perks: no registration fee',
      // More markers a form writes (review, 2026-10-19): "1/", "1 -", "1:", a keycap number.
      '1/ No fees', '1 - No fees', '3: No deposit', '2️⃣ Không thu phí đào tạo',
      // Southern particles and "completely" are no extra word.
      'Không thu phí nha', 'Không thu phí đào tạo nhen', 'Hoàn toàn không thu phí',
    ]) {
      // In a one-line field the marker is still there; in the description a list marker is already the renderer's.
      expect(jobTextProblem([['title', honest]]), honest).toBeNull()
      expect(hit(honest), honest).toBeNull()
    }
    expect(hit('No fees. Deposit required.')).toEqual({ code: 'job_candidate_fee', field: 'description', snippet: 'Deposit required' })
    expect(hit('No fees until you start, then a training fee.')).toEqual({ code: 'job_candidate_fee', field: 'description', snippet: 'training fee' })
    // A label outside the closed set is a word like any other: the fee words count.
    expect(hit('Condition: no training fee')).toMatchObject({ code: 'job_candidate_fee' })
    expect(jobTextProblem([['title', '3. Training fee required']])).toMatchObject({ code: 'job_candidate_fee', snippet: 'Training fee required' })
  })

  it('⛔ Vietnamese filler is matched with its tones before folding — a syllable that is also a word of time or money is no filler (Opus, round 3)', () => {
    expect(hit('Tạm không thu phí đào tạo.')).toMatchObject({ code: 'job_candidate_fee', field: 'description' })
    expect(hit('Không thu phí đào tạo tới tháng sau.')).toMatchObject({ code: 'job_candidate_fee' })
    for (const honest of [
      'Trung tâm không thu phí đào tạo.', 'Công ty tuyệt đối không thu phí đào tạo.', 'Bên mình không thu phí đào tạo nhé.',
      'Chúng tôi cam kết không thu phí đào tạo hay phí hồ sơ.', 'Nhà trường không thu phí đào tạo cho giáo viên.',
    ]) expect(hit(honest), honest).toBeNull()
    // "sẽ" (will) after the negation hands the fee on to someone else, like "will" does.
    expect(hit('Chúng tôi không thu phí đào tạo, trung tâm sẽ thu.')).toMatchObject({ code: 'job_candidate_fee' })
    // Typed without any mark, the many-syllable phrases still count — a lone syllable never does.
    expect(hit('Trung tam khong thu phi dao tao')).toBeNull()
    expect(hit('Tam khong thu phi dao tao')).toMatchObject({ code: 'job_candidate_fee' })
  })

  it('each JOB_DENY rule has its own code — discrimination, a candidate fee, adult-venue work', () => {
    expect(hit('Female only, under 30 years old.')).toMatchObject({ code: 'job_discrimination', field: 'description' })
    expect(hit('Ứng viên đặt cọc 2.000.000 đ.')).toEqual({ code: 'job_candidate_fee', field: 'description', snippet: 'đặt cọc' })
    expect(hit('Phí đào tạo 2 triệu.')).toMatchObject({ code: 'job_candidate_fee', snippet: 'Phí đào tạo' })
    expect(hit('No Asians.')).toMatchObject({ code: 'job_discrimination', snippet: 'No Asians' })
  })

  it('every field passed is screened, named by its key; visa wording is reported before a denylist hit', () => {
    const fields = [...ad('25 hours a week.'), ['attributes.salaryText', '20,000,000 VND + visa'], ['attributes.employer', 'Female only school'], ['district', 'Quận 7']] as const
    expect(jobTextProblem(fields)).toEqual({ code: 'job_residence_wording', field: 'attributes.salaryText', snippet: 'visa' })
    expect(jobTextProblem(fields.filter(([f]) => f !== 'attributes.salaryText'))).toEqual({ code: 'job_discrimination', field: 'attributes.employer', snippet: 'Female only' })
    expect(jobTextProblem([['location', 'Visa Tower, Quận 1']])).toMatchObject({ code: 'job_residence_wording', field: 'location' })
  })

  it('a clean teaching ad passes, and absent fields are skipped', () => {
    const clean = 'Teach English to adults and teenagers at our centre in District 7. 20–25 teaching hours a week, '
      + 'Monday to Saturday. Bachelor’s degree and a 120-hour TEFL certificate required; we apply for your work permit. '
      + 'Lương 25.000.000–30.000.000 đ/tháng, hợp đồng 12 tháng.'
    expect(jobTextProblem(ad(clean))).toBeNull()
    expect(jobTextProblem([['title', undefined], ['description', null], ['city', '']])).toBeNull()
  })

  /**
   * ⛔ HONEST NEGATIONS PASS THE EMPLOYER SCREEN (owner, 2026-10-18: "go with recommended") — both ways. A negation (fee,
   * age limit or looks) goes only when it is the whole sentence (what is left is filler): review rounds kept finding a fee or
   * a limit riding on a negation inside a longer sentence (codex + Opus, 2026-10-18).
   */
  it('honest negations pass: "no age limit", "no training fee", "without any fee", "không thu phí (đào tạo)", "không giới hạn tuổi"…', () => {
    for (const honest of [
      'No age limit.', 'No age limit — every nationality welcome.', 'There is no age limit for this role.', 'No upper age limit', 'no max age',
      'No age limit, no experience needed.', 'Age limit: none',
      'No training fee.', 'No training fee, no deposit.', 'No training fee, no experience needed.', 'No fees or deposits', 'without any fee',
      'There is no training fee for this position.', 'There will be no training fee.', 'No training & registration fee',
      'We do not charge any training fee', 'We will never charge a training fee.', 'You never pay a deposit.', 'You will never be asked for a deposit.',
      'You don’t have to pay a training fee.', 'No registration fee is required.', 'No training fee will be charged.', 'Deposit is not required.',
      'Training fee: none', 'Training fee: free of charge',
      'Không thu phí đào tạo.', 'Không thu phí (đào tạo)', 'Không thu phí', 'Không giới hạn tuổi', 'Không cần đặt cọc.', 'Không yêu cầu đặt cọc.',
      'Chúng tôi cam kết không thu phí đào tạo.', 'Hoàn toàn không thu phí đào tạo.', 'Không có phí đào tạo.', 'Ko thu phí đào tạo.',
      'Không thu phí đào tạo hay phí hồ sơ',
      'Không thu phí đào tạo, không nhận tiền cọc.', 'Không phải đóng phí đào tạo hay đặt cọc gì.', 'Không thu phí đào tạo, không làm thêm giờ.',
      'Phí đào tạo: không', 'Phí đào tạo: 0đ', 'Phí đào tạo: miễn phí', 'Đặt cọc: miễn phí', 'Miễn phí đào tạo.', 'Ứng viên được miễn phí đào tạo.',
      'Không yêu cầu ngoại hình đẹp',
      // A next sentence that is no consequence leaves the negation honest — "không được" alone is a house rule, not one.
      'No training fee. No experience needed.', 'Không thu phí đào tạo.\nKhông yêu cầu kinh nghiệm.', 'Không thu phí đào tạo.\nKhông được hút thuốc.',
    ]) expect(hit(honest), honest).toBeNull()
  })

  it('⛔ …and the fee words still count in any longer sentence: limited, put off, partly waived, a condition, or beside other words', () => {
    const refused: [string, string, string][] = [
      ['Training fee required', 'job_candidate_fee', 'Training fee required'],
      ['Age limit 35', 'job_discrimination', 'Age limit'],
      ['Age limit: no more than 35', 'job_discrimination', 'Age limit'],
      ['No age limit, female only', 'job_discrimination', 'age limit, female only'],
      // An age limit only partly waived is still one — the age negation is held to the same whole-sentence rule (Opus, round 5).
      ['No age limit for men, 35 for women', 'job_discrimination', 'age limit for men'],
      ['Age limit: none for native speakers, max 35 for others', 'job_discrimination', 'Age limit'],
      ['No age limit as long as you are healthy.', 'job_discrimination', 'age limit as'],
      ['Không yêu cầu ngoại hình đẹp, chỉ cần ưa nhìn', 'job_discrimination', 'ngoại hình đẹp, chỉ'],
      ['No training fee, but a deposit required', 'job_candidate_fee', 'training fee, but a deposit required'],
      ['No training fee and a deposit required', 'job_candidate_fee', 'training fee and a deposit required'],
      ['No experience, training fee required', 'job_candidate_fee', 'training fee required'],
      ['No fee and registration deposit required.', 'job_candidate_fee', 'deposit required'],
      // Limited, put off or partly waived (Opus, rounds 2 and 3).
      ['No training fee for the first month', 'job_candidate_fee', 'training fee for the first'],
      ['Không thu phí đào tạo quá 2 triệu', 'job_candidate_fee', 'phí đào tạo quá'],
      ['No extra training fee', 'job_candidate_fee', 'training fee'],
      ['Phí đào tạo: 0.5 triệu', 'job_candidate_fee', 'Phí đào tạo'],
      ['No training fee upfront – deducted from your first salary', 'job_candidate_fee', 'training fee upfront'],
      ['No training fee – deducted from your first salary', 'job_candidate_fee', 'training fee – deducted'],
      ['(No training fee) will be deducted from your first salary.', 'job_candidate_fee', 'training fee) will'],
      ['Không thu phí đào tạo, trừ vào lương tháng đầu', 'job_candidate_fee', 'phí đào tạo, trừ'],
      ['Không thu phí đào tạo trước, trừ vào lương tháng đầu', 'job_candidate_fee', 'phí đào tạo trước'],
      ['Không thu phí đào tạo (trừ vào lương)', 'job_candidate_fee', 'phí đào tạo (trừ'],
      ['Miễn phí đào tạo 3 tháng đầu', 'job_candidate_fee', 'phí đào tạo 3'],
      ['Miễn phí đào tạo nếu làm đủ 12 tháng', 'job_candidate_fee', 'phí đào tạo nếu'],
      // A condition (codex + Opus): in the sentence, or as the field's next sentence.
      ['Nobody starts without paying the training fee.', 'job_candidate_fee', 'training fee'],
      ['If you don’t pay the deposit, you lose the place.', 'job_candidate_fee', 'pay the deposit'],
      ['Without a training fee, you cannot start.', 'job_candidate_fee', 'training fee, you cannot'],
      ['Without the registration fee, your application will not be processed', 'job_candidate_fee', 'registration fee, your application'],
      ['Nếu không đặt cọc, bạn sẽ mất suất', 'job_candidate_fee', 'đặt cọc'],
      ['No training fee, no job.', 'job_candidate_fee', 'training fee, no'],
      ['Không nộp phí đào tạo, không nhận lớp.', 'job_candidate_fee', 'nộp phí đào tạo'],
      ['Không đặt cọc, không nhận việc.', 'job_candidate_fee', 'đặt cọc, không'],
      ['Không đặt cọc - không nhận việc', 'job_candidate_fee', 'Không đặt cọc - không'],
      ['Không đặt cọc. Không nhận việc.', 'job_candidate_fee', 'đặt cọc'],
      ['No training fee.\nNo job.', 'job_candidate_fee', 'training fee'],
      // NOT free: a negation before "miễn phí" — read before any fee negation is taken out (Opus, round 4).
      ['Học viên không được miễn phí đào tạo.', 'job_candidate_fee', 'không được miễn phí đào tạo'],
      ['Không phải miễn phí đào tạo.', 'job_candidate_fee', 'phí đào tạo'],
      ['Phí đào tạo: không miễn phí', 'job_candidate_fee', 'Phí đào tạo'],
      ['Phí hồ sơ: không được miễn phí', 'job_candidate_fee', 'Phí hồ sơ'],
      ['Phí đào tạo: không hoàn toàn miễn phí', 'job_candidate_fee', 'Phí đào tạo: không hoàn'],
      // The fee handed on to someone else: no auxiliary after the negation (Opus, round 6).
      ['We don’t charge a training fee — the school does.', 'job_candidate_fee', 'training fee — the school does'],
      ['We won’t charge you a training fee, the company will.', 'job_candidate_fee', 'training fee, the company will'],
      // No requirement, refund or condition word is filler (codex + Opus, round 4).
      ['No training fee to apply – it is required to join.', 'job_candidate_fee', 'training fee to apply'],
      ['Đặt cọc – không hoàn', 'job_candidate_fee', 'Đặt cọc'],
      // "and" / "và" carries no negation on, and other words beside a fee negation keep it counting — the safe side for an
      // honest line too; on its own line it passes.
      ['Không thu phí đào tạo và phí hồ sơ', 'job_candidate_fee', 'phí đào tạo và phí hồ sơ'],
      ['Không yêu cầu kinh nghiệm, phí đào tạo 2tr', 'job_candidate_fee', 'phí đào tạo'],
      ['Không yêu cầu ngoại hình đẹp, chỉ tuyển nữ', 'job_discrimination', 'ngoại hình đẹp, chỉ tuyển nữ'],
      ['Lương cao, không thu phí đào tạo, có hoa hồng', 'job_candidate_fee', 'phí đào tạo'],
      ['Miễn phí đào tạo nghiệp vụ cho nhân viên mới', 'job_candidate_fee', 'phí đào tạo nghiệp'],
    ]
    for (const [text, code, snippet] of refused) expect(hit(text), text).toEqual({ code, field: 'description', snippet })
  })

  it('⛔ the plural and the plain demand count too — the classic scam in its plainest words (round 4)', () => {
    const refused: [string, string, string][] = [
      ['Training fees required.', 'job_candidate_fee', 'Training fees required'],
      ['Training fees: 2,000,000 VND.', 'job_candidate_fee', 'Training fees'],
      ['Registration fees apply.', 'job_candidate_fee', 'Registration fees'],
      ['Deposits required.', 'job_candidate_fee', 'Deposits required'],
      ['A deposit is required.', 'job_candidate_fee', 'deposit is required'],
      ['A fee is required to apply.', 'job_candidate_fee', 'fee is required'],
      ['A deposit of 5,000,000 VND is required before you start.', 'job_candidate_fee', 'deposit of 5,000,000'],
      ['A refundable deposit of USD 500 before you start.', 'job_candidate_fee', 'deposit of USD 500'],
      ['Teachers pay a 500 USD placement fee.', 'job_candidate_fee', 'placement fee'],
      ['Placement fee: 500 USD.', 'job_candidate_fee', 'Placement fee'],
      ['Application fees: 1,000,000 VND', 'job_candidate_fee', 'Application fees'],
      ['Teachers pay the fees before training.', 'job_candidate_fee', 'pay the fees'],
      ['Females only.', 'job_discrimination', 'Females only'],
      ['Ladies only.', 'job_discrimination', 'Ladies only'],
      ['Males only', 'job_discrimination', 'Males only'],
    ]
    for (const [text, code, snippet] of refused) {
      expect(hit(text), text).toEqual({ code, field: 'description', snippet })
      // One list: the importer drops each of them too.
      expect(jobDenyReason(text), text).toBe(code === 'job_candidate_fee' ? 'fee' : 'discriminatory')
    }
    // …and the honest wording of each still passes: the negations already read "fees?" / "deposits?" and these fee kinds.
    for (const honest of [
      'No training fees.', 'No fees required.', 'No deposits required.', 'No deposit is required.', 'No placement fees.', 'No application fee.',
      'Placement fee: none', 'We do not charge placement fees.', 'You never pay deposits.', 'Male and female teachers welcome.',
    ]) expect(hit(honest), honest).toBeNull()
    // ⚠️ KNOWN REFUSALS — THE TRADE-OFF, PINNED (review, 2026-10-19): a word test cannot tell who pays. Round 3 asked for
    // more fee demands refused, round 4 for fewer honest lines refused — opposite asks, so the line stays where it is and
    // these are refused, fail-closed and fixable (the snippet names the words; "No fees" or "free" passes). A fee demand
    // worded outside the list ("a fee of 2,000,000 đ") is the report button's — the board says "Never pay to get a job".
    for (const known of ['The school covers all application fees.', 'We pay the training fee.', 'We reimburse your registration fees.'])
      expect(hit(known), known).toMatchObject({ code: 'job_candidate_fee' })
  })

  it('⛔ the importer keeps JOB_DENY exactly as it was — it reads no negation (a false drop costs it nothing)', () => {
    expect(jobDenyReason('No training fee')).toBe('fee')
    expect(jobDenyReason('No age limit')).toBe('discriminatory')
    expect(map({ title: 'English teacher, no training fee' })).toEqual({ ok: false, reason: 'fee' })
  })

  it('jobDenyReason is the importer’s own matcher: the folded text, diacritics no way round it', () => {
    expect(jobDenyReason('CHỈ TUYỂN NỮ')).toBe('discriminatory')
    expect(jobDenyReason('Phí đào tạo 500.000 đ')).toBe('fee')
    expect(jobDenyReason('Massage therapist')).toBe('adult-venue')
    expect(jobDenyReason('English teacher, full-time')).toBeNull()
    expect(jobDenyReason(undefined)).toBeNull()
    // The importer still drops by the same rule (mapStagedJob's reasons are unchanged by sharing the matcher).
    expect(map({ title: 'English teacher, training fee required' })).toEqual({ ok: false, reason: 'fee' })
  })

  it('isHiringPost: Jobs’ `job` intent only — never a `wanted` post, never another category', () => {
    expect(isHiringPost('jobs', 'job')).toBe(true)
    expect(isHiringPost('jobs', 'wanted')).toBe(false)
    expect(isHiringPost('services', 'job')).toBe(false)
    expect(isHiringPost('jobs', null)).toBe(false)
  })

  it('every job-text code has its sentence, in both languages, saying what to take out — no edition named, no ASCII apostrophe', () => {
    expect(Object.keys(JOB_TEXT_REFUSAL).sort()).toEqual([...JOB_TEXT_BLOCK_CODES].sort())
    for (const code of JOB_TEXT_BLOCK_CODES) {
      const { en, vi } = JOB_TEXT_REFUSAL[code]
      expect(en, code).toMatch(/^Job ads .* — remove that line\./)
      expect(vi, code).toMatch(/^Tin tuyển dụng .* — hãy xóa phần đó\./)
      // Every rule runs on both editions, so no sentence names one.
      expect(`${en}${vi}`, code).not.toMatch(/eno\.vn|eno\.forum/)
      // The i18n harvester reads single-quoted t()/tr() arguments only: an ASCII apostrophe would end the string.
      expect(`${en}${vi}`, code).not.toContain("'")
    }
    // The residence rule says the work permit may stay; the fee rule no longer claims a "none" is refused (negations pass).
    expect(JOB_TEXT_REFUSAL.job_residence_wording.en).toBe('Job ads on eno can’t mention visas or residence cards — remove that line. A work permit is fine to mention.')
    expect(JOB_TEXT_REFUSAL.job_residence_wording.vi).toMatch(/giấy phép lao động/)
    expect(JOB_TEXT_REFUSAL.job_candidate_fee.en).not.toMatch(/none/)
  })
})
