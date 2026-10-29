// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE CLASSROOM IS WEB-ONLY (owner, 2026-10-29: "Keep it web-only"). In either app — by its user agent, as every app gate
 * on the server — no classroom page renders: the notice, with its way back. A browser gets the classroom as before.
 */
const h = vi.hoisted(() => ({ ua: '', header: 'classroom header', page: 'the practice page' }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': h.ua }) }))
vi.mock('@/components/classroom/classroom-header', () => ({ ClassroomHeader: () => <header>{h.header}</header> }))
vi.mock('next/navigation', () => ({ usePathname: () => window.location.pathname, useSearchParams: () => new URLSearchParams(window.location.search) }))

const { LanguageProvider } = await import('@/context/language-context')
const { default: ClassroomLayout } = await import('./layout')

const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const show = async (ua: string) => {
  h.ua = ua
  window.history.pushState({}, '', '/classroom/join/AB12CD?x=1')
  render(<LanguageProvider>{await ClassroomLayout({ children: <p>{h.page}</p> })}</LanguageProvider>)
}
afterEach(cleanup)

describe('the classroom layout', () => {
  it.each([
    ['the iOS app (build 4, today)', `${BROWSER} EnoNativeApp/1`],
    ['the Android app', 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36 EnoNativeApp/1'],
    ['an app built for the voice guide', `${BROWSER} EnoNativeApp/1 EnoVoice/1`],
  ])('%s: the notice instead of the page, and the way back', async (_n, ua) => {
    await show(ua)
    expect(screen.queryByText('the practice page')).toBeNull()
    expect(screen.getByText('The classroom works in your phone’s browser')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to eno' }).getAttribute('href')).toBe('/')
    // The link the person came by — an invite's code, a report — copyable in the app, to carry into the browser (opus):
    // `allow-select` is the one class html.native's no-selection rule lets back in (globals.css).
    const link = await screen.findByText('localhost:3000/classroom/join/AB12CD?x=1')
    expect(link.className.split(' ')).toContain('allow-select')
    expect(readFileSync('src/app/globals.css', 'utf8')).toMatch(/html\.native \.allow-select \{[^}]*user-select: text;[^}]*-webkit-touch-callout: default;/)
    expect(screen.getByText('classroom header')).toBeTruthy()
  })

  it('a browser: the classroom as before', async () => {
    await show(BROWSER)
    expect(screen.getByText('the practice page')).toBeTruthy()
    expect(screen.queryByText('The classroom works in your phone’s browser')).toBeNull()
  })
})

describe('⛔ every file under the classroom route stays thin and dynamic (its app check hides the pages, but their server code still runs)', () => {
  const ROOT = 'src/app/[lang]/classroom'
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) files.push(p)
    }
  }
  walk(ROOT)

  it.each(files.map((p) => [p]))('%s: no redirect, no 404, no database, no session or header read (but the root layout\'s user agent)', (p) => {
    const src = readFileSync(p, 'utf8')
    expect(src).not.toMatch(/\b(?:permanentR|r)edirect\(|\bnotFound\(|\bdb\.|\bprisma\b|getCurrentProfile|getSession|cookies\(\)|createClient\(/)
    if (p !== join(ROOT, 'layout.tsx')) expect(src).not.toMatch(/headers\(\)/)
  })

  it.each(files.map((p) => [p]))('%s: never static — a static render would read no user agent and show the classroom in the apps', (p) => {
    expect(readFileSync(p, 'utf8')).not.toMatch(/force-static|export const revalidate|generateStaticParams/)
  })

  it('there are files to check, the layout among them', () => {
    expect(files.length).toBeGreaterThanOrEqual(6)
    expect(files).toContain(join(ROOT, 'layout.tsx'))
  })
})
