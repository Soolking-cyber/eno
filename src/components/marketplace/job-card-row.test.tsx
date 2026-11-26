// @vitest-environment jsdom
/**
 * ⛔ A JOB IS ONE CARD (owner-approved 2026-11-14, cook r06 jobs — job-card-row.tsx): /c/jobs below sm and a job page's rails.
 * Pinned here: the DOM order (link, role, heart, slot, meta, chat), the role whole (an h3, never clamped), the slot rules the
 * row has always had (employer / pay tag / "Negotiable" / nothing for a linked job with neither), "Urgent hiring" in words,
 * the per-card employer hiding of a job page's own rail, no chat on a linked card, the pending press, and a stale clock that
 * hydrates without a recoverable error.
 */
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/components/ui/icons', () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />
  return { MessageCircle: Icon, Zap: Icon, Heart: Icon, BadgeCheck: Icon, ShieldCheck: Icon }
})
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', t: (k: string) => k, tr: (en: string) => en }),
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('./listing-content', async () => {
  const { RelativeTime } = await import('./relative-time')
  return {
    useLocalized: (t: string) => t,
    PostedAgo: (p: { iso: string; inHtml?: boolean; markFresh?: boolean; className?: string }) => <RelativeTime {...p} />,
  }
})
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('./partner-badge', () => ({ PartnerBadge: () => <span data-partner-chip="" /> }))
vi.mock('./favorite-heart', () => ({ FavoriteHeart: ({ className }: { className?: string }) => <button type="button" aria-pressed="false" aria-label="Save listing" data-heart="" className={className} /> }))
vi.mock('./price', () => ({
  Price: ({ price, linked, className }: { price: number; linked?: boolean; className?: string }) => (
    <span data-price="" data-linked={String(linked)} className={className}>{price > 0 ? `${price} đ / month` : linked === false ? 'Negotiable' : 'Salary: see details'}</span>
  ),
}))
vi.mock('@/lib/quick-contact', () => ({ stashQuickCompose: () => false, quickActionSignIn: () => ({}) }))

import { JobCardRow } from './job-card-row'

