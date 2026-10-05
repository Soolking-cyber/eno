// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import { CATEGORY_ENTRY_LABELS, categoryEntryLabel } from './category-entry-label'
import { NAV_CATEGORIES } from './taxonomy-nav'
import { TAXONOMY } from './taxonomy'

/**
 * ⛔ THE TEACHERS ENTRY POINT SAYS WHO IT IS FOR: "Find a teacher / Tìm giáo viên" (nav audit N8, 2026-10-05).
 *
 * The Teachers category holds teacher PROFILES for schools to hire from; an expat teacher looking for WORK
 * read the "Teachers / Giáo viên" tile as theirs and found one profile and no jobs. The tile, the footer's
 * Explore link and /c's "Other categories" chips now carry the entry label; the category's own name — the
 * /c/teachers H1, breadcrumb and <title> — stays "Teachers / Giáo viên".
 */
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('categoryEntryLabel', () => {
  it('Teachers is "Find a teacher / Tìm giáo viên" where it is a way in', () => {
    expect(categoryEntryLabel({ slug: 'teachers', name: 'Teachers', nameVi: 'Giáo viên' })).toEqual({ name: 'Find a teacher', nameVi: 'Tìm giáo viên' })
  })

  it('every other category keeps its own name (and an empty nameVi falls back to the English)', () => {
    expect(categoryEntryLabel({ slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' })).toEqual({ name: 'Jobs', nameVi: 'Việc làm' })
    // No Vietnamese name: none is invented — tr() then reaches the dictionary / machine translation as before.
    expect(categoryEntryLabel({ slug: 'x', name: 'X', nameVi: null })).toEqual({ name: 'X', nameVi: undefined })
    expect(categoryEntryLabel({ slug: 'constructor', name: 'C', nameVi: 'C' })).toEqual({ name: 'C', nameVi: 'C' })
  })

  it('the category itself is not renamed — H1, breadcrumb and title keep "Teachers / Giáo viên"', () => {
    const teachers = TAXONOMY.find((c) => c.slug === 'teachers')
    expect([teachers?.name, teachers?.nameVi]).toEqual(['Teachers', 'Giáo viên'])
    expect(NAV_CATEGORIES.find((c) => c.slug === 'teachers')).toEqual({ slug: 'teachers', name: 'Teachers', nameVi: 'Giáo viên' })
  })

  it('every entry label belongs to a real category — a renamed slug cannot leave a dead entry', () => {
    for (const slug of Object.keys(CATEGORY_ENTRY_LABELS)) expect(TAXONOMY.some((c) => c.slug === slug), slug).toBe(true)
  })
})

describe('<CategoryRail> — the Teachers tile', () => {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  HTMLElement.prototype.scrollTo = () => {}

  async function tiles(lang: 'en' | 'vi') {
    const { LanguageProvider } = await import('@/context/language-context')
    const { CategoryRail } = await import('@/components/marketplace/category-rail')
    type Cats = React.ComponentProps<typeof CategoryRail>['categories']
    const cats = [
      { id: 'jobs', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm', icon: 'Briefcase' },
      { id: 'teachers', slug: 'teachers', name: 'Teachers', nameVi: 'Giáo viên', icon: 'GraduationCap' },
    ] as unknown as Cats
    const { container } = render(
      <LanguageProvider initialLang={lang} initialViDict={{}}>
        <CategoryRail categories={cats} activeCategory="all" activeSubcategory="all" subcategoryCounts={{}} onCategory={() => {}} onSubcategory={() => {}} />
      </LanguageProvider>,
    )
    return [...container.querySelectorAll('[data-cat]')].map((b) => [b.getAttribute('data-cat'), b.textContent?.trim()])
  }

  it('reads "Find a teacher" in English and "Tìm giáo viên" in Vietnamese; the slug is unchanged', async () => {
    expect(await tiles('en')).toEqual([['jobs', 'Jobs'], ['teachers', 'Find a teacher']])
    cleanup()
    expect(await tiles('vi')).toEqual([['jobs', 'Việc làm'], ['teachers', 'Tìm giáo viên']])
  })
})

describe('<Footer> — the Explore link to /c/teachers', () => {
  // The footer.test.tsx harness: the edition is read once at import, so the footer is re-imported per render.
  async function teachersLink(lang: 'en' | 'vi') {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const store = new Map<string, string>([['lang', lang]])
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size },
    })
    const { LanguageProvider } = await import('@/context/language-context')
    const { CurrencyProvider } = await import('@/context/currency-context')
    const { Footer } = await import('@/components/marketplace/footer')
    const { container } = render(
      <LanguageProvider initialLang={lang} initialViDict={{}}>
        <CurrencyProvider>
          <Footer />
        </CurrencyProvider>
      </LanguageProvider>,
    )
    return [...container.querySelectorAll('a')].find((a) => /\/c\/teachers$/.test(a.getAttribute('href') ?? ''))
  }

  it('wears the entry label in each language, the href unchanged', async () => {
    const en = await teachersLink('en')
    expect(en?.textContent).toBe('Find a teacher')
    expect(en?.getAttribute('href')).toBe('/c/teachers')
    cleanup()
    const vi_ = await teachersLink('vi')
    expect(vi_?.textContent).toBe('Tìm giáo viên')
    expect(vi_?.getAttribute('href')).toBe('/c/teachers')
  })
})
