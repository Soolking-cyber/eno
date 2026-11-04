import { describe, expect, it } from 'vitest'
import { renderFacebookConnectedEmail } from './facebook-connected'
import { renderFacebookDisconnectCodeEmail } from './facebook-disconnect-code'

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

describe('the code to disconnect Facebook', () => {
  it.each([['en', 'disconnect Facebook'], ['vi', 'ngắt kết nối Facebook']] as const)('%s: says what the code is for, and carries it intact', (lang, what) => {
    const m = renderFacebookDisconnectCodeEmail({ code: '004217', origin: 'https://eno.vn', lang })
    expect(m.subject).toContain(what)
    expect(m.text).toContain('004217')
    expect(m.html).toContain('004217')
  })
})

describe('the emails are laid out as rows of the card', () => {
  // Bare <p>s render hard against the card's edge: the layout's body is a table, and its rows bring the padding (owner, 2026-11-04).
  it.each([
    ['notice', () => renderFacebookConnectedEmail({ origin: 'https://eno.vn', lang: 'en' }).html],
    ['code', () => renderFacebookDisconnectCodeEmail({ code: '004217', origin: 'https://eno.vn', lang: 'en' }).html],
  ])('%s: its text sits inside padded rows', (_n, html) => {
    const body = html().split('<!-- body -->')[1].split('<!-- footer -->')[0]
    expect(body).toContain('<tr><td style="padding:8px 24px')
    expect(body.replace(/<td[^>]*>[\s\S]*?<\/td>/g, '').replace(/<\/?tr>/g, '').trim()).toBe('')
  })
  it('the copy button carries the code only in the fragment, which no server sees', () => {
    const en = renderFacebookDisconnectCodeEmail({ code: '004217', origin: 'https://eno.vn', lang: 'en' }).html
    expect(en).toContain('https://eno.vn/api/auth/copy-code#004217')
    expect(en).not.toMatch(/copy-code\?[^#"]*004217/)
    expect(renderFacebookDisconnectCodeEmail({ code: '004217', origin: 'https://eno.vn', lang: 'vi' }).html).toContain('https://eno.vn/api/auth/copy-code?l=vi#004217')
  })
})
