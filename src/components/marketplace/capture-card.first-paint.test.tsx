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
    expect(src).toContain('{index === FIRST_PAGE_SIZE - 1 && <CaptureCard jobs={jobsOnScreen} tight={rentalsWide} />}')
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
})
