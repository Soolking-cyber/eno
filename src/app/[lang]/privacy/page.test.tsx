// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * /privacy must name the processors that actually receive data, and say what reaches whom. The page's
 * Vietnamese is translated from these same English paragraphs (the English is authoritative), so the
 * English text is what is asserted here.
 */

// The page chrome is irrelevant to what the policy says, and pulls in auth and data.
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

/**
 * Render the policy as one edition builds it.
 *
 * ⚠️ `resetModules()` IS LOAD-BEARING: `IS_SERVICES` is read once, when src/lib/edition.ts first
 * loads, so without a fresh module graph whichever edition rendered first would decide every later
 * assertion. LanguageProvider is re-imported with the page for the same reason — `<Tr>` must find the
 * context object from ITS copy of language-context, not from a stale one.
 */
async function policyText(edition: 'marketplace' | 'services') {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  vi.resetModules()
  const { default: PrivacyPage } = await import('./page')
  const { LanguageProvider } = await import('@/context/language-context')
  render(<LanguageProvider><PrivacyPage /></LanguageProvider>)
  return document.body.textContent ?? ''
}

const CLOUDFLARE_EMAIL = [
  'delivery of transactional email such as sign-in links and notifications',
  'Cloudflare receives your email address and the content of that message',
  'Cloudflare keeps an activity log of the emails it sends for us, including the recipient address, for 30 days.',
]

describe('/privacy on eno.vn — transactional email: Cloudflare first, Resend as the fallback', () => {
  it('⛔ Cloudflare is the primary: the recipient address, the message content, and a 30-day activity log', async () => {
    const text = await policyText('marketplace')
    for (const sentence of CLOUDFLARE_EMAIL) expect(text).toContain(sentence)
  })

  it('⛔ Resend is named as the fallback, used only when Cloudflare cannot send, and receives the same two things', async () => {
    const text = await policyText('marketplace')
    expect(text).toContain('Only when Cloudflare cannot send a message do we send that message through a second provider, Resend, instead')
    expect(text).toContain('Resend then receives the same two things — your email address and the content of that message — and likewise uses them only to deliver it.')
  })

  it('⛔ both are US-based, and the paragraph points at the cross-border notice', async () => {
    const text = await policyText('marketplace')
    expect(text).toContain('Cloudflare and Resend are both based in the United States, so this is one of the transfers described under “Processing outside Vietnam”.')
    expect(text).toContain('Processing outside Vietnam')
  })
})

describe('/privacy on eno.forum — transactional email: Cloudflare only', () => {
  it('⛔ Resend is not a recipient: the forum has no fallback (it would send From eno.vn)', async () => {
    expect(await policyText('services')).not.toMatch(/resend/i)
  })

  it('⛔ Cloudflare is named with what it receives and keeps, and it is US-based', async () => {
    const text = await policyText('services')
    for (const sentence of CLOUDFLARE_EMAIL) expect(text).toContain(sentence)
    expect(text).toContain('Cloudflare is based in the United States, so this is one of the transfers described under “Processing outside Vietnam”.')
  })
})

describe('/privacy — what Advertising alone sends', () => {
  it('⛔ Advertising names Meta; Google gets ad signals only when Analytics is on as well (GA is never loaded without it)', async () => {
    for (const edition of ['marketplace', 'services'] as const) {
      const text = await policyText(edition)
      expect(text).toContain('Google receives advertising signals only when Analytics is on as well')
      expect(text).toContain('to send advertising measurement signals to Meta (and to Google, when Analytics is on as well)')
      expect(text).not.toContain('and Meta and Google for advertising measurement if you switch on Advertising')
      expect(text).not.toContain('advertising measurement signals to Meta and Google.')
      cleanup()
    }
  })
})

describe('/privacy — what switching a use off deletes', () => {
  it('⛔ names the advertising cookies too — enforceConsentCleanup deletes _fbp/_fbc/_gcl_* without Advertising', async () => {
    for (const edition of ['marketplace', 'services'] as const) {
      expect(await policyText(edition)).toContain('(the Google Analytics cookies, the first-visit link cookie, the Meta and Google advertising cookies, your viewing history) are deleted')
      cleanup()
    }
  })
})

/**
 * The PDPL filing draft lists the same recipients for counsel and the Ministry, so it must move with
 * this page (the page's recipients comment says so). Checked here because a stale dossier is filed,
 * not rendered, and nothing else would notice. The dossier is eno.vn's, so it carries the fallback.
 */
