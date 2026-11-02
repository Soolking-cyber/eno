// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { __resetBackToCloseForTests } from '@/lib/back-to-close'
import { installDrawerPolyfills, setViewport } from '@/test/drawer-env'
import { CustomSelect, type SelectOption } from './custom-select'
import { DeferredSelect, StandInSelect } from './deferred-select'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

beforeAll(() => {
  installDrawerPolyfills()
  configure({ asyncUtilTimeout: 5_000 })
})
afterEach(() => {
  cleanup()
  __resetBackToCloseForTests()
  setViewport('desktop')
})

const FEW: SelectOption[] = [{ value: 'newest', label: 'Newest' }, { value: 'price-low', label: 'Lowest price' }]
const MANY: SelectOption[] = ['en', 'vi', 'zh', 'ko', 'ja', 'ru'].map((c) => ({ value: c, label: c.toUpperCase() }))
const trigger = (c: HTMLElement | Document = document) => c.querySelector('button[role="combobox"]') as HTMLButtonElement
const look = (c: HTMLElement) => {
  const t = trigger(c)
  return { tag: t.tagName, type: t.getAttribute('type'), className: t.className, expanded: t.getAttribute('aria-expanded'), haspopup: t.getAttribute('aria-haspopup'), text: t.textContent, wrapper: t.parentElement?.className, glyph: t.querySelector(':scope > svg')?.getAttribute('class') }
}

describe('the stand-in looks like the picker, so nothing shifts when one replaces the other', () => {
  it.each([
    ['a short list', { value: 'newest', options: FEW, label: 'Sort by', searchable: false, indicator: 'down' as const, className: 'min-h-9 rounded-full', wrapperClassName: 'w-auto shrink-0', triggerLabel: 'Newest' }],
    ['a long list, type-to-filter', { value: 'vi', options: MANY, label: 'Language', className: 'min-h-11', activeClassName: 'min-h-11', wrapperClassName: 'shrink-0' }],
    ['a value that reads as applied', { value: 'price-low', options: FEW, label: 'Sort by', activeClassName: 'bg-accent' }],
  ] as const)('%s', (_name, props) => {
    const real = look(render(<CustomSelect {...props} onChange={vi.fn()} />).container)
    cleanup()
    expect(look(render(<StandInSelect {...props} onChange={vi.fn()} />).container)).toEqual(real)
  })

  it('it keeps a name of its own: the value alone would say nothing about what it picks', () => {
    render(<StandInSelect value="newest" options={FEW} label="Sort by" onChange={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toBeTruthy()
  })
})

describe('DeferredSelect is the real picker once its code is here', () => {
  const props = { value: 'newest', options: FEW, label: 'Sort by', searchable: false }

  it('from a wide screen: a click opens the list, a pick reaches the caller', async () => {
    const onChange = vi.fn()
    render(<DeferredSelect {...props} onChange={onChange} />)
    await screen.findByText('Sort by') // the real picker's own label span: the stand-in has none
    fireEvent.click(trigger(), { detail: 1 })
    await userEvent.setup().click(await screen.findByRole('option', { name: 'Lowest price' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('price-low'))
  })

  it('on a phone: the bottom sheet, which closes on a pick', async () => {
    setViewport('phone')
    const onChange = vi.fn()
    render(<DeferredSelect {...props} onChange={onChange} />)
    await screen.findByText('Sort by')
    fireEvent.click(trigger(), { detail: 1 })
    await userEvent.setup().click(await screen.findByRole('option', { name: 'Lowest price' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('price-low'))
  })
})

describe('when the code fails to arrive', () => {
  afterEach(() => { vi.doUnmock('./custom-select'); vi.resetModules() })

  it('the control stays on screen and a press asks again, with no error and no reload', async () => {
    vi.resetModules()
    vi.doMock('./custom-select', async () => { throw new Error('chunk failed') })
    const { DeferredSelect: Fresh } = await import('./deferred-select')
    render(<Fresh value="newest" options={FEW} label="Sort by" searchable={false} onChange={vi.fn()} />)
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByRole('combobox', { name: 'Sort by' }).textContent).toContain('Newest')
    fireEvent.click(trigger())
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByRole('combobox', { name: 'Sort by' }).textContent).toContain('Newest')
    expect(readFileSync('src/components/marketplace/deferred-select.tsx', 'utf8')).not.toMatch(/location\.reload\(/)
  })
})

describe('what must stay off the path to every page', () => {
  const src = (f: string) => readFileSync(`src/components/marketplace/${f}`, 'utf8')

  it('the header search does not reach the taxonomy', () => {
    expect(src('search-suggest.tsx')).not.toMatch(/from '\.\/count-chip'/)
    expect(src('count-chip-label.ts')).not.toMatch(/subcategories|taxonomy'/)
  })

  it.each(['footer-preferences.tsx', 'seller-listings.tsx'])('%s reaches the picker only through DeferredSelect', (f) => {
    expect(src(f)).not.toMatch(/from '\.\/custom-select'/)
    expect(src(f)).toMatch(/from '\.\/deferred-select'/)
  })

  it('the stand-in and the shared trigger import no Base UI, and the picker only by import()', () => {
    expect(src('custom-select-trigger.tsx')).not.toMatch(/@base-ui/)
    expect(src('deferred-select.tsx')).not.toMatch(/@base-ui|^import \{[^}]*\} from '\.\/custom-select'/m)
    expect(src('deferred-select.tsx')).toMatch(/import\('\.\/custom-select'\)/)
  })
})
