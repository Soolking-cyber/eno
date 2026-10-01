import { describe, expect, it } from 'vitest'
import { emailThumb, renderWeeklyDigest, track } from './weekly-digest'
import type { DigestContent } from '@/lib/digest'
import { formatMoneyFull } from '@/lib/vnd'

// The digest's copy makes claims about a service (the free rental availability check), so the
// wording is pinned: what it may promise, what it must not, and that every eno link is attributable.
const ORIGIN = 'https://eno.vn'
const home = (id: string) => ({ id, heading: 'Apartment · 2 bed · 1 bath · 64 m²', price: 9_000_000, currency: '₫', image: `https://sb.eno.vn/${id}.webp`, area: 'Binh Thanh District' })
const item = { id: 'esim', title: 'MobiFone Travel eSIM', price: 109_000, currency: '₫', image: null, district: 'Ho Chi Minh City', drop: null, urgent: false, trustScore: 100, category: 'Services' }
const full: DigestContent = {
  homes: [home('a'), home('b'), home('c')],
  homeCounts: { apartments: 2225, houses: 714, rooms: 1876, total: 4815 },
  districts: [{ slug: 'go-vap', label: 'Go Vap District' }, { slug: 'd7', label: 'District 7 (Phu My Hung)' }],
  picks: [item, { ...item, id: 'sofa', title: 'Grey 3-seat sofa', price: 2_500_000, category: 'Home' }],
  sales: [],
}
const render = (content = full, recipientName: string | null = 'Minh Tran') =>
  renderWeeklyDigest({ content, origin: ORIGIN, unsubscribeUrl: `${ORIGIN}/unsubscribe?token=t`, recipientName, siteName: 'eno.vn' })

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))

