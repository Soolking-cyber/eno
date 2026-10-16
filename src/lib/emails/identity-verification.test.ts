import { describe, it, expect } from 'vitest'
import { renderIdentityOutcomeEmail, identityRejectionSentence } from './identity-verification'

const base = { origin: 'https://eno.forum', siteName: 'eno.forum', tier: 'B' } as const

describe('identityRejectionSentence', () => {
  it('the reviewer note wins over the machine reason', () => {
    expect(identityRejectionSentence('en', 'expired', '  Name does not match the account  ')).toBe('Name does not match the account')
  })
  it('a machine reason has its own words in both languages', () => {
    expect(identityRejectionSentence('en', 'document_expires_soon', null)).toMatch(/six more months/)
    expect(identityRejectionSentence('vi', 'document_expires_soon', null)).toMatch(/sáu tháng/)
    expect(identityRejectionSentence('en', 'expired', '')).toMatch(/expired/)
  })
  it('an unknown reason with no note says nothing extra', () => {
    expect(identityRejectionSentence('en', 'manual', null)).toBeNull()
    expect(identityRejectionSentence('en', null, null)).toBeNull()
  })
})

describe('renderIdentityOutcomeEmail', () => {
  it('approved: says they can publish, links the hub, no reason box', () => {
    const m = renderIdentityOutcomeEmail({ ...base, outcome: 'approved', reason: null, note: null, lang: 'en' })
    expect(m.subject).toBe('Your identity is verified on eno.forum')
    expect(m.html).toContain('https://eno.forum/dashboard/verification')
    expect(m.text).toContain('You will not be asked to do this again')
    expect(m.html).not.toContain('border-radius:10px;color')
  })

  it('rejected: carries the reviewer note ESCAPED, never as HTML', () => {
    const m = renderIdentityOutcomeEmail({ ...base, outcome: 'rejected', reason: 'manual', note: 'Photo is blurred <b>retake</b>', lang: 'en' })
    expect(m.subject).toBe('Your identity verification was not accepted')
    expect(m.html).toContain('Photo is blurred &lt;b&gt;retake&lt;/b&gt;')
    expect(m.html).not.toContain('<b>retake</b>')
    expect(m.text).toContain('Photo is blurred <b>retake</b>')
    expect(m.text).toContain('you can verify again from your dashboard')
    expect(m.text, 'a reviewer note is never chased by photography advice').not.toContain('no glare')
  })

  it('a CCCD refusal gets CCCD advice, never the passport code lines', () => {
    const m = renderIdentityOutcomeEmail({ ...base, tier: 'A', outcome: 'rejected', reason: 'document_expiry_unreadable', note: null, lang: 'en' })
    expect(m.text).toContain('your CCCD')
    expect(m.text).not.toContain('code lines')
  })

  it('a refusal with neither note nor known reason ends in a full stop, not a colon', () => {
    const m = renderIdentityOutcomeEmail({ ...base, outcome: 'rejected', reason: 'something_new', note: null, lang: 'en' })
    expect(m.text).toContain('could not accept them.')
    expect(m.text).not.toContain('could not accept them:')
  })

  it('rejected at review by the six-month floor: the machine sentence, in Vietnamese', () => {
    const m = renderIdentityOutcomeEmail({ ...base, outcome: 'rejected', reason: 'document_expires_soon', note: null, lang: 'vi' })
    expect(m.subject).toBe('Hồ sơ xác minh danh tính chưa được chấp nhận')
    expect(m.text).toContain('sáu tháng')
    expect(m.text, 'an expiry refusal says renew, never "photograph it more clearly"').toContain('gia hạn')
    expect(m.text).not.toContain('rõ hơn')
    const en = renderIdentityOutcomeEmail({ ...base, outcome: 'rejected', reason: 'expired', note: null, lang: 'en' })
    expect(en.text).toContain('renew it')
    expect(en.text).not.toContain('code lines')
    const cccd = renderIdentityOutcomeEmail({ ...base, tier: 'A', outcome: 'rejected', reason: 'expired', note: null, lang: 'en' })
    expect(cccd.text).toContain('renew your CCCD')
    expect(cccd.text).not.toContain('six more months')
    expect(m.html).toContain('https://eno.forum/dashboard/verification')
  })
})

