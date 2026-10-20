import { describe, expect, it } from 'vitest'
import { readPost } from './extract'
import { fit, type MatchJob, type MatchTeacher } from './gates'
import { composeDm, payText, sourceLine, titleOf } from './compose'
import { checkPost, maskContacts } from './ingest'
import { isStopReply, JOB_DM_STOP_TEXTS } from './replies'

const NOW = new Date('2026-10-21T02:00:00Z') // Wed 21 Oct, 09:00 Vietnam

const teacher = (o: Partial<MatchTeacher> = {}): MatchTeacher => ({
  profileId: 't1', livesIn: 'city', currentCity: 'ho-chi-minh-city', teachAreas: ['d7', 'binh-thanh'], jobTypes: ['parttime'],
  ageGroups: ['kids'], subjects: ['general-english', 'phonics'], englishLevel: 'native', degreeLevel: 'bachelor', certificates: ['tefl'],
  yearsExperience: 3, expectedSalaryM: null, coverUsable: true, coverAreas: ['d7', 'binh-thanh'], coverSlots: ['thu-eve', 'sat-am'],
  coverRateVnd: 350_000, ...o,
})

const jobOf = (text: string, key = 'post:1'): MatchJob => {
  const f = readPost(text, NOW)
  return {
    key, kind: f.kind === 'cover_request' ? 'cover_request' : 'job_offer', employment: f.employment, places: f.places, pay: f.pay,
    schedule: f.schedule, ageGroups: f.ageGroups, subjects: f.subjects, requirements: f.requirements, postedAt: NOW,
  }
}

const COVER = 'URGENT: our centre needs a cover teacher tomorrow 6-7:30pm in Binh Thanh. Kids 8-10. 400k/h.'

describe('fit — cover requests', () => {
  it('a teacher open for cover, in the area, free then, at their rate: fits', () => {
    const f = fit(teacher(), jobOf(COVER), NOW)
    expect(f).toMatchObject({ ok: true, blocker: null })
    expect(f.reasons).toEqual(expect.arrayContaining(['district', 'free-then', 'pay']))
  })
  it('not open for cover / another district / busy then / pay below rate → refused, with the gate named', () => {
    expect(fit(teacher({ coverUsable: false }), jobOf(COVER), NOW).blocker).toBe('not-open-for-cover')
    expect(fit(teacher({ coverAreas: ['d1'] }), jobOf(COVER), NOW).blocker).toBe('cover-area')
    expect(fit(teacher({ coverSlots: ['thu-am'] }), jobOf(COVER), NOW).blocker).toBe('cover-slot')
    expect(fit(teacher({ coverRateVnd: 500_000 }), jobOf(COVER), NOW).blocker).toBe('pay-below-rate')
  })
  it('gate 2a: a job offered in a place OR online reaches an online teacher', () => {
    const j = jobOf('Our English centre in District 7 is hiring a part-time teacher for kids, offline or online classes via Zoom')
    expect(j.places).toEqual(expect.arrayContaining(['d7', 'online']))
    expect(fit(teacher({ teachAreas: ['online'] }), j, NOW).ok).toBe(true)
  })
  it('gate 2a: a cover with a time and no day is for the day it is read as — the teacher must be free then', () => {
    // NOW = Wed 21 Oct 09:00 ICT: "at 6pm" is this Wednesday evening
    const j = jobOf('URGENT: our centre needs a cover teacher at 6pm in Binh Thanh. Kids 8-10. 400k/h.')
    expect(fit(teacher({ coverSlots: ['sat-eve'] }), j, NOW).blocker).toBe('cover-slot')
    expect(fit(teacher({ coverSlots: ['wed-eve'] }), j, NOW).ok).toBe(true)
  })
  it("the cover rate is a floor for cover lessons only, not for an hourly part-time job", () => {
    const pt = jobOf('Our English centre in District 7 is hiring a part-time teacher for kids, 400k/hour, weekday evenings')
    expect(fit(teacher({ coverRateVnd: 500_000, jobTypes: ['parttime'], teachAreas: ['d7'] }), pt, NOW).ok).toBe(true)
  })
  it('"all of HCMC" covers every district', () => {
    expect(fit(teacher({ coverAreas: ['ho-chi-minh-city'] }), jobOf(COVER), NOW).ok).toBe(true)
  })
  it('a teacher abroad never gets a cover lesson', () => {
    expect(fit(teacher({ livesIn: 'abroad' }), jobOf(COVER), NOW).blocker).toBe('teacher-abroad')
  })
})

