import { describe, expect, it } from 'vitest'
import { readPost } from './extract'
import { fit, type MatchJob, type MatchTeacher } from './gates'
import { composeDm, payText, sourceLine, titleOf } from './compose'
import { checkPost, maskContacts } from './ingest'
import { isKeepReply, isStopReply, mayBeOptOut, JOB_DM_STOP_TEXTS } from './replies'

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
  it('masks a contact in the short printed fields too — never in the Apply line, which IS the way to apply (opus, gate 7a)', () => {
    const c = checkPost({
      ...ok, source: 'linkedin', externalKey: '4012345678', url: 'https://www.linkedin.com/jobs/view/4012345678/',
      title: 'GV tiếng Anh – Zalo 0901 234 567', company: 'Trung tâm ABC hr@abc.edu.vn', locationText: 'Q7 · zalo.me/0901234567',
    }, NOW)
    if (!c.ok) throw new Error(c.reason)
    for (const v of [c.post.title, c.post.company, c.post.locationText]) expect(v).not.toMatch(/\d{3}|@|zalo\.me/)
    expect(c.post.title).toMatch(/^GV tiếng Anh – Zalo /)
    const g = checkPost({ ...ok, sourceName: 'Việc làm GV 0909 123 456' }, NOW)
    if (!g.ok) throw new Error(g.reason)
    expect(g.post.sourceName).not.toMatch(/\d{3}/)
    // ⛔ masked BEFORE the 200-character cut: a number across the boundary never survives as a fragment (gate 7a2)
    const edge = checkPost({ ...ok, title: `${'x'.repeat(185)} Zalo 0901 234 567 hr@abc.edu.vn` }, NOW)
    if (!edge.ok) throw new Error(edge.reason)
    expect(edge.post.title!.length).toBeLessThanOrEqual(200)
    expect(edge.post.title).not.toMatch(/\d{3}|@abc/)
    const intake = checkPost({ ...ok, source: 'intake', externalKey: 'abc', url: undefined, applyText: 'Zalo 0901 234 567 (Ms Lan)' }, NOW)
    expect(intake.ok && intake.post.applyText).toBe('Zalo 0901 234 567 (Ms Lan)')
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
    expect(mayBeOptOut('Please stop sending me job messages, I did not opt in and do not contact me again')).toBe(true)
    expect(mayBeOptOut('Thanks for the jobs, the second one looks great, I applied this morning and will tell you')).toBe(false)
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
    expect(mayBeOptOut("Thanks, I'll stop sending CVs to schools that never reply, job 2 looks great though")).toBe(false)
  })
  it('an Apply line with a name like Tiến or an address is kept', () => {
    const fwd = { source: 'intake', externalKey: 'msg:abc', sourceName: 'Forwarded by the eno team', text: 'English teacher needed in D7' }
    expect(checkPost({ ...fwd, applyText: 'Ask for Mr Tiến at 12 D2 street' }, NOW)).toMatchObject({ ok: true, post: { applyText: 'Ask for Mr Tiến at 12 D2 street' } })
  })
})

describe('gate 3c: long replies', () => {
  it('only an opt-out from THESE messages counts', () => {
    for (const t of [
      "Please don't send me the address by email, just call me — job 2 looks great, applying today",
      'I got no more messages from the school about job 2, can you check for me please?',
      'Remove me from the shortlist for job 3, I found another position, thank you so much',
      'I opt out of nights but day shifts work for me, so the second one would be perfect',
    ]) expect(mayBeOptOut(t)).toBe(false)
    for (const t of [
      'Please stop sending me job messages, I am not looking for work at the moment, thank you',
      "Hi Alex, I'd like to unsubscribe from these, I already have a full-time job now. Thanks",
    ]) expect(mayBeOptOut(t)).toBe(true)
  })
})

