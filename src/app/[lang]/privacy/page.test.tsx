// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

/**
 * /privacy is a legal notice: every fact it states has to be true of the code, on each edition, and a
 * Vietnamese reader has to get the authored Vietnamese, not machine translation.
 */

// Every render re-imports the page on a fresh module graph (see `policy`), several per test — seconds
// each when the whole suite runs in parallel, so the default 5 s is not a budget this file can keep.
vi.setConfig({ testTimeout: 60_000 })

// The page chrome is irrelevant to what the policy says, and pulls in auth and data.
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.doUnmock('@/lib/site-legal')
})

/**
 * A stored language choice, so LanguageProvider's mount effect agrees with the server variant under
 * test instead of reconciling to jsdom's navigator.language ('en-US'). (Node's own global localStorage
 * has no working methods without --localstorage-file, so the suite stubs one.)
 */
function storedLang(lang: string): void {
  const map = new Map<string, string>([['lang', lang]])
  vi.stubGlobal('localStorage', {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  })
}

/**
 * Render the policy as one edition builds it, in one language.
 * ⚠️ `resetModules()` IS LOAD-BEARING: `IS_SERVICES` is read once, when src/lib/edition.ts first loads,
 * so without a fresh module graph whichever edition rendered first would decide every later assertion.
 * LanguageProvider is re-imported with the page so LegalText finds ITS copy of the context.
 */
async function policy(edition: 'marketplace' | 'services', lang: 'en' | 'vi' = 'en', legal?: Record<string, unknown>) {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  storedLang(lang)
  vi.resetModules()
  if (legal) vi.doMock('@/lib/site-legal', async (orig) => ({ ...(await orig<typeof import('@/lib/site-legal')>()), ...legal }))
  const { default: PrivacyPage } = await import('./page')
  const { LanguageProvider } = await import('@/context/language-context')
  render(<LanguageProvider initialLang={lang} initialViDict={{}}><PrivacyPage /></LanguageProvider>)
  return document.body.textContent ?? ''
}

describe('/privacy — its text and its date move together (commit gate B2)', () => {
  it('⛔ the policy as rendered matches PRIVACY_TEXT_FINGERPRINT — a change to the text must decide its date', async () => {
    const parts: string[] = []
    for (const edition of ['marketplace', 'services'] as const) {
      for (const lang of ['en', 'vi'] as const) {
        parts.push(`${edition}/${lang}\n${(await policy(edition, lang)).replace(/\s+/g, ' ').trim()}`)
        cleanup()
      }
    }
    const fingerprint = createHash('sha256').update(parts.join('\n\n')).digest('hex').slice(0, 16)
    const { PRIVACY_TEXT_FINGERPRINT, PRIVACY_TEXT_PUBLISHED } = await import('@/lib/compliance/privacy-updated')
    expect(
      fingerprint,
      `/privacy's text changed. Shipping outside a legal amendment? Re-date PRIVACY_TEXT_PUBLISHED (now ${PRIVACY_TEXT_PUBLISHED}) ` +
        `to the day it deploys. Then set PRIVACY_TEXT_FINGERPRINT to '${fingerprint}' (src/lib/compliance/privacy-updated.ts).`,
    ).toBe(PRIVACY_TEXT_FINGERPRINT)
  })
})