describe('fit — jobs', () => {
  const FT = 'We are hiring a full-time English teacher in Da Nang. Bachelor degree and TEFL required, 2 years experience. Salary 25-30 million VND/month.'
  const dn = teacher({ currentCity: 'da-nang', teachAreas: ['da-nang'], jobTypes: ['fulltime'], expectedSalaryM: 25 })
  it('meets every stated requirement and the pay → fits', () => {
    expect(fit(dn, jobOf(FT), NOW).ok).toBe(true)
  })
  it('each stated requirement blocks when unmet', () => {
    expect(fit({ ...dn, degreeLevel: 'associate' }, jobOf(FT), NOW).blocker).toBe('degree')
    expect(fit({ ...dn, certificates: [] }, jobOf(FT), NOW).blocker).toBe('certificate')
    expect(fit({ ...dn, yearsExperience: 1 }, jobOf(FT), NOW).blocker).toBe('experience')
    expect(fit({ ...dn, expectedSalaryM: 40 }, jobOf(FT), NOW).blocker).toBe('pay-below-expectation')
    expect(fit({ ...dn, jobTypes: ['parttime'] }, jobOf(FT), NOW).blocker).toBe('job-type:full_time')
    expect(fit({ ...dn, teachAreas: ['ha-noi'] }, jobOf(FT), NOW).blocker).toBe('place')
  })
  it('pay not stated → no pay gate, ranked lower ("just best match")', () => {
    const noPay = jobOf('We are hiring a full-time English teacher in Da Nang.')
    const f = fit({ ...dn, expectedSalaryM: 40 }, noPay, NOW)
    expect(f.ok).toBe(true)
    expect(f.score).toBeLessThan(fit(dn, jobOf(FT), NOW).score)
  })
  it('native required gates on the teacher\'s own English level and is noted for the message', () => {
    const j = jobOf('Hiring native English teachers, full-time, Da Nang')
    expect(fit({ ...dn, englishLevel: 'fluent' }, j, NOW).blocker).toBe('native')
    expect(fit(dn, j, NOW).notes).toContain('native-asked')
  })
  it('an IELTS job needs an IELTS teacher; general English does not satisfy it', () => {
    const j = jobOf('Our centre is hiring a part-time IELTS teacher in District 7')
    expect(fit(teacher(), j, NOW).blocker).toBe('subject:ielts')
    expect(fit(teacher({ subjects: ['ielts'] }), j, NOW).ok).toBe(true)
  })
  it('a district job reaches a teacher with that district, all of the city or anywhere — not another city', () => {
    const j = jobOf('Our school in District 7 is hiring a part-time English teacher for kids')
    expect(fit(teacher({ teachAreas: ['d7'] }), j, NOW).ok).toBe(true)
    expect(fit(teacher({ teachAreas: ['ho-chi-minh-city'] }), j, NOW).ok).toBe(true)
    expect(fit(teacher({ teachAreas: ['anywhere'] }), j, NOW).ok).toBe(true)
    expect(fit(teacher({ teachAreas: ['ha-noi'] }), j, NOW).blocker).toBe('place')
  })
  it('online jobs need an online teacher', () => {
    const j = jobOf('We are hiring online English teachers via Zoom, part-time')
    expect(fit(teacher({ teachAreas: ['d7'] }), j, NOW).blocker).toBe('not-online')
    expect(fit(teacher({ teachAreas: ['online'] }), j, NOW).ok).toBe(true)
  })
  it('abroad teachers only for full-time jobs that welcome applicants from abroad', () => {
    const abroad = { ...dn, livesIn: 'abroad', teachAreas: ['da-nang'] }
    expect(fit(abroad, jobOf(FT), NOW).blocker).toBe('teacher-abroad')
    expect(fit(abroad, jobOf(`${FT} Overseas applicants welcome, flight allowance.`), NOW).ok).toBe(true)
  })
})


