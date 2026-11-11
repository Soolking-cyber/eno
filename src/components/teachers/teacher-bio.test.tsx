// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import { TEACHER_BIO_LINES, TeacherBio } from './teacher-bio'

const STORY = 'Long story'
const LONGER = 'A much longer translated story'
const LH = 24

let mq: { matches: boolean; fire: () => void }
/**
 * A phone (below md, unless `wide`) whose rendered text is `lines` lines tall. The layout is modelled the way the browser
 * answers it: scrollHeight is the full text; clientHeight is the full text, or five lines while the clamp is applied.
 */
let aboutTop = 2000 // below a 844px screen unless a test puts it in view
function phone(lines: number, wide = false) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ top: aboutTop } as DOMRect))
  vi.stubGlobal('innerHeight', 844)
  const listeners = new Set<() => void>()
  mq = { matches: !wide, fire: () => listeners.forEach((f) => f()) }
  vi.stubGlobal('matchMedia', () => ({ get matches() { return mq.matches }, addEventListener: (_: string, f: () => void) => listeners.add(f), removeEventListener: (_: string, f: () => void) => listeners.delete(f) }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  setLines(lines)
}
let lineCount = 0
const setLines = (lines: number) => {
  lineCount = lines
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => lineCount * LH })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return (this.style.webkitLineClamp ? Math.min(lineCount, TEACHER_BIO_LINES) : lineCount) * LH } })
}
const tree = (text: string) => <LanguageProvider initialLang="en" initialViDict={{}}><TeacherBio>{text}</TeacherBio></LanguageProvider>

afterEach(() => { aboutTop = 2000; vi.unstubAllGlobals(); vi.restoreAllMocks(); Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight'); Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight') })

describe('TeacherBio (batch 69) — the server sends it whole; a mounted phone measures', () => {
  it('⛔ the server HTML: the whole text, no clamp, no button (a phone without the script still reads all of it)', () => {
    const html = renderToString(tree(STORY))
    expect(html).not.toContain('line-clamp')
    expect(html).not.toContain('<button')
  })
  it(`more than ${TEACHER_BIO_LINES} rendered lines: clamped; "See more" opens, "See less" closes; aria-expanded follows`, () => {
    phone(9)
    const { container, getByRole } = render(tree(STORY))
    const p = container.querySelector('p')!
    const btn = getByRole('button')
    expect(p.className).toContain('max-md:line-clamp-5')
    expect(btn.getAttribute('aria-controls')).toBe(p.id)
    fireEvent.click(btn)
    expect(p.className).not.toContain('line-clamp')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.textContent).toBe('See less')
    fireEvent.click(btn)
    expect(p.className).toContain('max-md:line-clamp-5')
  })
  it(`⛔ ${TEACHER_BIO_LINES + 1} lines or fewer: whole, and NO button (one hidden line is not worth a button; none expands nothing)`, () => {
    phone(TEACHER_BIO_LINES + 1)
    const { container } = render(tree(STORY))
    expect(container.querySelector('p')!.className).not.toContain('line-clamp')
    expect(container.querySelector('button')).toBeNull()
  })
  it('md and up: never clamped, no button', () => {
    phone(9, true)
    const { container } = render(tree(STORY))
    expect(container.querySelector('p')!.className).not.toContain('line-clamp')
    expect(container.querySelector('button')).toBeNull()
  })
  it('re-measured when the text changes after mount (a translation arriving)', async () => {
    phone(4)
    const { container, rerender } = render(tree(STORY))
    expect(container.querySelector('button')).toBeNull()
    setLines(10)
    await act(async () => { rerender(tree(LONGER)) })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(container.querySelector('button')).not.toBeNull()
  })
  it('re-measured when the viewport crosses the md line (the box may keep its width there)', async () => {
    phone(9, true)
    const { container } = render(tree(STORY))
    expect(container.querySelector('button')).toBeNull()
    mq.matches = true
    await act(async () => { mq.fire() })
    expect(container.querySelector('p')!.className).toContain('max-md:line-clamp-5')
  })
  it('opened, then no longer long (a shorter translation): it closes, so coming back long it starts clamped (opus, round 3)', async () => {
    phone(9)
    const { container } = render(tree(STORY))
    fireEvent.click(container.querySelector('button')!)
    setLines(3)
    await act(async () => { mq.fire() })
    expect(container.querySelector('button')).toBeNull()
    setLines(9)
    await act(async () => { mq.fire() })
    expect(container.querySelector('p')!.className).toContain('max-md:line-clamp-5')
    expect(container.querySelector('button')!.textContent).toBe('See more')
  })
  it('the measurement asks the layout and restores the element\'s own inline style (no line-height arithmetic; codex round 4)', () => {
    phone(9)
    const { container } = render(tree(STORY))
    const p = container.querySelector('p')!
    expect(p.className).toContain('max-md:line-clamp-5')
    expect(p.getAttribute('style') ?? '').toBe('')
  })
  it('⛔ a long bio the reader can SEE (on the first screen, or scrolled into) is not clamped — nothing in view moves (opus, round 7)', () => {
    aboutTop = 300
    phone(9)
    const { container } = render(tree(STORY))
    expect(container.querySelector('p')!.className).not.toContain('line-clamp')
    expect(container.querySelector('button')).toBeNull()
  })
  it('…nor one the reader has scrolled past (it starts above the screen)', () => {
    aboutTop = -400
    phone(9)
    const { container } = render(tree(STORY))
    expect(container.querySelector('p')!.className).not.toContain('line-clamp')
  })
  it('the phone query is Tailwind\'s own `max-md:` range, in rem', () => {
    const seen: string[] = []
    phone(9)
    const mm = window.matchMedia
    vi.stubGlobal('matchMedia', (q: string) => { seen.push(q); return mm(q) })
    render(tree(STORY))
    expect(seen).toContain('(width < 48rem)')
  })
})
