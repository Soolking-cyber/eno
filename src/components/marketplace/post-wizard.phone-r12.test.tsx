// @vitest-environment jsdom
/**
 * ⛔ /POST ON A PHONE, ROUND 12 (owner-approved 2026-11-16 on the hub, Q22 + Q15's post part: "yes if they are related to
 * visual change"; cook r12 post-r12c, P1 + P2 + P4 + P5 + P8). On a phone in a browser:
 *   · P1 — the wizard's own Exit link and h1 are one fixed 56px task bar (× + the title), the app header and the subtitle
 *     stand down (the `post-bar` variant in globals.css: below 40rem, in a browser, until the success screen);
 *   · P2 — every option chip group but the category grid is one swipe row; the pick comes into view, without ever
 *     scrolling the page; multi-pick still presses several. The pick itself is the selected grey (`line-strong`, an ink
 *     bold label) at EVERY width and in the store apps too — owner, 2026-11-17: "Grey everywhere" → "Yes, follow it" for
 *     /post; it was the 11-16 ink fill on a phone and the 09-27 blue elsewhere, so it is the one P2 look not on `post-bar`;
 *   · P4 — solid photo tiles and one counter line built from the page's own counts; the hint and the video sentence stay
 *     in #pw-photo-hint, sr-only, so the grid's aria-describedby still reads them;
 *   · P5 — "Needed" hidden (✓ kept), the price type a segmented control, the Urgent hint one line, a guest's Contact said once;
 *   · P8 — filled borderless fields, a full-width price, counters under the field.
 * ⛔ EVERY ONE OF THEM RIDES THE `post-bar` VARIANT (below 40rem, in a browser, html:not(.native)), NEVER `max-sm`, so the
 * store apps keep today's form whole (review, 2026-11-16); and only what the owner saw on the stills ships — the For sale /
 * For rent radios and the signed-in contact fields are untouched, and the ✕ is the bare one.
 * CSS does not run in jsdom, so the phone half is read from the classes each node carries (and the variant's own definition
 * in globals.css); the behaviour half — every control still there and still working — runs for real.
 */
import { readFileSync } from 'node:fs'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { renderToString } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListingEditData } from './post-wizard'
import type { SerializedCategory } from '@/lib/types'

const h = vi.hoisted(() => ({
  router: { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} },
  language: {
    lang: 'en',
    t: (k: string) => k,
    tr: ((en: string) => en) as (en: string, vi?: string) => string,
    setLang: () => {},
  },
  auth: { user: null as { id: string } | null, profile: null, loading: false, openSignIn: () => {} },
}))

vi.mock('next/navigation', () => ({ useRouter: () => h.router, usePathname: () => '/post', useSearchParams: () => new URLSearchParams() }))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => h.language,
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth }))
vi.mock('@/context/currency-context', () => ({
  vndPerUsd: () => null,
  useCurrency: () => ({ currency: 'VND', rates: null, ratesPending: false, format: (n: number) => String(n) }),
}))
// react-easy-crop's stylesheet cannot load under the test transform; the dialog renders nothing here.
vi.mock('./square-crop-dialog', () => ({ SquareCropDialog: () => null }))

const { PostWizard } = await import('./post-wizard')
const { Chips, PHONE_FIELD, PHONE_FIELD_LINE, FIELD_INVALID } = await import('./post-wizard-parts')
const { VI_OVERRIDES } = await import('@/generated/vi-overrides')

const cat = (slug: string, name: string, icon = 'Package') => ({ id: `c-${slug}`, slug, name, nameVi: name, icon, color: 'blue' })
const CATS = [
  cat('baby-kids', 'Baby & kids'), cat('electronics', 'Electronics'), cat('fashion-beauty', 'Fashion & beauty'),
  cat('furniture-appliances', 'Furniture & appliances'), cat('jobs', 'Jobs'), cat('moving-sale', 'Moving sale'),
  cat('pets', 'Pets'), cat('property', 'Property'), cat('rentals', 'Rentals'), cat('services', 'Services'), cat('vehicles', 'Vehicles'),
] as unknown as SerializedCategory[]

/** A phone listed for sale on the edit screen — every specific answered, so its chip rows each hold a pick. */
const phoneEdit: ListingEditData = {
  id: 'l1', title: 'iPhone 14 128GB, battery 92%', description: 'Always in a case, no scratches, box and cable included.',
  price: 12_000_000, negotiable: true, urgent: false, categorySlug: 'electronics', subcategorySlug: 'phones-tablets', listingType: 'sell',
  condition: 'used', brand: 'Apple', model: 'iPhone 14', attributes: {}, year: null, mileageKm: null, engineL: null, engineCc: null,
  areaM2: null, salaryM: null, district: 'Quận 1', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
}

const doc = (edit?: ListingEditData) => new DOMParser().parseFromString(renderToString(<PostWizard categories={CATS} edit={edit} />), 'text/html')
const classes = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/)

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  } as Storage
}

beforeEach(() => {
  Element.prototype.scrollIntoView = function () {}
  window.scrollTo = (() => {}) as typeof window.scrollTo
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  h.auth.user = null
  h.language.lang = 'en'
  h.language.tr = (en: string) => en
})