describe('/privacy — which language governs', () => {
  it('⛔ no longer says the English version is authoritative', async () => {
    for (const lang of ['en', 'vi'] as const) {
      const text = await policy('marketplace', lang)
      expect(text).not.toMatch(/English version of this policy is the authoritative/i)
      cleanup()
    }
  })

  it('⛔ while LEGAL_VI_APPROVED is false it says the Vietnamese is under review — and declares no prevailing language', async () => {
    const vi = await policy('marketplace', 'vi')
    expect(vi).toContain('Bản tiếng Việt của trang này là bản dịch do eno biên soạn và đang được luật sư rà soát.')
    expect(vi).toContain('chưa có bản ngôn ngữ nào được xác định là có giá trị ưu tiên')
    expect(vi).not.toMatch(/có giá trị pháp lý/)
    cleanup()
    const en = await policy('marketplace', 'en')
    expect(en).toContain('The Vietnamese text of this page is a translation prepared by eno that our lawyers are still reviewing.')
    expect(en).toContain('neither language version prevails over the other')
    expect(en).not.toMatch(/legally binding|có giá trị pháp lý|authoritative/i)
  })

  it('when counsel signs off (LEGAL_VI_APPROVED) it says the Vietnamese is the legally binding text', async () => {
    expect(await policy('marketplace', 'vi', { LEGAL_VI_APPROVED: true })).toContain('Bản tiếng Việt là bản có giá trị pháp lý.')
  })
})

describe('/privacy — a Vietnamese reader gets the authored Vietnamese', () => {
  it('⛔ the vi render carries the Vietnamese body, headings and tables — not the English source', async () => {
    const text = await policy('marketplace', 'vi')
    expect(text).toContain('Chính sách bảo vệ dữ liệu cá nhân')
    expect(text).toContain('Bên kiểm soát dữ liệu cá nhân')
    expect(text).toContain('Dữ liệu của bạn được lưu ở đâu')
    expect(text).toContain('Các bên nhận dữ liệu cá nhân')
    expect(text).toContain('Những gì website lưu trên thiết bị của bạn')
    expect(text).not.toContain('Account information:')
    expect(text).not.toContain('Who else receives your data')
  })

  it('⛔ services edition: the passport page and portrait going to Gemini outside Vietnam is disclosed, in both languages', async () => {
    // src/app/api/visa/applications/[id]/extract/route.svc.ts:241-244 → gemini.ts:60 (location 'global')
    const en = await policy('services')
    expect(en).toContain('Google (Vertex AI, Gemini — Google’s global endpoint, outside Vietnam) receives the image of the passport data page and the portrait photograph you upload')
    expect(en).toContain('using Google’s Gemini AI model')
    cleanup()
    const vi = await policy('services', 'vi')
    expect(vi).toContain('nhận ảnh trang thông tin hộ chiếu và ảnh chân dung bạn tải lên')
    expect(vi).toContain('mô hình AI Gemini của Google')
    cleanup()
    // and none of it reaches the marketplace render
    expect(await policy('marketplace')).not.toContain('passport data page')
  })

  it('the services edition’s own section is authored in Vietnamese too', async () => {
    const text = await policy('services', 'vi')
    expect(text).toContain('Hồ sơ thị thực: giấy tờ, sự đồng ý và đơn vị cung cấp')
    expect(text).not.toContain('Visa applications: documents, consent and the provider')
  })
})

describe('/privacy — the impact-assessment dossiers', () => {
  it('⛔ while PDP_DOSSIERS_FILED is false it claims no filing, and no longer ties it to company registration', async () => {
    const text = await policy('marketplace')
    expect(text).toContain('being prepared for filing with the Ministry of Public Security (Department of Cybersecurity and High-Tech Crime Prevention, A05)')
    expect(text).toContain('They have not been filed yet')
    expect(text).not.toMatch(/have filed both|file them with the Ministry/)
    expect(text).not.toContain('as our company registration completes')
  })

  it('says they are filed only once PDP_DOSSIERS_FILED is true', async () => {
    const text = await policy('marketplace', 'en', { PDP_DOSSIERS_FILED: true })
    expect(text).toContain('have filed both with the Ministry of Public Security')
    expect(text).not.toContain('They have not been filed yet')
  })
})