// ⚖️ A TEACHER'S APPROVAL (owner, 2026-10-15): one sentence about the opt-in "Identity verified" mark, a button to the
// switch (/teachers/edit?step=finish — never the verify flow), and no "selling" signoff. Everyone else: unchanged.
describe('renderIdentityOutcomeEmail — a teacher', () => {
  it('the mark shows: the sentence, the button to the switch, no signoff', () => {
    const m = renderIdentityOutcomeEmail({ ...base, outcome: 'approved', reason: null, note: null, lang: 'en', teacher: { line: 'now' } })
    expect(m.text).toContain('“Identity verified” now shows on your teacher profile.')
    expect(m.html).toContain('https://eno.forum/teachers/edit?step=finish')
    expect(m.html).toContain('Update my teacher profile')
    expect(m.html).not.toContain('/dashboard/verification')
    expect(m.text).not.toContain('Thanks for selling')
    expect(m.html).not.toContain('Thanks for selling')
    expect(m.subject).toBe('Your identity is verified on eno.forum')
  })
  it('not shown: "You can now show … — switch it on in Photo & publish."', () => {
    const m = renderIdentityOutcomeEmail({ ...base, outcome: 'approved', reason: null, note: null, lang: 'en', teacher: { line: 'can' } })
    expect(m.text).toContain('You can now show “Identity verified” on your teacher profile — switch it on in Photo & publish.')
    expect(m.text).toContain('https://eno.forum/teachers/edit?step=finish')
  })
  // Commit gate, 2026-10-16: the NAME holds it back (not within the ID, say) — never "switch it on".
  it('the name holds it back: "… is not showing on your teacher profile yet — see why in Photo & publish."', () => {
    const m = renderIdentityOutcomeEmail({ ...base, outcome: 'approved', reason: null, note: null, lang: 'en', teacher: { line: 'notYet' } })
    expect(m.text).toContain('“Identity verified” is not showing on your teacher profile yet — see why in Photo & publish.')
    expect(m.text).not.toContain('switch it on')
    expect(m.text).toContain('https://eno.forum/teachers/edit?step=finish')
    const vi = renderIdentityOutcomeEmail({ ...base, outcome: 'approved', reason: null, note: null, lang: 'vi', teacher: { line: 'notYet' } })
    expect(vi.text).toContain('Nhãn “Đã xác minh danh tính” chưa hiển thị trên hồ sơ giáo viên của bạn — xem lý do trong bước Ảnh & đăng.')
  })
  it('in Vietnamese: the curated sentence and button — "xác minh", never "xác thực"', () => {
    const m = renderIdentityOutcomeEmail({ ...base, outcome: 'approved', reason: null, note: null, lang: 'vi', teacher: { line: 'can' } })
    expect(m.text).toContain('Giờ bạn có thể hiển thị “Đã xác minh danh tính” trên hồ sơ giáo viên — bật trong bước Ảnh & đăng.')
    expect(m.html).toContain('Cập nhật hồ sơ giáo viên')
    expect(m.text).not.toContain('Cảm ơn bạn đã bán hàng')
    expect(m.html + m.text).not.toContain('xác thực')
  })
  it('a refusal ignores it — and every non-teacher email is what it was', () => {
    const refused = renderIdentityOutcomeEmail({ ...base, outcome: 'rejected', reason: 'manual', note: 'Blurred', lang: 'en', teacher: { line: 'now' } })
    expect(refused.text).not.toContain('Identity verified')
    expect(refused.html).toContain('https://eno.forum/dashboard/verification')
    expect(refused.text).toContain('Thanks for selling on eno.forum.')
    const plain = renderIdentityOutcomeEmail({ ...base, outcome: 'approved', reason: null, note: null, lang: 'en' })
    const nulled = renderIdentityOutcomeEmail({ ...base, outcome: 'approved', reason: null, note: null, lang: 'en', teacher: null })
    expect(nulled).toEqual(plain)
    expect(plain.text).toContain('Thanks for selling on eno.forum.')
    expect(plain.html).toContain('Open verification')
    expect(plain.text).not.toContain('Identity verified')
  })
})