describe('gate 3d: long replies — a missed STOP is the costly failure', () => {
  it('plain long opt-outs count, in English and Vietnamese', () => {
    for (const t of [
      'Stop messaging me, I never signed up for any of this, who gave you my number?!',
      "Don't contact me again please, I am not a teacher and I do not want these messages",
      'dont text me anymore, I have a job already and I really do not need this at all',
      'Mình không muốn nhận tin nhắn nữa, cảm ơn bạn nhiều nhé, chúc bạn một ngày vui vẻ',
    ]) expect(mayBeOptOut(t)).toBe(true)
  })
  it('an object that is plainly something else does not', () => {
    expect(mayBeOptOut("I unsubscribed from the school newsletter; please keep sending these jobs, they're useful")).toBe(false)
    expect(mayBeOptOut('Please do not send me the address by email, just call me — job 2 looks great, applying today')).toBe(false)
  })
})

describe('gate 3e: long replies fail toward stopping', () => {
  it('opt-outs in any wording count', () => {
    for (const t of [
      'Please stop these job alerts immediately; I already found work and do not need any further updates',
      'No more job messages, I found a job already, thanks for everything so far, really appreciate it',
      'Please remove me from your database, I am leaving Vietnam next month and will not be teaching',
      "I opt out, I have a job in Hanoi now and won't need these anymore, thank you for your help",
      'Stop sending these job offers, not interested at all, I have told you this before twice now',
      'Đừng gửi tin cho tôi nữa, tôi có việc rồi, cảm ơn nhiều nhé, chúc bạn một ngày tốt lành',
      'Ngừng gửi tin nhắn cho mình nhé, mình không còn tìm việc nữa, cảm ơn bạn nhiều lắm luôn',
    ]) expect(mayBeOptOut(t)).toBe(true)
  })
  it('plainly about something else does not', () => {
    for (const t of [
      'You never text me back when I apply, is job 2 still open? I sent my CV yesterday morning',
      'Trường ko nhắn tin lại cho em về job 2, anh check giúp em được không ạ, em cảm ơn anh nhiều',
      'Is the school near the bus stop on Nguyen Hue? I can stop by tomorrow morning to drop my CV',
    ]) expect(mayBeOptOut(t)).toBe(false)
  })
})

describe('gate 3f: long replies', () => {
  it('a complaint about being messaged is a STOP, whatever words it uses', () => {
    for (const t of [
      'Why do you keep messaging me? I never signed up for this, stop it now please, this is the third time',
      'Please do not continue sending me these job messages, I already have a job and I do not need it',
      'Đừng gửi tiếp nữa nhé, tôi có việc rồi, cảm ơn bạn nhiều, chúc một ngày vui vẻ và thành công',
    ]) expect(mayBeOptOut(t)).toBe(true)
  })
  it('"not interested" in one job, and "thôi gửi CV", are not', () => {
    for (const t of [
      "I'm not interested in job 1, but job 2 looks perfect; please send me the details when you can",
      'Not interested in the Hanoi one, but please send more in HCMC like the District 7 job, thanks',
      'Mình sẽ thôi gửi CV cho trường đó vì họ không trả lời, job 2 thì mình đã ứng tuyển rồi nhé',
    ]) expect(mayBeOptOut(t)).toBe(false)
    expect(mayBeOptOut('Not interested at all, I have a job already and I do not teach any more, sorry')).toBe(true)
  })
})

describe('gate 3g: free text never withdraws by itself — it pauses', () => {
  it('a long message withdraws only when it opens with STOP', () => {
    expect(isStopReply('STOP. I have already found work and never agreed to any of this. Thank you.')).toBe(true)
    expect(isStopReply('Dừng lại nhé, mình đã có việc rồi và không cần các tin này nữa, cảm ơn bạn nhiều')).toBe(true)
    expect(isStopReply("I don't want to receive these job messages anymore, please take note, thank you.")).toBe(false)
    expect(mayBeOptOut("I don't want to receive these job messages anymore, please take note, thank you.")).toBe(true)
  })
  it('a delivery instruction about one job is at most a pause, never a withdrawal', () => {
    const t = 'Please stop sending me the address by email; call me instead because I want to apply today.'
    expect(isStopReply(t)).toBe(false)
  })
})

