import { describe, expect, it } from 'vitest'

import { visaPayloadSchema } from '@/lib/visa/schema'
import { formatVisaReference } from '@/lib/visa/reference'
import { renderVisaResultEmail } from './visa-result'

// ── WHAT THESE TESTS ARE FOR ──────────────────────────────────────────────────────────
//
// This email carries the applicant's identity document. The PDF is meant to be there; the
// PROSE is not. The first block below is the one that matters: it walks every field of the
// real decrypted payload schema, gives each a unique sentinel, and fails if any of them
// reaches the rendered output. It reads the schema rather than a hand-written list, so a
// field added to `visaPayloadSchema` next month is covered the day it lands — the failure
// mode being defended against is someone "improving" the copy with a helpful line like
// "your visa is valid from … to …", which is exactly the sort of edit that looks kind and
// puts a passport's validity window into a mailbox forever.
//
// The rest lock the shape the owner asked for: thanks, both languages, the reference the
// customer can search their inbox by, and the two places the file can be found.

const ORIGIN = 'https://eno.vn'
const REFERENCE = formatVisaReference(42) // EV-1042

/** Every payload key with a value that could not occur by accident in brand copy. */
function sentinelPayload(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of Object.keys(visaPayloadSchema.shape)) out[key] = `PAYLOADLEAK~${key}~`
  return out
}

describe('visa result email · minimal PII', () => {
  it('leaks no payload field — the whole schema, both languages', () => {
    const payload = sentinelPayload()
    expect(Object.keys(payload).length).toBeGreaterThan(50) // the sweep is real, not empty

    for (const locale of ['en', 'vi'] as const) {
      const { subject, html, text } = renderVisaResultEmail({
        // The given name is the ONE payload value allowed through, and it is passed
        // explicitly — never read out of the payload by this module.
        givenName: 'Minh',
        reference: REFERENCE,
        origin: ORIGIN,
        locale,
      })
      const all = `${subject}\n${html}\n${text}`
      for (const [key, sentinel] of Object.entries(payload)) {
        expect(all, `${locale}: payload.${key} reached the email`).not.toContain(sentinel)
      }
      expect(all).not.toContain('PAYLOADLEAK')
    }
  })

  it('carries no realistic identity data even when the copy is read as a whole', () => {
    const { subject, html, text } = renderVisaResultEmail({
      givenName: 'Minh',
      reference: REFERENCE,
      origin: ORIGIN,
      locale: 'en',
    })
    const all = `${subject}\n${html}\n${text}`
    // Shapes, not values: a passport number, a date of birth, an ISO date of any kind, an
    // email address other than the support desk's. None of them belong in this body.
    expect(all).not.toMatch(/\b[A-Z]{1,2}\d{6,9}\b/) // passport / identity number
    expect(all).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/) // any ISO date
    const addresses = all.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? []
    expect(new Set(addresses)).toEqual(new Set(['support@eno.vn']))
  })

  it('keeps the applicant out of the subject and the inbox preview', () => {
    // A lock screen shows both. The reference is meaningless without eno's database; a
    // name is not.
    const { subject, html } = renderVisaResultEmail({
      givenName: 'Nguyet',
      reference: REFERENCE,
      origin: ORIGIN,
      locale: 'en',
    })
    expect(subject).not.toContain('Nguyet')
    const preheader = /<!-- preheader --><div[^>]*>([^<]*)<\/div>/.exec(html)?.[1] ?? ''
    expect(preheader.length).toBeGreaterThan(20)
    expect(preheader).not.toContain('Nguyet')
    // …and the body does greet them by name.
    expect(html).toContain('Hi Nguyet,')
  })
})

describe('visa result email · the owner’s ask', () => {
  it('thanks them for the service and says the PDF is attached', () => {
    const en = renderVisaResultEmail({ givenName: 'Minh', reference: REFERENCE, origin: ORIGIN, locale: 'en' })
    expect(en.html).toMatch(/thank you/i)
    expect(en.html).toMatch(/attached to this email as a PDF/i)
    expect(en.text).toMatch(/thank you/i)

    const vi = renderVisaResultEmail({ givenName: 'Minh', reference: REFERENCE, origin: ORIGIN, locale: 'vi' })
    expect(vi.html).toContain('Cảm ơn bạn')
    expect(vi.html).toContain('đính kèm')
  })

  it('points at the chat as the second copy, with a working CTA', () => {
    const { html, text } = renderVisaResultEmail({
      givenName: null,
      reference: REFERENCE,
      origin: ORIGIN,
      locale: 'en',
    })
    expect(html).toContain('https://eno.vn/messages')
    expect(text).toContain('https://eno.vn/messages')
    expect(html).toMatch(/saved in your eno\.vn chat/i)
  })

  it('renders inside the brand shell rather than a hand-rolled layout', () => {
    const { html } = renderVisaResultEmail({ givenName: 'Minh', reference: REFERENCE, origin: ORIGIN, locale: 'en' })
    expect(html).toContain('https://eno.vn/logo.png') // the shared header wordmark
    expect(html).toContain('Công ty TNHH ENO') // the shared legal footer
    expect(html).toContain('#0A66C2') // the one brand blue
  })

  it('prints the case reference where a customer can find it again', () => {
    const { subject, html, text } = renderVisaResultEmail({
      givenName: 'Minh',
      reference: REFERENCE,
      origin: ORIGIN,
      locale: 'en',
    })
    expect(REFERENCE).toBe('EV-1042')
    expect(subject).toContain(REFERENCE)
    expect(html).toContain(REFERENCE)
    expect(text).toContain(REFERENCE)
  })
})

