import { describe, expect, it } from 'vitest'
import { renderFacebookConnectedEmail } from './facebook-connected'
import { renderFacebookConnectCodeEmail } from './facebook-connect-code'

describe('the Facebook-connected notice', () => {
  it.each([
    ['en', 'Facebook was connected to your account', 'disconnect Facebook'],
    ['vi', 'Facebook đã được kết nối với tài khoản của bạn', 'ngắt kết nối Facebook'],
  ] as const)('%s: says what happened and how to undo it', (lang, subject, undo) => {
    const m = renderFacebookConnectedEmail({ origin: 'https://eno.vn', lang })
    expect(m.subject).toBe(subject)
    expect(m.text).toContain(undo)
    expect(m.html).toContain(undo)
  })
})

describe('the code to connect Facebook', () => {
  it.each([['en', 'connect or disconnect Facebook'], ['vi', 'kết nối hoặc ngắt kết nối Facebook']] as const)('%s: says what the code is for, and carries it intact', (lang, what) => {
    const m = renderFacebookConnectCodeEmail({ code: '004217', origin: 'https://eno.vn', lang })
    expect(m.subject).toContain(what)
    expect(m.text).toContain('004217')
    expect(m.html).toContain('004217')
  })
})