describe('gate 3h', () => {
  it('a long message withdraws only on a standalone opening STOP; others go to the pause', () => {
    expect(isStopReply('Stop by the school tomorrow? I would like to drop off my CV and certificates in person')).toBe(false)
    expect(isStopReply('Hủy buổi phỏng vấn job 2 giúp em nhé, em bận đột xuất, em xin lỗi anh nhiều ạ')).toBe(false)
    expect(isStopReply('STOP! I have already found work and never agreed to any of this, thanks')).toBe(true)
  })
  it('revoking consent, and a channel opt-out, may be opt-outs', () => {
    expect(mayBeOptOut('I revoke my consent to receive job alerts and any future employment messages, effective immediately')).toBe(true)
    expect(mayBeOptOut("Don't text me on WhatsApp or here ever again, I never gave you my number, thanks")).toBe(true)
  })
})

describe('gate 3h: a channel preference is a pause, not a pass', () => {
  it('"don\'t message me on Zalo, email me instead" pauses (cheap: the teacher writes again and it lifts)', () => {
    expect(mayBeOptOut('Please do not message me on Zalo, email me instead please — job 2 sounds great, applying now')).toBe(true)
    expect(isStopReply('Please do not message me on Zalo, email me instead please — job 2 sounds great, applying now')).toBe(false)
  })
})

describe('gate 3i: the keep reader', () => {
  it('the chip and its typed forms lift a pause; a thank-you does not', () => {
    for (const t of ['Keep sending jobs', 'Gửi tiếp việc làm', 'keep sending please', 'Yes keep sending me jobs', 'gửi tiếp nhé']) expect(isKeepReply(t)).toBe(true)
    for (const t of ['thanks!', 'ok', 'Why do you keep sending me these?', 'please stop']) expect(isKeepReply(t)).toBe(false)
  })
})

describe('gate 3j', () => {
  it('a STOP that goes on without a sentence end is a PAUSE (gate 4a: no capitals special case); "Stop - I meant job 3" too', () => {
    expect(isStopReply('STOP I already found work and never consented to these messages, thank you')).toBe(false)
    expect(mayBeOptOut('STOP I already found work and never consented to these messages, thank you')).toBe(true)
    expect(isStopReply('Stop - I meant job 3 not job 2, please send me the details for job 3, thanks')).toBe(false)
  })
})

describe('gate 3l', () => {
  it('an all-caps STOP that goes somewhere else is not a withdrawal', () => {
    expect(isStopReply('STOP by the school tomorrow? I want to deliver my CV and certificates in person')).toBe(false)
    expect(isStopReply('STOP? Why would I stop, I love these jobs — please keep them coming, thank you')).toBe(false)
  })
})

describe('gate 3m', () => {
  it('"Stop, I meant job 3" is not a withdrawal; "no further contact" may be an opt-out', () => {
    expect(isStopReply('Stop, I meant job 3 not job 2 — please send me the details for job 3, thanks a lot')).toBe(false)
    expect(isStopReply('Ngừng lại, cho em hỏi job 3 có còn tuyển không ạ, em cảm ơn anh nhiều lắm luôn ạ')).toBe(false)
    expect(mayBeOptOut('Stop — I already found a job and do not want any further contact from your service')).toBe(true)
  })
})

describe('gate 3n', () => {
  it('a shouted STOP that goes on to something else pauses, never withdraws', () => {
    expect(isStopReply('STOP, I meant job 3 not job 2 — please send job 3 details when you can, thanks')).toBe(false)
    expect(isStopReply('STOP sending me the address by email, call me, job 2 looks great, applying today')).toBe(false)
    expect(isStopReply('STOP please, I have a job now and I do not need these messages any more, thanks')).toBe(false)
    expect(mayBeOptOut('STOP please, I have a job now and I do not need these messages any more, thanks')).toBe(true)
    expect(isStopReply('STOP. I have a job now and I do not need these messages any more, thanks a lot')).toBe(true)
  })
})