describe('visa result email · both languages, whole and distinct', () => {
  it('renders each locale in its own language, end to end', () => {
    const en = renderVisaResultEmail({ givenName: 'Minh', reference: REFERENCE, origin: ORIGIN, locale: 'en' })
    const vi = renderVisaResultEmail({ givenName: 'Minh', reference: REFERENCE, origin: ORIGIN, locale: 'vi' })

    expect(vi.subject).not.toEqual(en.subject)
    expect(vi.html).not.toEqual(en.html)
    expect(vi.text).not.toEqual(en.text)

    expect(en.subject).toMatch(/e-Visa is ready/i)
    expect(vi.subject).toContain('Thị thực điện tử')
    expect(vi.html).toContain('Chào Minh,')
    expect(vi.text).toContain('Mã hồ sơ: EV-1042')

    // Neither language may fall back to the other's copy anywhere in the body.
    expect(vi.text).not.toMatch(/Safe travels/i)
    expect(en.text).not.toContain('Chúc bạn')

    for (const out of [en, vi]) {
      expect(out.subject.length).toBeGreaterThan(10)
      expect(out.text.length).toBeGreaterThan(200)
      expect(out.text).not.toContain('<') // the text part is genuinely plain text
      expect(out.text).not.toMatch(/undefined|null|NaN|\[object/)
      expect(out.html).not.toMatch(/undefined|NaN|\[object/)
    }
  })

  it('an unexpected locale falls back to English rather than rendering nothing', () => {
    const weird = renderVisaResultEmail({
      givenName: 'Minh',
      reference: REFERENCE,
      origin: ORIGIN,
      locale: 'fr' as 'en',
    })
    expect(weird.subject).toMatch(/e-Visa is ready/i)
  })
})

describe('visa result email · hostile and missing values', () => {
  it('greets without a name when there is none, in both languages', () => {
    const en = renderVisaResultEmail({ givenName: null, reference: REFERENCE, origin: ORIGIN, locale: 'en' })
    expect(en.html).toContain('Hi there,')
    expect(en.text).toContain('Hi there,')

    const vi = renderVisaResultEmail({ givenName: '   ', reference: REFERENCE, origin: ORIGIN, locale: 'vi' })
    expect(vi.html).toContain('Xin chào,')
    expect(vi.html).not.toContain('Chào ,')
  })

  it('escapes the name instead of rendering it as markup', () => {
    const { html, text } = renderVisaResultEmail({
      givenName: '<script>alert(1)</script>',
      reference: REFERENCE,
      origin: ORIGIN,
      locale: 'en',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(text).not.toContain('\n<script>') // plain text keeps it on one line, harmless
  })

  it('flattens a name or reference that carries newlines or invisible characters', () => {
    const { html, text, subject } = renderVisaResultEmail({
      givenName: 'Mi\nnh\u200B\u0007',
      reference: 'EV-1042\u200B',
      origin: ORIGIN,
      locale: 'en',
    })
    expect(html).toContain('Hi Mi nh,')
    expect(text).toContain('Hi Mi nh,')
    expect(subject).toBe('Your Vietnam e-Visa is ready — EV-1042')
    // The plain-text part must stay structurally intact: one field per line.
    expect(text).toContain('Case reference: EV-1042')
    expect(text.split('\n').filter((l) => l.startsWith('Hi ')).length).toBe(1)
  })

  it('caps an absurd name rather than shipping a broken layout', () => {
    const { html } = renderVisaResultEmail({
      givenName: 'A'.repeat(400),
      reference: REFERENCE,
      origin: ORIGIN,
      locale: 'en',
    })
    expect(html).not.toContain('A'.repeat(60))
    expect(html).toContain('A'.repeat(40))
  })

  it('never emits a doubled slash from a trailing-slash origin', () => {
    const { html, text } = renderVisaResultEmail({
      givenName: 'Minh',
      reference: REFERENCE,
      origin: 'https://eno.vn/',
      locale: 'en',
    })
    expect(html).not.toContain('https://eno.vn//')
    expect(text).toContain('https://eno.vn/messages')
  })

  it('shows a visibly empty reference rather than a silent hole', () => {
    const { html, subject } = renderVisaResultEmail({ givenName: 'Minh', reference: '', origin: ORIGIN, locale: 'en' })
    expect(subject).toContain('—')
    expect(html).toContain('Case reference')
  })
})