describe('compose', () => {
  const items = [
    { key: 'post:1', title: titleOf(readPost(COVER, NOW)), when: 'Thu 22 Oct, evening', pay: payText(readPost(COVER, NOW).pay), asks: [], source: sourceLine('fb', 'Saigon Teachers'), link: 'https://www.facebook.com/groups/1/posts/2/' },
  ]
  it('the owner\'s greeting, eno\'s own summary, the link, the fee warning and STOP', () => {
    const { text, included } = composeDm({ firstName: 'Anna Smith', items, kind: 'cover', first: true })
    expect(text.startsWith('Hi Anna, this is Alex from eno.vn.')).toBe(true)
    expect(text).toContain('Cover lesson · kids — Binh Thanh District, Ho Chi Minh City')
    expect(text).toContain('400,000 đ / hour')
    expect(text).toContain('https://www.facebook.com/groups/1/posts/2/')
    expect(text).toContain('Never pay a fee')
    expect(text).toContain('Reply STOP')
    expect(included).toEqual(['post:1'])
  })
  it('never carries a visa word: a visa-named group is renamed, a visa-worded job is left out', () => {
    expect(sourceLine('fb', 'Visa & Jobs Vietnam')).toBe('Posted in a Facebook teaching-jobs group')
    const r = composeDm({ firstName: 'A', kind: 'jobs', first: false, items: [{ key: 'listing:9', title: 'Teacher with work permit support', asks: [], source: 'Listed on eno.vn' }] })
    expect(r.text).toBe('')
    expect(r.skipped).toEqual(['listing:9'])
  })
  it('stays under the chat length cap', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...items[0], key: `post:${i}`, link: `https://www.facebook.com/groups/1/posts/${1000 + i}/` }))
    const r = composeDm({ firstName: 'A', items: many, kind: 'jobs', first: true })
    expect(r.text.length).toBeLessThanOrEqual(1900)
    expect(r.skipped.length).toBeGreaterThan(0)
  })
})

describe('ingest', () => {
  const ok = { source: 'fb', externalKey: '123:456', sourceName: 'Saigon Teachers', text: 'We are hiring', url: 'https://www.facebook.com/groups/123/posts/456/', postedAt: '2026-10-20T10:00:00Z' }
  it('accepts a clean post', () => {
    expect(checkPost(ok, NOW)).toMatchObject({ ok: true })
  })
  it('refuses a link that is not the source\'s own canonical form', () => {
    expect(checkPost({ ...ok, url: 'https://evil.example/groups/1/posts/2' }, NOW)).toMatchObject({ ok: false, reason: 'url' })
    expect(checkPost({ ...ok, source: 'linkedin', url: 'https://www.linkedin.com/comm/jobs/view/1/?tracking=x' }, NOW)).toMatchObject({ ok: false, reason: 'url' })
  })
  it('refuses future and stale dates, oversize text, unknown sources', () => {
    expect(checkPost({ ...ok, postedAt: '2026-11-30T00:00:00Z' }, NOW)).toMatchObject({ reason: 'postedAt_future' })
    expect(checkPost({ ...ok, postedAt: '2026-07-01T00:00:00Z' }, NOW)).toMatchObject({ reason: 'postedAt_old' })
    expect(checkPost({ ...ok, text: 'x'.repeat(6001) }, NOW)).toMatchObject({ reason: 'text_too_long' })
    expect(checkPost({ ...ok, source: 'zalo' }, NOW)).toMatchObject({ reason: 'source' })
  })
  it('masks contacts in LinkedIn and forwarded text', () => {
    expect(maskContacts('Call 0901 234 567 or mail hr@school.vn, zalo.me/0901234567')).toBe('Call [phone] or mail [email], [link]')
  })
  it('gate 2a: a dotted salary is not a phone; Facebook text is masked too; a long key or an empty text is refused', () => {
    expect(maskContacts('Lương 30.000.000-40.000.000 VND/tháng, gọi 090.123.4567 hoặc +84 90 123 4567')).toBe('Lương 30.000.000-40.000.000 VND/tháng, gọi [phone] hoặc [phone]')
    expect(checkPost({ ...ok, text: 'Hiring, call 0901234567' }, NOW)).toMatchObject({ ok: true, post: { text: 'Hiring, call [phone]' } })
    expect(checkPost({ ...ok, externalKey: '1:' + '2'.repeat(250) }, NOW)).toMatchObject({ ok: false, reason: 'externalKey' })
    expect(checkPost({ ...ok, text: '\u0001\u0002\u0003' }, NOW)).toMatchObject({ ok: false, reason: 'text' })
  })
})

