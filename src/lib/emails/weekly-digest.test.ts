import { describe, expect, it } from 'vitest'
import { emailThumb, renderWeeklyDigest, track } from './weekly-digest'
import type { DigestContent } from '@/lib/digest'
import { formatMoneyFull } from '@/lib/vnd'

// The digest (owner, 2026-10-15) is the 2 newest apartments + the 2 newest teachers + a sell prompt.
// These pin the subject, the card copy, link attribution, image cropping, escaping, and the greeting.
const ORIGIN = 'https://eno.vn'
const apt = (id: string, o: Partial<DigestContent['apartments'][number]> = {}) =>
  ({ id, heading: 'Apartment · 2 bed · 1 bath · 64 m²', price: 9_000_000, currency: '₫', image: `https://sb.eno.vn/${id}.webp`, area: 'Binh Thanh District', ...o })
const tchr = (id: string, o: Partial<DigestContent['teachers'][number]> = {}) =>
  ({ id, name: 'Jane Doe', headline: 'IELTS 8.0 · 5 yrs', image: `https://sb.eno.vn/${id}.webp`, ...o })
const full: DigestContent = { apartments: [apt('a'), apt('b')], teachers: [tchr('t1'), tchr('t2')] }
const render = (content = full, recipientName: string | null = 'Minh Tran') =>
  renderWeeklyDigest({ content, origin: ORIGIN, unsubscribeUrl: `${ORIGIN}/unsubscribe?token=t`, recipientName, siteName: 'eno.vn' })

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))

describe('weekly digest email', () => {
  it('subject names the two counts', () => {
    expect(render().subject).toBe('2 new apartments & 2 new teachers on eno.vn this week')
    expect(render({ apartments: [apt('a')], teachers: [] }).subject).toBe('1 new apartment on eno.vn this week')
    expect(render({ apartments: [], teachers: [] }).subject).toBe("What's new on eno.vn this week")
  })

  it('renders an apartment card: monthly price, heading, area, link', () => {
    const { html, text } = render()
    expect(html).toContain(`${formatMoneyFull(9_000_000, '₫', 'en')} / month`)
    expect(html).toContain('Apartment · 2 bed · 1 bath · 64 m²')
    expect(html).toContain('Binh Thanh District')
    expect(html).toContain('View apartment →')
    expect(text).toContain('/ month — Apartment · 2 bed · 1 bath · 64 m², Binh Thanh District')
  })

  it('renders a teacher card: name, headline, profile link', () => {
    const { html, text } = render()
    expect(html).toContain('Jane Doe')
    expect(html).toContain('IELTS 8.0 · 5 yrs')
    expect(html).toContain('View profile →')
    expect(text).toContain('• Jane Doe — IELTS 8.0 · 5 yrs')
  })

  it('asks for second-hand items with a free-to-post CTA to /post', () => {
    const { html, text } = render()
    expect(html).toContain('Have second-hand items to sell?')
    expect(html).toContain('Post an item for sale')
    expect(hrefs(html)).toContain(track(`${ORIGIN}/post`, 'sell'))
    expect(text).toContain(`Have second-hand items to sell? List them free on eno.vn: ${track(`${ORIGIN}/post`, 'sell')}`)
  })

  it('tags every link into the site with UTMs, and leaves unsubscribe untagged', () => {
    const links = hrefs(render().html)
    const site = links.filter((u) => u.startsWith(`${ORIGIN}/listings/`) || u.startsWith(`${ORIGIN}/post`))
    expect(site.length).toBe(2 + 2 + 1) // 2 apartments, 2 teachers, 1 sell
    for (const u of site) {
      const q = new URL(u).searchParams
      expect(q.get('utm_source'), u).toBe('eno')
      expect(q.get('utm_medium'), u).toBe('email')
      expect(q.get('utm_campaign'), u).toBe('weekly-digest')
      expect(q.get('utm_content'), u).toBeTruthy()
    }
    expect(links).toContain(`${ORIGIN}/unsubscribe?token=t`)
  })

  it('shows photos as cropped 4:3 JPEG thumbnails from Storage, never the raw WebP', () => {
    const raw = 'https://sb.eno.vn/storage/v1/object/public/listings/affiliate/m/a-768x1024.webp'
    expect(emailThumb(raw)).toBe('https://sb.eno.vn/storage/v1/render/image/public/listings/affiliate/m/a-768x1024.webp?width=300&height=225&resize=cover&quality=80')
    expect(emailThumb('https://example.com/x.jpg')).toBe('https://example.com/x.jpg')
    const html = render({ apartments: [apt('a', { image: raw })], teachers: [] }).html
    expect(html).toContain('/storage/v1/render/image/public/listings/affiliate/m/a-768x1024.webp?width=300&amp;height=225')
    expect(html).not.toContain('src="https://sb.eno.vn/storage/v1/object/public/')
  })

  it('greets by first name, falling back when the name is not name-like', () => {
    expect(render().text.startsWith('Hi Minh,')).toBe(true)
    expect(render(full, 'someone@gmail.com').text.startsWith('Hi there,')).toBe(true)
    expect(render(full, null).text.startsWith('Hi there,')).toBe(true)
  })

  it('escapes listing + teacher text', () => {
    const html = render({ apartments: [apt('x', { heading: '<script>alert(1)</script>' })], teachers: [tchr('y', { name: '<b>x</b>' })] }).html
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<b>x</b>')
  })

  it('opens with the edition wordmark, never the plain logo', async () => {
    const { IS_MARKETPLACE } = await import('@/lib/edition')
    const { html } = render()
    expect(html).toContain(IS_MARKETPLACE ? `${ORIGIN}/brand/wordmark-eno-vn.png` : `${ORIGIN}/brand/wordmark-eno-forum.png`)
    expect(html).not.toContain(`${ORIGIN}/logo.png`)
  })

  it('omits a section with no cards, and the hero names only what is present', () => {
    const noTeachers = render({ apartments: [apt('a')], teachers: [] })
    expect(noTeachers.html).toContain('New apartments this week')
    expect(noTeachers.html).not.toContain('New teachers this week')
    expect(noTeachers.html).toContain('The newest apartments added to eno.vn this week.')
    const noApts = render({ apartments: [], teachers: [tchr('t1')] })
    expect(noApts.html).not.toContain('New apartments this week')
    expect(noApts.html).toContain('New teachers this week')
    expect(noApts.html).toContain('The newest teachers added to eno.vn this week.')
  })
})
