import { describe, expect, it } from 'vitest'
import { readPost } from './extract'
import { decide, type PostMeta } from './facts'

const NOW = new Date('2026-10-21T02:00:00Z') // Wed 21 Oct, 09:00 Vietnam
const COVER = 'URGENT: our centre needs a cover teacher tomorrow 6-7:30pm in Binh Thanh. Kids 8-10. 400k/h.'

describe('decide — ready / held / dropped', () => {
  const meta = (o: Partial<PostMeta> = {}): PostMeta => ({ source: 'fb', postedAt: NOW, receivedAt: NOW, groupPublic: true, url: 'https://www.facebook.com/groups/1/posts/2/', applyText: null, ...o })
  const laya = (kind: string, poster = 'school') => ({
    kind: { hiring: kind === 'hiring' ? 0.9 : 0.03, cover: kind === 'cover' ? 0.9 : 0.03, seeker: kind === 'seeker' ? 0.9 : 0.03, other: kind === 'other' ? 0.9 : 0.04 },
    poster: { school: poster === 'school' ? 0.9 : 0.02, agency: 0.02, teacher: poster === 'teacher' ? 0.9 : 0.02, parent: 0.02, unclear: 0.02 },
    native: { required: 0.3, preferred: 0.3, not_stated: 0.4 }, degree: { required: 0.3, preferred: 0.3, not_stated: 0.4 }, tefl: { required: 0.3, preferred: 0.3, not_stated: 0.4 },
  })
  it('a public-group cover request from a school → ready, offered until its part of the day begins (evening: 17:00 ICT)', () => {
    const d = decide(readPost(COVER, NOW), meta(), laya('cover'), NOW)
    expect(d.status).toBe('ready')
    expect(d.expiresAt.toISOString()).toBe('2026-10-22T10:00:00.000Z')
  })
  it('refusals are drops', () => {
    expect(decide(readPost('Looking for a female teacher for kindergarten in D7', NOW), meta(), laya('hiring'), NOW)).toMatchObject({ status: 'dropped', reason: 'deny:gender' })
    expect(decide(readPost("I'm a TEFL teacher looking for part-time classes in HCMC", NOW), meta(), laya('seeker'), NOW).status).toBe('dropped')
  })
  it('Laya records and does not decide (LAYA_ROLE record, measured 2026-10-20)', () => {
    expect(decide(readPost('We are hiring a teacher in District 3', NOW), meta(), laya('seeker'), NOW).status).toBe('ready')
    expect(decide(readPost(COVER, NOW), meta(), null, NOW).status).toBe('ready')
  })
  it("in role 'veto', Laya confidently saying \"seeker\" holds a rules-read job", () => {
    expect(decide(readPost('We are hiring a teacher in District 3', NOW), meta(), laya('seeker'), NOW, 'veto')).toMatchObject({ status: 'held' })
  })
  it('LinkedIn: role screens apply; Facebook: an undated post is held; Laya only on a box-internal host', () => {
    expect(decide(readPost('Sales Executive · Saigon Co · Ho Chi Minh City', NOW, { listing: true }), meta({ source: 'linkedin', url: 'https://www.linkedin.com/jobs/view/1/' }), null, NOW).reason).toBe('kind:other')
    expect(decide(readPost('English Teacher · ILA Vietnam · District 3', NOW, { listing: true }), meta({ source: 'linkedin', url: 'https://www.linkedin.com/jobs/view/1/' }), null, NOW).status).toBe('ready')
    expect(decide(readPost('Our English centre in District 3 is hiring a part-time teacher', NOW), meta({ postedAt: null }), null, NOW).reason).toBe('undated')
  })
  it('a person-directed nationality, gender or age word holds the post', () => {
    expect(decide(readPost('[HIRING] ENGLISH TEACHER – Philipines Teacher, District 7, kindergarten', NOW), meta(), null, NOW).reason).toBe('mention:nation')
    expect(decide(readPost('Our centre in District 3 is hiring: 2 Female native for kindergarden', NOW), meta(), null, NOW).reason).toBe('deny:gender')
    expect(decide(readPost('Our centre in District 3 is hiring a kindergarten teacher. Female native preferred.', NOW), meta(), null, NOW).reason).toBe('mention:gender')
    expect(decide(readPost('Our centre in District 3 is hiring teachers. Pay depends on experience and country of passport', NOW), meta(), null, NOW).reason).toBe('mention:passport')
    expect(decide(readPost('British International School, District 2, is hiring a primary teacher', NOW), meta(), null, NOW).status).toBe('ready')
    expect(decide(readPost('Our centre in District 3 is hiring a teacher for a 6-year-old girl, learners aged 3 to 5 years old', NOW), meta(), null, NOW).status).toBe('ready')
  })
  it('holds: private/unknown group, cover from a teacher, HCMC cover with no district, forwarded with no Apply line', () => {
    expect(decide(readPost(COVER, NOW), meta({ groupPublic: null }), laya('cover'), NOW).reason).toBe('group-privacy-unknown')
    expect(decide(readPost("I need someone to cover my class tomorrow 6pm in D2, can't make it", NOW), meta(), laya('cover', 'teacher'), NOW).status).not.toBe('ready')
    expect(decide(readPost('Urgent cover teacher needed tomorrow evening in Saigon, our centre, 400k/h', NOW), meta(), laya('cover'), NOW).reason).toBe('cover-hcmc-no-district')
    expect(decide(readPost(COVER, NOW), meta({ source: 'intake', url: null }), laya('cover'), NOW).reason).toBe('no-apply-path')
  })
  it("in role 'veto', without Laya only an unambiguous school job offer is ready", () => {
    expect(decide(readPost('Our English centre in District 3 is hiring a part-time teacher', NOW), meta(), null, NOW, 'veto').status).toBe('ready')
    expect(decide(readPost(COVER, NOW), meta(), null, NOW, 'veto').reason).toBe('laya-unavailable')
  })
})