describe('weekly digest email', () => {
  it('leads with the week’s homes in the subject, counted with thousands separators', () => {
    expect(render().subject).toBe('4,815 homes for rent added to eno.vn this week')
  })

  it('promises only what the availability check does', () => {
    const { html, text } = render()
    for (const body of [html, text]) {
      expect(body).toContain('landlord or agent') // imported rentals often have an agent behind them
      expect(body).toContain('The check is free — no fee, no markup.')
      expect(body).not.toMatch(/message the seller/i) // not how a rental on eno works
      expect(body).not.toMatch(/new to the market|guaranteed|always available/i)
    }
  })

  it('tags every link into the site, and only those', () => {
    const links = hrefs(render().html)
    const site = links.filter((u) => u.startsWith(`${ORIGIN}/listings/`) || u.startsWith(`${ORIGIN}/c/`) || u.startsWith(`${ORIGIN}/post`))
    expect(site.length).toBeGreaterThanOrEqual(3 + 2 + 1 + 2 + 1) // homes, chips, CTA, picks, sell
    for (const u of site) {
      const q = new URL(u).searchParams
      expect(q.get('utm_source'), u).toBe('eno')
      expect(q.get('utm_medium'), u).toBe('email')
      expect(q.get('utm_campaign'), u).toBe('weekly-digest')
      expect(q.get('utm_content'), u).toBeTruthy()
    }
    // The unsubscribe link is not a marketing click and stays exactly as minted.
    expect(links).toContain(`${ORIGIN}/unsubscribe?token=t`)
  })

  it('links each district chip to its /c/rentals page and the CTA to the rentals hub', () => {
    const links = hrefs(render().html)
    expect(links).toContain(track(`${ORIGIN}/c/rentals/go-vap`, 'district-go-vap'))
    expect(links).toContain(track(`${ORIGIN}/c/rentals`, 'cta-check'))
  })

  it('prices homes per month in the house money format', () => {
    expect(render().html).toContain(`${formatMoneyFull(9_000_000, '₫', 'en')} / month`)
  })

  it('greets by first name, and falls back when the name does not look like one', () => {
    expect(render().text.startsWith('Hi Minh,')).toBe(true)
    expect(render(full, 'someone@gmail.com').text.startsWith('Hi there,')).toBe(true)
    expect(render(full, null).text.startsWith('Hi there,')).toBe(true)
  })

  it('shows a free partner product as "Free", not "0 đ"', () => {
    const { html, text } = render({ ...full, picks: [{ ...item, price: 0 }] })
    expect(html).toContain('>Free</div>')
    expect(text).toContain('— Free')
    expect(text).not.toContain(' 0 đ')
  })

  it('shows every photo as a cropped 4:3 JPEG thumbnail from Storage, never the raw WebP', () => {
    const raw = 'https://sb.eno.vn/storage/v1/object/public/listings/affiliate/m/a-768x1024.webp'
    expect(emailThumb(raw)).toBe('https://sb.eno.vn/storage/v1/render/image/public/listings/affiliate/m/a-768x1024.webp?width=300&height=225&resize=cover&quality=80')
    expect(emailThumb('https://example.com/x.jpg')).toBe('https://example.com/x.jpg')
    const html = render({ ...full, homes: [{ ...home('a'), image: raw }] }).html
    expect(html).toContain('/storage/v1/render/image/public/listings/affiliate/m/a-768x1024.webp?width=300&amp;height=225')
    expect(html).not.toContain('src="https://sb.eno.vn/storage/v1/object/public/')
  })

  it('labels every pick with its category, so the variety is visible', () => {
    const { html, text } = render()
    expect(html).toContain('>Services</div>')
    expect(html).toContain('>Home</div>')
    expect(text).toContain('[Home] Grey 3-seat sofa')
  })

  it('opens with the eno.vn wordmark on the marketplace (owner, 2026-09-29)', async () => {
    const { IS_MARKETPLACE } = await import('@/lib/edition')
    const { html } = render()
    expect(html).toContain(IS_MARKETPLACE ? `${ORIGIN}/brand/wordmark-eno-vn.png` : `${ORIGIN}/brand/wordmark-eno-forum.png`)
    expect(html).not.toContain(`${ORIGIN}/logo.png`)
  })

  it('labels picks only — a moving-sales card keeps its old look', () => {
    const { html } = render({ ...full, picks: [], sales: [{ ...item, id: 'sale', category: 'Home', drop: '−20%' }] })
    expect(html).not.toContain('>Home</div>')
  })

  it('escapes listing text', () => {
    const evil = { ...full, homes: [{ ...home('x'), heading: '<script>alert(1)</script>' }] }
    expect(render(evil).html).not.toContain('<script>alert(1)</script>')
  })

  it('makes no weekly count claim when this week added none but older homes fill the cards', () => {
    const quietWeek = { ...full, homeCounts: { apartments: 0, houses: 0, rooms: 0, total: 0 } }
    const { subject, html, text } = render(quietWeek)
    expect(subject).toBe('Homes for rent worth a look on eno.vn')
    for (const body of [subject, html, text]) expect(body).not.toMatch(/\b0 homes?\b/)
  })

  it('pluralises the type counts', () => {
    const { html, text } = render({ ...full, homeCounts: { apartments: 1, houses: 2, rooms: 1, total: 4 } })
    expect(html).toContain('1 apartment · 2 houses · 1 room,')
    expect(text).toContain('(1 apartment, 2 houses, 1 room)')
  })

  // "Partner" means a signed agreement since 2026-10-01 (partner-badge.tsx); the portals hold none (review P2).
  it('calls the portals the homes are linked from listing sites, never partners', () => {
    for (const r of [render(), render({ ...full, homeCounts: { apartments: 0, houses: 0, rooms: 0, total: 0 } })]) {
      // What a reader SEES — HTML comments (the layout's own notes) never render.
      expect(r.html.replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/partner/i)
      expect(r.html).toContain('linked from other property listing sites.')
    }
  })

  it('says how many cards follow instead of a hard-coded six', () => {
    expect(render().html).toContain('Here are three worth a look.')
    expect(render({ ...full, homes: [home('a')] }).html).toContain('Here is one worth a look.')
  })

  it('with no homes it still reads as a digest and keeps a way onward', () => {
    const quiet: DigestContent = { homes: [], homeCounts: { apartments: 0, houses: 0, rooms: 0, total: 0 }, districts: [], picks: [item], sales: [] }
    const { subject, html } = render(quiet)
    expect(subject).toBe("This week on eno.vn — what's new")
    expect(html).not.toContain('availability check')
    expect(hrefs(html)).toContain(track(ORIGIN, 'cta-browse'))
  })
})