const JOB = {
  id: 'j1',
  title: 'Primary PE Teacher — Nord Anglia Education',
  titleVi: null,
  titleI18n: null,
  images: [],
  video: null,
  price: 0,
  currency: '₫',
  priceUnit: 'VND/month',
  listingType: 'job',
  jobType: 'parttime',
  jobEmployer: 'Nord Anglia Education',
  location: 'Hà Nội',
  city: 'Hanoi',
  district: null,
  condition: null,
  savedCount: 0,
  contactCount: 0,
  negotiable: false,
  isPartnerBooking: true,
  isSponsored: false,
  urgent: false,
  prevPrice: null,
  sellerId: 'linked-jobs',
  seller: { trustScore: 100, isBusiness: true, officialPartner: false },
  category: { icon: 'Briefcase', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' },
  postedAt: '2026-11-05T00:00:00.000Z',
} as unknown as SerializedListingCard

const card = (patch: Record<string, unknown> = {}, props: Record<string, unknown> = {}) =>
  render(<JobCardRow listing={{ ...JOB, ...patch } as SerializedListingCard} index={0} onOpen={vi.fn()} onPrefetch={vi.fn()} onLocate={vi.fn()} {...props} />).container
const root = (c: HTMLElement) => c.firstElementChild as HTMLElement
const slot = (c: HTMLElement) => root(c).querySelector(':scope > div.row-start-2') as HTMLElement | null

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('the card', () => {
  it('is one bordered white card under its seller id, with no tile', () => {
    const c = card()
    const cls = root(c).className.split(' ')
    expect(cls).toEqual(expect.arrayContaining(['rounded-2xl', 'border', 'border-line-strong', 'bg-background', 'py-4', 'pl-4', 'pr-1']))
    expect(root(c).getAttribute('data-sid')).toBe('linked-jobs')
    expect(c.querySelector('img')).toBeNull()
  })

  it('DOM order = reading and Tab order: link, role, heart, slot, meta (and the chat last)', () => {
    const own = card({ isPartnerBooking: false, price: 0 })
    const kids = Array.from(root(own).children).map((e) => e.getAttribute('data-row-link') !== null ? 'link' : e.getAttribute('role') === 'heading' ? 'role' : e.hasAttribute('data-heart') ? 'heart' : e.classList.contains('row-start-2') ? 'slot' : e.tagName === 'P' ? 'meta' : e.getAttribute('aria-label') === 'Chat with seller' ? 'chat' : '?')
    expect(kids).toEqual(['link', 'role', 'heart', 'slot', 'meta', 'chat'])
  })

  it('the role is a level-3 heading (role=heading since 2026-11-26), whole: never clamped or truncated, and the link keeps the full title as its name', () => {
    const c = card()
    const h3 = c.querySelector('[role="heading"][aria-level="3"]')!
    expect(h3.textContent).toBe('Primary PE Teacher')
    expect(h3.className).not.toMatch(/line-clamp|truncate/)
    expect(h3.className.split(' ')).toContain('text-t-h3')
    expect(c.querySelector('a[data-row-link]')!.getAttribute('aria-label')).toBe('Primary PE Teacher — Nord Anglia Education')
    // …and its text says the same, so a crawler does not read an empty link (Seobility crawl 7).
    expect(c.querySelector('a[data-row-link]')!.textContent).toBe('Primary PE Teacher — Nord Anglia Education')
  })

  it('the meta line: place · posted · type, wrapping, never truncated', () => {
    const p = card().querySelector('p')!
    expect(p.textContent).toMatch(/^Hanoi · .+ · Part-time$/)
    expect(p.className).not.toMatch(/truncate|line-clamp/)
  })
})

describe('the slot', () => {
  it('a linked job with no figure: the employer, plain body ink', () => {
    const s = slot(card())!
    expect(s.textContent).toBe('Nord Anglia Education')
    expect(s.querySelector('[data-price]')).toBeNull()
    expect(s.firstElementChild!.className.split(' ')).toEqual(expect.arrayContaining(['text-t-card', 'text-body']))
  })

  it('a stated pay: a filled tag, bold — and the title keeps its own words', () => {
    const c = card({ price: 80_000_000 })
    const tag = slot(c)!.querySelector('[data-price]')!.parentElement!
    expect(tag.className.split(' ')).toEqual(expect.arrayContaining(['rounded-lg', 'bg-muted', 'px-2.5', 'py-1']))
    expect(tag.firstElementChild!.className).toContain('font-bold')
    expect(c.querySelector('[role="heading"]')!.textContent).toBe('Primary PE Teacher — Nord Anglia Education')
  })

  it('an employer\'s own job with no figure: <Price>\'s "Negotiable" in the same tag, regular body ink', () => {
    const s = slot(card({ isPartnerBooking: false }))!
    const price = s.querySelector('[data-price]')!
    expect(price.textContent).toBe('Negotiable')
    expect(price.className.split(' ')).toEqual(expect.arrayContaining(['font-normal', 'text-body']))
    expect(price.parentElement!.className).toContain('bg-muted')
  })

  it('⛔ a linked job with neither pay nor employer prints no slot at all', () => {
    expect(slot(card({ jobEmployer: null }))).toBeNull()
  })

  it('"Urgent hiring" in words beside its bolt, after the slot\'s first item', () => {
    const s = slot(card({ urgent: true }))!
    expect(s.textContent).toBe('Nord Anglia EducationUrgent hiring')
    expect(s.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    // …and with no employer either, the flag alone still draws the line.
    expect(slot(card({ urgent: true, jobEmployer: null }))!.textContent).toBe('Urgent hiring')
  })
})

describe('hideEmployerNamed — a job page\'s own rail', () => {
  it('hides only a card whose employer is the page\'s (case, spacing and Unicode form aside)', () => {
    expect(slot(card({}, { hideEmployerNamed: '  nord   ANGLIA education ' }))).toBeNull()
    expect(slot(card({}, { hideEmployerNamed: 'CareerLink.vn' }))!.textContent).toBe('Nord Anglia Education')
  })
  it('keeps the pay and the urgent flag', () => {
    expect(slot(card({ urgent: true }, { hideEmployerNamed: 'Nord Anglia Education' }))!.textContent).toBe('Urgent hiring')
    expect(slot(card({ price: 600_000 }, { hideEmployerNamed: 'Nord Anglia Education' }))!.querySelector('[data-price]')).not.toBeNull()
  })
})

describe('the actions', () => {
  it('no chat on a linked job: there is nobody to message', () => {
    expect(card().querySelector('[aria-label="Chat with seller"]')).toBeNull()
    expect(card({ isPartnerBooking: false }).querySelector('[aria-label="Chat with seller"]')).not.toBeNull()
  })
  it('the heart and the chat are 44px boxes above the card\'s link', () => {
    const c = card({ isPartnerBooking: false })
    for (const el of [c.querySelector('[data-heart]')!, c.querySelector('[aria-label="Chat with seller"]')!]) {
      expect(el.className.split(' ')).toEqual(expect.arrayContaining(['relative', 'z-[2]', 'size-11']))
    }
  })
  it('a tap opens the listing once and holds the press until the next screen (useRowPress)', () => {
    const onOpen = vi.fn()
    const c = render(<JobCardRow listing={JOB} index={0} onOpen={onOpen} onPrefetch={vi.fn()} onLocate={vi.fn()} />).container
    fireEvent.click(root(c))
    fireEvent.click(root(c))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(root(c).hasAttribute('data-pending')).toBe(true)
  })
})

describe('the server HTML and a stale clock', () => {
  it('hydrates without a recoverable error, and marks a posting under a day old after mount', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T06:00:00.000Z')) // 6h old when the page was cached: fresh
    const node = <JobCardRow listing={JOB} index={0} onOpen={vi.fn()} onPrefetch={vi.fn()} onLocate={vi.fn()} clockInHtml />
    const html = renderToString(node)
    expect(html).toContain('data-fresh=""')
    vi.setSystemTime(new Date('2026-11-07T06:00:00.000Z')) // two days later the reader hydrates it: stale
    const host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    const errors: unknown[] = []
    await act(async () => { hydrateRoot(host, node, { onRecoverableError: (e) => errors.push(e) }) })
    expect(errors).toEqual([])
    const time = host.querySelector('time')!
    expect(time.hasAttribute('data-fresh')).toBe(false)
    expect(time.className).toContain('data-fresh:font-bold')
    host.remove()
  })
})
