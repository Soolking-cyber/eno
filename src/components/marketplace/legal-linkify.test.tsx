import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('links an archived version of the Terms or the Quy chế, and no other versioned path', () => {
    const out = html('Until then the previous wording applies; it is published at /terms/v1 and /regulations/v1.')
    expect([...out.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/terms/v1', '/regulations/v1'])
    expect(html('see /privacy/v1')).not.toContain('<a ')
    expect(html('see /terms/v1x')).not.toContain('<a ')
  })

  it('returns plain text untouched', () => {
    expect(linkifyLegal('Nothing to link here.')).toEqual(['Nothing to link here.'])
  })
})

describe('linkifyLegal — the operator’s phone, and old Safari', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('links the marketplace operator’s number as an E.164 tel: — and no other number', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    vi.resetModules()
    const { linkifyLegal: link } = await import('./legal-linkify')
    const { COMPANY } = await import('@/lib/site-legal')
    const s = `Write to ${COMPANY.email} or call ${COMPANY.phone}. Business registration no. ${COMPANY.erc}.`
    const out = renderToStaticMarkup(createElement(Fragment, null, ...link(s)))
    expect(out).toContain(`<a href="tel:+84${COMPANY.phone.slice(1)}" class="font-semibold text-accent-foreground hover:underline">${COMPANY.phone}</a>.`)
    expect(out.match(/href="tel:/g)).toHaveLength(1)
    expect(text(out)).toBe(s)
  })

  it('links no number while the edition’s phone is still the placeholder', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    vi.resetModules()
    const { linkifyLegal: link } = await import('./legal-linkify')
    const { COMPANY } = await import('@/lib/site-legal')
    expect(COMPANY.phone).not.toMatch(/\d/)
    expect(renderToStaticMarkup(createElement(Fragment, null, ...link('Call 0772007921 or 0909123456.')))).not.toContain('tel:')
  })

  it('⛔ carries no regex lookbehind — it ships to Safari 16.0–16.3, where one is a SyntaxError', () => {
    const src = readFileSync('src/components/marketplace/legal-linkify.tsx', 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, '$1')
    expect(src).not.toMatch(/\(\?<[!=]/)
  })
})
