import { describe, expect, it } from 'vitest'
import { renderSchoolsAsk, schoolsAskChatText, schoolsAskCopy } from './schools-ask'

const origin = 'https://eno.vn'

describe('the schools ask — the approved wording (owner, 2026-11-20)', () => {
  it('English: subject, the two links, and "no review yet" only while true', () => {
    const c = schoolsAskCopy({ lang: 'en', firstName: 'Anna', schools: 172, reviewed: false, origin })
    expect(c.subject).toBe('Which schools have you taught at?')
    const text = schoolsAskChatText(c)
    expect(text).toBe([
      'Hi Anna — eno.vn ranks 172 schools and language centres in Ho Chi Minh City by what teachers say. None has a review yet, so yours would be among the first.',
      "Rate a school you've worked at: https://eno.vn/schools",
      "See who's hiring now: https://eno.vn/schools#schools-hiring-h",
    ].join('\n'))
    expect(schoolsAskChatText(schoolsAskCopy({ lang: 'en', firstName: 'Anna', schools: 172, reviewed: true, origin }))).not.toMatch(/None has a review/)
  })

  it('Vietnamese mirrors it', () => {
    const c = schoolsAskCopy({ lang: 'vi', firstName: null, schools: 172, reviewed: false, origin })
    expect(c.subject).toBe('Bạn từng dạy ở trường nào?')
    expect(schoolsAskChatText(c)).toMatch(/^Chào bạn — eno\.vn xếp hạng 172 trường/)
    expect(schoolsAskChatText(c)).toContain('https://eno.vn/schools#schools-hiring-h')
  })

  it('the email names its sender and can be stopped (Decree 91/2020)', () => {
    const c = schoolsAskCopy({ lang: 'en', firstName: 'Anna', schools: 172, reviewed: false, origin })
    const r = renderSchoolsAsk(c, { origin, unsubscribeUrl: 'https://eno.vn/unsubscribe?token=t' })
    expect(r.html).toContain('https://eno.vn/unsubscribe?token=t')
    expect(r.text).toContain('Stop these emails: https://eno.vn/unsubscribe?token=t')
    expect(r.text).toMatch(/Sent by .+/)
    expect(r.html).toContain("Rate a school you've worked at")
  })
})
