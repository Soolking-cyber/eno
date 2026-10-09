// @vitest-environment jsdom
/**
 * The teacher form's Nationality picker (owner, 2026-10-08: "make the dropdowns in teacher.eno.vn searchable"). It was a
 * ~240-row select with no search. These pin what makes it searchable: typing filters by the name shown, from the start
 * of a word — case- and accent-blind, in Vietnamese too, and by the English name there — a pick stores the ISO code,
 * only the Clear button stores '', Enter commits only a row the person moved to (typing never highlights one), and the
 * id the form's label points at lands on the input, where a refused Next still finds it.
 *
 * ⚠️ Harness notes: explicit cleanup (no vitest globals); jsdom runs no animations, but Base UI still unmounts a closed
 * list on a later frame, so "it closed" is waited for; jsdom has no scrollIntoView, which the list calls on the
 * highlighted row; and Node 25's built-in Web Storage is dead under jsdom, so the form gets fresh stores.
 * ⚠️ The house timeouts for heavy jsdom files (listings-explorer.history.test.tsx): a ~240-row list and a whole form
 * take up to ~1 s alone, and blew vitest's 5 s default under the full suite's load (measured, 2026-10-08).
 */
import { useState } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, fireEvent, getConfig, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider, type Language } from '@/context/language-context'
import { CountryCombobox } from './country-combobox'
import { TeacherForm } from './teacher-form'

vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: () => {} }) }))

// Everything this file changes globally is put back after it (gate review, 2026-10-08) — per-file isolation already
// scopes it, and this keeps it scoped even if a pool ever shares a worker.
const asyncUtilTimeout = getConfig().asyncUtilTimeout
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 30_000 })
const hadScrollIntoView = Object.prototype.hasOwnProperty.call(Element.prototype, 'scrollIntoView')
beforeAll(() => { Element.prototype.scrollIntoView ??= function () {} })
afterAll(() => {
  configure({ asyncUtilTimeout })
  vi.resetConfig()
  if (!hadScrollIntoView) delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})
afterEach(cleanup)

const LABEL = 'Nationality'

/** The form's own wiring: a `<label htmlFor>`, and the value held by the parent as TeacherForm holds `t.nationality`. */
function mount({ lang = 'en', value = '' }: { lang?: Language; value?: string } = {}) {
  const onChange = vi.fn()
  function Form() {
    const [v, setV] = useState(value)
    return (
      <>
        <label htmlFor="tf-nat">{LABEL}</label>
        <CountryCombobox id="tf-nat" value={v} onChange={(next) => { setV(next); onChange(next) }} />
      </>
    )
  }
  const ui = (l: Language) => <LanguageProvider initialLang={l} initialViDict={{}}><Form /></LanguageProvider>
  const { rerender } = render(ui(lang))
  return {
    onChange, input: screen.getByRole('combobox', { name: LABEL }) as HTMLInputElement, user: userEvent.setup(),
    /** The page's language changing in place — a soft navigation into the other variant, as the provider adopts it. */
    relang: (l: Language) => rerender(ui(l)),
  }
}

const option = (name: string) => screen.queryByRole('option', { name })
/** The row carrying Base UI's highlight — the one its Enter commits — if any. */
const highlighted = () => document.querySelector('[role="option"][data-highlighted]')