describe('isStopReply — gate 2a', () => {
  it('"Đúng ạ" (yes, right), a name, are not a stop; "dừng lại", "hủy đăng ký", "ngừng" are', () => {
    for (const t of ['Đúng ạ', 'đúng nha', 'Dũng', 'Huy', 'Huy a']) expect(isStopReply(t)).toBe(false)
    for (const t of ['Dừng lại', 'dừng gửi nhé', 'Hủy đăng ký', 'Ngừng', 'dừng tin nhắn']) expect(isStopReply(t)).toBe(true)
  })
})

describe('isStopReply', () => {
  it('the chip words and short stops', () => {
    for (const s of [JOB_DM_STOP_TEXTS.en, JOB_DM_STOP_TEXTS.vi, 'STOP', 'stop please', 'Unsubscribe', 'no more jobs', 'Dừng', 'ngừng nhé']) expect(isStopReply(s)).toBe(true)
  })
  it('a sentence that only contains the word is not a stop', () => {
    for (const s of ['Is it near the bus stop?', 'Thanks! I applied', 'Keep sending jobs', "Don't stop sending"]) expect(isStopReply(s)).toBe(false)
  })
})

describe('compose — gate 2a', () => {
  it('a link carrying a visa word inside a slug is left out', () => {
    const r = composeDm({ firstName: 'Sam', kind: 'jobs', first: false, items: [
      { key: 'post:1', title: 'Part-time teaching job — District 7, Ho Chi Minh City', asks: [], source: 'Posted in a Facebook teaching-jobs group', link: 'https://www.facebook.com/groups/vietnamvisateachers/posts/1/' },
      { key: 'post:2', title: 'Part-time teaching job — District 3, Ho Chi Minh City', asks: [], source: 'Posted in a Facebook teaching-jobs group', link: 'https://www.facebook.com/groups/123/posts/2/' },
    ] })
    expect(r.included).toEqual(['post:2'])
    expect(r.skipped).toEqual(['post:1'])
  })
})

describe('gate 2b', () => {
  it('a group name is used only when it is plainly a name', () => {
    expect(sourceLine('fb', 'Saigon Teachers')).toBe('Posted in the Facebook group "Saigon Teachers"')
    expect(sourceLine('fb', 'English Teachers in Hanoi (HN)')).toBe('Posted in the Facebook group "English Teachers in Hanoi (HN)"')
    for (const n of ['Việc làm GV — Zalo 0901234567', 'Jobs www.example.com', 'Teachers 🔥🔥 DM me', 'Work Permit Teachers VN', 'x'.repeat(70)]) {
      expect(sourceLine('fb', n)).toBe('Posted in a Facebook teaching-jobs group')
    }
  })
  it('a permit word in a link slug leaves the job out', () => {
    const r = composeDm({ firstName: null, kind: 'jobs', first: false, items: [
      { key: 'post:1', title: 'Teaching job — Hanoi', asks: [], source: 'Posted in a Facebook teaching-jobs group', link: 'https://www.facebook.com/groups/workpermitteachersvn/posts/1/' },
    ] })
    expect(r.included).toEqual([])
  })
  it('pay reads in vnd.ts forms', () => {
    expect(payText({ min: 25_000_000, max: 30_000_000, unit: 'month', text: '' })).toBe('25M–30M đ / month')
    expect(payText({ min: 400_000, max: 400_000, unit: 'hour', text: '' })).toBe('400,000 đ / hour')
  })
  it('a timed cover too close to read a day for is refused by fit itself', () => {
    const late = new Date('2026-10-21T12:30:00Z') // 19:30 ICT, for an 8pm lesson
    const j = { ...jobOf('URGENT: our centre needs a cover teacher at 8pm in Binh Thanh. Kids 8-10. 400k/h.'), postedAt: late }
    expect(fit(teacher({ coverSlots: ['wed-eve'] }), j, late).blocker).toBe('cover-too-late')
  })
  it('stops: a short message that starts by asking to stop counts, a question does not', () => {
    for (const t of ['Please stop sending me jobs', 'stop messaging me', 'Unsubscribe me', "Don't send me these", 'Không nhận nữa', 'Đừng gửi nữa']) expect(isStopReply(t)).toBe(true)
    for (const t of ['Can you stop by the school?', 'Thanks, I applied!', 'Keep sending jobs']) expect(isStopReply(t)).toBe(false)
    // gate 2c: anchored — none of these is a stop
    for (const t of ['Stop teaching kids, I prefer adults', 'Không nhận được link', 'Đúng, gửi tiếp', 'Đúng, cần ạ', 'Dũng gửi CV ạ', 'dung gui nua']) expect(isStopReply(t)).toBe(false)
  })
})