describe('/privacy — the facts it states match the code', () => {
  it('⛔ hosting: our own server in Vietnam, backups in Ho Chi Minh City — not "Singapore", not Supabase/Google Cloud as hosts', async () => {
    const text = await policy('marketplace')
    expect(text).toContain('on our own server in Vietnam')
    expect(text).toContain('Bizfly Simple Storage, in Ho Chi Minh City')
    expect(text).not.toMatch(/Singapore|Supabase|Google Cloud \(the servers/)
  })

  it('⛔ names the recipients the code actually sends to, and drops the retired ones', async () => {
    const text = await policy('marketplace')
    for (const r of ['Cloudflare', 'Microsoft (Azure AI Translator)', 'Google (Vertex AI, Gemini)', 'Resend', 'CARTO', 'OpenStreetMap', 'Meta (WhatsApp Business)', 'AccessTrade', 'Google Analytics', 'Meta (Conversions API)']) {
      expect(text, r).toContain(r)
    }
    expect(text).not.toContain('Google Cloud Translation') // removed 2026-09-19 (src/lib/translate.ts)
    expect(text).not.toMatch(/bound by a data-processing agreement/) // no copies collected yet
  })

  it('⛔ location: no "sorts listings by distance" (there is no distance sort) — it filters, estimates and fills in', async () => {
    const text = await policy('marketplace')
    expect(text).not.toMatch(/sort(s)? listings by distance/i)
    expect(text).toContain('showing listings within a distance of you')
  })

  it('names automated processing and how to ask for a person, through the operator’s own contact', async () => {
    const { COMPANY } = await import('@/lib/site-legal')
    const text = await policy('marketplace')
    expect(text).toContain('Automated decisions, and how to ask for a person')
    expect(text).toContain('Trust score')
    expect(text).toContain('AI moderation')
    expect(text).toContain(`write to ${COMPANY.privacyEmail}`)
  })

  it('describes the security processing that runs before any choice, and the counters’ daily digest', async () => {
    const text = await policy('marketplace')
    expect(text).toContain('Cloudflare Turnstile')
    expect(text).toContain('deleted after 36 hours')
  })

  it('lists the on-device storage with when each item is removed', async () => {
    const text = await policy('marketplace')
    for (const s of ['eno-consent-v2', 'After 12 months', 'Your last 30 messages with the AI assistant', 'After 180 days']) {
      expect(text, s).toContain(s)
    }
  })

  it('⛔ the "Join eno" reminder’s keys — and the sign-in gate record (UX3 J1) — are listed, hold no personal data, and the page does not claim sign-out clears them', async () => {
    const { DEVICE_KEY, TAB_KEY } = await import('@/lib/signup-prompt')
    const { GATE_RECORD_KEY } = await import('@/lib/signin-gates')
    const { INTENT_KEY } = await import('@/lib/pending-intent')
    const text = await policy('marketplace')
    expect(text).toContain(`Sign-up reminder (${DEVICE_KEY}, ${TAB_KEY}, ${GATE_RECORD_KEY}, ${INTENT_KEY})`)
    expect(text).toContain('Apart from that action: timings, counts, that one yes/no and the kind of place — no page, listing or identifier.')
    expect(text).toContain('the kind of place at your next sign-in')
    // UX3 J5: the pending action is disclosed, as this tab only, and its lifetime promises only what the code does
    // (pending-intent.ts: spent on use, dropped on close, read as gone after 15 minutes; sign-out-storage.ts).
    expect(text).toContain('that action — the search, the amount or the message and its listing — for this tab only')
    expect(text).toContain('the action also once it is finished or when you sign out, and it is ignored after 15 minutes')
    expect(text).toContain('signing out does not remove it')
    const vi = await policy('marketplace', 'vi')
    expect(vi).toContain('Lời nhắc đăng ký')
    expect(vi).toContain('đăng xuất không xóa mục này')
    // No "Maybe later" button any more (owner, 2026-10-01) — the copy must not name one.
    expect(text).not.toMatch(/maybe later/i)
    expect(vi).not.toContain('Để sau')
  })

  it('⛔ the reminder’s anonymous daily totals are disclosed — on both editions — as counted without the Analytics choice and keeping nothing about the visitor', async () => {
    for (const site of ['marketplace', 'services'] as const) {
      const text = await policy(site)
      expect(text, site).toContain('Sign-up reminder counts')
      // UX3 J1: the coarse label is named, so the page no longer says the totals hold no browser details.
      expect(text, site).toContain('no IP address, account, cookie, browser version or page')
      expect(text, site).toContain('left open when the page was hidden or closed')
      expect(text, site).toContain('the kind of browser (a regular one, Facebook’s, Zalo’s or another app’s built-in browser, the home-screen app or the eno app), phone or computer, and Vietnamese or English')
      // Sign in with Apple (2026-10-08): `apple_click` / gate action `apple` are counted too (src/lib/signup-prompt.ts).
      expect(text, site).toContain('how many times sign-in was opened there, Google, Apple or email was chosen, and a sign-in followed')
      expect(text, site).toContain('answered with Google, Apple or email')
      expect(text, site).not.toContain('browser details or page')
      expect(text, site).toContain('counted whatever you choose for Analytics')
      const vi = await policy(site, 'vi')
      expect(vi, site).toContain('Số liệu lời nhắc đăng ký')
    }
  })

  it('⛔ on-device lifetimes promise no deletion that nothing performs — the draft TTLs apply only when the form opens again', async () => {
    // post-draft-photos.ts checks PHOTO_TTL_MS only inside loadDraftPhotos; rental-check/store.ts applies
    // DRAFT_TTL_MS only inside readDraft. No timer sweeps either.
    const text = await policy('marketplace')
    expect(text).toContain('are also discarded the next time the form opens if they are more than 24 hours old')
    expect(text).toContain('Nothing removes them before the form is opened again')
    expect(text).toContain('an unfinished request is discarded the next time you open the list if it is more than 7 days old')
    expect(text).not.toMatch(/after 24 hours at most|an unfinished request after 7 days/)
  })

  it('⛔ chat translation: on by default when languages differ, and a sender’s messages go out on the other person’s switch', async () => {
    // use-chat-translation.ts:126-130 (default ON on a mismatch) · api/messages/translate/route.ts:24 (incoming only)
    const text = await policy('marketplace')
    expect(text).toContain('translation starts switched on in that case')
    expect(text).toContain('the messages you send are translated for the other person while their translation is on')
    expect(text).not.toContain('when you turn on chat translation, the messages you receive')
  })

  it('App Store gate app-ai-notice: eno.forum\'s policy says the apps ask first — and only with the gate on', async () => {
    const ASK = 'In our apps, you are asked before your chats are first translated'
    // `policy()` renders into document.body, so each render is cleaned up before the next is read.
    const read = async (...args: Parameters<typeof policy>) => { cleanup(); return policy(...args) }
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect(await read('services')).not.toContain(ASK)
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    const on = await read('services')
    expect(on).toContain(ASK)
    // The existing promises stay word for word on both branches.
    expect(on).toContain('translation starts switched on in that case')
    expect(await read('services', 'vi')).toContain('Trong ứng dụng của chúng tôi, bạn sẽ được hỏi trước')
    // eno.vn's policy is untouched: the apps load only eno.forum.
    expect(await read('marketplace')).not.toContain(ASK)
    cleanup()
    vi.unstubAllEnvs()
  })

  it('⛔ Google receives search terms, a search-by-photo image and text to rephrase', async () => {
    const text = await policy('marketplace')
    expect(text).toContain('the words you search for')
    expect(text).toContain('a photo you choose to search by')
    expect(text).toContain('text you ask us to rephrase')
  })

  it('⛔ the moderators’ AI review of a report is disclosed — what Gemini receives, and that a person decides — on both editions', async () => {
    // The numbers the policy prints are the route's own: src/app/api/admin/ai-review/route.ts.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const route = readFileSync(join(__dirname, '..', '..', 'api', 'admin', 'ai-review', 'route.ts'), 'utf8')
    expect(route).toMatch(/messages: \{ orderBy: \{ createdAt: 'desc' \}, take: 40\b/)
    expect(route).toContain('const MAX_IMAGES = 4')
    for (const site of ['marketplace', 'services'] as const) {
      const en = await policy(site)
      expect(en, site).toContain('when our team reviews a report or a dispute and asks the AI for a suggestion, that case')
      expect(en, site).toContain('the last 40 messages of the conversation between the two parties')
      expect(en, site).toContain('up to 4 photos (evidence from the dispute, appeal proof or listing photos)')
      expect(en, site).toContain('not the email address or phone number of either account')
      expect(en, site).toContain('suggesting an outcome to our team when it reviews a report or dispute (a member of our team decides)')
      expect(en, site).toContain('AI review of reports: when our team reviews a report or a dispute')
      expect(en, site).toContain('The suggestion is advisory only: it does not decide or change anything in the case by itself, and a member of our team reads the evidence and makes the decision.')
      cleanup()
      const vi = await policy(site, 'vi')
      expect(vi, site).toContain('40 tin nhắn gần nhất trong cuộc trò chuyện giữa hai bên')
      expect(vi, site).toContain('cùng tối đa 4 ảnh')
      expect(vi, site).toContain('Hỗ trợ xem xét báo cáo bằng AI')
      expect(vi, site).toContain('Gợi ý này chỉ mang tính tham khảo')
      cleanup()
    }
  })

  it('⛔ the business tax code goes to VietQR — named as a recipient, not described as the tax authority', async () => {
    const text = await policy('marketplace')
    expect(text).toContain('VietQR’s public business-register service (api.vietqr.io')
    expect(text).toContain('VietQR (api.vietqr.io)')
    expect(text).not.toContain('against the tax authority’s public business register')
  })

  it('⛔ Cloudflare is described as carrying all traffic, and the intro no longer promises “nothing else”', async () => {
    const text = await policy('marketplace')
    expect(text).toContain('Everything sent between your device and this site passes through Cloudflare’s network')
    expect(text).not.toMatch(/for the purpose listed, and nothing else/)
  })

  it('describes consent v2: three separate uses, all off until switched on, and the record kept', async () => {
    const text = await policy('marketplace')
    expect(text).toContain('three optional uses, and each stays off until you switch it on')
    expect(text).toContain('not to your IP address')
    expect(text).toContain('the Meta and Google advertising cookies')
    expect(text).not.toMatch(/Allow all|Essential only/)
  })
})

/**
 * SIGN IN WITH APPLE (2026-10-08, D12: one dated update shipped with the SIWA dark deploy). Apple is a recipient
 * like Google, with what it sends (the name only the first time, a private relay address if the person hides
 * theirs), the token kept ONLY to revoke at deletion (TN3194), and the relay that carries our mail; Meta never
 * gets the email hash of an Apple account or a relay address (D14, meta-capi.ts). Both editions.
 */
describe('/privacy — Sign in with Apple', () => {
  it('⛔ names Apple as a recipient — what it sends, the token kept only for revocation, the relay — in both languages', async () => {
    for (const site of ['marketplace', 'services'] as const) {
      const en = await policy(site)
      expect(en, site).toContain('Apple (Sign in with Apple)')
      expect(en, site).toContain('the first time only and only if you share it, your name')
      expect(en, site).toContain('a private relay address that forwards to it')
      expect(en, site).toContain('We keep a sign-in token from Apple, stored encrypted, only so that when you delete your account we can ask Apple to end this site’s access to your Apple Account.')
      expect(en, site).toContain('Emails we send to a private relay address pass through Apple’s relay service on their way to you.')
      cleanup()
      const vi = await policy(site, 'vi')
      expect(vi, site).toContain('Apple (Đăng nhập bằng Apple)')
      expect(vi, site).toContain('chỉ để khi bạn xóa tài khoản, chúng tôi có thể yêu cầu Apple chấm dứt quyền truy cập')
      cleanup()
    }
  })

  it('⛔ account information and the cross-border notice name Apple', async () => {
    const text = await policy('marketplace')
    expect(text).toContain('if you use Sign in with Apple, your name from Apple — only the first time, and only if you choose to share it')
    expect(text).toContain('Cloudflare, Microsoft, Google, Apple, Resend')
  })

  it('⛔ D14: the Meta row and the Advertising paragraph say the email hash is never sent for an Apple account or a relay address', async () => {
    const en = await policy('marketplace')
    expect(en).toContain('never your email address if you use Sign in with Apple, or if it is an Apple private relay address')
    expect(en).toContain('with your email address (never if you use Sign in with Apple, or for an Apple private relay address), phone number and account identifier scrambled (hashed) first')
    cleanup()
    const vi = await policy('marketplace', 'vi')
    expect(vi).toContain('không bao giờ gửi email của bạn nếu bạn dùng Đăng nhập bằng Apple')
  })

  it('the sign-up reminder lists Apple among the methods it remembers choosing', async () => {
    const text = await policy('marketplace')
    expect(text).toContain('when you last chose Google, Apple or email in it')
    expect(text).toContain('For any sign-in window: when you choose Google, Apple or email in it')
  })

  it('the teacher-profile paragraph rides the same dated update', async () => {
    const text = await policy('marketplace')
    expect(text).toContain('Teacher profiles: if you create a teacher profile, we publish what you enter')
    expect(text).toContain('a link that expires after 10 minutes')
  })

  it('⛔ D12: "Last updated" prints this text’s own date, or a later Terms amendment’s, never an earlier one', async () => {
    const { LEGAL_AMENDMENT, dateEn, dateVi } = await import('@/lib/compliance/legal-amendment')
    const { PRIVACY_TEXT_PUBLISHED: own } = await import('@/lib/compliance/privacy-updated')
    expect(own).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // The Apple rows and the teacher paragraph changed this text after the Terms' version 3 dated it.
    expect(own >= LEGAL_AMENDMENT.published).toBe(true)
    const day = own > LEGAL_AMENDMENT.published ? own : LEGAL_AMENDMENT.published
    expect(await policy('marketplace')).toContain(`Last updated: ${dateEn(day)}`)
    cleanup()
    expect(await policy('marketplace', 'vi')).toContain(`Cập nhật lần cuối: ${dateVi(day)}`)
  })
})

describe('/privacy — round-2 corrections hold', () => {
  it('⛔ the essential-storage paragraph points at the full table instead of implying nothing else is kept', async () => {
    const text = await policy('marketplace')
    expect(text).not.toContain('Two more things stay on your device only')
    expect(text).toContain('It is not all this site keeps on your device: the table at the end of this section lists every item')
  })

  it('⛔ location names the real control, and geocoding covers the area filter too', async () => {
    // area-filter.tsx:421/:462 (label) · :206 reverse-geocodes the searched-near point
    const text = await policy('marketplace')
    expect(text).not.toContain('Search near you')
    expect(text).toContain('the “Use my current location” button')
    expect(text).toContain('or to show the area you searched near')
    cleanup()
    const vi = await policy('marketplace', 'vi')
    expect(vi).toContain('nút “Dùng vị trí hiện tại”')
    expect(vi).not.toContain('Tìm gần bạn')
  })

  it('⛔ social: every channel the code can post to is named (social/channels.ts + syndicate.ts)', async () => {
    const text = await policy('marketplace')
    expect(text).toContain('Facebook, Instagram, Threads, LinkedIn, Reddit and Telegram (our own pages and channels)')
  })

  it('⛔ Meta CAPI: the hashed account id, the listing and price, the page address and _fbp/_fbc are disclosed', async () => {
    // meta-capi.ts:59-68 user_data · :122 event_source_url · api/track/view/route.ts:53-58 custom_data
    const text = await policy('marketplace')
    expect(text).toContain('your email address, phone number and account identifier, each scrambled (hashed) first')
    expect(text).toContain('its identifier and, when you view or post one, its price')
    expect(text).toContain('the address of the page you were on')
    expect(text).toContain('Meta’s own browser cookies (_fbp, _fbc), if your browser already holds them')
    expect(text).toContain('only if Analytics is on as well — the link or campaign that first brought you here')
  })

  it('⛔ the location paragraph no longer extends "never shared with advertisers" to on-site behaviour', async () => {
    // With Advertising on, on-site behaviour DOES reach Meta: api/track/view/route.ts:49-58 ViewContent ·
    // api/listings/[id]/contact/route.ts:187-190 Contact · core/listings.ts:1138-1144 Lead ·
    // api/profile/account-type/route.ts:234-242 CompleteRegistration (all gated by meta-capi.ts:112-114).
    const en = await policy('marketplace')
    expect(en).not.toContain('same standard')
    expect(en).toContain('We treat your activity on this site as sensitive personal data too: it is used for Personalisation, Analytics or Advertising only when you switch that use on (see “Cookies, tracking and your device”).')
    cleanup()
    const vi = await policy('marketplace', 'vi')
    expect(vi).not.toContain('cùng tiêu chuẩn')
    expect(vi).toContain('Hoạt động của bạn trên website cũng được coi là dữ liệu cá nhân nhạy cảm: chỉ được dùng cho Cá nhân hóa, Phân tích hoặc Quảng cáo khi bạn bật mục tương ứng (xem mục “Cookie, theo dõi và thiết bị của bạn”).')
    cleanup()
    // the cross-reference names a section that exists, in each language
    expect(await policy('marketplace')).toContain('Cookies, tracking and your device')
  })

  it('⛔ services edition: the e-visa InitiateCheckout sent to Meta is disclosed, in both languages — and never on eno.vn', async () => {
    // api/visa/applications/start/route.svc.ts:113-120 (externalId only; custom_data evisa) · meta-capi.ts:59-68
    const en = await policy('services')
    expect(en).toContain('Meta (Conversions API) — only if you switch on Advertising: when you start a Vietnam e-visa application')
    expect(en).toContain('with your account identifier scrambled (hashed), your IP address and browser details, the address of the page you were on')
    expect(en).toContain('never the application details or documents')
    cleanup()
    const vi = await policy('services', 'vi')
    expect(vi).toContain('Meta (Conversions API) — chỉ khi bạn bật Quảng cáo: khi bạn bắt đầu một hồ sơ xin e-visa Việt Nam')
    expect(vi).toContain('không bao giờ kèm thông tin hồ sơ hay giấy tờ')
    cleanup()
    const vn = await policy('marketplace')
    expect(vn).not.toContain('Meta is told that an application was started')
    // the advertising paragraph points at the whole section, which on eno.forum holds this extra paragraph
    expect(vn).toContain('(“Who else receives your data” above lists all of it)')
    expect(vn).not.toContain('the recipients table above lists all of it')
  })

  it('⛔ no processing location is claimed for Zalo — only its operator', async () => {
    const text = await policy('marketplace')
    expect(text).not.toContain('Zalo: Vietnam.')
    expect(text).toContain('Zalo: operated by VNG, a Vietnamese company.')
  })

  it('⛔ the composer note is not "a message you started before signing in" — it is only written when signed in', async () => {
    const text = await policy('marketplace')
    expect(text).not.toContain('a message you started before signing in')
    expect(text).toContain('the message you were sending also when you sign out')
  })

  it('⛔ the "no selling" sentence is unambiguous in Vietnamese', async () => {
    const vi = await policy('marketplace', 'vi')
    expect(vi).not.toContain('chúng tôi cũng vậy')
    expect(vi).toContain('pháp luật Việt Nam cấm hành vi này, và quy định của chính chúng tôi cũng cấm')
  })

  it('⛔ the Vietnamese uses the site’s spelling (hóa, xóa, tùy — as src/generated/vi-overrides.ts does), never the mixed form', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const NEW_STYLE = /(?<![\p{L}])(tuỳ|hoá|khoá|xoá|khoẻ|uỷ|toạ|huỷ)(?![\p{L}])/iu
    for (const f of [join(__dirname, 'page.tsx'), join(__dirname, '..', '..', '..', 'lib', 'privacy-services-copy.ts')]) {
      expect(readFileSync(f, 'utf8').normalize('NFC'), f).not.toMatch(NEW_STYLE)
    }
  })

  it('⛔ the cookie bar’s link is named exactly what the page it opens is titled, in both languages', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8')
    const card = readFileSync(join(__dirname, '..', '..', '..', 'components', 'marketplace', 'cookie-consent.tsx'), 'utf8')
    const en = page.match(/<ContentPage\s+title="([^"]+)"/)?.[1]
    const vi = page.match(/titleVi="([^"]+)"/)?.[1]
    expect(en && vi).toBeTruthy()
    // ⚠️ Built with join(), never a literal `tr` + `('` in this file: scripts/gen-ui-strings.mjs walks test
    // files too and would harvest a placeholder key into the shipped catalogue (it did, 2026-10-01).
    const call = ['{tr', `('${en}', '${vi}')}`].join('')
    expect(card).toContain(`<Link href="/privacy" prefetch={false} className="font-semibold text-accent-foreground underline underline-offset-2">${call}</Link>`)
  })
})