describe('CountryCombobox', () => {
  it('typing "tun" shows Tunisia and hides an unrelated country', async () => {
    const { input, user } = mount()
    await user.click(input)
    expect(await screen.findByRole('option', { name: 'Germany' })).toBeTruthy() // the whole list, before typing
    await user.type(input, 'tun')
    expect(await screen.findByRole('option', { name: 'Tunisia' })).toBeTruthy()
    expect(option('Germany')).toBeNull()
  })

  it('choosing a country stores its ISO code, and the field shows its name', async () => {
    const { input, onChange, user } = mount()
    await user.type(input, 'TUN')
    await user.click(await screen.findByRole('option', { name: 'Tunisia' }))
    expect(onChange).toHaveBeenLastCalledWith('TN')
    expect(input.value).toBe('Tunisia')
    await waitFor(() => expect(option('Tunisia')).toBeNull()) // the list closed
  })

  // ⛔ From the start of a word only (gate review, 2026-10-08): as a substring, "ca" sat inside Ameri·ca and "in" inside
  // Filip·in·o — and the US and the Philippines come first in the list.
  it('"ca" lists Canada, not the US (Ameri·ca); "in" lists India and Indonesia, not the Philippines (Filip·in·o)', async () => {
    const { input, user } = mount()
    await user.type(input, 'ca')
    expect(await screen.findByRole('option', { name: 'Canada' })).toBeTruthy()
    expect(option('United States')).toBeNull()
    await user.clear(input)
    await user.type(input, 'in')
    expect(await screen.findByRole('option', { name: 'India' })).toBeTruthy()
    expect(option('Indonesia')).toBeTruthy()
    expect(option('Philippines')).toBeNull()
  })

  // ⛔ THE STANDARD CLOSED-LIST COMBOBOX (gate review, 2026-10-08): typing only filters, and Enter commits only a row the
  // person moved to with the arrow keys (or points at). Three rounds of letting Enter infer a choice each found a new way
  // to save a country nobody picked; with no row highlighted, Enter commits nothing and the list stays open to tap.
  describe('Enter commits only a row the person moved to', () => {
    it('"tun" + Enter commits nothing: the list stays open with Tunisia in it, and the query stays', async () => {
      const { input, onChange, user } = mount()
      await user.type(input, 'tun')
      expect(await screen.findByRole('option', { name: 'Tunisia' })).toBeTruthy()
      expect(highlighted()).toBeNull() // typing only filters
      await user.keyboard('{Enter}')
      expect(onChange).not.toHaveBeenCalled()
      expect(option('Tunisia')).toBeTruthy()
      expect(input.value).toBe('tun')
    })

    it('ArrowDown + Enter commits the first match; another ArrowDown, the next ("austr": Australia, then Austria)', async () => {
      const { input, onChange, user } = mount()
      await user.type(input, 'tun')
      await user.keyboard('{ArrowDown}{Enter}')
      expect(onChange).toHaveBeenLastCalledWith('TN')
      expect(input.value).toBe('Tunisia')

      cleanup()
      const next = mount()
      await next.user.type(next.input, 'austr')
      await next.user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
      expect(next.onChange).toHaveBeenLastCalledWith('AT')
      expect(next.input.value).toBe('Austria')
    })

    it('"austr" + Enter saves nothing — Australia comes first in the list, but nobody chose it', async () => {
      const { input, onChange, user } = mount()
      await user.type(input, 'austr')
      expect(await screen.findByRole('option', { name: 'Australia' })).toBeTruthy()
      expect(option('Austria')).toBeTruthy()
      await user.keyboard('{Enter}')
      expect(onChange).not.toHaveBeenCalled()
    })

    it('"niger" + Enter commits nothing and lists Niger and Nigeria; a tap on Niger saves NE', async () => {
      const { input, onChange, user } = mount()
      await user.type(input, 'niger')
      expect(await screen.findByRole('option', { name: 'Niger' })).toBeTruthy()
      expect(option('Nigeria')).toBeTruthy()
      await user.keyboard('{Enter}')
      expect(onChange).not.toHaveBeenCalled()
      await user.click(screen.getByRole('option', { name: 'Niger' }))
      expect(onChange).toHaveBeenLastCalledWith('NE')
      expect(input.value).toBe('Niger')
    })

    it('"-" + Enter commits nothing (punctuation alone lists every country)', async () => {
      const { input, onChange, user } = mount()
      await user.type(input, '-')
      expect(await screen.findByRole('option', { name: 'Germany' })).toBeTruthy()
      await user.keyboard('{Enter}')
      expect(onChange).not.toHaveBeenCalled()
    })

    it('an empty field: tapped open, Enter commits nothing and the list stays — then ArrowDown + Enter, the first row', async () => {
      const tapped = mount()
      await tapped.user.click(tapped.input)
      expect(await screen.findByRole('option', { name: 'Germany' })).toBeTruthy()
      await tapped.user.keyboard('{Enter}')
      expect(tapped.onChange).not.toHaveBeenCalled()
      expect(option('Germany')).toBeTruthy()
      await tapped.user.keyboard('{ArrowDown}{Enter}')
      expect(tapped.onChange).toHaveBeenLastCalledWith('US')

      cleanup()
      const focused = mount() // focused without opening the list: Enter does nothing at all
      focused.input.focus()
      await focused.user.keyboard('{Enter}')
      expect(focused.onChange).not.toHaveBeenCalled()
    })

    it('a filled field (GB) tapped open + Enter keeps GB', async () => {
      const { input, onChange, user } = mount({ value: 'GB' })
      await user.click(input)
      expect(await screen.findByRole('option', { name: 'Germany' })).toBeTruthy()
      await user.keyboard('{Enter}')
      // Base UI opens a filled list on its saved row, so Enter may commit GB again — never another country.
      expect(onChange.mock.calls.every(([code]) => code === 'GB')).toBe(true)
      expect(input.value).toBe('United Kingdom')
    })
  })

  it('typed text never becomes the value: closing without a pick puts the picked name back', async () => {
    const { input, onChange, user } = mount({ value: 'GB' })
    await user.type(input, 'zzq')
    expect(await screen.findByText('No country matches.')).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(input.value).toBe('United Kingdom'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a query that matches nothing says so — "dst" no longer sits inside United·St·ates', async () => {
    const { input, user } = mount()
    await user.type(input, 'dst')
    expect(await screen.findByText('No country matches.')).toBeTruthy()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('only the Clear button clears: it saves ""', async () => {
    const { input, onChange, user } = mount({ value: 'GB' })
    expect(input.value).toBe('United Kingdom')
    await user.click(screen.getByRole('button', { name: 'Clear nationality' }))
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(input.value).toBe('')
  })

  it('deleting the text and leaving keeps the saved country — list closed or open', async () => {
    // Closed: the field was focused without opening the list, emptied, then left.
    const closed = mount({ value: 'GB' })
    await closed.user.clear(closed.input)
    expect(closed.input.value).toBe('') // the person may type a new query meanwhile
    await closed.user.click(document.body)
    expect(closed.input.value).toBe('United Kingdom')
    expect(closed.onChange).not.toHaveBeenCalled()

    cleanup()
    // Open: tapped (the list opens), emptied, then Escape.
    const opened = mount({ value: 'GB' })
    await opened.user.click(opened.input)
    await opened.user.clear(opened.input)
    expect(await screen.findByRole('option', { name: 'Germany' })).toBeTruthy() // the whole list while empty
    await opened.user.keyboard('{Escape}')
    await waitFor(() => expect(opened.input.value).toBe('United Kingdom'))
    expect(opened.onChange).not.toHaveBeenCalled()
  })

  it('Escape over a closed field keeps the saved country (Base UI would clear it)', async () => {
    const { input, onChange, user } = mount({ value: 'GB' })
    input.focus()
    await user.keyboard('{Escape}')
    expect(input.value).toBe('United Kingdom')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('the id the label points at is the input itself (the label names and focuses it)', async () => {
    const { input, user } = mount()
    expect(document.getElementById('tf-nat')).toBe(input)
    await user.click(screen.getByText(LABEL))
    expect(document.activeElement).toBe(input)
  })

  // A returning teacher changing a saved nationality (gate review, 2026-10-08): the saved row's highlight, the typed query
  // and the keyboard must all end on the country they chose — never the old one, never a guess.
  it('replacing a saved nationality by search: type, then tap — or arrow — the new country', async () => {
    const tap = mount({ value: 'GB' })
    await tap.user.click(tap.input)
    await tap.user.clear(tap.input)
    await tap.user.type(tap.input, 'fra')
    await tap.user.click(await screen.findByRole('option', { name: 'France' }))
    expect(tap.onChange).toHaveBeenLastCalledWith('FR')
    expect(tap.input.value).toBe('France')
    cleanup()
    const keys = mount({ value: 'GB' })
    await keys.user.click(keys.input)
    await keys.user.clear(keys.input)
    await keys.user.type(keys.input, 'tun')
    await keys.user.keyboard('{Enter}') // nothing moved to yet: nothing changes
    expect(keys.onChange).not.toHaveBeenCalled()
    await keys.user.keyboard('{ArrowDown}{Enter}')
    expect(keys.onChange).toHaveBeenLastCalledWith('TN')
    expect(keys.input.value).toBe('Tunisia')
    // A keyboard pick closes the list like a tap does — only Enter with NOTHING highlighted keeps it open.
    await waitFor(() => expect(option('Tunisia')).toBeNull())
  })

  // The edit form loads the saved profile AFTER mount (gate review, 2026-10-08): the field must take the loaded value's
  // name — and a query the person already started is theirs until they leave it.
  it('a value that arrives after mount (the edit load) shows its name; a query being typed stays until they leave it', async () => {
    const onChange = vi.fn()
    const ui = (v: string) => (
      <LanguageProvider initialLang="en" initialViDict={{}}>
        <label htmlFor="tf-nat">{LABEL}</label>
        <CountryCombobox id="tf-nat" value={v} onChange={onChange} />
      </LanguageProvider>
    )
    const { rerender } = render(ui(''))
    const input = screen.getByRole('combobox', { name: LABEL }) as HTMLInputElement
    expect(input.value).toBe('')
    rerender(ui('GB'))
    expect(input.value).toBe('United Kingdom')
    const user = userEvent.setup()
    await user.click(input)
    await user.clear(input)
    await user.type(input, 'fr')
    rerender(ui('DE')) // a late load while the person types
    expect(input.value).toBe('fr')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(input.value).toBe('Germany'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('opening a filled field lists every country, not only the picked one', async () => {
    const { input, user } = mount({ value: 'TN' })
    await user.click(input)
    expect(await screen.findByRole('option', { name: 'Germany' })).toBeTruthy()
    expect(option('Tunisia')).toBeTruthy()
  })

  it('a language change in place re-labels the picked country', async () => {
    const { input, relang } = mount({ value: 'DE' })
    expect(input.value).toBe('Germany')
    relang('vi')
    await waitFor(() => expect(input.value).toBe('Đức'))
  })

  it('finds the common nationalities by what people type: "uk", "usa", "british"', async () => {
    const { input, user } = mount()
    await user.type(input, 'uk')
    expect(await screen.findByRole('option', { name: 'United Kingdom' })).toBeTruthy()
    expect(option('Ukraine')).toBeTruthy()
    await user.clear(input)
    await user.type(input, 'usa')
    expect(await screen.findByRole('option', { name: 'United States' })).toBeTruthy()
    await user.clear(input)
    await user.type(input, 'british')
    expect(await screen.findByRole('option', { name: 'United Kingdom' })).toBeTruthy()
  })

  it('in English, "my" does not list the US — "Mỹ" is a Vietnamese-only alias', async () => {
    const { input, user } = mount()
    await user.type(input, 'my')
    expect(await screen.findByRole('option', { name: 'Myanmar (Burma)' })).toBeTruthy()
    expect(option('United States')).toBeNull()
  })

  describe('in Vietnamese', () => {
    // The provider's mount check would otherwise switch to the DEVICE language — jsdom's is English.
    beforeEach(() => { Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['vi-VN', 'vi'] }) })
    afterEach(() => { Reflect.deleteProperty(navigator, 'languages') })

    it('an unaccented query finds an accented name, đ included', async () => {
      const { input, onChange, user } = mount({ lang: 'vi' })
      expect(input.placeholder).toBe('Nhập hoặc chọn quốc gia')
      await user.type(input, 'han quoc')
      await user.click(await screen.findByRole('option', { name: 'Hàn Quốc' }))
      expect(onChange).toHaveBeenLastCalledWith('KR')
      expect(input.value).toBe('Hàn Quốc')

      await user.clear(input)
      await user.type(input, 'duc')
      expect(await screen.findByRole('option', { name: 'Đức' })).toBeTruthy()
      expect(option('Hàn Quốc')).toBeNull()
    })

    it('the English name finds it too, and "Mỹ" finds Hoa Kỳ', async () => {
      const { input, user } = mount({ lang: 'vi' })
      await user.type(input, 'germany')
      expect(await screen.findByRole('option', { name: 'Đức' })).toBeTruthy()
      await user.clear(input)
      await user.type(input, 'my')
      expect(await screen.findByRole('option', { name: 'Hoa Kỳ' })).toBeTruthy()
      await user.clear(input)
      await user.type(input, 'xyzq')
      expect(await screen.findByText('Không có quốc gia phù hợp.')).toBeTruthy()
    })
  })
})

describe('in the teacher form', () => {
  const store = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 }
  }
  beforeEach(() => { vi.stubGlobal('localStorage', store()); vi.stubGlobal('sessionStorage', store()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('a refused Next with no nationality focuses its input (revealFirstError); a pick lets the teacher on', async () => {
    const user = userEvent.setup()
    render(
      <LanguageProvider initialLang="en" initialViDict={{}}>
        <main><TeacherForm mode="join" draftHost={false} apexOrigin="https://eno.vn" /></main>
      </LanguageProvider>,
    )
    // StepWizard renders Next twice — the phone's sticky bar first, the desktop inline twin after; jsdom shows both.
    const next = () => user.click(screen.getAllByRole('button', { name: 'Next' })[0])
    // The two plain fields in one change each: key-by-key, every keystroke re-renders the whole form (and that is not
    // what this pins).
    fireEvent.change(screen.getByRole('textbox', { name: 'Full name' }), { target: { value: 'Jane Doe' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Headline' }), { target: { value: 'CELTA English teacher, five years' } })
    await next()
    const input = screen.getByRole('combobox', { name: LABEL })
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent)
    expect(described).toContain('This is required.') // the error is read as the field's description

    await user.type(input, 'tunis')
    await user.click(await screen.findByRole('option', { name: 'Tunisia' })) // typing only filters: the row is tapped
    await next()
    expect(await screen.findByText('Where do you live now?')).toBeTruthy()
  })
})