describe('P1 — the phone task bar', () => {
  it('the post-bar variant is below 40rem, in a browser, and stands down on the success screen', () => {
    const css = readFileSync('src/app/globals.css', 'utf8')
    expect(css).toMatch(/@custom-variant post-bar \{ @media \(width < 40rem\) \{ &:is\(html:not\(\.native\):not\(\[data-post-done\]\) \*\) \{ @slot; \} \} \}/)
  })

  it('the Exit link and the h1 ARE the bar: fixed, 56px (+ the status-bar inset), the hairline under it', () => {
    const bar = doc().querySelector('[data-post-bar]')!
    for (const c of ['post-bar:fixed', 'post-bar:inset-x-0', 'post-bar:top-0', 'post-bar:z-40', 'post-bar:flex', 'post-bar:h-[calc(3.5rem+env(safe-area-inset-top))]', 'post-bar:pt-[env(safe-area-inset-top)]', 'post-bar:bg-background', 'post-bar:shadow-[inset_0_-1px_0_var(--color-border)]'])
      expect(classes(bar), c).toContain(c)
    // The SAME two nodes at every width — nothing re-created, one Exit and one h1.
    expect(bar.children).toHaveLength(2)
    const [exit, h1] = [...bar.children]
    expect(exit.tagName).toBe('A')
    expect(h1.tagName).toBe('H1')
    expect(h1.textContent).toBe('Create a listing')
    expect(doc().querySelectorAll('h1')).toHaveLength(1)
  })

  it('× is a 44px target whose name stays "Exit" — the word is sr-only on a phone, the chevron gives way to the ✕', () => {
    const exit = doc().querySelector('[data-post-bar] > a')!
    for (const c of ['post-bar:size-11', 'post-bar:justify-center', 'post-bar:rounded-full', 'post-bar:text-foreground', 'tap-44', 'relative']) expect(classes(exit), c).toContain(c)
    const word = [...exit.querySelectorAll('span')].find((s) => s.textContent === 'Exit')!
    expect(classes(word)).toContain('post-bar:sr-only')
    const svgs = [...exit.querySelectorAll('svg')]
    expect(svgs).toHaveLength(2)
    expect(classes(svgs[0])).toContain('post-bar:hidden') // the chevron, from sm up
    expect(classes(svgs[1])).toEqual(expect.arrayContaining(['hidden', 'size-6', 'post-bar:block'])) // the ✕, phone only
    // ⛔ the BARE ✕ the stills show (XBare: two Solar bars crossed), never `X` — the ringed close-circle the dialogs draw
    expect(svgs[1].getAttribute('aria-hidden')).toBe('true')
    expect([...svgs[1].querySelectorAll('use')].map((u) => u.getAttribute('href')?.split('#')[1])).toEqual(['XBare-r', 'XBare-o'])
  })

  it('the h1 keeps the heading ramp and is 17px, centred, on one line in the bar', () => {
    const h1 = doc().querySelector('[data-post-bar] > h1')!
    for (const c of ['h-display', 'post-bar:absolute', 'post-bar:inset-x-14', 'post-bar:bottom-0', 'post-bar:mt-0', 'post-bar:h-14', 'post-bar:truncate', 'post-bar:text-center', 'post-bar:[--text-display:var(--text-t-h3)]', 'post-bar:leading-14!', 'post-bar:tracking-[-0.01em]!'])
      expect(classes(h1), c).toContain(c)
    // ⛔ the size the canon's way (docs/design-language.md §1, the /c/* precedent): the variable re-pointed, never a text-* size;
    // and no weight utility — font-semibold IS 700 in this family (globals.css), which .h-display already paints
    expect(classes(h1).filter((c) => /^post-bar:(text-t-|font-)/.test(c))).toEqual([])
  })

  it('the subtitle goes on a phone, and the form starts at <main>\'s reserve', () => {
    const d = doc()
    const sub = [...d.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Fill in the sections below'))!
    expect(classes(sub)).toContain('post-bar:hidden')
    const grid = d.querySelector('[data-post-bar] ~ div.grid')!
    expect(classes(grid)).toEqual(expect.arrayContaining(['mt-8', 'post-bar:mt-0']))
  })

  it('an edit gets the same bar with its own title', () => {
    h.auth.user = { id: 'u1' }
    expect(doc(phoneEdit).querySelector('[data-post-bar] > h1')?.textContent).toBe('Edit listing')
  })

  it('both post-flow pages pad <main> for the bar, and so does the /post skeleton', () => {
    for (const f of ['src/app/[lang]/post/page.tsx', 'src/app/[lang]/listings/[id]/edit/page.tsx', 'src/app/[lang]/post/loading.tsx'])
      expect(readFileSync(f, 'utf8'), f).toContain('post-bar:pt-[calc(4.75rem+env(safe-area-inset-top))]')
  })

  it('a live render: Exit is still a link named "Exit" to home, and the title is the page\'s one h1', () => {
    render(<PostWizard categories={CATS} />)
    expect(screen.getByRole('link', { name: 'Exit' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Create a listing')
  })
})

describe('P2 — option chips: one swipe row each on a phone, the pick in the selected grey (owner 2026-11-17, "Grey everywhere")', () => {
  const SWIPE = ['post-bar:-mx-3', 'post-bar:max-w-none', 'post-bar:flex-nowrap', 'post-bar:overflow-x-auto', 'post-bar:px-3', 'post-bar:py-1']

  it('every chip row in the form swipes; the category grid alone keeps wrapping', () => {
    h.auth.user = { id: 'u1' }
    const d = doc(phoneEdit)
    const rows = [...d.querySelectorAll('[data-chip-row]')]
    // Condition, Warranty, Colour and the optional electronics specs — at least the three required ones.
    expect(rows.length).toBeGreaterThanOrEqual(3)
    for (const row of rows) {
      expect(classes(row)).toEqual(expect.arrayContaining(SWIPE))
      // whole chips: each keeps its width and the row scrolls
      for (const b of row.querySelectorAll('button')) expect(classes(b)).toContain('post-bar:shrink-0')
    }
    const grid = doc().querySelector('[data-category-grid]')!
    expect(classes(grid)).toContain('flex-wrap')
    expect(classes(grid).some((c) => c.includes('nowrap') || c.includes('overflow'))).toBe(false)
  })

  // ⛔ The pick's own classes, gone at every width (owner, 2026-11-17, "Grey everywhere"): the 09-27 blue fill and white label,
  // the 11-16 ink pick on a phone (hub Q15), and the 11-17 first pass that greyed the phone alone. No pick class rides a variant.
  const OLD_PICK = ['bg-primary', 'text-white', 'post-bar:bg-foreground', 'post-bar:text-background', 'post-bar:bg-line-strong', 'post-bar:text-foreground', 'post-bar:font-bold']

  it('a picked chip is the selected grey with an ink 14/700 label at every width and in the apps, never blue or the ink fill', () => {
    h.auth.user = { id: 'u1' }
    const picked = [...doc(phoneEdit).querySelectorAll('[data-chip-row] button[aria-pressed="true"]')].find((b) => b.textContent === 'Used')!
    expect(picked).toBeTruthy()
    expect(classes(picked)).toEqual(expect.arrayContaining(['bg-line-strong', 'text-foreground', 'font-bold', 'text-sm', 'icon-own-ink', 'post-bar:shrink-0']))
    for (const c of OLD_PICK) expect(classes(picked), c).not.toContain(c)
    // the bold pick replaces the resting semibold (tailwind-merge keeps one weight)
    expect(classes(picked)).not.toContain('font-semibold')
    const resting = doc(phoneEdit).querySelector('[data-chip-row] button[aria-pressed="false"]')!
    expect(classes(resting)).toEqual(expect.arrayContaining(['bg-tint', 'text-body', 'font-semibold']))
    for (const c of ['bg-line-strong', 'font-bold', 'text-foreground']) expect(classes(resting), c).not.toContain(c)
  })

  it('a pick in the category grid is the selected grey at every width too, glyph in ink (so dark mode keeps it visible)', () => {
    render(<PostWizard categories={CATS} />)
    fireEvent.click(screen.getByRole('button', { name: /Change|Electronics/ }))
    // Picking folds the grid; "Change" reopens it with the pick showing.
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    const chip = document.querySelector('[data-category-grid] [data-cat-slug="electronics"]')!
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(classes(chip)).toEqual(expect.arrayContaining(['bg-line-strong', 'font-bold', 'text-foreground', 'icon-own-ink']))
    for (const c of OLD_PICK) expect(classes(chip), c).not.toContain(c)
    // CategoryIcon's outer node carries the caller's className (h-4 w-4 …)
    const glyph = [...chip.querySelectorAll('*')].find((n) => classes(n).includes('h-4'))!
    expect(classes(glyph)).toContain('text-foreground')
    for (const c of ['text-white', 'post-bar:text-foreground', 'post-bar:text-background']) expect(classes(glyph), c).not.toContain(c)
    // a resting grid chip is not the pick's grey
    const resting = document.querySelector('[data-category-grid] [data-cat-slug="rentals"]')!
    expect(resting.getAttribute('aria-pressed')).toBe('false')
    expect(classes(resting)).toEqual(expect.arrayContaining(['bg-tint', 'text-body']))
    expect(classes(resting)).not.toContain('bg-line-strong')
    const restingGlyph = [...resting.querySelectorAll('*')].find((n) => classes(n).includes('h-4'))!
    expect(classes(restingGlyph)).toContain('text-body')
  })
})

describe('P2 — bringing the pick into its row', () => {
  /** A 390px row of 140px chips, 150px apart: c0 at 0, c5 at 750–890. jsdom has no layout, so the geometry is stubbed. */
  function stubRow() {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-chip-row') ? 900 : 0 })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-chip-row') ? 390 : 0 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const i = [...(this.parentElement?.children ?? [])].indexOf(this)
      const box = this.hasAttribute('data-chip-row') ? { left: 0, right: 390 } : { left: i * 150, right: i * 150 + 140 }
      return { ...box, top: 0, bottom: 40, width: box.right - box.left, height: 40, x: box.left, y: 0, toJSON: () => ({}) } as DOMRect
    })
    const scrollTo = vi.fn()
    HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof HTMLElement.prototype.scrollTo
    const intoView = vi.fn()
    Element.prototype.scrollIntoView = intoView
    const pageScroll = vi.fn()
    window.scrollTo = pageScroll as unknown as typeof window.scrollTo
    return { scrollTo, intoView, pageScroll }
  }
  const OPTIONS = Array.from({ length: 6 }, (_, i) => ({ value: `c${i}`, label: `Chip ${i}` }))

  function Single({ start }: { start: string }) {
    const [v, setV] = useState(start)
    return <Chips options={OPTIONS} value={v} onPick={(x) => setV((p) => (p === x ? '' : x))} />
  }
  function Multi({ start }: { start: string[] }) {
    const [v, setV] = useState<string[]>(start)
    return <Chips options={OPTIONS} value={v} onPick={(x) => setV((p) => (p.includes(x) ? p.filter((y) => y !== x) : [...p, x]))} />
  }

  it('a pick past the edge is scrolled in on mount — instantly, by the row alone, stopping 12px short of the edge', () => {
    const s = stubRow()
    render(<Single start="c5" />)
    expect(s.scrollTo).toHaveBeenCalledWith({ left: 890 - 390 + 12, behavior: 'instant' })
    expect(s.intoView).not.toHaveBeenCalled()
    expect(s.pageScroll).not.toHaveBeenCalled()
  })

  it('a new single pick comes into view (smoothly unless motion is reduced); one already in view moves nothing', () => {
    const s = stubRow()
    render(<Single start="c1" />)
    expect(s.scrollTo).not.toHaveBeenCalled() // c1 (150–290) is in view
    fireEvent.click(screen.getByRole('button', { name: 'Chip 4' }))
    expect(screen.getByRole('button', { name: 'Chip 4' }).getAttribute('aria-pressed')).toBe('true')
    expect(s.scrollTo).toHaveBeenLastCalledWith({ left: 740 - 390 + 12, behavior: 'smooth' })
    expect(s.pageScroll).not.toHaveBeenCalled()
  })

  it('a row with nothing to scroll (it wraps, from sm up) is never scrolled', () => {
    const s = stubRow()
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(390)
    render(<Single start="c5" />)
    expect(s.scrollTo).not.toHaveBeenCalled()
  })

  it('multi-pick still presses several chips at once, and a tap brings the chip tapped into view', async () => {
    const s = stubRow()
    render(<Multi start={['c0']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Chip 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Chip 4' }))
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))) })
    const pressed = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)
    expect(pressed).toEqual(['Chip 0', 'Chip 2', 'Chip 4'])
    expect(s.scrollTo).toHaveBeenLastCalledWith({ left: 740 - 390 + 12, behavior: 'smooth' })
    // …and un-pressing one keeps the others.
    fireEvent.click(screen.getByRole('button', { name: 'Chip 2' }))
    expect(screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toEqual(['Chip 0', 'Chip 4'])
  })
})