describe('docs/compliance/pdpl-dossier-draft.md — in step with /privacy on eno.vn', () => {
  // Resolved from THIS file, not process.cwd(), so the suite reads the same dossier from any vitest root.
  const dossier = readFileSync(join(__dirname, '../../../../docs/compliance/pdpl-dossier-draft.md'), 'utf8')
  /** A heading that has moved fails the test that needs it — never the whole file at collection time. */
  const section = (from: string, to: string) => {
    const start = dossier.indexOf(from)
    if (start < 0) throw new Error(`dossier section "${from}" is missing`)
    return dossier.slice(start, dossier.indexOf(to, start))
  }
  const row = (table: string, id: string) =>
    table.split('\n').find((l) => new RegExp(`^\\|\\s*${id}\\s*\\|`).test(l)) ?? ''
  const transfers = () => section('### 3.2', '### 3.3')
  const appendixB = () => section('# 5. PHỤ LỤC B', '\n# ')

  it('⛔ §2.1 lists Cloudflare as the primary email processor and Resend as the fallback', () => {
    const parties = section('### 2.1', '### 2.2')
    expect(parties).toMatch(/Cloudflare Inc\.[^\n]*transactional email via Cloudflare Email Sending, the primary sender/)
    expect(parties).toContain('Resend Inc. (fallback transactional email, used only when Cloudflare cannot send a message; US-based)')
    expect(dossier).not.toContain('which replaced Resend')
    expect(dossier).not.toContain('thay Resend')
  })

  it('⛔ §3.2 row 12 is Cloudflare (primary), row 12a is Resend (fallback) — each with recipient address, message content and the United States', () => {
    const cloudflare = row(transfers(), '12')
    const resend = row(transfers(), '12a')
    expect(cloudflare).toContain('Cloudflare, Inc. — Email Sending')
    expect(cloudflare).toContain('nhà cung cấp CHÍNH')
    expect(cloudflare).toMatch(/30 ngày/)
    expect(resend).toContain('Resend, Inc.')
    expect(resend).toContain('nhà cung cấp DỰ PHÒNG')
    expect(resend).toContain('chỉ khi Cloudflare không gửi được')
    for (const r of [cloudflare, resend]) {
      expect(r).toMatch(/[Ee]mail người nhận/)
      expect(r).toContain('nội dung thư')
      expect(r).toContain('**Hoa Kỳ**')
    }
  })

  it('⛔ §3.3 states the email transfer: both processors, US-based, Resend only as the fallback', () => {
    const rationale = section('### 3.3', '### 3.4')
    expect(rationale).toContain('Rows 12, 12a and 13–14 (email and OTP)')
    expect(rationale).toContain('Rows 12 and 12a (Cloudflare and Resend) are both United States companies')
    expect(rationale).toContain('Resend receives a message only when Cloudflare cannot send it')
  })

  it('⛔ Phụ lục B carries B11 (Cloudflare Email Sending) and B11a (Resend, fallback), each with its DPA to collect', () => {
    const b11 = row(appendixB(), 'B11')
    const b11a = row(appendixB(), 'B11a')
    expect(b11).toContain('Cloudflare, Inc. — Email Sending')
    expect(b11).toMatch(/30 ngày/)
    expect(b11a).toContain('Resend, Inc.')
    expect(b11a).toContain('DỰ PHÒNG')
    expect(b11a).toContain('Resend DPA')
    for (const r of [b11, b11a]) {
      expect(r).toContain('Email người nhận + nội dung thư')
      expect(r).toMatch(/\| US /)
    }
  })

  it('⛔ the data-flow diagram, the DPA gap and the production-env gap name both', () => {
    expect(dossier).toMatch(/├→ Cloudflare Email Sending \(email giao dịch — CHÍNH[^\n]*Resend \(DỰ PHÒNG/)
    expect(section('### 5. ⛔ Chưa có bản sao DPA', '### 6.')).toContain('Supabase, Resend (email dự phòng) và Telegram Gateway cần yêu cầu riêng')
    const envGap = section('### 8. ⚠️ Xác minh trạng thái', '### 9.')
    expect(envGap).toContain('`MAILER_URL`/`MAILER_KEY` (Cloudflare Email Sending)')
    expect(envGap).toContain('`RESEND_API_KEY` (Resend, dự phòng)')
  })
})
