// @vitest-environment jsdom
/**
 * A linked job's Apply block on the 30-day-ISR listing page: it closes on the CLIENT once the apply-by
 * date has passed, and the deadline line prints the day (no clock) and adds the countdown only after
 * mount, in the final fortnight.
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

import { JobApplyBy, JobApplyGuard } from './job-apply-guard'

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

describe('JobApplyBy', () => {
  it('server-renders the day alone — no countdown, so the cached HTML never goes stale', () => {
    vi.setSystemTime(new Date('2026-09-29T03:00:00Z'))
    expect(renderToString(<JobApplyBy applyBy="2026-10-08" />)).not.toContain('left')
    expect(renderToString(<JobApplyBy applyBy="2026-10-08" />)).toContain('8 Oct 2026')
  })

  it('adds the days left after mount, inside the final fortnight', () => {
    vi.setSystemTime(new Date('2026-09-29T03:00:00Z')) // 10:00 on the 29th in Hanoi
    const { container } = render(<JobApplyBy applyBy="2026-10-08" />)
    expect(container.textContent).toBe('Apply by 8 Oct 2026 · 10 days left')
    expect(container.querySelector('p')?.className).not.toContain('text-warning')
  })

  it('turns warning-ink in the last three days, and names the last one', () => {
    vi.setSystemTime(new Date('2026-10-08T03:00:00Z'))
    const { container } = render(<JobApplyBy applyBy="2026-10-08" />)
    expect(container.textContent).toBe('Apply by 8 Oct 2026 · Last day')
    expect(container.querySelector('p')?.className).toContain('text-warning')
  })

  it('shows no countdown further out than two weeks', () => {
    vi.setSystemTime(new Date('2026-09-01T03:00:00Z'))
    const { container } = render(<JobApplyBy applyBy="2026-10-08" />)
    expect(container.textContent).toBe('Apply by 8 Oct 2026')
  })

  it('writes the Vietnamese date and label', () => {
    language.lang = 'vi'
    vi.setSystemTime(new Date('2026-09-01T03:00:00Z'))
    const { container } = render(<JobApplyBy applyBy="2026-10-08" />)
    expect(container.textContent).toBe('Hạn nộp: 8/10/2026')
  })

  it('renders nothing for a malformed date', () => {
    const { container } = render(<JobApplyBy applyBy="soon" />)
    expect(container.innerHTML).toBe('')
  })
})