describe('/privacy — the edition boundary', () => {
  it('⛔ eno.vn never mentions itinerary, trip planning or PayPal — and e-Visa only as a SELLER\'s service (2026-10-06)', async () => {
    const text = await policy('marketplace')
    expect(text).not.toMatch(/itinerar|trip plan|paypal|lịch trình/i)
    expect(text).toContain('e-Visa photos you send to a seller')
    expect(text).toContain('eno.vn is the marketplace: it is not a government agency and does not decide visa applications.')
    expect(text).toContain('https://evisa.gov.vn')
    // eno.forum's processor / provider-of-record text never reaches eno.vn
    expect(text).not.toMatch(/eno\.forum operates the platform|data processor/i)
    cleanup()
    const vi = await policy('marketplace', 'vi')
    expect(vi).not.toMatch(/itinerar|paypal|lịch trình/i)
    expect(vi).toContain('Ảnh hồ sơ e-Visa bạn gửi cho người bán')
  })

  it('⛔ a marketplace build WITHOUT the partner flow (the stub next.config.ts aliases in) never mentions visa at all', async () => {
    vi.doMock('@/lib/privacy-partner-visa-copy', () => import('@/lib/privacy-partner-visa-copy.stub'))
    try {
      expect(await policy('marketplace')).not.toMatch(/visa/i)
      cleanup()
      expect(await policy('marketplace', 'vi')).not.toMatch(/visa|thị thực/i)
    } finally {
      vi.doUnmock('@/lib/privacy-partner-visa-copy')
    }
  })

  it('eno.forum states its tag-manager exception; eno.vn states that declining stops all third-party tracking', async () => {
    expect(await policy('services')).toContain('our tag manager (Google Tag Manager) loads for every visitor to this site')
    cleanup()
    const vn = await policy('marketplace')
    expect(vn).toContain('Decline and no third-party tracking runs, server-side included.')
    expect(vn).not.toContain('Google Tag Manager')
  })
})

describe('/privacy — every paragraph is a real pair', () => {
  it('⛔ no paragraph ships an empty or untranslated Vietnamese', async () => {
    const src = (await import('node:fs')).readFileSync((await import('node:path')).join(__dirname, 'page.tsx'), 'utf8')
    const pairs = [...src.matchAll(/en: (['`])((?:(?!\1)[^\\]|\\.)*)\1,\s*vi: (['`])((?:(?!\3)[^\\]|\\.)*)\3/g)].map((m) => [m[2], m[4]])
    expect(pairs.length).toBeGreaterThan(60)
    // Proper nouns may be identical in both languages; a sentence may not.
    const untranslated = pairs.filter(([en, vi]) => !vi.trim() || (en === vi && en.split(' ').length > 4))
    expect(untranslated).toEqual([])
  })
})
