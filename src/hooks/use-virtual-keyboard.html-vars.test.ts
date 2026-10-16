// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ NOTHING IS WRITTEN ON <html> WHILE THE KEYBOARD IS CLOSED (speed plan item 7, 2026-10-16).
 *
 * A custom property set on <html> is inherited by every element, so each write restyles the whole document. The
 * mount-time sync used to write `--vvt: 0px` / `--kb-h: 0px` over their CSS defaults on every page — a 146–173 ms style
 * recalc on the mid-phone lab — and the same writes ran on every frame of iOS Safari's toolbar collapse while scrolling.
 * Closed is the resting state the CSS already describes (`var(--vvt, 0px)`, `:root { --kb-h: 0px }`, `var(--vvh,
 * 100dvh)`), so the three are SET while open and REMOVED once on close.
 */

type Listener = () => void
const vvListeners: Record<string, Listener[]> = {}
const vv = { height: 900, offsetTop: 0, addEventListener: (t: string, fn: Listener) => { (vvListeners[t] ??= []).push(fn) }, removeEventListener: () => {} }
const fire = (t: string) => (vvListeners[t] ?? []).forEach((fn) => fn())
const htmlStyle = () => document.documentElement.getAttribute('style') ?? ''

beforeEach(() => {
  vi.resetModules()
  for (const k of Object.keys(vvListeners)) delete vvListeners[k]
  vv.height = 900
  vv.offsetTop = 0
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
  // rAF runs at once, so the initial sync and each viewport event apply synchronously.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  document.documentElement.removeAttribute('style')
  document.documentElement.className = ''
  document.body.innerHTML = '<input id="f" type="text">'
})
afterEach(() => { vi.unstubAllGlobals() })

describe('the keyboard variables on <html>', () => {
  it('⛔ mounting with the keyboard closed writes nothing — no inline style at all', async () => {
    const { ensureKeyboardWired } = await import('./use-virtual-keyboard')
    ensureKeyboardWired()
    expect(htmlStyle()).toBe('')
    expect(document.documentElement.classList.contains('kb-open')).toBe(false)
  })

  it('⛔ scrolling with the keyboard closed (iOS toolbar collapse) writes nothing either', async () => {
    const { ensureKeyboardWired } = await import('./use-virtual-keyboard')
    ensureKeyboardWired()
    for (const h of [880, 860, 760, 900]) { vv.height = h; fire('resize'); fire('scroll') }
    expect(htmlStyle()).toBe('')
  })

  it('a value left on <html> before this module ran (Fast Refresh, another writer) is removed by the next closed sync', async () => {
    document.documentElement.style.setProperty('--kb-h', '312px')
    const { ensureKeyboardWired } = await import('./use-virtual-keyboard')
    ensureKeyboardWired()
    expect(htmlStyle()).toBe('')
  })

  it('sets all three while the keyboard is open, and removes them once it closes', async () => {
    const { ensureKeyboardWired } = await import('./use-virtual-keyboard')
    ensureKeyboardWired()
    ;(document.getElementById('f') as HTMLInputElement).focus()
    vv.height = 520
    vv.offsetTop = 40
    fire('resize')
    const s = document.documentElement.style
    expect(s.getPropertyValue('--vvh')).toBe('520px')
    expect(s.getPropertyValue('--vvt')).toBe('40px')
    expect(s.getPropertyValue('--kb-h')).toBe('340px') // 900 − 40 − 520
    expect(document.documentElement.classList.contains('kb-open')).toBe(true)

    ;(document.getElementById('f') as HTMLInputElement).blur()
    vv.height = 900
    vv.offsetTop = 0
    fire('resize')
    expect(htmlStyle()).toBe('')
    expect(document.documentElement.classList.contains('kb-open')).toBe(false)
  })
})

describe('every reader survives the variables being UNSET (the closed state is the CSS fallback)', () => {
  it('⛔ each var(--vvt|--vvh|--kb-h|--banner-h) read carries a fallback — or, for --kb-h, the :root default exists', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const codes: Array<[string, string]> = []
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f)
        if (statSync(p).isDirectory()) walk(p)
        // Comments describe the variables in prose (`var(--vvt)`); only code is checked.
        else if (/\.(css|tsx?|mjs)$/.test(f) && !/\.test\./.test(f)) codes.push([p.replace(process.cwd() + '/', ''), readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')])
      }
    }
    walk(join(process.cwd(), 'src'))
    const bare: string[] = []
    for (const [f, code] of codes) {
      for (const m of code.matchAll(/var\(\s*(--vvt|--vvh|--kb-h|--banner-h)\s*\)/g)) bare.push(`${f}: ${m[0]}`)
      // Tailwind v4's shorthand `top-(--vvt)` compiles to a bare `var(--vvt)` — the same failure, spelled differently.
      for (const m of code.matchAll(/[a-z0-9-]+-\(\s*(--vvt|--vvh|--kb-h|--banner-h)\s*\)/g)) bare.push(`${f}: ${m[0]} (tailwind)`)
    }
    const kbDefault = /:root\s*\{[^}]*--kb-h:\s*0px/.test(readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8'))
    expect(kbDefault).toBe(true)
    // --kb-h may be read bare (the :root default answers); --vvt, --vvh and --banner-h must carry their own fallback.
    expect(bare.filter((b) => !b.endsWith('var(--kb-h)'))).toEqual([])
  }, 60_000)
})

describe('--banner-h (KeyboardViewportSync)', () => {
  it('no banner → nothing written, and a value left from earlier is removed; a banner → its height, written once', async () => {
    const { render, cleanup } = await import('@testing-library/react')
    const { createElement } = await import('react')
    const { KeyboardViewportSync } = await import('@/components/marketplace/keyboard-viewport-sync')
    document.documentElement.style.setProperty('--banner-h', '37px') // stale
    render(createElement(KeyboardViewportSync))
    expect(document.documentElement.style.getPropertyValue('--banner-h')).toBe('')
    expect(htmlStyle()).toBe('')
    cleanup()

    const banner = document.createElement('div')
    banner.id = 'prelaunch-banner'
    Object.defineProperty(banner, 'offsetHeight', { value: 48, configurable: true })
    document.body.prepend(banner)
    const observed: Array<() => void> = []
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { observed.push(cb) } observe() {} disconnect() {} })
    const set = vi.spyOn(document.documentElement.style, 'setProperty')
    render(createElement(KeyboardViewportSync))
    expect(document.documentElement.style.getPropertyValue('--banner-h')).toBe('48px')
    observed.forEach((cb) => cb()) // a same-size observer callback
    expect(set.mock.calls.filter((c) => c[0] === '--banner-h')).toHaveLength(1)
    set.mockRestore()
    cleanup()
  })
})