describe('gate 4b', () => {
  it('a reply about a job is not an opt-out, even when it opens with stop', () => {
    for (const t of [
      'Stop - I meant job 3 not job 2, please send me the details for job 3, thanks a lot',
      "I never asked for job 3's address, I asked about job 2 — is it still open? thanks so much",
      'STOP sending me the address by email, call me instead, job 2 looks great, applying today',
    ]) expect(mayBeOptOut(t)).toBe(false)
  })
})

describe('gate 4c', () => {
  it('a bare "applied" or "interview" does not excuse an opt-out', () => {
    expect(mayBeOptOut('Please stop the job messages, I got hired after an interview last week, thanks for everything')).toBe(true)
    expect(mayBeOptOut('Stop sending these job alerts, I already applied elsewhere and got the position, thank you')).toBe(true)
  })
})

describe('gate 5d', () => {
  it('explicit stop words win over talk of a job', () => {
    expect(mayBeOptOut("Please stop the job messages, I'll apply to job 3 myself, thanks for all the help")).toBe(true)
    expect(isStopReply("Stop. Don't send me job 4 or anything else, I have found a job now, thank you")).toBe(true)
  })
})

describe('gate 6a', () => {
  it('asking to KEEP the alerts, or why they stopped, is not an opt-out', () => {
    expect(mayBeOptOut("Please don't stop the job alerts, they're great and I applied to two of them already")).toBe(false)
    expect(mayBeOptOut('Why did you stop the job messages? I have not had any for a week now, is something wrong')).toBe(false)
  })
})

describe('gate 6b', () => {
  it('a threat or a complaint keeps its "stop"', () => {
    expect(mayBeOptOut("If you don't stop the job messages I'll report you as spam, I never asked for any of this")).toBe(true)
    expect(mayBeOptOut('You never stop messaging me, every single day another one, this is too much honestly')).toBe(true)
  })
})

describe('gate 6c', () => {
  it('keeping the alerts, in more words, is not an opt-out', () => {
    for (const t of [
      "Please don't stop the job alerts, they aren't spam at all, I really like getting them every day",
      "Please don't stop the job alerts, I'll report back on the interviews I get from them this week",
      "I hope you won't stop the job alerts, they have been really useful for me this month, thanks",
      "Please don't ever stop the job messages, they found me two good classes already this month",
      'Why did you stop the job messages? I liked getting them and I applied to two of the schools',
      // gate 6d
      'Please don’t stop the job alerts, no complaints at all, they have been really helpful to me',
      'Never stop the job alerts! I found my current school through one of them last month',
      'Don’t you dare stop the job alerts, I read every one of them the morning it arrives',
    ]) expect(mayBeOptOut(t), t).toBe(false)
  })

  it('…and the same words that ask to STOP still pause (a miss is the costly error)', () => {
    for (const t of [
      'Will you stop messaging me? I have told you before that I am not looking for work now',
      'Would you stop sending me these messages, I am not interested in teaching any more',
      "You won't stop messaging me, will you? This is the third time this week, honestly",
      "Why don't you stop sending me these messages? I asked you last week already",
      "You don't stop sending me jobs even though I asked you not to send them to me",
      "Can you stop the job messages? I'll apply to job 3 myself if I want it, thanks",
      "Oh please don't stop the messages, I just love spam from people I never gave my number to",
      "Please don't stop the job alerts... just kidding, stop sending me these messages or I will block your number",
      "If you don't stop the job messages I'll report you to Facebook, this is the last warning",
      'Did you stop the job alerts? Good. Please stop all the job messages from now on, thank you',
      // gate 6e: a question about stopping can be either — it pauses (the cheap error), and the PAUSE_ACK offers "Keep"
      "Did you stop the job alerts? I haven't had one in a week and I was looking forward to them",
      'Did you stop sending me these messages like I asked you to last week? I am still getting them',
      'Have you stopped messaging me yet? I asked twice already and they keep on coming every day',
      "Don't you ever stop sending me these? I have told you I am not looking for any work now",
      // gate 6d: the same new keep-shapes, said by someone who wants it to end
      'You never stop sending these messages even after I asked you twice to leave me be',
      'Please don’t stop the job alerts — said no one ever. I have complained about these twice',
    ]) expect(mayBeOptOut(t), t).toBe(true)
  })
})

