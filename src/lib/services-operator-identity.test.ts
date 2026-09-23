import { afterEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { GeneratedItineraryResponse } from '@/lib/itinerary-data'
import type { SavedItineraryDocxInput } from '@/lib/itinerary-docx'
import type { DigestItem } from '@/lib/digest'

/**
 * ⛔ eno.forum MAY NOT SPEAK AS THE LICENSED MARKETPLACE — pinned across every email and the Word export.
 *
 * Công ty TNHH ENO (eno.vn) is the licensed Vietnamese sàn TMĐT and may not offer e-visa, itinerary or
 * PayPal services; eno.forum does (src/lib/site-legal.ts explains why the forum must never borrow that
 * company's identity). Until 2026-09-23 the forum build nonetheless:
 *   · closed EVERY email with "Công ty TNHH ENO · … · support@eno.vn / eno.vn — …" (emails/layout.ts);
 *   · delivered the finished e-Visa "thank you for trusting eno.vn … write to support@eno.vn";
 *   · mailed forum sign-ins "Sign in to eno.vn";
 *   · printed an itinerary headed "eno.vn", footed "www.eno.vn", with the concierge at support@eno.vn.
 * Each is the licensed company named in writing as the provider or the contact for a service it is
 * not licensed to sell. No lint could see it: every string was a literal inside a template.
 *
 * ⚠️ THE EDITION IS SWITCHED FOR REAL, NOT MOCKED. `vi.stubEnv` + `vi.resetModules` re-evaluates the
 * real src/lib/edition.ts and src/lib/site-legal.ts, so what is measured is what each build would
 * send — including the marketplace, whose output must NOT change (asserted at the bottom).
 *
 * ⚠️ A LINK THAT POINTS *AT* eno.vn IS NOT THE LEAK. The itinerary's "eno Travel Marketplace" entry
 * links to eno.vn's travel category as a disclosed sibling-site link; that one target is allowed, and
 * only as a hyperlink target, never as visible text or a contact.
 */

const FORBIDDEN = ['eno.vn', 'Công ty TNHH ENO', 'ENO Company Limited', 'support@eno.vn'] as const
/** The one eno.vn URL the itinerary may carry: a disclosed link to the sibling marketplace. */
const DISCLOSED_MARKETPLACE_LINK = 'https://eno.vn/?category=tickets-travel'
const FORUM_ORIGIN = 'https://www.eno.forum'

afterEach(() => {
  vi.unstubAllEnvs()
})

async function loadEdition(edition: 'marketplace' | 'services') {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  const [ed, legal, layout, visa, link, code, digest, biz, idv, docx] = await Promise.all([
    import('@/lib/edition'),
    import('@/lib/site-legal'),
    import('@/lib/emails/layout'),
    import('@/lib/emails/visa-result'),
    import('@/lib/emails/sign-in-link'),
    import('@/lib/emails/sign-in-code'),
    import('@/lib/emails/weekly-digest'),
    import('@/lib/emails/business-verification'),
    import('@/lib/emails/identity-verification'),
    import('@/lib/itinerary-docx'),
  ])
  return { ed, legal, layout, visa, link, code, digest, biz, idv, docx }
}

function expectClean(label: string, value: string) {
  for (const word of FORBIDDEN) {
    expect(value, `${label} names "${word}" on the services edition`).not.toContain(word)
  }
}

const item: DigestItem = {
  id: 'l1', title: 'Sofa', price: 1_000_000, currency: 'VND', image: null, district: 'D1', drop: '-10%', urgent: false, trustScore: 80,
}

const activity = (title: string) => ({
  time: '09:00', title, place: 'Old Quarter', details: 'Walk', travelMinutes: 10, estimatedCostVnd: 100_000, bookingAdvice: 'Book early',
})

const liveItinerary: GeneratedItineraryResponse = {
  plan: {
    title: 'Hanoi weekend', summary: 'Two days', routeSummary: 'Hanoi', routeRationale: 'Compact',
    budget: { perTravelerLowVnd: 1_000_000, perTravelerHighVnd: 2_000_000, groupLowVnd: 2_000_000, groupHighVnd: 4_000_000, flightsIncluded: false, note: 'n' },
    routeLegs: [{ from: 'Hanoi', to: 'Ha Long', mode: 'Bus', duration: '3h', advice: 'a' }],
    flights: [{
      direction: 'outbound', label: 'Out', route: 'SGN-HAN', airlines: ['VN'], date: '2026-10-01', departureWindow: 'AM',
      duration: '2h', stops: 0, priceLowVnd: 1, priceHighVnd: 2, fareNote: 'f', url: 'https://example.com/f',
    }],
    stays: [{ city: 'Hanoi', name: 'Hotel', area: 'HK', category: 'hotel', why: 'w', nightlyLowVnd: 1, nightlyHighVnd: 2, url: 'https://example.com/s' }],
    days: [{
      dayNumber: 1, date: '2026-10-01', city: 'Hanoi', title: 'Day one', focus: 'f', paceNote: 'p',
      morning: activity('m'), afternoon: activity('a'), evening: activity('e'), foodNote: 'pho', estimatedDailyCostVnd: 500_000,
    }],
    practical: { arrival: 'a', localTransport: 'l', connectivity: 'c', money: 'm', weather: 'w', safety: 's' },
    bookingChecklist: [{ when: 'now', item: 'i', reason: 'r' }],
    assumptions: ['x'],
  },
  model: 'm',
  generatedAt: '2026-09-01T00:00:00Z',
  sources: [{ title: 'Src', url: 'https://example.com/src', domain: 'example.com' }],
  searchQueries: [],
}

const savedItinerary: SavedItineraryDocxInput = {
  title: 'Saved trip', destinationLabel: 'Hanoi', days: 2, estimatedBudget: 3_000_000, interests: ['food'], updatedAt: '2026-09-01',
  dayPlans: [{
    dayNumber: 1, area: 'HK', areaVi: null, title: 'D1', titleVi: null,
    morning: 'm', morningVi: null, afternoon: 'a', afternoonVi: null, evening: 'e', eveningVi: null,
  }],
  stays: [{ name: 'Hotel', nameVi: null, area: 'HK', areaVi: null, note: 'n', noteVi: null, estimatedNightly: 1_000_000 }],
}

/** Every part of the .docx, split into what a reader SEES and where its hyperlinks POINT. */
async function readDocx(blob: Blob) {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const xml = (path: string) => (files[path] ? strFromU8(files[path]) : '')
  const visibleParts = Object.keys(files).filter((p) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(p))
  expect(visibleParts).toContain('word/document.xml')
  expect(visibleParts.some((p) => p.startsWith('word/header'))).toBe(true)
  expect(visibleParts.some((p) => p.startsWith('word/footer'))).toBe(true)
  const textOf = (s: string) => [...s.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')
  const headers = visibleParts.filter((p) => p.includes('header')).map((p) => textOf(xml(p))).join('\n')
  const footers = visibleParts.filter((p) => p.includes('footer')).map((p) => textOf(xml(p))).join('\n')
  const body = textOf(xml('word/document.xml'))
  const targets = [...xml('word/_rels/document.xml.rels').matchAll(/Target="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
  return { headers, footers, body, targets, core: xml('docProps/core.xml') }
}

describe('services edition — no email names the licensed marketplace', () => {
  it('the shared email footer prints no company block, only this site and its own inbox', async () => {
    const { layout } = await loadEdition('services')
    for (const audienceNote of [undefined, 'You are receiving this because…']) {
      const html = layout.renderBrandEmail({ preheader: 'p', bodyHtml: '', origin: FORUM_ORIGIN, audienceNote, unsubscribeUrl: `${FORUM_ORIGIN}/u` })
      expectClean('email layout', html)
      expect(html).toContain('eno.forum · support@eno.forum')
      expect(html).toContain('alt="eno.forum"')
    }
  })

  it('the finished e-Visa email names eno.forum and support@eno.forum, in both languages', async () => {
    const { ed, legal, visa } = await loadEdition('services')
    for (const locale of ['en', 'vi'] as const) {
      // Rendered exactly as src/lib/visa/result.ts calls it — visa/result.test.ts pins that wiring.
      const m = visa.renderVisaResultEmail({
        givenName: 'Minh', reference: 'EV-1042', origin: FORUM_ORIGIN, locale, siteName: ed.SITE_NAME, supportEmail: legal.COMPANY.email,
      })
      const all = `${m.subject}\n${m.html}\n${m.text}`
      expectClean(`visa result (${locale})`, all)
      expect(all).toContain('support@eno.forum')
      expect(m.text).toMatch(/eno\.forum/)
    }
  })

  it('sign-in links and codes name the site the visitor is actually on', async () => {
    const { ed, link, code } = await loadEdition('services')
    for (const lang of ['en', 'vi'] as const) {
      for (const mode of ['signin', 'signup'] as const) {
        const l = link.renderSignInEmail({ url: `${FORUM_ORIGIN}/auth/confirm?t=1`, origin: FORUM_ORIGIN, email: 'a@b.co', lang, mode, siteName: ed.SITE_NAME })
        const c = code.renderSignInCodeEmail({ code: '007302', origin: FORUM_ORIGIN, email: 'a@b.co', lang, mode, siteName: ed.SITE_NAME })
        for (const [kind, m] of [['link', l], ['code', c]] as const) {
          expectClean(`sign-in ${kind} (${lang}/${mode})`, `${m.subject}\n${m.html}\n${m.text}`)
          expect(m.subject, `sign-in ${kind} (${lang}/${mode})`).toContain('eno.forum')
        }
      }
    }
  })

  it('the digest and both verification outcomes stay on eno.forum too', async () => {
    const { ed, digest, biz, idv } = await loadEdition('services')
    const site = ed.SITE_NAME
    const outs = [
      digest.renderWeeklyDigest({ top: [item, item], sales: [item], origin: FORUM_ORIGIN, unsubscribeUrl: `${FORUM_ORIGIN}/u`, recipientName: 'Minh', siteName: site }),
      digest.renderWeeklyDigest({ top: [item], sales: [], origin: FORUM_ORIGIN, unsubscribeUrl: `${FORUM_ORIGIN}/u`, siteName: site }),
      ...(['approved', 'rejected'] as const).flatMap((outcome) => (['en', 'vi'] as const).flatMap((lang) => [
        biz.renderVerificationOutcomeEmail({ outcome, note: 'n', lang, origin: FORUM_ORIGIN, siteName: site }),
        idv.renderIdentityOutcomeEmail({ outcome, reason: null, note: 'n', tier: 'B', lang, origin: FORUM_ORIGIN, siteName: site }),
      ])),
    ]
    outs.forEach((m, i) => expectClean(`email #${i}`, `${m.subject}\n${m.html}\n${m.text}`))
  })
})

describe('services edition — the itinerary Word export', () => {
  const renders = [
    ['live', (docx: Awaited<ReturnType<typeof loadEdition>>['docx'], lang: 'en' | 'vi') => docx.createItineraryDocx(liveItinerary, 2, lang)],
    ['saved', (docx: Awaited<ReturnType<typeof loadEdition>>['docx'], lang: 'en' | 'vi') => docx.createSavedItineraryDocx(savedItinerary, lang)],
  ] as const

  for (const [name, render] of renders) {
    it(`${name}: header, footer, cover and concierge contact are eno.forum's — en and vi`, async () => {
      const { docx } = await loadEdition('services')
      for (const lang of ['en', 'vi'] as const) {
        const { blob } = await render(docx, lang)
        const d = await readDocx(blob)
        const label = `${name} docx (${lang})`

        // Everything a reader sees.
        expectClean(`${label} header`, d.headers)
        expectClean(`${label} footer`, d.footers)
        expectClean(`${label} body`, d.body)
        expectClean(`${label} document properties`, d.core)
        expect(d.headers).toContain('eno.forum')
        expect(d.footers).toContain('www.eno.forum')
        expect(d.body).toContain('eno.forum  /  ') // the cover wordmark
        expect(d.body).toContain('support@eno.forum') // the concierge callout

        // Everything a link points at: never eno.vn's inbox, and eno.vn only as the one disclosed link.
        expect(d.targets.some((t) => t.startsWith('mailto:support@eno.forum'))).toBe(true)
        for (const t of d.targets) {
          expect(t, `${label} links to the licensed marketplace's inbox`).not.toContain('support@eno.vn')
          if (/\/\/(www\.)?eno\.vn\b/.test(t)) expect(t, `${label} undisclosed eno.vn link`).toBe(DISCLOSED_MARKETPLACE_LINK)
        }
      }
    })
  }
})

describe('marketplace edition — unchanged', () => {
  it('still prints the licensed operator block at the foot of every email, byte for byte', async () => {
    const { layout } = await loadEdition('marketplace')
    const html = layout.renderBrandEmail({ preheader: 'p', bodyHtml: '', origin: 'https://eno.vn' })
    expect(html).toContain(
      "Công ty TNHH ENO · TP. Hồ Chí Minh, Việt Nam · support@eno.vn<br/>\n          eno.vn — Vietnam's trusted marketplace for the international community.",
    )
    expect(html).not.toContain('eno.forum')
  })

  it('still names eno.vn in its own sign-in mail', async () => {
    const { ed, link } = await loadEdition('marketplace')
    const m = link.renderSignInEmail({ url: 'https://eno.vn/auth/confirm?t=1', origin: 'https://eno.vn', email: 'a@b.co', siteName: ed.SITE_NAME })
    expect(m.subject).toBe('Your sign-in link for eno.vn')
    expect(m.html).not.toContain('eno.forum')
  })
})
