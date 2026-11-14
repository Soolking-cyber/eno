// @vitest-environment jsdom
/**
 * A linked job's Apply block on the 30-day-ISR listing page: it closes on the CLIENT once the apply-by
 * date has passed, and the one caption under it (batch 95, owner-approved 2026-11-14) prints the host and
 * the day (no clock) and adds the countdown only after mount, in the final fortnight — into a cell whose
 * width is there from the first render, so the line never moves.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'

const language = vi.hoisted(() => ({ lang: 'en' }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: language.lang, tr: (en: string, vi?: string) => (language.lang === 'vi' && vi ? vi : en) }),
  Tr: ({ text }: { text: string }) => <>{text}</>,
}))

import { JobApplyGuard, JobApplyLine } from './job-apply-guard'

const APPLY = 'Apply'
beforeEach(() => { language.lang = 'en'; vi.useFakeTimers({ toFake: ['Date'] }) })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('JobApplyGuard', () => {
  it('closes a job whose apply-by day has ended in Vietnam', () => {
    vi.setSystemTime(new Date('2026-10-08T17:00:01Z')) // 00:00:01 on the 9th in Hanoi
    const { container } = render(<JobApplyGuard applyBy="2026-10-08"><a>{APPLY}</a></JobApplyGuard>)
    expect(container.textContent).toContain('This job has closed')
    expect(container.querySelector('a')).toBeNull()
  })

  it('keeps it open through the last day', () => {
    vi.setSystemTime(new Date('2026-10-08T16:59:00Z')) // 23:59 on the 8th in Hanoi
    const { container } = render(<JobApplyGuard applyBy="2026-10-08"><a>{APPLY}</a></JobApplyGuard>)
    expect(container.querySelector('a')).not.toBeNull()
  })
})

const HOST = 'careers.nordanglia.com'
/** What a reader sees: without the countdown cell's invisible, aria-hidden sizers. */
const seen = (el: Element) => {
  const c = el.cloneNode(true) as Element
  for (const h of c.querySelectorAll('[aria-hidden]')) h.remove()
  return (c.textContent ?? '').replace(/\s+/g, ' ').trim()
}
const ssr = (ui: React.ReactElement) => { const d = document.createElement('div'); d.innerHTML = renderToString(ui); return d }

describe('JobApplyLine — batch 95: one caption, "<host> · closes <day> (<n> days)"', () => {
  it('server-renders the host and the day, and a countdown cell with its two invisible sizers but no countdown', () => {
    vi.setSystemTime(new Date('2026-09-29T03:00:00Z'))
    const d = ssr(<JobApplyLine applyBy="2026-10-08" host={HOST} />)
    expect(seen(d)).toBe('careers.nordanglia.com · closes 8 Oct 2026')
    const cell = d.querySelector('[data-job-countdown]')!
    expect(cell.className.split(' ')).toEqual(['inline-grid', 'tabular-nums'])
    const [a, b, real] = [...cell.children]
    for (const sizer of [a, b]) {
      expect(sizer.getAttribute('aria-hidden')).toBe('true')
      expect(sizer.className.split(' ')).toEqual(['invisible', '[grid-area:1/1]'])
    }
    expect([a.textContent, b.textContent]).toEqual(['(14 days)', '(today)'])
    expect(real.textContent).toBe('')
    expect(real.className).toBe('[grid-area:1/1]')
  })

  it('after mount: the days left in the same cell, the sizers unchanged (the line keeps its width)', () => {
    vi.setSystemTime(new Date('2026-09-29T03:00:00Z')) // 10:00 on the 29th in Hanoi
    const { container } = render(<JobApplyLine applyBy="2026-10-08" host={HOST} />)
    expect(seen(container)).toBe('careers.nordanglia.com · closes 8 Oct 2026 (10 days)')
    const cell = container.querySelector('[data-job-countdown]')!
    expect([...cell.children].map((c) => c.textContent)).toEqual(['(14 days)', '(today)', '(10 days)'])
    expect(container.querySelector('.text-warning')).toBeNull()
  })

  it('the last three days turn the deadline warning-ink — colour only, never weight — and the last one says "(today)"', () => {
    vi.setSystemTime(new Date('2026-10-06T03:00:00Z'))
    const three = render(<JobApplyLine applyBy="2026-10-08" host={HOST} />).container
    expect(seen(three)).toBe('careers.nordanglia.com · closes 8 Oct 2026 (3 days)')
    expect(three.querySelector('.text-warning')?.textContent).toContain('closes')
    expect(three.innerHTML).not.toMatch(/font-(semibold|bold|medium)/)
    cleanup()
    vi.setSystemTime(new Date('2026-10-08T03:00:00Z'))
    const last = render(<JobApplyLine applyBy="2026-10-08" host={HOST} />).container
    expect(seen(last)).toBe('careers.nordanglia.com · closes 8 Oct 2026 (today)')
    expect(last.querySelector('.text-warning')).not.toBeNull()
    expect(last.innerHTML).not.toMatch(/font-(semibold|bold|medium)/)
  })

  it('shows no countdown further out than two weeks (the cell stays, empty)', () => {
    vi.setSystemTime(new Date('2026-09-01T03:00:00Z'))
    const { container } = render(<JobApplyLine applyBy="2026-10-08" host={HOST} />)
    expect(seen(container)).toBe('careers.nordanglia.com · closes 8 Oct 2026')
    expect(container.querySelector('[data-job-countdown]')!.children).toHaveLength(3)
  })

  it('the year only when the page asks for it (decided from data, never the clock)', () => {
    vi.setSystemTime(new Date('2026-09-01T03:00:00Z'))
    expect(seen(ssr(<JobApplyLine applyBy="2026-10-08" host={HOST} year={false} />))).toBe('careers.nordanglia.com · closes 8 Oct')
    expect(seen(ssr(<JobApplyLine applyBy="2027-01-05" host={HOST} />))).toBe('careers.nordanglia.com · closes 5 Jan 2027')
  })

  it('writes the Vietnamese words, date and countdown', () => {
    language.lang = 'vi'
    vi.setSystemTime(new Date('2026-09-29T03:00:00Z'))
    const { container } = render(<JobApplyLine applyBy="2026-10-08" host={HOST} year={false} />)
    expect(seen(container)).toBe('careers.nordanglia.com · hạn 8/10 (còn 10 ngày)')
    expect([...container.querySelector('[data-job-countdown]')!.children].slice(0, 2).map((c) => c.textContent)).toEqual(['(còn 14 ngày)', '(hôm nay)'])
  })

  it('a host alone, a day alone, and nothing for neither (a malformed date is no date)', () => {
    vi.setSystemTime(new Date('2026-09-01T03:00:00Z'))
    expect(seen(ssr(<JobApplyLine applyBy={null} host={HOST} />))).toBe('careers.nordanglia.com')
    expect(seen(ssr(<JobApplyLine applyBy="soon" host={HOST} />))).toBe('careers.nordanglia.com')
    expect(ssr(<JobApplyLine applyBy="soon" host={HOST} />).querySelector('[data-job-countdown]')).toBeNull()
    expect(seen(ssr(<JobApplyLine applyBy="2026-10-08" host={null} />))).toBe('closes 8 Oct 2026')
    const { container } = render(<JobApplyLine applyBy="soon" host={null} />)
    expect(container.innerHTML).toBe('')
  })
})