describe('gate 6h — the same wish in other verbs', () => {
  it('"keep them stopped", "turn off the job alerts", "switch these off" pause', () => {
    for (const t of [
      'Why did you stop the job messages? Please keep them stopped, I do not want any more of them',
      'Please turn off the job alerts, I have already found a full-time school for this year',
      'Can you switch these off? I found a school last week and I am happy there, thank you',
      'Turn off notifications please, I am leaving Vietnam at the end of this month anyway',
      'Leave the job alerts off for now please, I will switch them on again myself in January',
    ]) expect(mayBeOptOut(t), t).toBe(true)
  })
  it('…and other things turned off or kept are not', () => {
    for (const t of [
      'I have to turn off my phone during class, but the school in job 2 looks good to me, thanks',
      'Keep them coming! The cover lesson in Thao Dien last week was great and they want me back',
      'The school asked me to switch off the projector after class, is that normal for a cover lesson?',
      // gate 7a: a bare "it/this"
      'I need to turn it off before the lesson starts, sorry for the late reply about the school in Thu Duc',
      'Can you turn this off? The school form keeps asking me for a photo and I already uploaded one',
    ]) expect(mayBeOptOut(t), t).toBe(false)
  })
})

describe('gate 7b — "turn off", plainly asked, pauses; "don\'t turn off" keeps', () => {
  it('the plainest ways to ask pause — first person included', () => {
    for (const t of [
      'I want to turn off these messages, I have found a job for next year already, thank you',
      'How do I turn off the job alerts? I am not looking for work any more, thanks for your help',
      'Can we switch them off? We are a school and we only wanted to post our own job here',
      "I'd like you to turn them off please, I am moving back home to Canada next month",
      // the accepted cheap error: a teacher describing their phone is paused, and PAUSE_ACK offers "Keep sending jobs"
      'I usually turn off job notifications during class, but keep the jobs coming, job 2 looks good',
      // gate 7a2: other determiners and nouns, and a short bare "turn this off"
      'Please turn off my job alerts, I am not teaching any more after this term ends in December',
      "Switch those off please, I'm leaving Vietnam for good at the end of the month",
      'Turn off all your messages, I have never asked for any of these and I do not want them',
      "Turn off eno's messages please, I found a full-time job at a school in District 7",
      'Turn off the job DMs please, I already have enough classes for this year, thanks a lot',
      'Turn this off please',
      'turn it off',
      'Turn all of my messages off, I have a contract with a school until next summer now',
    ]) expect(mayBeOptOut(t), t).toBe(true)
  })
  it('"please don\'t turn off / switch off …" asks to KEEP them', () => {
    for (const t of [
      "Please don't turn off the job alerts, I still want them even though I'm busy this week",
      'Do not switch these off, they are useful to me and I read every one of them carefully',
      "Don't ever switch off the job messages please, they found me my current cover classes",
      // gate 7c: every shape the turn-off rule reads
      "Please don't turn off job alerts, I check them every evening after my classes finish",
      "Don't turn off all the job alerts please, they are the best part of my morning coffee",
      "Please don't turn it off, I like getting them",
      "Don't switch eno messages off, I rely on them for cover lessons in District 2 and Thu Duc",
    ]) expect(mayBeOptOut(t), t).toBe(false)
  })
})
