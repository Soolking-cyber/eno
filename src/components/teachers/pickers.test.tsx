// @vitest-environment jsdom
/**
 * The closed-list pickers of the teacher form (closed-combobox.tsx, the nationality picker's rules): the province (with
 * the town aliases of the 2025 merger), the HCMC district, and the language ADDER. Typing only filters; Enter commits
 * only a row the person moved to; a pick is a row, never typed text.
 * ⚠️ Harness: the house timeouts for Base UI lists in jsdom (country-combobox.test.tsx).
 */
import { useState } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, getConfig, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

import { ProvinceCombobox } from './province-combobox'
import { DISTRICT_NOT_SAYING, DistrictCombobox } from './district-combobox'
import { LanguagePicker } from './language-combobox'

const asyncUtilTimeout = getConfig().asyncUtilTimeout
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 30_000 })
beforeAll(() => { Element.prototype.scrollIntoView ??= function () {} })
afterAll(() => { configure({ asyncUtilTimeout }); vi.resetConfig() })
afterEach(cleanup)
/** Visible labels the pickers sit under (as their forms give them), held in constants for the i18n lint. */
const [PROVINCE_LABEL, DISTRICT_LABEL, LANGUAGES_LABEL] = ['Which province?', 'District', 'Other languages you speak']

function province(initial = '') {
  const onPick = vi.fn()
  function Host() {
    const [v, setV] = useState(initial)
    return <><label htmlFor="p">{PROVINCE_LABEL}</label><ProvinceCombobox id="p" value={v} onPick={(k) => { onPick(k); if (k.startsWith('p-') || !k) setV(k) }} /></>
  }
  render(<Host />)
  return { onPick, input: screen.getByRole('combobox', { name: 'Which province?' }) as HTMLInputElement, user: userEvent.setup() }
}

describe('Which province?', () => {
  it('"Quy Nhơn" (typed without accents) finds Gia Lai — the pick is the PROVINCE', async () => {
    const { input, onPick, user } = province()
    await user.type(input, 'quy nhon')
    await user.click(await screen.findByRole('option', { name: 'Quy Nhon → Gia Lai' }))
    expect(onPick).toHaveBeenLastCalledWith('p-52')
    expect(input.value).toBe('Gia Lai')
  })

  it('"Hội An" hands back the Da Nang CHIP (a hub), so the answer switches to the city', async () => {
    const { input, onPick, user } = province()
    await user.type(input, 'hoi an')
    await user.click(await screen.findByRole('option', { name: 'Hoi An → Da Nang' }))
    expect(onPick).toHaveBeenLastCalledWith('da-nang')
  })

  it('a province finds itself by its Vietnamese or English name, from the start of a word', async () => {
    const { input, user } = province()
    await user.type(input, 'lak')
    expect(await screen.findByRole('option', { name: 'Dak Lak' })).toBeTruthy()
    await user.clear(input)
    await user.type(input, 'ak')
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Dak Lak' })).toBeNull()) // not inside a word
  })

  it('Enter with no row moved to commits nothing; ArrowDown + Enter commits the first match', async () => {
    const { input, onPick, user } = province()
    await user.type(input, 'gia lai')
    expect(await screen.findByRole('option', { name: 'Gia Lai' })).toBeTruthy()
    await user.keyboard('{Enter}')
    expect(onPick).not.toHaveBeenCalled()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onPick).toHaveBeenLastCalledWith('p-52')
  })

  it('a city chip’s province is never offered (Hà Nội is a chip, not "somewhere else")', async () => {
    const { input, user } = province()
    await user.type(input, 'ha noi')
    expect(await screen.findByText('No province or town matches.')).toBeTruthy()
  })
})

