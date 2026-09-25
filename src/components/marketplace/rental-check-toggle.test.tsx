// @vitest-environment jsdom
/**
 * The availability-check toggle lives on every rental card and on the rental PDP. What it must get
 * right, pinned here:
 *   · it exists for rentals only, and never on the viewer's own listing;
 *   · its accessible name is constant and `aria-pressed` carries the state (the save heart's rule);
 *   · a tap on the card chip does NOT reach the card — the media box opens the listing on click;
 *   · the first add of a session says the check is FREE (the owner's copy requirement), and only
 *     the first; a sixth add says "up to 5";
 *   · the PDP button turns into "Added (n/5) · View list", pointing at the list page.
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { push, toast, auth, nav } = vi.hoisted(() => ({
  nav: { pathname: '/c/rentals' },
  push: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  auth: { user: null as unknown, loading: false, sellerId: null as string | null, openSignIn: () => {} },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => nav.pathname }))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/components/ui/icons', () => {
  const icon = (name: string) => (props: React.SVGProps<SVGSVGElement>) => <svg data-icon={name} {...props} />
  return { Check: icon('check'), ClipboardCheck: icon('clipboard-check') }
})
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/lib/haptics', () => ({ hapticTap: vi.fn(), hapticError: vi.fn() }))

import { RentalCheckToggle, rentalFreeLine } from './rental-check-toggle'
import { RentalCheckPill } from './rental-check-pill'
import { __resetRentalCheckStoreForTests, addToBasket, getBasket } from '@/lib/rental-check/store'

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

const FREE = rentalFreeLine((en) => en)
const listing = (n: number, slug = 'rentals', sellerId = 's-other') => ({
  id: `r${n}`,
  sellerId,
  title: `Flat ${n}`,
  titleVi: null,
  images: [`https://photo.example/${n}.jpg`],
  price: 9_000_000,
  currency: 'VND',
  priceUnit: 'VND/month',
  category: { slug },
})

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  __resetRentalCheckStoreForTests()
  auth.sellerId = null
  nav.pathname = '/c/rentals'
  toast.mockClear()
  push.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const chip = () => screen.getByRole('button', { name: 'Check availability' })

describe('card chip', () => {
  it('renders for a rental and not for anything else', () => {
    const { container, rerender } = render(<RentalCheckToggle variant="card" listing={listing(1)} />)
    expect(chip()).toBeTruthy()
    rerender(<RentalCheckToggle variant="card" listing={listing(1, 'motorbikes')} />)
    expect(container.querySelector('[data-rental-check-toggle]')).toBeNull()
  })

  it('is absent on the viewer’s own listing', () => {
    auth.sellerId = 's-mine'
    const { container } = render(<RentalCheckToggle variant="card" listing={listing(1, 'rentals', 's-mine')} />)
    expect(container.querySelector('[data-rental-check-toggle]')).toBeNull()
  })

  it('toggles with a constant name; aria-pressed carries the state; the glyph swaps', () => {
    render(<RentalCheckToggle variant="card" listing={listing(1)} />)
    expect(chip().getAttribute('aria-pressed')).toBe('false')
    expect(chip().querySelector('[data-icon="clipboard-check"]')).toBeTruthy()
    fireEvent.click(chip())
    expect(chip().getAttribute('aria-pressed')).toBe('true')
    expect(chip().querySelector('[data-icon="check"]')).toBeTruthy()
    // aria-pressed trips the global selected-icon rule (accent-blue Bold layer) — on the chip's own
    // brand fill that is an invisible tick unless the glyph opts out with icon-own-ink.
    expect(chip().querySelector('svg')!.getAttribute('class')).toContain('icon-own-ink')
    expect(getBasket().map((i) => i.id)).toEqual(['r1'])
    fireEvent.click(chip())
    expect(chip().getAttribute('aria-pressed')).toBe('false')
    expect(getBasket()).toEqual([])
  })

  it('does not let the tap reach the card (which would open the listing)', () => {
    const openCard = vi.fn()
    render(<div onClick={openCard}><RentalCheckToggle variant="card" listing={listing(1)} /></div>)
    fireEvent.click(chip())
    expect(openCard).not.toHaveBeenCalled()
  })

  it('the first add says it is free — once per session', () => {
    const { rerender } = render(<RentalCheckToggle variant="card" listing={listing(1)} />)
    fireEvent.click(chip())
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][1]).toMatchObject({ description: FREE })
    rerender(<RentalCheckToggle variant="card" listing={listing(2)} />)
    fireEvent.click(chip())
    expect(toast).toHaveBeenCalledTimes(1)
    // Its action goes to the list page.
    toast.mock.calls[0][1].action.onClick()
    expect(push).toHaveBeenCalledWith('/rentals/check')
  })

  it('a sixth add is refused with "up to 5" and leaves the basket alone', () => {
    for (let i = 1; i <= 5; i++) addToBasket(listing(i))
    render(<RentalCheckToggle variant="card" listing={listing(6)} />)
    toast.mockClear()
    fireEvent.click(chip())
    expect(chip().getAttribute('aria-pressed')).toBe('false')
    expect(toast).toHaveBeenCalledWith('Up to 5 at a time', expect.objectContaining({ id: 'rental-check-full' }))
    expect(getBasket()).toHaveLength(5)
  })

  it('follows a change made elsewhere (another card, the list page, another tab)', () => {
    render(<RentalCheckToggle variant="card" listing={listing(1)} />)
    act(() => { addToBasket(listing(1)) })
    expect(chip().getAttribute('aria-pressed')).toBe('true')
  })
})

describe('PDP button', () => {
  it('adds, then becomes "Added (n/5) · View list" pointing at the list; the free line is always there', () => {
    addToBasket(listing(9))
    render(<RentalCheckToggle variant="pdp" listing={listing(1)} />)
    expect(screen.getByText(FREE)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add to free availability check' }))
    const link = screen.getByRole('link', { name: 'Added (2/5) · View list' })
    expect(link.getAttribute('href')).toBe('/rentals/check')
    expect(screen.getByText(FREE)).toBeTruthy()
  })

  it('is absent on the viewer’s own listing and on a non-rental', () => {
    auth.sellerId = 's-mine'
    const a = render(<RentalCheckToggle variant="pdp" listing={listing(1, 'rentals', 's-mine')} />)
    expect(a.container.textContent).toBe('')
    auth.sellerId = null
    const b = render(<RentalCheckToggle variant="pdp" listing={listing(1, 'property')} />)
    expect(b.container.textContent).toBe('')
  })
})

describe('the pill (back-to-top cluster)', () => {
  const pill = () => document.querySelector('[data-rental-check-pill]')

  it('is absent while the basket is empty, and appears with the count and the free line', () => {
    render(<RentalCheckPill />)
    expect(pill()).toBeNull()
    act(() => { addToBasket(listing(1)); addToBasket(listing(2)) })
    expect(pill()?.textContent).toContain('Check 2 rentals')
    expect(pill()?.textContent).toContain('Free · same price as listed')
    expect(pill()?.getAttribute('href')).toBe('/rentals/check')
    act(() => { addToBasket(listing(3)) })
    expect(pill()?.textContent).toContain('Check 3 rentals')
  })

  it('opts back into pointer events — the cluster it sits in is pointer-events:none', () => {
    addToBasket(listing(1))
    render(<RentalCheckPill />)
    expect(pill()?.className).toContain('pointer-events-auto')
    expect(pill()?.textContent).toContain('Check 1 rental')
  })

  it('stands down on the list page it points at', () => {
    addToBasket(listing(1))
    nav.pathname = '/rentals/check'
    render(<RentalCheckPill />)
    expect(pill()).toBeNull()
  })
})
