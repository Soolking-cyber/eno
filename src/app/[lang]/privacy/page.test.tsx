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
    // The build-time switches the page reads, pinned empty (commit gate B4, opus): a shell or CI env that sets them
    // must not move the hash and send someone to re-date a policy whose text did not change.
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', '')
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
    for (const r of ['Cloudflare', 'Microsoft (Azure AI Translator)', 'Google (Vertex AI, Gemini)', 'Anthropic (Claude)', 'Resend', 'CARTO', 'OpenStreetMap', 'Meta (WhatsApp Business)', 'AccessTrade', 'Google Analytics', 'Meta (Conversions API)']) {
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
      expect(text, site).toContain('how many times sign-in was opened there, Google, Apple, Facebook or email was chosen, and a sign-in followed')
      expect(text, site).toContain('answered with Google, Apple, Facebook or email')
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
    expect(text).toContain('Cloudflare, Microsoft, Google, Apple, Anthropic, Resend')
  })

  it('⛔ D14: the Meta row and the Advertising paragraph say the email hash is never sent for an Apple account or a relay address', async () => {
    const en = await policy('marketplace')
    expect(en).toContain('never your email address if you use Sign in with Apple, or if it is an Apple private relay address')
    expect(en).toContain('with your email address (never if you use Sign in with Apple, or for an Apple private relay address), phone number and account identifier scrambled (hashed) first')
    cleanup()
    const vi = await policy('marketplace', 'vi')
    expect(vi).toContain('không bao giờ gửi email của bạn nếu bạn dùng Đăng nhập bằng Apple, hoặc nếu')
  })

  // Sign in with LinkedIn — removed 2026-10-16 (owner: "remove linkedin login"), never switched on: no row, no sign-in data,
  // no withdrawal route. LinkedIn stays only as our own social page.
  it.each(['marketplace', 'services'] as const)('%s: LinkedIn is no sign-in recipient any more', async (site) => {
    const en = await policy(site)
    expect(en).not.toContain('Sign in with LinkedIn')
    expect(en).not.toContain('LinkedIn profile saved as a PDF')
    cleanup()
    expect(await policy(site, 'vi')).not.toContain('Đăng nhập bằng LinkedIn')
  })
  // Teacher CV import (owner, 2026-10-15; autofill 2026-10-16) — both editions (one codebase, one database).
  it.each(['marketplace', 'services'] as const)('%s: the CV reading — Google reads the whole file, its text is never kept, the phone and a PDF fill in, and it decides nothing', async (site) => {
    const en = await policy(site)
    expect(en).toContain('only when you choose “Fill it in from my CV” in the teacher profile form, the CV you choose — for a Word file, the text your browser reads from it — which the AI reads in full; we never keep its text (a PDF is kept only as the private CV attached to your profile, which you can replace or remove at any time and which is deleted with your profile)')
    expect(en).toContain('filling in a teacher profile from a CV you choose')
    expect(en).toContain('The phone number in your CV fills an empty phone field, and a CV that is a PDF is attached to your profile as your private CV unless you already have one')
    expect(en).toContain('Filling in a teacher profile from a CV: when you ask, an AI model (Google Gemini) reads the CV you choose')
    cleanup()
    expect(await policy(site, 'vi')).toContain('Điền hồ sơ giáo viên từ CV')
  })
  // The teacher profile photo check (owner, 2026-10-16) — what is sent, what is kept, what it decides, the human route.
  it.each(['marketplace', 'services'] as const)('%s: the profile photo check — Google sees the photo, only the result is kept, a person can approve it', async (site) => {
    const en = await policy(site)
    expect(en).toContain('And the profile photo you choose for a teacher profile — and, once, the photos already on teacher profiles — to check that it is a real photo showing a face — on the same terms.')
    expect(en).toContain('checking that a teacher’s profile photo is a real photo showing a face')
    expect(en).toContain('it does not identify you or judge your looks, Google does not use it to train its AI and keeps it only briefly — for up to 90 days if its automated checks flag the request as misuse — and we keep only the result, for up to 180 days')
    expect(en).toContain('Teacher profile photos: an AI model (Google Gemini) checks that the photo you choose for a teacher profile is a real photo showing a face')
    expect(en).toContain('ask from the Help page for a member of our team to look at it — they can approve it')
    cleanup()
    expect(await policy(site, 'vi')).toContain('Ảnh hồ sơ giáo viên: một mô hình AI (Google Gemini) kiểm tra ảnh bạn chọn')
  })
  // "Improve with AI" under the teacher's About text (owner, 2026-10-21; deploy planned 2026-10-22) — what Google receives
  // and never receives, the suggestion staying in the form, the two records and the export, and that it decides nothing.
  it.each(['marketplace', 'services'] as const)('%s: the About-text rewrite — what Gemini gets and never gets, the suggestion stays in the form, the records, and it decides nothing', async (site) => {
    const en = await policy(site)
    // the Google row: what is sent, what never is, on the CV reader's terms — and its purpose, between the pinned clauses
    expect(en).toContain('And, only when you tap “Improve with AI” under “About you” in the teacher profile form, to suggest a better About text: the About text as you wrote it, without any sentence where we find contact details, and your answers in that form (the subjects and languages you teach,')
    expect(en).toContain('the work you want and your headline) — never the name or phone number fields of the form (a name you write in the About text goes with it), your email address, photo, video, CV, expected salary, start date, cover lessons or any consent — on the same terms.')
    expect(en).toContain('checking that a teacher’s profile photo is a real photo showing a face, improving a teacher’s “About you” text when they ask, and suggesting an outcome to our team when it reviews a report or dispute (a member of our team decides).')
    // the teacher paragraph: when, to whom, never what, Google's terms; the form keeps it; the records and the export
    expect(en).toContain('If you tap “Improve with AI” under “About you”, Google’s Gemini AI reads the About text as you wrote it — any sentence where we find contact details is left out —')
    expect(en).toContain('about your teaching, qualifications, nationality and languages,')
    expect(en).toContain('it never receives the name or phone number fields of the form (a name you write in the About text goes with it), your email address, photo, intro video, CV, expected salary, start date, cover lessons or any consent you give, and Google does not use what it receives to train its AI and keeps it only briefly — for up to 90 days if its automated checks flag the request as misuse.')
    expect(en).toContain('The suggestion replaces the text in the form, where you can undo or change it, and like anything you type there it is published only when you publish your profile or save your changes;')
    expect(en).toContain('we keep two records of each request, neither holding any of the text: one made before anything is sent — when you asked, the version and a fingerprint of the words shown beside the button,')
    expect(en).toContain('— and one of its outcome — whether a suggestion came back (or why not), the AI model, how many attempts it took and how many words it had; both are included when you download your data.')
    // automated decisions: a suggestion, nothing decided
    expect(en).toContain('Improving a teacher’s “About you” text: when you ask, an AI model (Google Gemini) reads your About text and some of your answers in the teacher profile form (see “Teacher profiles”) and suggests a better About text. It decides nothing about you: the suggestion only replaces the text in the form, you read it and can change or undo it, and nothing is published until you publish your profile or save your changes.')
    expect(en).not.toMatch(/Gemini[^.]*job match/i)
    cleanup()
    const vi = await policy(site, 'vi')
    expect(vi).toContain('Và, chỉ khi bạn bấm “Cải thiện bằng AI” dưới mục “Giới thiệu” trong biểu mẫu hồ sơ giáo viên, để gợi ý một phần giới thiệu tốt hơn:')
    expect(vi).toContain('kiểm tra ảnh hồ sơ giáo viên là ảnh thật có khuôn mặt, cải thiện phần “Giới thiệu” của giáo viên khi giáo viên yêu cầu, và gợi ý hướng xử lý')
    expect(vi).toContain('Nếu bạn bấm “Cải thiện bằng AI” dưới mục “Giới thiệu”, AI Gemini của Google đọc phần giới thiệu đúng như bạn đã viết')
    expect(vi).toContain('về việc giảng dạy, bằng cấp, chứng chỉ, quốc tịch và ngôn ngữ,')
    expect(vi).toContain('với mỗi lần yêu cầu, chúng tôi lưu hai bản ghi, không bản ghi nào chứa văn bản: một bản ghi lập trước khi dữ liệu được gửi đi')
    expect(vi).toContain('cả hai bản ghi đều có trong dữ liệu bạn tải xuống.')
    expect(vi).toContain('Cải thiện phần “Giới thiệu” của giáo viên: khi bạn yêu cầu, một mô hình AI (Google Gemini)')
  })
  // ⛔ THE CV IS OPTIONAL — TO PUBLISH AND TO KEEP (owner: "publish before video/CV" 2026-10-22, "Allow removal" 2026-10-25; live
  // with the 2026-10-25 deploy). The 23 October 2026 cutoff (profiles created from it could only replace their CV) ended
  // with it: every teacher may remove a CV, so nothing in the policy may still draw that line.
  it('the CV can be replaced or removed at any time — no cutoff any more, EN and VI', async () => {
    const en = await policy('marketplace')
    expect(en).toContain('you can replace or remove it at any time, and it is deleted when you delete your profile.')
    expect(en).not.toContain('(a profile created before 23 October 2026 can also remove it)')
    cleanup()
    const vi = await policy('marketplace', 'vi')
    expect(vi).toContain('bạn có thể thay hoặc gỡ CV bất cứ lúc nào, và CV bị xóa khi bạn xóa hồ sơ.')
    expect(vi).not.toContain('(hồ sơ tạo trước ngày 23 tháng 10 năm 2026 cũng có thể gỡ CV)')
  })

  // ⛔ THE DAY THE JOB-MATCH SWITCHES TURNED ON BY DEFAULT IS A FACT NOW: 25 October 2026 (deploy 2f31c854b, ~14:35 ICT).
  // Until it ran, this test derived the day from PRIVACY_TEXT_PUBLISHED (gate review, opus 2026-10-22); the next re-date of
  // the policy (the in-app Google carry, 2026-10-26) pinned it here as a literal, as the CV dates were — never moved again.
  it('the day the job-match switches turned on by default is pinned: 25 October 2026, EN and VI', async () => {
    const [y, m, d] = [2026, 10, 25]
    const month = 'October'
    const why = 'The job-match switches went on by default with the 25 October 2026 deploy: that day is a fact, never re-dated.'
    for (const site of ['marketplace', 'services'] as const) {
      const en = await policy(site)
      cleanup()
      const vi = await policy(site, 'vi')
      cleanup()
      for (const s of [
        `are on by default in the form of a new teacher profile since ${d} ${month} ${y}:`,
        `both are on by default since ${d} ${month} ${y},`,
        `which are on by default in its form since ${d} ${month} ${y} —`,
      ]) expect(en, why).toContain(s)
      for (const s of [
        `Nếu bạn đang tìm việc, từ ngày ${d} tháng ${m} năm ${y}, “Gửi email`,
        `từ ngày ${d} tháng ${m} năm ${y}, cả hai được bật sẵn`,
        `được bật sẵn trong biểu mẫu từ ngày ${d} tháng ${m} năm ${y} —`,
      ]) expect(vi, why).toContain(s)
    }
  })

  // Google inside an app's built-in browser (2026-10-25): the page moves to the phone's own browser, and the teacher form's
  // step-1 answers wait on the server under a 30-minute link (src/lib/auth/carry.ts) — said where account data is listed.
  it.each(['marketplace', 'services'] as const)('%s: Google inside an app\'s browser — the page moves, the teacher\'s answers wait under a 30-minute link, within an hour', async (site) => {
    const en = await policy(site)
    expect(en).toContain('If you choose Google inside an app’s built-in browser (such as Facebook’s or Zalo’s), where Google does not let you sign in, the page opens in your phone’s own browser instead; on the teacher profile form, the answers you have given so far (where you live, the kinds of work you want, and whether — and where — you would move) go with it — we keep them on our server only until that browser picks them up through a link in the page’s address that works for 30 minutes, and delete them then, or otherwise within an hour.')
    cleanup()
    const vi = await policy(site, 'vi')
    expect(vi).toContain('Nếu bạn chọn Google trong trình duyệt tích hợp của một ứng dụng (như của Facebook hay Zalo), nơi Google không cho đăng nhập, trang sẽ được mở bằng trình duyệt của điện thoại; trên biểu mẫu hồ sơ giáo viên, các câu trả lời bạn đã đưa ra (nơi bạn sống, loại công việc bạn muốn, bạn có sẵn sàng chuyển đi không và đi đâu) đi cùng — chúng tôi chỉ giữ chúng trên máy chủ cho đến khi trình duyệt đó nhận qua một liên kết trong địa chỉ trang, có hiệu lực 30 phút, rồi xóa ngay, hoặc nếu không thì trong vòng một giờ.')
  })

  it('the switches it names are the form\'s own — the labels finish-step.tsx shows, EN and VI', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const form = readFileSync(join(__dirname, '..', '..', '..', 'components', 'teachers', 'steps', 'finish-step.tsx'), 'utf8')
    const labels = [['Email me jobs that match my profile', 'Gửi email cho tôi các việc làm phù hợp với hồ sơ'], ['Our staff may call me', 'Nhân viên của chúng tôi có thể gọi cho tôi']]
    const en = await policy('marketplace')
    cleanup()
    const vi = await policy('marketplace', 'vi')
    for (const [e, v] of labels) {
      // (built in two pieces: a literal tr('…', '…') here would be harvested into ui-strings.ts by gen-ui-strings)
      expect(form).toContain('tr' + `('${e}', '${v}')`)
      expect(en).toContain(`“${e}”`)
      expect(vi).toContain(`“${v}”`)
    }
  })

  // The CV REQUIRED for a new teacher profile (owner, 2026-10-21; deploy planned 2026-10-22): private as before, uploaded at
  // Publish (a failed Publish's upload deleted), replaced at any time, deleted with the profile — and nothing promises a
  // removal the form no longer offers. The 10 MB the policy prints is the private bucket's own limit.
  it.each(['marketplace', 'services'] as const)('%s: a teacher profile can include a CV — optional at Publish since 2026-10-25, private, replaced or removed at any time, deleted with the profile', async (site) => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const ddl = readFileSync(join(__dirname, '..', '..', '..', '..', 'scripts', 'teachers-ddl.mjs'), 'utf8')
    expect(ddl).toContain(`values ('teacher-cvs', 'teacher-cvs', false, ${10 * 1024 * 1024}, array['application/pdf'])`)
    const en = await policy(site)
    expect(en).toContain('A teacher profile can include a CV — a PDF of up to 10 MB, kept private as described above; leave out what schools don’t need, such as health details, ID numbers or your referees’ phone numbers: you can upload it when you publish your profile or add it later (an upload your profile does not end up using is deleted automatically), you can replace or remove it at any time, and it is deleted when you delete your profile.')
    // Publish before video/CV (owner, 2026-10-22; live with the 2026-10-25 deploy): nothing says a new profile NEEDS one.
    expect(en).not.toContain('A new teacher profile needs a CV')
    expect(en).toContain('Your phone number, email address and CV are never published: the account you are talking to receives them only if you tap “Share my phone, email & CV” in your conversation with it.')
    expect(en).toContain('both stay private as described above, and you can change the number or replace the CV on the last step.')
    for (const s of ['which you can remove)', 'remove the CV on the last step']) expect(en, s).not.toContain(s)
    cleanup()
    const vi = await policy(site, 'vi')
    expect(vi).toContain('Hồ sơ giáo viên có thể kèm CV — tệp PDF tối đa 10 MB, được giữ riêng tư như mô tả ở trên; hãy bỏ những gì trường không cần, như thông tin sức khỏe, số giấy tờ hay số điện thoại của người giới thiệu: bạn có thể tải CV lên khi đăng hồ sơ hoặc thêm sau')
    expect(vi).toContain('bạn có thể thay hoặc gỡ CV bất cứ lúc nào, và CV bị xóa khi bạn xóa hồ sơ.')
    expect(vi).not.toContain('Hồ sơ giáo viên mới cần có CV')
    expect(vi).toContain('bạn có thể thay hoặc gỡ tệp bất cứ lúc nào, và tệp bị xóa cùng hồ sơ)')
    expect(vi).toContain('và bạn có thể đổi số hoặc thay CV khác ở bước cuối.')
    for (const s of ['và bạn có thể xóa)', 'xóa CV ở bước cuối']) expect(vi, s).not.toContain(s)
  })

  it('the sign-up reminder lists Apple among the methods it remembers choosing', async () => {
    const text = await policy('marketplace')
    expect(text).toContain('when you last chose Google, Apple, Facebook or email in it')
    expect(text).toContain('For any sign-in window: when you choose Google, Apple, Facebook or email in it')
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

/**
 * ⛔ TEACHER JOB MATCHING (owner, 2026-10-08 — Claude Haiku 5.5, Anthropic; plan review E4). The pipeline's privacy gate
 * reads https://eno.vn/privacy for the exact label 'Anthropic (Claude)' before it judges anything, so the label, what is
 * sent (and never sent), the transfer abroad, the automated paragraph and the page's own dated record are pinned here.
 */
describe('/privacy — teacher job matching (Anthropic)', () => {
  it('⛔ names Anthropic (Claude) as a recipient on BOTH editions, outside Vietnam, with what it gets and never gets', async () => {
    for (const site of ['marketplace', 'services'] as const) {
      const text = await policy(site)
      expect(text, site).toContain('Anthropic (Claude)')
      // ⚖️ ON BY DEFAULT in a new profile's form since 2026-10-22 (owner — accepted risk): "with job matches on", the default named
      expect(text, site).toContain('Only for teachers with job matches on (by email, or through a call from our staff — in the form of a new teacher profile both are on by default, and a teacher can switch either off at any time):')
      expect(text, site).not.toContain('Only for teachers who ask for job matches')
      expect(text, site).toContain('with the teacher’s own name taken out wherever we can detect it')
      expect(text, site).toContain('Never the name, photo, video, phone number, email address or CV fields of the profile.')
      expect(text, site).toContain('Comparing teacher profiles with teaching jobs, to suggest jobs to the teacher and, while the teacher’s “Our staff may call me” is on, to our staff.')
      cleanup()
    }
  })

  it('⛔ lists Anthropic among the transfers outside Vietnam, in both languages', async () => {
    expect(await policy('marketplace')).toContain('Cloudflare, Microsoft, Google, Apple, Anthropic, Resend')
    cleanup()
    expect(await policy('marketplace', 'vi')).toContain('Cloudflare, Microsoft, Google, Apple, Anthropic, Resend')
  })

  it('describes the matching as automated processing — the bar, the email limits, who sees the score, how to stop it', async () => {
    const { MATCH_MIN_SCORE } = await import('@/lib/teachers/match-io')
    const { MATCH_EMAIL_RULES } = await import('@/lib/teachers/match-emails')
    // The numbers the policy prints are the code's own.
    expect(MATCH_MIN_SCORE).toBe(70)
    expect(MATCH_EMAIL_RULES.perEmail).toBe(5)
    expect(MATCH_EMAIL_RULES.cooldownMs).toBe(3 * 86_400_000)
    const en = await policy('marketplace')
    expect(en).toContain('Teacher job matching: while a teacher has job matches on (in the form of a new teacher profile they are on by default), an AI model (Anthropic’s Claude) compares their profile with new teaching jobs')
    expect(en).toContain('while the teacher’s “Email me jobs that match my profile” is on, it is emailed to them (at most five jobs per email, at most one email every three days), and, while their “Our staff may call me” is on, listed for our staff, who may call the teacher about it.')
    expect(en).toContain('Switching both choices off in the teacher profile stops it; the unsubscribe link in an email stops the emails.')
    expect(en).toContain('A job that scores 70 or more becomes a suggestion')
    expect(en).toContain('at most five jobs per email, at most one email every three days')
    expect(en).toContain('schools never see the score')
    expect(en).toContain('the unsubscribe link in an email stops the emails')
    // The purpose says what counts as the consent once the switches start ON — never "consent only", a word for an act a
    // teacher who left the default on did not make.
    expect(en).toContain('With a teacher’s consent, given in the teacher profile with two switches — in the form of a new profile both are on by default since 25 October 2026, so leaving one on and publishing counts as that consent; a teacher can switch either off before publishing or at any time after: to compare the profile with teaching jobs and suggest the ones that fit, by email or through a call from our staff to the teacher’s phone number (see “Teacher profiles” and “Automated decisions”).')
    for (const s of ['With a teacher’s consent only, given in the teacher profile', 'if a teacher asks for job matches', 'if the teacher allowed our staff to call']) expect(en, s).not.toContain(s)
    expect(en).not.toMatch(/Gemini[^.]*job match/i)
    cleanup()
    const vi = await policy('marketplace', 'vi')
    expect(vi).toContain('So khớp việc làm cho giáo viên: khi giáo viên đang bật gợi ý việc làm (trong biểu mẫu của hồ sơ giáo viên mới, mục này được bật sẵn), một mô hình AI (Claude của Anthropic)')
    expect(vi).toContain('khi mục “Gửi email cho tôi các việc làm phù hợp với hồ sơ” của giáo viên đang bật, gợi ý được gửi qua email cho giáo viên (tối đa năm việc làm mỗi email, tối đa một email mỗi ba ngày), và khi mục “Nhân viên của chúng tôi có thể gọi cho tôi” đang bật, được đưa vào danh sách để nhân viên có thể gọi cho giáo viên về việc làm đó.')
    expect(vi).toContain('Chỉ với giáo viên đang bật gợi ý việc làm (qua email, hoặc qua cuộc gọi từ nhân viên của chúng tôi — trong biểu mẫu của hồ sơ giáo viên mới, cả hai mục đều được bật sẵn, và giáo viên có thể tắt từng mục bất cứ lúc nào):')
    expect(vi).toContain('để gợi ý việc làm cho giáo viên và, khi mục “Nhân viên của chúng tôi có thể gọi cho tôi” của giáo viên đang bật, cho nhân viên của chúng tôi.')
    expect(vi).toContain('Với sự đồng ý của giáo viên, được đưa ra trong hồ sơ giáo viên bằng hai công tắc — từ ngày 25 tháng 10 năm 2026, cả hai được bật sẵn trong biểu mẫu của hồ sơ mới, nên việc để nguyên một công tắc ở trạng thái bật và đăng hồ sơ được coi là sự đồng ý đó; giáo viên có thể tắt từng công tắc trước khi đăng hoặc bất cứ lúc nào sau đó:')
    for (const s of ['Chỉ khi giáo viên đồng ý trong hồ sơ giáo viên', 'nếu giáo viên yêu cầu gợi ý việc làm', 'Chỉ với giáo viên yêu cầu gợi ý việc làm', 'nếu giáo viên cho phép nhân viên của chúng tôi gọi điện']) expect(vi, s).not.toContain(s)
  })
})

/**
 * ⛔ THE TEACHER PHONE REQUIRED AND THE JOB-MATCH SWITCHES ON BY DEFAULT (owner, 2026-10-22: "also phone number is mandatory
 * and all toggles should be on by default go" — phone "Everyone, on next save", toggles "On by default everywhere"; an
 * accepted risk, docs/compliance/pdpl-dossier-draft.md [OWNER DECISION 2026-10-22]). What the policy says is what the code
 * does: the phone on every save (profile.ts validateTeacherInput, isTeacherPhone), never refused for a save that only
 * hides or switches off (phoneWaived), never published, used by staff only while "Our staff may call me" is on; the
 * switches on in a NEW profile's FORM (teacher-form.tsx optInChoice — the answers of EMPTY_TEACHER, a draft or a link never
 * hold a switch ON; the form shows the default beside them, and a draft keeps only the switches turned off), an
 * existing profile's own choice kept, and the general "off until you turn it on" carving them out by name.
 */
describe('/privacy — the teacher phone and the job-match defaults (2026-10-22)', () => {
  it('⛔ the rules it describes are the code’s own', async () => {
    const { EMPTY_TEACHER, validateTeacherInput, phoneWaived, isTeacherPhone, normalizeForSave } = await import('@/lib/teachers/profile')
    // "Every teacher profile needs a phone number" — the finish step refuses a save without one, and junk
    expect(validateTeacherInput({ ...EMPTY_TEACHER }, ['finish']).phone).toBe('required')
    expect(validateTeacherInput({ ...EMPTY_TEACHER, phone: '()()()()' }, ['finish']).phone).toBe('invalid')
    expect(isTeacherPhone('+84 90 123 4567')).toBe(true)
    // "the default … in the form of a new teacher profile" — never in the empty profile a draft or a link starts from
    expect(EMPTY_TEACHER.matchEmailOptIn).toBe(false)
    expect(EMPTY_TEACHER.staffContactOptIn).toBe(false)
    // "a save that only hides your profile or switches something off is never refused for it" — and a new profile, or one
    // that changes nothing, still needs it
    const none = { phone: false, matchEmailOptIn: true, staffContactOptIn: true, coverOpen: false, publicVideo: false }
    const next = { phone: '', matchEmailOptIn: true, staffContactOptIn: true, coverOpen: false, videoUrl: null }
    expect(phoneWaived(null, next, true)).toBe(false)
    expect(phoneWaived(none, next, false)).toBe(false)
    // a save that hides has no job type, and with none both job-match switches are saved off (normalizeForSave) — so a
    // hide always switches off whatever it had on, and is waived whatever the profile had
    expect(normalizeForSave({ ...EMPTY_TEACHER, jobTypes: [], matchEmailOptIn: true, staffContactOptIn: true })).toMatchObject({ matchEmailOptIn: false, staffContactOptIn: false })
    const hidden = { ...next, matchEmailOptIn: false, staffContactOptIn: false }
    expect(phoneWaived(none, hidden, true)).toBe(true)
    expect(phoneWaived({ ...none, matchEmailOptIn: false, staffContactOptIn: false }, hidden, true)).toBe(true)
    expect(phoneWaived(none, { ...next, staffContactOptIn: false }, false)).toBe(true)
    expect(phoneWaived({ ...none, phone: true }, { ...next, staffContactOptIn: false }, false)).toBe(false)
  })

  const EN = [
    'Your phone number, email address and CV are never published: the account you are talking to receives them only if you tap “Share my phone, email & CV” in your conversation with it.',
    'Every teacher profile needs a phone number: you give it when you publish a new profile, and a profile saved without one adds it the next time it is saved — a save that only hides your profile or switches something off is never refused for it.',
    'Our staff call it only while “Our staff may call me” is on — about jobs that match your profile, and to offer to introduce you to the schools behind them; we never give your number to a school: only your Share tap does.',
    'If you are looking for work, “Email me jobs that match my profile” and “Our staff may call me” are on by default in the form of a new teacher profile since 25 October 2026: switch either off before you publish, or at any time later in “Teacher profile” in your account, and the unsubscribe link in any job-match email switches the emails off; an existing profile keeps the choices it saved.',
    'We record when each was switched on, with the version of the notice shown beside them, and when it was switched off; if a new profile is published with a switch still at its default, we also record which one was left on, and that record is included when you download your data.',
    // ⛔ a suggestion is emailed only while the email switch is on (gate review, codex 2026-10-22: it read as always)
    'A job that scores 70 or more becomes a suggestion: while the teacher’s “Email me jobs that match my profile” is on, it is emailed to them',
    // ⛔ the general promise names the new carve-out — the sentence a reader holds us to
    'and you can hide it at any time (see above); and except the two job-match switches of a new teacher profile, which are on by default in its form since 25 October 2026 — you can switch either off before you publish and at any time after (see “Teacher profiles”).',
  ]
  const VI = [
    'Mọi hồ sơ giáo viên đều cần có số điện thoại: bạn nhập số khi đăng hồ sơ mới, và hồ sơ đã lưu mà chưa có số sẽ cần thêm số vào lần lưu tiếp theo — lần lưu chỉ để ẩn hồ sơ hoặc tắt một mục thì không bao giờ bị từ chối vì thiếu số.',
    'Nhân viên của chúng tôi chỉ gọi số này khi mục “Nhân viên của chúng tôi có thể gọi cho tôi” đang bật — về các việc làm phù hợp với hồ sơ, và để đề nghị giới thiệu bạn với các trường đăng các việc làm đó; chúng tôi không bao giờ đưa số của bạn cho trường: chỉ khi bạn bấm Chia sẻ.',
    'Nếu bạn đang tìm việc, từ ngày 25 tháng 10 năm 2026, “Gửi email cho tôi các việc làm phù hợp với hồ sơ” và “Nhân viên của chúng tôi có thể gọi cho tôi” được bật sẵn trong biểu mẫu của hồ sơ giáo viên mới:',
    'hồ sơ đã có giữ nguyên lựa chọn đã lưu.',
    'khi mục “Gửi email cho tôi các việc làm phù hợp với hồ sơ” của giáo viên đang bật, gợi ý được gửi qua email cho giáo viên',
    'nếu hồ sơ mới được đăng khi một mục vẫn để nguyên mặc định, chúng tôi còn ghi lại mục nào được để bật, và bản ghi này có trong dữ liệu bạn tải xuống.',
    'và bạn có thể ẩn nhãn bất cứ lúc nào (xem ở trên); và trừ hai công tắc gợi ý việc làm của hồ sơ giáo viên mới, được bật sẵn trong biểu mẫu từ ngày 25 tháng 10 năm 2026 — bạn có thể tắt từng công tắc trước khi đăng hồ sơ và bất cứ lúc nào sau đó (xem mục “Hồ sơ giáo viên”).',
  ]

  it('⛔ both editions, both languages: the phone on every save, what staff use it for, the default, switching off, the records', async () => {
    for (const site of ['marketplace', 'services'] as const) {
      const en = await policy(site)
      for (const s of EN) expect(en, `${site}: ${s}`).toContain(s)
      // the old phone rule ("optional unless staff may call") must not survive anywhere
      expect(en).not.toMatch(/phone[^.]*optional/i)
      cleanup()
      const vi = await policy(site, 'vi')
      for (const s of VI) expect(vi, `${site}: ${s}`).toContain(s)
      expect(vi).not.toMatch(/số điện thoại[^.]*không bắt buộc/)
      cleanup()
    }
  })
})

/**
 * ⛔ TEACHER JOB MESSAGES (owner, 2026-10-20 — src/lib/teachers/job-dms). The jobs desk's chat messages are their OWN
 * consent (the "Job messages" page — consent.ts), matched on eno's own server (gates.ts reads the profile; the on-box AI
 * model reads only the posts), so NO recipient row and no transfer abroad: the Anthropic row above stays the email/staff
 * matching's alone. The numbers the policy prints are the code's own (JOB_DM_RULES), and the switch it quotes is the one
 * the page shows (job-messages-panel.tsx).
 */
describe('/privacy — teacher job messages (the jobs desk)', () => {
  const EN = [
    'Job messages for teachers: job messages are on for every teacher profile on eno.vn — since 21 October 2026, and for a new profile once it is live — until you switch off “Message me matching jobs and cover lessons in eno chat” (on the “Job messages” page of your teacher profile) or reply STOP. While they are on, our jobs desk — shown in chat as “Alex · eno.vn” — may send you automatic messages in eno.vn chat',
    'We find them in Facebook teaching-job groups, in LinkedIn job-alert emails, in job posts our team forwards to us and among eno.vn’s own job listings.',
    'The posts we collect are kept privately on our server in Vietnam: they are never published, are used only to find jobs and cover lessons for teachers with job messages on, and their content is deleted 30 days after we receive them — only a post’s identifier at its source is kept, for up to 6 months, so the same post is never sent twice.',
    'if a reply may be asking us to stop, we pause the messages and ask you — tap “Keep sending jobs” to get them again, and if you don’t, they switch off after 14 days.',
    'To choose the jobs for you we use where you live (in Vietnam or abroad), the places you can teach, the work you want, your subjects, age groups, English level, degree, certificate types, years of experience and expected salary — and, while cover lessons are on, your cover areas, free periods and hourly rate.',
    'This runs on our own server in Vietnam: no AI company outside Vietnam receives your profile for it.',
    'You get at most one jobs message and one cover-lesson message a day, each with at most five jobs, and at most two messages until you reply',
    'We keep the time job messages were switched on for you — by us, or by you with the version of the notice shown beside the switch — and the time they were switched off; reply STOP in that chat, or switch them off on the same page, at any time: the first message says how.',
    'We also tell each teacher once, in the app only, that job messages are on and where to switch them off.',
    'For every teacher profile, as part of the teacher service, until the teacher switches it off on the “Job messages” page or replies STOP: to send them automatic messages in eno.vn chat about jobs and cover lessons that fit their profile',
    'Job messages for teachers: for every teacher with job messages on — they are on until the teacher switches them off — our own server in Vietnam reads job and cover-lesson posts and picks the ones that fit the teacher’s profile.',
    'an AI language model that runs on that same server also reads the posts, never the teacher’s profile, and its readings are only recorded, to check and improve the rules.',
    'a post that asks for a particular gender, age, race or nationality, or charges candidates a fee, is never sent — nor is one that names a nationality, gender or age in a way the rules cannot tell apart from such a request.',
    'no score is shown to anyone, and no application is made on anyone’s behalf. Replying STOP in the chat, or switching it off on the “Job messages” page, stops it.',
  ]
  const VI = [
    'Tin nhắn việc làm cho giáo viên: tin nhắn việc làm được bật cho mọi hồ sơ giáo viên trên eno.vn — từ ngày 21 tháng 10 năm 2026, và với hồ sơ mới thì từ khi hồ sơ được hiển thị — cho đến khi bạn tắt “Nhắn cho tôi các việc làm và buổi dạy thay phù hợp qua tin nhắn eno” (tại trang “Tin nhắn việc làm” trong hồ sơ giáo viên) hoặc trả lời STOP.',
    'hiển thị trong tin nhắn là “Alex · eno.vn”',
    'và nội dung được xóa sau 30 ngày kể từ khi chúng tôi nhận được — chỉ giữ mã định danh của tin tại nguồn, tối đa 6 tháng, để không gửi trùng một tin.',
    'không có công ty AI nào ngoài Việt Nam nhận hồ sơ của bạn cho việc này.',
    'Bạn nhận tối đa một tin nhắn việc làm và một tin nhắn dạy thay mỗi ngày, mỗi tin tối đa năm việc, và tối đa hai tin nhắn cho đến khi bạn trả lời',
    'bạn có thể trả lời STOP trong cuộc trò chuyện đó, hoặc tắt tại cùng trang đó, bất cứ lúc nào: tin nhắn đầu tiên sẽ hướng dẫn cách tắt.',
    'Với mọi hồ sơ giáo viên, như một phần của dịch vụ dành cho giáo viên, cho đến khi giáo viên tắt tại trang “Tin nhắn việc làm” hoặc trả lời STOP: để gửi cho giáo viên tin nhắn tự động',
    'chỉ đọc các tin tuyển dụng và không bao giờ đọc hồ sơ của giáo viên, và kết quả đọc của mô hình chỉ được ghi lại',
    'tin nào yêu cầu một giới tính, độ tuổi, chủng tộc hay quốc tịch cụ thể, hoặc thu phí ứng viên, sẽ không bao giờ được gửi — cũng như tin nêu quốc tịch, giới tính hay độ tuổi',
    'nếu một tin trả lời có thể là yêu cầu dừng, chúng tôi tạm dừng tin nhắn và hỏi bạn — chạm “Gửi tiếp việc làm” để nhận lại, nếu không, mục này sẽ tự tắt sau 14 ngày.',
  ]

  it('⛔ the numbers it prints are the code’s own', async () => {
    const { JOB_DM_RULES } = await import('@/lib/teachers/job-dms/constants')
    expect(JOB_DM_RULES.retentionDays).toBe(30) // "their content is deleted 30 days after we receive them"
    expect(JOB_DM_RULES.shellDays).toBe(180) // "only a post’s identifier … for up to 6 months"
    expect(JOB_DM_RULES.pauseToWithdrawDays).toBe(14) // "they switch off after 14 days"
    expect(JOB_DM_RULES.perDayPerKind).toBe(1) // "one jobs message and one cover-lesson message a day"
    expect(JOB_DM_RULES.jobsPerDm).toBe(5) // "each with at most five jobs"
    expect(JOB_DM_RULES.unansweredMax).toBe(2) // "at most two messages until you reply"
  })

  it('⛔ both editions, both languages: the switch, the sources, the 30-day posts, what is used, on our own server, the caps, STOP', async () => {
    for (const site of ['marketplace', 'services'] as const) {
      const en = await policy(site)
      for (const s of EN) expect(en, `${site}: ${s}`).toContain(s)
      // ON by default since 2026-10-21 (owner): the opt-in wording is gone
      expect(en).not.toContain('; it stays off until you switch it on.')
      expect(en).not.toContain('With a teacher’s consent only, given on the “Job messages” page')
      cleanup()
      const vi = await policy(site, 'vi')
      for (const s of VI) expect(vi, `${site}: ${s}`).toContain(s)
      cleanup()
    }
  })

  it('⛔ names no AI company for it — neither paragraph speaks of Anthropic, Claude, Google or Gemini', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8')
    const paras = [...page.matchAll(/(?:en|vi): '((?:Job messages for teachers|Tin nhắn việc làm cho giáo viên):[^']*)'/g)].map((m) => m[1])
    expect(paras).toHaveLength(4) // what we collect + automated decisions, in each language
    for (const p of paras) expect(p).not.toMatch(/Anthropic|Claude|Google|Gemini/)
  })

  it('the switch it quotes is the switch the page shows — the label, word for word, in both languages', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const panel = readFileSync(join(__dirname, '..', '..', '..', 'components', 'teachers', 'job-messages-panel.tsx'), 'utf8')
    // ⚠️ No literal `tr` + `('` here: scripts/gen-ui-strings.mjs walks test files too.
    expect(panel).toContain(`'Message me matching jobs and cover lessons in eno chat', 'Nhắn cho tôi các việc làm và buổi dạy thay phù hợp qua tin nhắn eno'`)
    expect(panel).toContain(`'Job messages', 'Tin nhắn việc làm'`)
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

  it('⛔ TikTok is named as a recipient on BOTH editions, outside Vietnam — what it gets, the click id, and from when — in both languages', async () => {
    // src/lib/tiktok-events.ts (server-side: tiktokConsent + the consent record) · api/teachers/me/route.ts PUT →
    // CompleteRegistration · src/lib/tiktok-consent.ts TIKTOK_NAMED_FROM_S / TIKTOK_COPY_VERSION.
    for (const edition of ['marketplace', 'services'] as const) {
      const en = await policy(edition)
      expect(en).toContain('TikTok (Events API) — only if you switch on Advertising')
      expect(en).toContain('That you published a teacher profile, with the listing involved (its identifier and category)')
      expect(en).toContain('each scrambled (hashed) first — never your email address if you use Sign in with Apple')
      expect(en).not.toMatch(/click identifier|ttclid/) // not carried in this release: nothing here may say it is
      expect(en).toContain('Only for an Advertising choice made on or after 13 October 2026, the first full day our consent question named TikTok.')
      // …the Advertising paragraph, the consent sentence and the cross-border list say the same.
      expect(en).toContain('we also tell TikTok that a sign-up was completed')
      expect(en).toContain('advertising measurement signals to Meta and TikTok (and to Google, when Analytics is on as well)')
      expect(en).toContain('Telegram, Meta, TikTok, LinkedIn')
      expect(en).toContain('the Meta, TikTok and Google advertising signals')
      cleanup()
      const vi = await policy(edition, 'vi')
      expect(vi).toContain('TikTok (Events API) — chỉ khi bạn bật Quảng cáo')
      expect(vi).toContain('Chỉ áp dụng với lựa chọn Quảng cáo được thực hiện từ ngày 13 tháng 10 năm 2026, ngày trọn vẹn đầu tiên câu hỏi xin đồng ý của chúng tôi nêu tên TikTok.')
      expect(vi).toContain('chúng tôi cũng báo cho TikTok rằng một lượt đăng ký đã hoàn tất')
      expect(vi).not.toMatch(/lượt nhấp|ttclid/)
      cleanup()
    }
  })
  it('⛔ the day /privacy gives for TikTok is the day the code starts from (TIKTOK_NAMED_FROM_S), in Vietnam', async () => {
    const { TIKTOK_NAMED_FROM_S } = await import('@/lib/tiktok-consent')
    const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(TIKTOK_NAMED_FROM_S * 1000))
    expect(day).toBe('13 October 2026')
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(TIKTOK_NAMED_FROM_S * 1000))).toBe('00:00')
    // …in both editions and both languages (the Vietnamese date is written out).
    for (const edition of ['marketplace', 'services'] as const) {
      expect(await policy(edition)).toContain(`on or after ${day}`)
      cleanup()
      expect(await policy(edition, 'vi')).toContain('từ ngày 13 tháng 10 năm 2026')
      cleanup()
    }
  })

  it('⛔ the location paragraph no longer extends "never shared with advertisers" to on-site behaviour', async () => {
    // With Advertising on, on-site behaviour DOES reach Meta: api/track/view/route.ts:49-58 ViewContent ·
    // api/listings/[id]/contact/route.ts:187-190 Contact · core/listings.ts:1138-1144 Lead ·
    // api/teachers/me/route.ts PUT Lead (a new teacher profile is a listing posted) ·
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
    // Since speed plan item 7 the link's words are boxed (BoxedLink — cookie-consent.tsx says why): the label is the
    // same tr() pair, and the link itself still never prefetches.
    expect(card).toContain(`<BoxedLink href="/privacy" label=${call} className="font-semibold text-accent-foreground" />`)
    expect(card).toContain('<Link href={href} prefetch={false} className={className}>')
  })

  it('⛔ every other "Privacy Policy" link and label names the page by its own Vietnamese title (2026-10-15: sign-in, onboarding, the rental check and the help center said "Chính sách bảo mật" / "Chính sách quyền riêng tư")', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const vi = readFileSync(join(__dirname, 'page.tsx'), 'utf8').match(/titleVi="([^"]+)"/)?.[1]
    expect(vi).toBeTruthy()
    const src = join(__dirname, '..', '..', '..')
    const files = [
      'components/marketplace/sign-in-form.tsx', 'app/[lang]/onboard/onboard-client.tsx', 'app/[lang]/rentals/check/rental-check-view.tsx',
      'components/teachers/teacher-form.tsx', 'components/teachers/steps/finish-step.tsx',
    ]
    for (const f of files) {
      // ⚠️ No literal `tr` + `('` here: scripts/gen-ui-strings.mjs walks test files too (see the test above).
      const named = [...readFileSync(join(src, f), 'utf8').matchAll(/'Privacy [Pp]olicy', '([^']+)'/g)].map((m) => m[1])
      expect(named.length, f).toBeGreaterThan(0)
      expect(named, f).toEqual(named.map(() => vi))
    }
    const help = readFileSync(join(src, 'components/marketplace/help-center.tsx'), 'utf8')
    expect(help).toContain(`{ href: '/privacy', en: 'Privacy policy', vi: '${vi}',`)
    const overrides = readFileSync(join(src, 'generated/vi-overrides.ts'), 'utf8')
    for (const key of ['Privacy Policy', 'Privacy policy']) expect(overrides).toContain(`"${key}": "${vi}",`)
  })

  it('⛔ no shipped file calls eno\'s policy "Chính sách bảo mật" or "Chính sách quyền riêng tư" — only OTHER parties\' policies may use those words', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join, relative } = await import('node:path')
    const src = join(__dirname, '..', '..', '..')
    // Only two LINES may use those words, and neither is eno's /privacy: the visa partner's own policy (services copy),
    // and the note that the OTHER site has its own terms and privacy policy.
    const ALLOWED_LINE: Record<string, string> = {
      'lib/privacy-services-copy.ts': 'xử lý hồ sơ theo chính sách quyền riêng tư cũng như nghĩa vụ',
      'generated/vi-overrides.ts': 'its own operator details, terms and privacy policy',
    }
    const OLD = /chính sách (bảo mật|quyền riêng tư)/iu
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!/\.(ts|tsx|json|md|mdx)$/.test(name) || /\.(test|spec)\.tsx?$/.test(name)) continue
        const rel = relative(src, p).split('\\').join('/')
        const text = readFileSync(p, 'utf8').normalize('NFC')
        if (!OLD.test(text)) continue
        const lines = text.split('\n').filter((l) => OLD.test(l))
        const allowed = ALLOWED_LINE[rel]
        if (!allowed || !lines.every((l) => l.includes(allowed))) hits.push(rel)
      }
    }
    walk(src)
    expect(hits).toEqual([])
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

  // ⛔ Owner, 2026-10-14: the e-Visa subcategory is open to any seller on both editions — so the shared "Messages to
  // e-Visa sellers" paragraph is the ONE place a marketplace build without the partner flow names e-Visa.
  it('⛔ a marketplace build WITHOUT the partner flow (the stub next.config.ts aliases in) mentions visa only in the shared e-Visa sellers paragraph', async () => {
    vi.doMock('@/lib/privacy-partner-visa-copy', () => import('@/lib/privacy-partner-visa-copy.stub'))
    try {
      const en = await policy('marketplace')
      const enPara = en.slice(en.indexOf('Messages to e-Visa sellers:'), en.indexOf('https://evisa.gov.vn.') + 'https://evisa.gov.vn.'.length)
      expect(enPara.startsWith('Messages to e-Visa sellers:')).toBe(true)
      expect(en.replace(enPara, '')).not.toMatch(/visa/i)
      cleanup()
      const vi = await policy('marketplace', 'vi')
      const viPara = vi.slice(vi.indexOf('Tin nhắn với người bán dịch vụ e-Visa:'), vi.indexOf('https://evisa.gov.vn.') + 'https://evisa.gov.vn.'.length)
      expect(viPara.startsWith('Tin nhắn với người bán dịch vụ e-Visa:')).toBe(true)
      expect(vi.replace(viPara, '')).not.toMatch(/visa|thị thực/i)
    } finally {
      vi.doUnmock('@/lib/privacy-partner-visa-copy')
    }
  })

  // What chat does with what a buyer types to an e-Visa seller — true on both editions (prisma Message has no file
  // column; deleting is recall, not erasure; a report of the conversation, the listing or the seller can be read).
  it('the e-Visa sellers paragraph says what chat does, on both editions, in both languages', async () => {
    for (const edition of ['marketplace', 'services'] as const) {
      const en = await policy(edition, 'en')
      expect(en, edition).toContain('Messages to e-Visa sellers: sellers on this site may offer help with a Vietnam e-Visa.')
      expect(en, edition).toContain('an ordinary chat, which cannot carry photos or files')
      expect(en, edition).toContain('deleting a message hides it from both of you but does not erase it')
      expect(en, edition).toContain('if a report involves the conversation, the listing or the seller, our team can read it and may ask an AI model for a suggestion')
      cleanup()
      const vi = await policy(edition, 'vi')
      expect(vi, edition).toContain('Tin nhắn với người bán dịch vụ e-Visa:')
      expect(vi, edition).toContain('không gửi được ảnh hay tệp')
      expect(vi, edition).toContain('chứ không xóa hẳn')
      cleanup()
    }
  })

  // The partner section's first sentence no longer says every e-Visa seller takes photos in chat (only the listings
  // with the in-chat application do) — the shared paragraph above would contradict it.
  it('the partner e-Visa section opens with the listings that take an application in chat', async () => {
    const en = await policy('marketplace')
    expect(en).toContain('Some e-Visa listings on eno.vn let you apply in the chat. If you use one, you send the seller two photos in the chat:')
    expect(en).not.toContain('Some sellers on eno.vn offer help')
    cleanup()
    expect(await policy('marketplace', 'vi')).toContain('Một số tin đăng e-Visa trên eno.vn cho phép bạn nộp hồ sơ ngay trong cuộc trò chuyện.')
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

/**
 * ⚖️ THE IDENTITY CHANGE (owner, 2026-10-15 — not material, live with the deploy): a verified identity counts in the
 * trust score while it is current, every account, both editions; the selfie holds no code since 2026-09-04; one
 * Vietnamese term for the trust score (Quy chế Art 17); and the teacher's "Identity verified" mark — AUTOMATIC since
 * 2026-10-16 (owner: "if they verify it should be auto"; "On deploy", not material): where it shows, its conditions,
 * never the document, the identity declaration as its consent and record (identity-v2's clause 5), the identity-v1
 * cohort shown on the same terms, said, hiding it at any time (before publishing too), what is recorded, its own
 * purpose, and the general "off until you turn it on" carving it out. Decree 69/2024 reserves "xác thực": eno's own
 * check is "xác minh".
 */
describe('/privacy — a verified identity, the trust score and the teacher’s “Identity verified”', () => {
  it.each(['marketplace', 'services'] as const)('%s: ⛔ the selfie holds no code since 2026-09-04', async (site) => {
    const en = await policy(site)
    expect(en).not.toContain('a selfie holding a one-time code')
    expect(en).toContain('and a selfie, together with the details printed on the document')
    cleanup()
    const vi = await policy(site, 'vi')
    expect(vi).not.toContain('cầm mã dùng một lần')
    expect(vi).toContain('và một ảnh chân dung, cùng các thông tin in trên giấy tờ')
  })

  it.each(['marketplace', 'services'] as const)('%s: ⛔ the score counts a verified identity while it is current — never business verification', async (site) => {
    const en = await policy(site)
    expect(en).toContain('from a verified phone number, a verified identity (while it is current), account age')
    expect(en).toContain('A verified identity also counts toward the account’s trust score for as long as it is current')
    expect(en).not.toContain('business verification, account age')
    // The score is public and its rule is published, so it can show a verified identity — said, not left to infer
    // (commit gate, 2026-10-16: the mark — which the teacher can hide — must not read as the only place it shows).
    expect(en).toContain('so a score can show that an account’s identity is verified even where nothing else says so')
    expect(en).toContain('Whether or not it shows, a verified identity counts toward your trust score, which is public')
    cleanup()
    const vi = await policy(site, 'vi')
    expect(vi).toContain('danh tính đã xác minh (khi còn hiệu lực)')
    expect(vi).toContain('Danh tính đã xác minh còn được tính vào điểm uy tín của tài khoản')
    expect(vi).toContain('nên điểm số có thể cho thấy danh tính của tài khoản đã được xác minh')
    expect(vi).toContain('Dù nhãn có hiển thị hay không, danh tính đã xác minh vẫn được tính vào điểm uy tín của bạn')
  })

  it.each(['marketplace', 'services'] as const)('%s: ⛔ one Vietnamese term for the trust score — "điểm uy tín", never "tín nhiệm"', async (site) => {
    const vi = await policy(site, 'vi')
    expect(vi).not.toMatch(/tín nhiệm/)
    expect(vi).toContain('Điểm uy tín:')
  })

  it.each(['marketplace', 'services'] as const)('%s: ⛔ the AUTOMATIC mark — where, when, never the document, the declaration, the earlier cohort, hiding, the record, its purpose, the carve-out', async (site) => {
    const en = await policy(site)
    for (const s of [
      // the identity paragraph's pointer
      'A teacher’s profile also shows “Identity verified” while their verification is current, unless they hide it (see “Teacher profiles”).',
      // the teacher paragraph: where, when, never the document
      'If you have verified your identity, your profile shows “Identity verified” — on the profile, on your profile’s card wherever it appears in a list, and to the people who message you about your profile —',
      'while your verification is current and the name on your profile matches the name on your verified document; it never shows your document or anything printed on it.',
      // …the consent and its record, and the cohort that never gave it — said, not hidden
      'You agree to this in the declaration you confirm before you upload an identity document, and we keep a record of which version you confirmed, when, and the IP address you confirmed it from.',
      'If your identity was verified under the earlier declaration (used until 16 October 2026), which did not mention “Identity verified”, it shows on the same terms and you can hide it the same way.',
      // …hiding it, before publishing too, and what is recorded
      'You can hide it at any time — before you publish your profile, too — and show it again later.',
      'Whether or not it shows, a verified identity counts toward your trust score',
      'We record when you last hid it, and when you last showed it again together with the version of the words shown beside the switch at that time;',
      'hiding it takes it off your profile, your card and those conversations within a few minutes',
      'You can switch cover lessons off, hide “Identity verified”, hide your profile or delete it at any time from “Teacher profile” in your account.',
      // the purpose — and the cohort again, so "with a teacher’s consent" does not claim it for them
      'With a teacher’s consent, given in the declaration they confirm before uploading an identity document: to show “Identity verified” on their teacher profile, on its card in lists and to the people who message them about it, while their verification is current — they can hide it at any time in the teacher profile.',
      'Teachers whose identity was verified under the earlier declaration (used until 16 October 2026), which did not ask for this, show it on the same terms and can hide it the same way.',
      // ⛔ the general promise carves it out by name — nothing else would have caught that sentence going false
      'each optional use has its own switch, and each is off until you turn it on — except “Identity verified” on a teacher profile: its consent is part of the identity declaration you confirm before uploading, together with the verification itself (an identity verified under the earlier declaration, which did not mention it, shows too — see “Teacher profiles”), so it shows once your identity is verified, and you can hide it at any time (see above);',
    ]) expect(en, s).toContain(s)
    // ⛔ The opt-in (2026-10-15) is gone from every passage: nothing may promise a switch-on the code no longer asks for.
    for (const s of [
      'choose to show “Identity verified”',
      'It is off until you switch it on',
      'We record when you switched it on',
      'switching it off takes it off',
      'switch cover lessons or “Identity verified” off',
      'With a teacher’s consent only, given in the teacher profile with its own switch',
      // the OLD unqualified promise (the carve-out above is pinned positively): nothing may say every use is off until switched on
      'each is off until you turn it on — and withdrawable',
    ]) expect(en, s).not.toContain(s)
    expect(en).not.toMatch(/Verified by eno|Verified teacher|vetted/i)
    cleanup()
    const vi = await policy(site, 'vi')
    for (const s of [
      'Hồ sơ giáo viên cũng hiển thị “Đã xác minh danh tính” trong thời gian kết quả xác minh còn hiệu lực, trừ khi giáo viên ẩn nhãn (xem mục “Hồ sơ giáo viên”).',
      'Nếu bạn đã xác minh danh tính, hồ sơ của bạn hiển thị “Đã xác minh danh tính” — trên hồ sơ, trên thẻ hồ sơ ở mọi danh sách có hồ sơ của bạn, và với những người nhắn tin cho bạn về hồ sơ —',
      'trong thời gian việc xác minh của bạn còn hiệu lực và họ tên trên hồ sơ khớp với họ tên trên giấy tờ đã xác minh; nhãn không bao giờ hiển thị giấy tờ hay bất kỳ thông tin nào in trên đó.',
      'Bạn đồng ý với việc này trong bản cam đoan mà bạn xác nhận trước khi tải giấy tờ tùy thân lên, và chúng tôi lưu bản ghi về phiên bản bạn đã xác nhận, thời điểm xác nhận và địa chỉ IP bạn dùng khi xác nhận.',
      'Nếu danh tính của bạn được xác minh theo bản cam đoan trước đó (dùng đến ngày 16 tháng 10 năm 2026), vốn không đề cập đến nhãn “Đã xác minh danh tính”, nhãn vẫn hiển thị theo cùng điều kiện và bạn có thể ẩn nhãn theo cùng cách.',
      'Bạn có thể ẩn nhãn bất cứ lúc nào — kể cả trước khi đăng hồ sơ — và hiển thị lại sau đó.',
      'Chúng tôi ghi lại thời điểm gần nhất bạn ẩn nhãn, và thời điểm gần nhất bạn hiển thị lại nhãn cùng phiên bản nội dung hiển thị cạnh công tắc lúc đó;',
      'khi bạn ẩn, nhãn được gỡ khỏi hồ sơ, thẻ hồ sơ và các cuộc trò chuyện đó trong vòng vài phút',
      'Bạn có thể tắt dạy thay, ẩn nhãn “Đã xác minh danh tính”, ẩn hoặc xóa hồ sơ bất cứ lúc nào tại mục “Hồ sơ giáo viên” trong tài khoản.',
      'Với sự đồng ý của giáo viên, được đưa ra trong bản cam đoan mà giáo viên xác nhận trước khi tải giấy tờ tùy thân lên: để hiển thị “Đã xác minh danh tính”',
      'Với giáo viên có danh tính được xác minh theo bản cam đoan trước đó (dùng đến ngày 16 tháng 10 năm 2026), vốn không hỏi điều này, nhãn cũng hiển thị theo cùng điều kiện và có thể ẩn theo cùng cách.',
      'mỗi mục tùy chọn có công tắc riêng và đều tắt cho đến khi bạn bật — trừ nhãn “Đã xác minh danh tính” trên hồ sơ giáo viên: sự đồng ý cho nhãn này nằm trong bản cam đoan danh tính mà bạn xác nhận trước khi tải giấy tờ lên, cùng với việc xác minh (danh tính đã được xác minh theo bản cam đoan trước đây, vốn không nhắc đến nhãn này, cũng hiển thị — xem mục “Hồ sơ giáo viên”), nên nhãn hiển thị khi danh tính của bạn đã được xác minh, và bạn có thể ẩn nhãn bất cứ lúc nào (xem ở trên);',
    ]) expect(vi, s).toContain(s)
    for (const s of [
      'chọn hiển thị “Đã xác minh danh tính”',
      'Nhãn này tắt cho đến khi bạn bật',
      'Chúng tôi ghi lại thời điểm bạn bật',
      'tắt dạy thay hoặc nhãn “Đã xác minh danh tính”',
      'Chỉ khi giáo viên đồng ý bằng công tắc riêng trong hồ sơ giáo viên',
      'đều tắt cho đến khi bạn bật — và có thể rút lại',
    ]) expect(vi, s).not.toContain(s)
    expect(vi).not.toMatch(/xác thực/)
  })

  it('⛔ the day the policy gives as the earlier declaration’s last is the day identity-v2 took effect (declaration-text.ts)', async () => {
    // A slipped deploy re-dates identity-v2's `effective` (not hashed) — and this holds the policy's sentence to it, in
    // both languages and both places it is said (the teacher paragraph and the purpose).
    const { DECLARATIONS, CURRENT_DECLARATION } = await import('@/lib/compliance/declaration-text')
    const { dateEn } = await import('@/lib/compliance/legal-amendment')
    expect(CURRENT_DECLARATION).toBe('identity-v2')
    const iso = DECLARATIONS['identity-v2'].effective
    const [y, m, d] = iso.split('-').map(Number)
    const en = await policy('marketplace')
    expect(en.split(`the earlier declaration (used until ${dateEn(iso)})`)).toHaveLength(3)
    cleanup()
    const vi = await policy('marketplace', 'vi')
    expect(vi.split(`bản cam đoan trước đó (dùng đến ngày ${d} tháng ${m} năm ${y})`)).toHaveLength(3)
  })
})

describe('the teacher form\'s own counts (2026-10-16)', () => {
  it('the sign-up counts name the teacher profile form — as a place that asks, and its first step and publishes', async () => {
    for (const site of ['marketplace', 'services'] as const) {
      const text = await policy(site)
      expect(text, site).toContain('posting, the teacher profile form, the header or tab bar')
      expect(text, site).toContain('and for the teacher profile form, how many times its first step was ready to use, answered, and continued — or stopped by a missing answer — and, with each Continue, whether the link that brought you was an ad’s, a Facebook group’s, Zalo’s, another or none;')
      // 2026-10-17: the rest of a new profile's way to Publish, and "Open in your browser" (signup-prompt.ts TEACHER_FORM_EVENTS).
      // 2026-10-22: the required CV — a Publish refused on it is its own count (publish_refused_cv).
      // 2026-10-22 too: the way out first — the screen shown, going on in the app, the arrival (escape_shown/stay/arrived).
      expect(text, site).toContain('how many times each later step was reached, an intro video was chosen, turned down by the check in your browser, could not be prepared or uploaded, or was uploaded, and Publish was tapped, refused for the video, the photo, the CV, the kind of work or another answer, or did not go through; how many times the screen offering your browser instead was shown, “Open in Safari” or “Open in your browser” was tapped, a page then opened in your browser from it, or you chose to go on in the app; and how many new teacher profiles were published')
    }
    expect(await policy('marketplace', 'vi')).toContain('và với biểu mẫu hồ sơ giáo viên: số lần bước đầu tiên sẵn sàng để dùng')
    cleanup()
    expect(await policy('marketplace', 'vi')).toContain('bị từ chối vì video, ảnh, CV, loại công việc hoặc một câu trả lời khác')
    expect(await policy('marketplace', 'vi')).toContain('số lần bấm “Mở bằng Safari” hoặc “Mở bằng trình duyệt”')
    expect(await policy('marketplace', 'vi')).toContain('số lần một trang sau đó mở được trong trình duyệt của bạn, hoặc bạn chọn tiếp tục trong ứng dụng')
  })
})

describe('Continue with Facebook (2026-10-16)', () => {
  it('Meta is named as the recipient, on both editions — never its access token, never its picture, no account without an email', async () => {
    for (const site of ['marketplace', 'services'] as const) {
      const text = await policy(site)
      expect(text, site).toContain('Meta (Continue with Facebook)')
      expect(text, site).toContain('never Facebook’s access token')
      expect(text, site).toContain('we never show or copy your Facebook picture or post anything to Facebook')
      expect(text, site).toContain('If Facebook has no email address for you, no account is created')
      expect(text, site).toContain('Facebook is never added to an account that already exists here')
      expect(text, site).toContain('if you use Continue with Facebook, your name and email address from Facebook')
      expect(text, site).toContain('You can remove eno from your Facebook settings (Apps and websites) at any time, and deleting your eno account deletes what Facebook sent us.')
      // Meta's Platform Terms: an email Facebook gave us never reaches another ad network.
      expect(text, site).toContain('never your email address if you use Sign in with Apple or Continue with Facebook')
    }
    const vi = await policy('marketplace', 'vi')
    expect(vi).toContain('Meta (Tiếp tục với Facebook)')
    expect(vi).toContain('không bao giờ lưu mã truy cập của Facebook')
  })
})

describe('the teacher photo check says what it does (gate review, 2026-10-16)', () => {
  it('Google\'s retention as the Google row puts it, the young-children rule, and the one-time check of photos already up', async () => {
    const text = await policy('marketplace')
    expect(text).not.toContain('Google does not keep the photo')
    expect(text).toContain('Google does not use it to train its AI and keeps it only briefly — for up to 90 days if its automated checks flag the request as misuse')
    expect(text).toContain('or one where only young children can be seen does not')
    expect(text).toContain('and, once, the photos already on teacher profiles')
    const vi = await policy('marketplace', 'vi')
    expect(vi).toContain('hay ảnh chỉ thấy trẻ nhỏ là không đạt')
  })
})