describe('Which district do you live in?', () => {
  function district() {
    const onChange = vi.fn()
    function Host() {
      const [v, setV] = useState('')
      return <><label htmlFor="d">{DISTRICT_LABEL}</label><DistrictCombobox id="d" value={v} onChange={(k) => { onChange(k); setV(k) }} /></>
    }
    render(<Host />)
    return { onChange, input: () => screen.getByRole('combobox', { name: 'District' }) as HTMLInputElement, user: userEvent.setup() }
  }
  it('finds a district by the neighbourhood people say ("Thao Dien" → District 2) and stores its key', async () => {
    const { input, onChange, user } = district()
    await user.type(input(), 'thao dien')
    await user.click(await screen.findByRole('option', { name: 'District 2 (Thu Duc)' }))
    expect(onChange).toHaveBeenLastCalledWith('d2')
  })
  it('"Prefer not to say" is a ROW it reports — the form stores nothing for it — and the field says it was answered', async () => {
    const { input, onChange, user } = district()
    await user.click(input())
    await user.click(await screen.findByRole('option', { name: 'Prefer not to say' }))
    expect(onChange).toHaveBeenLastCalledWith(DISTRICT_NOT_SAYING)
    expect(input().value).toBe('Prefer not to say')
  })
})

describe('the language adder', () => {
  function languages(initial: string[], max = 8, exclude: string[] = []) {
    const onChange = vi.fn()
    function Host() {
      const [v, setV] = useState(initial)
      return <><label htmlFor="l">{LANGUAGES_LABEL}</label><LanguagePicker id="l" value={v} max={max} exclude={exclude} onChange={(n) => { onChange(n); setV(n) }} /></>
    }
    render(<Host />)
    return { onChange, input: () => screen.getByRole('combobox', { name: 'Other languages you speak' }) as HTMLInputElement, user: userEvent.setup() }
  }
  it('a pick ADDS the language by its stored (English) name, the field empties, the count shows', async () => {
    const { input, onChange, user } = languages([])
    await user.type(input(), 'kor')
    await user.click(await screen.findByRole('option', { name: 'Korean' }))
    expect(onChange).toHaveBeenLastCalledWith(['Korean'])
    expect(input().value).toBe('')
    expect(screen.getByText('1/8')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove Korean' })).toBeTruthy()
  })
  it('finds a language by its own name ("한국어") and by an alias ("Mandarin" → Chinese)', async () => {
    const { input, user } = languages([])
    const field = input() // held: while the list is open, Base UI hides the page around it from the a11y tree
    await user.type(field, '한국')
    expect(await screen.findByRole('option', { name: 'Korean' })).toBeTruthy()
    await user.clear(field)
    await user.type(field, 'mandarin')
    expect(await screen.findByRole('option', { name: 'Chinese' })).toBeTruthy()
  })
  it('an old free-text value the list does not hold is KEPT, shown as typed, and removable', async () => {
    const { onChange, user } = languages(['Klingon', 'french'])
    expect(screen.getByText('Klingon')).toBeTruthy()
    expect(screen.getByText('French')).toBeTruthy() // a listed language, matched case-blind
    await user.click(screen.getByRole('button', { name: 'Remove Klingon' }))
    expect(onChange).toHaveBeenLastCalledWith(['french'])
  })
  it('a chosen language is not offered again; an excluded one never is', async () => {
    const { input, user } = languages(['Korean'], 8, ['en'])
    const field = input()
    await user.type(field, 'kor')
    expect(await screen.findByText('No language matches.')).toBeTruthy()
    await user.clear(field)
    await user.type(field, 'engl')
    expect(await screen.findByText('No language matches.')).toBeTruthy()
  })
  it('at the limit the field is disabled and says why', () => {
    languages(['Korean', 'French'], 2)
    expect(screen.getByText('2/2')).toBeTruthy()
    expect(input2().disabled).toBe(true)
    expect(input2().placeholder).toMatch(/most you can add/)
    function input2() { return screen.getByRole('combobox', { name: 'Other languages you speak' }) as HTMLInputElement }
  })
})
