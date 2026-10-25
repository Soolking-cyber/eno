import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * Small /schools fixes from the sweep of 2026-10-22, pinned so they stay fixed:
 * the breadcrumb hides in the native app in every language, the board's count has a singular, the Vietnamese "Top
 * rated" tab fits its segment from `sm` up, and the review prompt's first star is "1 star".
 */
const lang = vi.hoisted(() => ({ tr: (en: string, vi?: string) => vi ?? en }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'vi', tr: lang.tr }) }))

const { BreadcrumbNav } = await import('./breadcrumb-nav')

describe('school pages breadcrumb', () => {
  it('carries data-crumb-trail, so the native app hides it whatever the language (the Vietnamese label is not "breadcrumb")', () => {
    const html = renderToStaticMarkup(<BreadcrumbNav><ol /></BreadcrumbNav>)
    expect(html).toContain('aria-label="Vị trí trang"')
    expect(html).toContain('data-crumb-trail=""')
  })
})

describe('board and review copy', () => {
  const board = readFileSync('src/components/schools/schools-board.tsx', 'utf8')
  const prompt = readFileSync('src/components/marketplace/review-prompt.tsx', 'utf8')

  it('one school is "1 school or centre", not "1 schools and centres"', () => {
    expect(board).toMatch(/shown\.length === 1\s*\?\s*tr\('1 school or centre', '1 trường hoặc trung tâm'\)/)
  })

  it('the Vietnamese long "Top rated" label is the short one that fits ~110px ("Được đánh giá cao" was cut)', () => {
    expect(board).toContain("tr('Top rated', 'Đánh giá cao')")
    expect(board).not.toContain("tr('Top rated', 'Được đánh giá cao')")
  })

  it('the first star is named "1 star"', () => {
    expect(prompt).toMatch(/n === 1 \? tr\('1 star', '1 sao'\)/)
  })
})
