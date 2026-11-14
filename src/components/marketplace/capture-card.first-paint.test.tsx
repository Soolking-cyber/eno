// @vitest-environment jsdom
/** A VISITOR WITH NO SESSION HAS THE ROW IN THE FIRST PAINT, SO NOTHING UNDER IT MOVES WHEN AUTH SETTLES (speed audit, 2026-11-03). A signed-in reader never meets it. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const auth = vi.hoisted(() => ({ value: { user: null as unknown, loading: true, openSignIn: () => {} } }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth.value, preloadSignIn: () => {} }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

const { CaptureCard } = await import('./capture-card')
const row = (c: HTMLElement) => c.firstElementChild as HTMLElement | null

afterEach(cleanup)

describe('CaptureCard', () => {
  it('while auth loads it is in the HTML, shown only by html.no-session', () => {
    auth.value = { user: null, loading: true, openSignIn: () => {} }
    const { container } = render(<CaptureCard />)
    expect(row(container)?.className).toContain('hidden')
    expect(row(container)?.className).toContain('no-session:flex')
  })
  it('a guest keeps the same row, shown', () => {
    auth.value = { user: null, loading: false, openSignIn: () => {} }
    const { container } = render(<CaptureCard />)
    expect(row(container)?.className).not.toContain('hidden')
    expect(row(container)?.className).toContain('flex')
  })
  it('a signed-in reader has none', () => {
    auth.value = { user: { id: 'u' }, loading: false, openSignIn: () => {} }
    const { container } = render(<CaptureCard />)
    expect(row(container)).toBeNull()
  })

  /** ⛔ A JOB SEEKER IS NOT HUNTING A DEAL (batch 63): in Jobs the card speaks of jobs; everywhere else it is the shop's card. */
  it('in Jobs it speaks to a job seeker; elsewhere it keeps the shop wording', () => {
    auth.value = { user: null, loading: false, openSignIn: () => {} }
    const jobs = render(<CaptureCard jobs />).container.textContent ?? ''
    expect(jobs).toContain('Get new jobs first.')
    expect(jobs).toContain('Save jobs to apply later')
    expect(jobs).toContain('Alerts for new jobs')
    expect(jobs).not.toMatch(/deal|sellers|Price-drop/)
    cleanup()
    const shop = render(<CaptureCard />).container.textContent ?? ''
    expect(shop).toContain('Never miss a deal.')
    expect(shop).toContain('Chat with sellers instantly')
    expect(shop).not.toContain('jobs')
  })
  it('the explorer hands the jobs wording to both of its rows, keyed on the jobs on screen', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/marketplace/listings-explorer.tsx'), 'utf8')
    expect(src).toContain('{index === FIRST_PAGE_SIZE - 1 && jobsRows && <CaptureCard jobs />}')
    // `tight` on the rentals feed's phone (owner-approved 2026-11-14, cook r06 rentals-a), keyed on the one-column rentals grid.
    // …and `panel` on the goods grid's phone (owner-approved 2026-11-15 (build 7), cook r07 goods), keyed on the goods grid.
    expect(src).toContain('{index === FIRST_PAGE_SIZE - 1 && <CaptureCard jobs={jobsOnScreen} tight={rentalsWide} panel={goodsGrid} />}')
    expect(src).not.toMatch(/<CaptureCard \/>/)
  })

  /**
   * ⛔ `tight` (owner-approved 2026-11-14, cook r06 rentals-a — the rentals feed's phone): one line, the title and the house SECONDARY
   * button; the bullets out of the box tree. Below sm only: from sm the row, its bullets and its brand CTA are as before. The
   * button is rendered twice and a class picks one, so each width has ONE in the tab order.
   */
  it('tight: one line on a phone with the outline button; from sm the cta and the bullets as before', () => {
    auth.value = { user: null, loading: false, openSignIn: () => {} }
    const { container } = render(<CaptureCard tight />)
    const r = row(container)!
    expect(r.getAttribute('data-capture-tight')).toBe('true')
    expect(r.className.split(/\s+/)).toEqual(expect.arrayContaining(['max-sm:flex-row', 'max-sm:items-center', 'sm:flex-row']))
    expect(container.querySelector('ul')!.className.split(/\s+/)).toContain('max-sm:hidden')
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons.map((b) => b.textContent)).toEqual(['Join free', 'Join free'])
    expect(buttons[0].className.split(/\s+/)).toContain('max-sm:hidden')
    expect(buttons[1].className.split(/\s+/)).toContain('sm:hidden')
    expect(buttons[1].className).not.toMatch(/\bbg-cta\b/)
    cleanup()
    // Without it: one button, nothing phone-specific.
    const plain = render(<CaptureCard />).container
    expect(plain.querySelectorAll('button')).toHaveLength(1)
    expect(plain.innerHTML).not.toContain('max-sm:hidden')
  })

  /**
   * ⛔ `panel` (owner-approved 2026-11-15 (build 7), cook r07 goods — the goods grid's phone): one field panel, no hairlines.
   * ⛔ ONE CALM ROW since build 8 (owner-approved 2026-11-15, cook r08 goods): the title at the h3 role and "Join free" — still
   * the one brand CTA, sized to its words at 44px — on one line, the bullets out of the box tree, the panel on the 12px gutter.
   * The same words, fewer of them. From sm the row is as before.
   */
  it('panel: one calm row in a field well on a phone — the title and the cta, no bullets; from sm the row as before', () => {
    auth.value = { user: null, loading: false, openSignIn: () => {} }
    const { container } = render(<CaptureCard panel />)
    const r = row(container)!
    expect(r.getAttribute('data-capture-panel')).toBe('true')
    const cls = r.className.split(/\s+/)
    expect(cls).toEqual(expect.arrayContaining(['col-span-full', 'max-sm:mx-2', 'max-sm:flex-row', 'max-sm:flex-wrap', 'max-sm:items-center', 'max-sm:rounded-2xl', 'max-sm:border-0', 'max-sm:bg-tint', 'max-sm:py-3', 'max-sm:pl-4', 'max-sm:pr-3', 'border-t', 'sm:flex-row']))
    expect(cls).not.toContain('max-sm:p-4')
    expect(container.querySelector('p')!.className.split(/\s+/)).toContain('max-sm:text-t-h3')
    // The title's block takes the row; it wraps rather than truncates (a long Vietnamese line).
    expect(container.querySelector('p')!.parentElement!.className.split(/\s+/)).toEqual(expect.arrayContaining(['min-w-0', 'max-sm:flex-1', 'max-sm:min-w-24']))
    expect(container.querySelector('p')!.className).not.toMatch(/\btruncate\b/)
    expect(container.querySelector('ul')!.className.split(/\s+/)).toContain('max-sm:hidden')
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons).toHaveLength(1)
    expect(buttons[0].textContent).toBe('Join free')
    expect(buttons[0].className.split(/\s+/)).toEqual(expect.arrayContaining(['min-h-11', 'max-sm:w-auto', 'max-sm:text-base/5']))
    expect(buttons[0].className).not.toContain('max-sm:min-h-12')
    expect(container.textContent).toContain('Never miss a deal.')
    cleanup()
    // Without it: no panel attribute and no phone well.
    const plain = render(<CaptureCard />).container
    expect(row(plain)!.hasAttribute('data-capture-panel')).toBe(false)
    expect(plain.innerHTML).not.toMatch(/max-sm:(bg-tint|rounded-2xl|mx-2|py-3|w-auto)/)
  })
})