describe('P4 — solid photo tiles and one counter line', () => {
  const counter = (d: Document) => d.querySelector('[data-photo-counter]')

  it('before a category: "0/6 photos · 0/1 video · the first is your cover", phone browser only, 13px, aria-hidden', () => {
    const c = counter(doc())!
    expect(c.textContent).toBe('0/6 photos · 0/1 video · the first is your cover')
    expect(classes(c)).toEqual(expect.arrayContaining(['text-t-meta', 'text-ink-4', 'hidden', 'post-bar:block']))
    // ⛔ aria-hidden, as the mock had it: every word of it is in #pw-photo-hint already, so a screen reader reading on
    // would otherwise hear "the first is your cover" twice
    expect(c.getAttribute('aria-hidden')).toBe('true')
  })

  it('adds "· at least N" once the category asks for photos — goods 3, services 1 — and nothing for a job', () => {
    render(<PostWizard categories={CATS} />)
    fireEvent.click(screen.getByRole('button', { name: /Electronics/ }))
    expect(document.querySelector('[data-photo-counter]')?.textContent).toBe('0/6 photos · 0/1 video · the first is your cover · at least 3')
    cleanup()
    render(<PostWizard categories={CATS} />)
    fireEvent.click(screen.getByRole('button', { name: /Services/ }))
    expect(document.querySelector('[data-photo-counter]')?.textContent).toBe('0/6 photos · 0/1 video · the first is your cover · at least 1')
    cleanup()
    render(<PostWizard categories={CATS} />)
    fireEvent.click(screen.getByRole('button', { name: /Jobs/ }))
    expect(document.querySelector('[data-photo-counter]')?.textContent).toBe('0/6 photos · 0/1 video · the first is your cover')
  })

  it('the hint and the video sentence stay in #pw-photo-hint, sr-only on a phone, and the grid is still described by it', () => {
    const d = doc()
    const hint = d.getElementById('pw-photo-hint')!
    expect(classes(hint)).toContain('post-bar:sr-only')
    expect(hint.textContent).toContain('Up to 6 photos. The first is your cover. The minimum depends on the category you pick below.')
    expect(hint.textContent).toContain('A video (optional) plays on your listing card and in the Video tab.')
    // the hint's copy in #pw-photo-hint is phone-browser-only, so from sm up and in the apps it is not read twice
    expect(classes(hint.querySelector('span'))).toEqual(expect.arrayContaining(['hidden', 'post-bar:inline']))
    expect(d.querySelector('[role="group"][aria-label="Photos"]')?.getAttribute('aria-describedby')).toBe('pw-photo-hint')
    // …and the visible hint under the heading goes on a phone
    const sectionHint = [...d.querySelectorAll('#pw-photo p')].find((p) => p !== hint && p.textContent?.startsWith('Up to 6 photos'))!
    expect(classes(sectionHint)).toContain('post-bar:hidden')
  })

  it('⛔ the phone drops the unmeasured "far more views" claim (P4); from sm up and in the apps the hint is as it was', () => {
    const phoneCopy = () => document.querySelector('#pw-photo-hint > span')?.textContent?.trim()
    const sectionHint = () => [...document.querySelectorAll('#pw-photo p')].find((p) => p.id !== 'pw-photo-hint' && !p.hasAttribute('data-photo-counter') && /cover/i.test(p.textContent ?? ''))?.textContent
    render(<PostWizard categories={CATS} />)
    fireEvent.click(screen.getByRole('button', { name: /Electronics/ }))
    expect(phoneCopy()).toBe('At least 3 photos from different angles, up to 6. The first is your cover.')
    expect(sectionHint()).toBe('At least 3 photos from different angles, up to 6. The first is your cover. Listings with more photos get far more views.')
    cleanup()
    render(<PostWizard categories={CATS} />)
    fireEvent.click(screen.getByRole('button', { name: /Services/ }))
    expect(phoneCopy()).toBe('One photo is enough, up to 6. The first is your cover. More are optional.')
    expect(sectionHint()).toContain('far more views')
    expect(document.getElementById('pw-photo-hint')!.textContent).not.toContain('far more views')
  })

  it('the empty tiles are solid on a phone: field grey, no dashed edge, 16px corner, 28px glyph, 15/600 label, the small line sr-only', () => {
    const d = doc()
    const tiles = [...d.querySelectorAll('#pw-photo label')]
    expect(tiles.map((l) => l.querySelector('span')?.textContent)).toEqual(['Add', 'Add video'])
    for (const tile of tiles) {
      expect(classes(tile)).toEqual(expect.arrayContaining(['post-bar:rounded-2xl', 'post-bar:border-0', 'post-bar:bg-tint', 'post-bar:text-ink-3', 'post-bar:active:bg-line-strong', 'border-dashed']))
      expect(classes(tile.querySelector('svg'))).toContain('post-bar:size-7')
      const [label, small] = [...tile.querySelectorAll(':scope > span')]
      expect(classes(label)).toEqual(expect.arrayContaining(['post-bar:text-t-card', 'post-bar:font-semibold', 'post-bar:text-foreground']))
      // sr-only only on a phone in a browser — the store apps keep the second line
      expect(classes(small)).toContain('post-bar:sr-only')
      expect(classes(small).some((c) => c.startsWith('max-sm:') || c === 'sr-only')).toBe(false)
      // the file input is still there (parity)
      expect(tile.querySelector('input[type="file"]')).not.toBeNull()
    }
  })

  it('⛔ a real photo or video tile keeps the photo corner on a phone (rounded-media, design-language §2), never the card tier', () => {
    // No photo or video in a server render, so their class strings are read from the file.
    const src = readFileSync('src/components/marketplace/post-wizard-sections.tsx', 'utf8')
    const photo = src.match(/'group relative aspect-square cursor-move[^']*'/)?.[0]
    const video = src.match(/"group relative h-full w-full overflow-hidden[^"]*bg-black[^"]*"/)?.[0]
    for (const cls of [photo, video]) {
      expect(cls).toBeTruthy()
      expect(cls).toContain('post-bar:rounded-media')
      expect(cls).not.toMatch(/rounded-2xl/)
    }
  })

  it('Vietnamese: the counter line is the curated twin, and vi-overrides carries every new string', () => {
    h.language.lang = 'vi'
    h.language.tr = (en: string, vi?: string) => vi ?? en
    expect(counter(doc())?.textContent).toBe('0/6 ảnh · 0/1 video · ảnh đầu là ảnh bìa')
    expect(VI_OVERRIDES['{photos}/6 photos · {videos}/1 video · the first is your cover']).toBe('{photos}/6 ảnh · {videos}/1 video · ảnh đầu là ảnh bìa')
    expect(VI_OVERRIDES['{photos}/6 photos · {videos}/1 video · the first is your cover · at least {min}']).toBe('{photos}/6 ảnh · {videos}/1 video · ảnh đầu là ảnh bìa · tối thiểu {min}')
    expect(VI_OVERRIDES['Highlighted for 7 days.']).toBe('Nổi bật 7 ngày.')
    expect(VI_OVERRIDES['Sign in when you publish. Your number stays private until you reply.']).toBe('Đăng nhập khi bạn đăng tin. Số điện thoại của bạn được giữ kín cho đến khi bạn trả lời.')
    expect(VI_OVERRIDES['One photo is enough, up to 6. The first is your cover. More are optional.']).toBe('Cần 1 ảnh, tối đa 6. Ảnh đầu là ảnh bìa. Thêm ảnh là tuỳ chọn.')
    expect(VI_OVERRIDES['At least 3 photos from different angles, up to 6. The first is your cover.']).toBe('Tối thiểu 3 ảnh từ các góc khác nhau, tối đa 6. Ảnh đầu là ảnh bìa.')
  })
})

