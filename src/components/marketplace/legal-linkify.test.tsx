import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { linkifyLegal } from './legal-linkify'

const html = (text: string) => renderToStaticMarkup(createElement(Fragment, null, ...linkifyLegal(text)))
const text = (markup: string) => markup.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')

describe('linkifyLegal', () => {
  it('links a document path and keeps the sentence around it', () => {
    const out = html('the Operating Regulations published at /regulations and the Privacy Policy')
    expect(out).toContain('<a href="/regulations"')
    expect(out).toContain('>/regulations</a> and the Privacy Policy')
  })

  it('links an email and leaves the sentence full stop outside the link', () => {
    const out = html('Questions about these Terms: support@eno.vn.')
    expect(out).toContain('<a href="mailto:support@eno.vn"')
    expect(out).toMatch(/>support@eno\.vn<\/a>\.$/)
  })

  it('links several tokens in one paragraph, in order', () => {
    const out = html('See /privacy, /terms and /legal/ranking, or write to privacy@eno.vn.')
    expect([...out.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/privacy', '/terms', '/legal/ranking', 'mailto:privacy@eno.vn'])
  })

  it('does not link a domain path, a longer path or an unknown one', () => {
    for (const s of ['Safety advice: eno.vn/safety', 'see /terms-of-sale', 'see /pricing', 'giá 5/10 triệu', 'đ/tháng']) {
      expect(html(s)).not.toContain('<a ')
    }
  })

  it('links a path inside machine-translated Vietnamese', () => {
    const out = html('Chính sách quyền riêng tư được công bố tại /privacy, là một phần của các Điều khoản này.')
    expect(out).toContain('<a href="/privacy"')
  })

  it('never changes the visible text', () => {
    const s = 'Write to support@eno.vn about anything published at /prohibited or /returns.'
    expect(text(html(s))).toBe(s)
  })

  it('returns plain text untouched', () => {
    expect(linkifyLegal('Nothing to link here.')).toEqual(['Nothing to link here.'])
  })
})