describe('gate 2c', () => {
  it('phones in parentheses are masked; a long URL is refused; an Apply line asking for money is dropped', () => {
    expect(maskContacts('Call (+84) 901 234 567 or +84 (90) 123 4567')).toBe('Call [phone] or [phone]')
    const ok = { source: 'fb', externalKey: '123:456', sourceName: 'Saigon Teachers', text: 'We are hiring', url: 'https://www.facebook.com/groups/123/posts/456/', postedAt: '2026-10-20T10:00:00Z' }
    expect(checkPost({ ...ok, url: 'https://www.facebook.com/groups/123/posts/' + '4'.repeat(600) + '/' }, NOW)).toMatchObject({ ok: false, reason: 'url' })
    const fwd = { source: 'intake', externalKey: 'msg:abc', sourceName: 'Forwarded by the eno team', text: 'English teacher needed in D7' }
    expect(checkPost({ ...fwd, applyText: 'Email hr@school.vn with your CV' }, NOW)).toMatchObject({ ok: true, post: { applyText: 'Email hr@school.vn with your CV' } })
    expect(checkPost({ ...fwd, applyText: 'Transfer a 500k deposit, then send CV' }, NOW)).toMatchObject({ ok: true, post: { applyText: null } })
  })
  it('an undated cover read as an older day is in the past', () => {
    const posted = new Date('2026-10-20T02:00:00Z') // Tue 09:00 ICT — "at 6pm" is that Tuesday
    const j = { ...jobOf('URGENT: our centre needs a cover teacher at 6pm in Binh Thanh. Kids 8-10. 400k/h.'), postedAt: posted }
    expect(fit(teacher({ coverSlots: ['tue-eve'] }), j, NOW).blocker).toBe('cover-in-the-past')
  })
})

describe('gate 2d', () => {
  it('stops: a long message with an unmistakable phrase; "không nhận" alone declines one cover', () => {
    expect(isStopReply('Please stop sending me job messages, I did not opt in and do not contact me again')).toBe(true)
    expect(isStopReply('Thanks for the jobs, the second one looks great, I applied this morning and will tell you')).toBe(false)
    expect(isStopReply('Không nhận')).toBe(false)
    expect(isStopReply('ko nhận')).toBe(false)
    expect(isStopReply('Không nhận nữa')).toBe(true)
    expect(isStopReply('Không nhận tin nhắn nữa')).toBe(true)
  })
  it('an Apply line with money in any form is dropped', () => {
    const fwd = { source: 'intake', externalKey: 'msg:abc', sourceName: 'Forwarded by the eno team', text: 'English teacher needed in D7' }
    expect(checkPost({ ...fwd, applyText: 'Send 500k cash to secure your place' }, NOW)).toMatchObject({ ok: true, post: { applyText: null } })
  })
  it('the asks line names a teaching certificate, as the gate counts it', () => {
    const r = composeDm({ firstName: null, kind: 'jobs', first: false, items: [{ key: 'post:1', title: 'Teaching job — Hanoi', asks: ['a teaching certificate (TEFL/TESOL/CELTA or similar)'], source: 'Posted on LinkedIn', link: 'https://www.linkedin.com/jobs/view/1/' }] })
    expect(r.text).toContain('The post asks for a teaching certificate (TEFL/TESOL/CELTA or similar).')
  })
  it('a dated cover with a time is too late an hour before it', () => {
    const j = jobOf('Our centre needs a cover teacher today at 6pm in Binh Thanh, kids 8-10, 400k/h')
    expect(fit(teacher({ coverSlots: ['wed-eve'] }), j, new Date('2026-10-21T10:30:00Z')).blocker).toBe('cover-too-late') // 17:30 ICT
  })
})

describe('gate 3b', () => {
  it('a long reply that stops sending something else is not a STOP', () => {
    expect(isStopReply("Thanks, I'll stop sending CVs to schools that never reply, job 2 looks great though")).toBe(false)
  })
  it('an Apply line with a name like Tiến or an address is kept', () => {
    const fwd = { source: 'intake', externalKey: 'msg:abc', sourceName: 'Forwarded by the eno team', text: 'English teacher needed in D7' }
    expect(checkPost({ ...fwd, applyText: 'Ask for Mr Tiến at 12 D2 street' }, NOW)).toMatchObject({ ok: true, post: { applyText: 'Ask for Mr Tiến at 12 D2 street' } })
  })
})