describe('P5 — the copy diet', () => {
  it('"Needed" is hidden on a phone; the ✓ is not', () => {
    render(<PostWizard categories={CATS} />)
    const mark = () => screen.getByRole('heading', { level: 2, name: 'Category' }).parentElement!
    const needed = [...mark().querySelectorAll('span')].find((s) => s.textContent === 'Needed' && !s.children.length)!
    expect(classes(needed)).toContain('post-bar:hidden')
    fireEvent.click(screen.getByRole('button', { name: /Electronics/ }))
    const done = [...mark().querySelectorAll('span')].find((s) => s.textContent === 'Done')!.parentElement!
    expect(classes(done).some((c) => c.includes('hidden'))).toBe(false)
  })

  it('Negotiable / Fixed price is a 44px segmented track on a phone, labels only — still two working toggles', () => {
    render(<PostWizard categories={CATS} />)
    const group = screen.getByRole('group', { name: 'Price type' })
    expect(classes(group)).toEqual(expect.arrayContaining(['post-bar:h-11', 'post-bar:max-w-none', 'post-bar:gap-0', 'post-bar:rounded-xl', 'post-bar:bg-tint', 'post-bar:p-1']))
    const [neg, fixed] = [...group.querySelectorAll('button')]
    expect(classes(neg)).toEqual(expect.arrayContaining(['post-bar:bg-background', 'post-bar:shadow-sm', 'tap-44', 'relative']))
    // From sm up and in the apps the pick is the selected grey with an ink label, never the blue fill (owner 2026-11-17).
    expect(classes(neg)).toEqual(expect.arrayContaining(['bg-line-strong', 'text-foreground']))
    expect(classes(neg)).not.toContain('bg-primary')
    expect(classes(neg)).not.toContain('text-white')
    expect(classes(fixed)).toEqual(expect.arrayContaining(['post-bar:bg-transparent', 'post-bar:text-ink-3']))
    // the hints are sr-only, so each stays part of its button's name
    for (const b of [neg, fixed]) expect(classes(b.querySelector('span'))).toContain('post-bar:sr-only')
    expect(neg.textContent).toBe('NegotiableBuyers can send offers')
    // behaviour unchanged: Fixed price presses, and turns Urgent off
    const urgent = screen.getByRole('switch', { name: 'Urgent sale' })
    fireEvent.click(urgent)
    expect(urgent.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(fixed)
    expect(fixed.getAttribute('aria-pressed')).toBe('true')
    expect(neg.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('switch', { name: 'Urgent sale' }).getAttribute('aria-checked')).toBe('false')
  })

  it('the Urgent hint is "Highlighted for 7 days." on a phone; the long one from sm up; the switch is described by the hint', () => {
    render(<PostWizard categories={CATS} />)
    const hint = document.getElementById('pw-urgent-hint')!
    const [long, short] = [...hint.querySelectorAll('span')]
    expect(long.textContent).toBe('Highlighted for 7 days — sell fast, open to offers')
    expect(classes(long)).toContain('post-bar:hidden')
    expect(short.textContent).toBe('Highlighted for 7 days.')
    expect(classes(short)).toEqual(expect.arrayContaining(['hidden', 'post-bar:inline']))
    expect(classes(hint)).toContain('post-bar:text-t-meta')
    expect(screen.getByRole('switch', { name: 'Urgent sale' }).getAttribute('aria-describedby')).toBe('pw-urgent-hint')
  })

  it('a job\'s Urgent hiring row takes the same one-line hint', () => {
    render(<PostWizard categories={CATS} />)
    fireEvent.click(screen.getByRole('button', { name: /Jobs/ }))
    const short = [...document.getElementById('pw-urgent-hint')!.querySelectorAll('span')][1]
    expect(short.textContent).toBe('Highlighted for 7 days.')
  })

  it('a guest\'s Contact is said once on a phone, in one 13px muted line with no em dash', async () => {
    // a guest's /api/me answers { user: null } — then the Contact section renders its guest copy
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).startsWith('/api/me') ? { ok: true, json: async () => ({ user: null }) } : new Promise(() => {}))))
    render(<PostWizard categories={CATS} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    const line = document.querySelector('#pw-contact [data-phone-hint]')!
    expect(line.textContent).toBe('Sign in when you publish. Your number stays private until you reply.')
    expect(line.textContent).not.toContain('—')
    expect(classes(line)).toEqual(expect.arrayContaining(['text-t-meta', 'text-muted-foreground', 'hidden', 'post-bar:block']))
    const contact = document.getElementById('pw-contact')!
    const long = [...contact.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Your name comes from your account'))!
    expect(classes(long)).toContain('post-bar:hidden')
    const hint = [...contact.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Your number stays private —'))!
    expect(classes(hint)).toContain('post-bar:hidden')
  })

  it('⛔ the guest line sits where every section hint does: in the heading block, mt-0.5 under the h2 (as Category\'s)', async () => {
    // In the section body it sat under Section's space-y-3, 12px below the heading; the stills put it 2px under it.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).startsWith('/api/me') ? { ok: true, json: async () => ({ user: null }) } : new Promise(() => {}))))
    render(<PostWizard categories={CATS} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    const line = document.querySelector('#pw-contact [data-phone-hint]')!
    const heading = screen.getByRole('heading', { level: 2, name: 'Contact' })
    const block = line.parentElement!
    expect(block.parentElement?.id).toBe('pw-contact')
    expect(block.contains(heading)).toBe(true)
    expect(classes(line)).toContain('mt-0.5')
    const category = screen.getByRole('heading', { level: 2, name: 'Category' })
    const catHint = [...category.closest('section')!.querySelectorAll(':scope > div > p')][0]
    expect(classes(catHint)).toContain('mt-0.5')
  })

  it('⛔ the subtitle and the guest\'s Contact line are one variant apart, never both: subtitle `post-bar:hidden`, line `hidden post-bar:block`', async () => {
    // The apps (html.native) never match post-bar: they show the subtitle and never the line. A phone browser shows the
    // line and never the subtitle; sm up, the subtitle. A `max-sm` on either side would show both in the apps.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).startsWith('/api/me') ? { ok: true, json: async () => ({ user: null }) } : new Promise(() => {}))))
    render(<PostWizard categories={CATS} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    const sub = [...document.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Fill in the sections below'))!
    expect(sub.textContent).toContain('sign-in comes last')
    const line = document.querySelector('#pw-contact [data-phone-hint]')!
    expect(classes(sub)).toContain('post-bar:hidden')
    expect(classes(sub).filter((c) => /^(max-sm:|sm:)/.test(c))).toEqual([])
    expect(classes(line).filter((c) => /^(hidden|block|post-bar:block|post-bar:hidden|max-sm:.*|sm:.*)$/.test(c)).sort()).toEqual(['hidden', 'post-bar:block'])
  })

  it('a signed-in seller\'s Contact hint is left as it is (no guest line, nothing hidden)', () => {
    h.auth.user = { id: 'u1' }
    const d = doc(phoneEdit)
    expect(d.querySelector('#pw-contact [data-phone-hint]')).toBeNull()
    const hint = [...d.querySelectorAll('#pw-contact p')].find((p) => p.textContent?.startsWith('Your number stays private —'))!
    expect(classes(hint).filter((c) => c.endsWith(':hidden'))).toEqual([])
  })
})

describe('P8 — filled, borderless fields; full-width price; counters under the field', () => {
  it('the phone field look: no edge, the solid brand focus ring, 52px single-line fields', () => {
    expect(PHONE_FIELD).toBe('post-bar:shadow-none post-bar:focus:ring-2 post-bar:focus:ring-brand')
    // An invalid phone field stays red when focused: in one cn() the invalid ring's focus colour replaces the brand one.
    const merged = cn('max-w-2xl', PHONE_FIELD_LINE, FIELD_INVALID).split(' ')
    expect(merged).toContain('post-bar:focus:ring-destructive/60')
    expect(merged).not.toContain('post-bar:focus:ring-brand')
    expect(PHONE_FIELD_LINE).toBe(`${PHONE_FIELD} post-bar:h-13`)
    render(<PostWizard categories={CATS} />)
    // ⛔ the landmine: the title's id stays exactly pw-title, on the <input> itself, and its label still names it
    const title = document.getElementById('pw-title')!
    expect(title.tagName).toBe('INPUT')
    expect(screen.getByLabelText('Title')).toBe(title)
    expect(classes(title)).toEqual(expect.arrayContaining(PHONE_FIELD_LINE.split(' ')))
    expect(classes(document.querySelector('#pw-description textarea'))).toEqual(expect.arrayContaining(PHONE_FIELD.split(' ')))
    const price = document.getElementById('pw-price-input')!
    expect(classes(price)).toEqual(expect.arrayContaining(PHONE_FIELD_LINE.split(' ')))
    // full width on a phone, with its đ suffix still inside the field
    expect(classes(document.querySelector('#pw-price div.max-w-xs'))).toContain('post-bar:max-w-none')
    expect(price.parentElement?.textContent).toContain('đ')
  })

  it('the title counter sits under the field, right-aligned at 13px, on a phone; the label row keeps only the label', () => {
    render(<PostWizard categories={CATS} />)
    const title = document.getElementById('pw-title')!
    const root = title.closest('[class*="post-bar:grid"]')!
    expect(classes(root)).toEqual(expect.arrayContaining(['post-bar:grid', 'post-bar:grid-cols-[minmax(0,1fr)_auto]', 'post-bar:gap-x-3']))
    const count = [...root.querySelectorAll('span')].find((s) => s.textContent === '0/140')!
    expect(classes(count)).toEqual(expect.arrayContaining(['post-bar:row-start-3', 'post-bar:col-start-2', 'post-bar:justify-self-end', 'post-bar:text-t-meta', 'text-ink-4']))
    expect(classes(count.parentElement)).toContain('post-bar:contents')
    // the control's wrapper is `contents` wherever post-bar does not match (sm up, the apps), a grid cell where it does
    // (a flex column there, not a block: a block cell gave the textarea a 6px line-box gap under it)
    expect(classes(title.parentElement)).toEqual(expect.arrayContaining(['contents', 'post-bar:col-span-2', 'post-bar:row-start-2', 'post-bar:flex', 'post-bar:flex-col']))
  })

  it('the description: hint and counter share the row under the field', () => {
    render(<PostWizard categories={CATS} />)
    const field = document.getElementById('pw-description')!
    const count = [...field.querySelectorAll('span')].find((s) => s.textContent?.startsWith('Min. 20 characters'))!
    expect(classes(count)).toEqual(expect.arrayContaining(['post-bar:row-start-3', 'post-bar:col-start-2']))
    const hint = [...field.querySelectorAll('p, div')].find((p) => p.textContent?.startsWith('Condition, why'))!
    expect(classes(hint)).toEqual(expect.arrayContaining(['post-bar:row-start-3', 'post-bar:col-start-1']))
  })

  it('a field with no counter keeps today\'s flex column (no grid)', () => {
    h.auth.user = { id: 'u1' }
    const d = doc(phoneEdit)
    // the Brand field: label, a combobox, a hint, no counter
    const brand = [...d.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Brand'))!.closest('div[class*="flex-col"]')!
    expect(classes(brand).some((c) => c.startsWith('post-bar:grid') || c.startsWith('max-sm:grid'))).toBe(false)
  })

  it('⛔ the signed-in contact name and phone keep ui/input\'s look — P8 names title, description and price only', async () => {
    h.auth.user = { id: 'u1' }
    // an account with no name and no phone: both fields render as inputs
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).startsWith('/api/me') ? { ok: true, json: async () => ({ user: { id: 'u1' }, profile: { name: '', phone: '' } }) } : new Promise(() => {}))))
    render(<PostWizard categories={CATS} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    const name = screen.queryByLabelText('Your name')
    const phone = document.getElementById('pw-contactPhone')
    expect(name ?? phone).not.toBeNull()
    for (const el of [name, phone].filter(Boolean)) {
      expect(classes(el).filter((c) => c.startsWith('post-bar:') || c.startsWith('max-sm:'))).toEqual([])
    }
  })
})

describe('parity — every control a guest had on /post is still there', () => {
  it('Exit, the category grid, photos + video inputs, title, description, price + its unit chips, price type, Urgent, area, locate, Publish', () => {
    render(<PostWizard categories={CATS} />)
    expect(screen.getByRole('link', { name: 'Exit' })).toBeTruthy()
    for (const c of ['Electronics', 'Rentals', 'Jobs', 'Services', 'More…']) expect(screen.getByRole('button', { name: new RegExp(c) })).toBeTruthy()
    expect(document.querySelectorAll('#pw-photo input[type="file"]')).toHaveLength(2)
    expect(screen.getByLabelText('Title')).toBeTruthy()
    expect(screen.getByLabelText('Description')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Price' })).toBeTruthy()
    for (const f of ['×1,000', '×1,000,000', '×1,000,000,000']) expect(screen.getByRole('button', { name: f })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Negotiable/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Fixed price/ })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Urgent sale' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Set area/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use my current location' })).toBeTruthy()
    expect(screen.getAllByRole('button').some((b) => /Add photos/.test(b.textContent ?? ''))).toBe(true)
  })

  it('⛔ a rentable sale category keeps its For sale / For rent radios as they were, but the pick is ui/segmented\'s white pill, not blue (owner 2026-11-17, "Grey everywhere" → /post "Yes, follow it")', () => {
    render(<PostWizard categories={CATS} />)
    fireEvent.click(screen.getByRole('button', { name: /Vehicles/ }))
    const group = screen.getByRole('radiogroup', { name: 'For sale or for rent?' })
    expect(group.getAttribute('class')).toBe('inline-flex rounded-xl bg-tint p-1')
    const sale = screen.getByRole('radio', { name: 'For sale' })
    expect(sale.getAttribute('aria-checked')).toBe('true')
    // WELL_PICK: the white pill with its shadow, one step up with no shadow in dark (the canvas is darker than the track there).
    expect(classes(sale)).toEqual(expect.arrayContaining(['rounded-lg', 'px-4', 'py-1.5', 'text-sm', 'font-bold', 'bg-background', 'text-foreground', 'shadow-sm', 'dark:bg-line-strong', 'dark:shadow-none']))
    expect(classes(sale)).not.toContain('bg-primary')
    expect(classes(sale)).not.toContain('text-white')
    for (const r of [sale, screen.getByRole('radio', { name: 'For rent' })])
      expect(classes(r).filter((c) => c.startsWith('post-bar:') || c.startsWith('max-sm:') || c === 'tap-44')).toEqual([])
    expect(classes(screen.getByRole('radio', { name: 'For rent' }))).toEqual(expect.arrayContaining(['text-body', 'hover:text-foreground']))
  })

  it('⛔ the store apps keep today\'s form: no r12 phone change in the wizard rides `max-sm`, only `post-bar`', () => {
    for (const f of ['src/components/marketplace/post-wizard.tsx', 'src/components/marketplace/post-wizard-parts.tsx', 'src/components/marketplace/post-wizard-sections.tsx', 'src/app/[lang]/post/loading.tsx'])
      expect(readFileSync(f, 'utf8').match(/max-sm:[\w\[\]()/.,%#-]+/g) ?? [], f).toEqual([])
    // and nothing the batch shows only on a phone is keyed to the bare width (sm:hidden) either
    for (const f of ['src/components/marketplace/post-wizard-parts.tsx', 'src/components/marketplace/post-wizard-sections.tsx'])
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/["' ]sm:(hidden|contents)\b/)
  })
})
