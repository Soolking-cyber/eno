// @vitest-environment jsdom
/**
 * "Where can you teach?" — THE ONE LIST (teacher onboarding redesign, 2026-10-08). What these pin:
 *   · no double selection, ever: all of HCMC vs its districts, Thủ Đức vs District 2/9, "anywhere" vs other cities;
 *   · the home pre-selection is shown as picked, and ⛔ counts only once confirmed — any edit is a confirmation (B6);
 *   · Online is asked once, first, and is locked (with why) after "Online only".
 */
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HCMC_DISTRICT_KEYS, HUBS } from '@/lib/teachers/places'
import { EMPTY_TEACHER, type TeacherInput } from '@/lib/teachers/profile'
import { withRelocate, withSituation } from './teacher-form-rules'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

import { TeachAreaPicker } from './teach-area-picker'

beforeAll(() => { Element.prototype.scrollIntoView ??= function () {} })
afterEach(cleanup)

type PickerProps = Partial<React.ComponentProps<typeof TeachAreaPicker>>
/** The picker as the Where step holds it: the list in state, every edit a confirmation. */
function mount(start: TeacherInput, props: PickerProps = {}) {
  const seen: { areas: string[][]; confirmed: boolean[] } = { areas: [], confirmed: [] }
  const onChangeAnswer = vi.fn()
  function Host() {
    const [t, setT] = useState(start)
    return (
      <TeachAreaPicker
        t={t}
        onAreas={(a) => { seen.areas.push(a); setT((p) => ({ ...p, teachAreas: a, teachAreasConfirmed: true })) }}
        onConfirm={(v) => { seen.confirmed.push(v); setT((p) => ({ ...p, teachAreasConfirmed: v })) }}
        onChangeAnswer={onChangeAnswer}
        {...props}
      />
    )
  }
  render(<Host />)
  return { seen, onChangeAnswer, user: userEvent.setup(), last: () => seen.areas.at(-1) }
}
const hcmc = (o: Partial<TeacherInput> = {}) => withRelocate(withSituation({ ...EMPTY_TEACHER, jobTypes: ['fulltime'] }, { livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7' }), o.relocate ?? 'no')
const btn = (name: string) => screen.getByRole('button', { name })
const isPressed = (name: string) => btn(name).getAttribute('aria-pressed') === 'true'

describe('the home pre-selection (B6)', () => {
  it('shows the home city picked, Online first and not picked, and the confirmation unticked', () => {
    mount(hcmc())
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons[0]).toBe('Online lessons')
    expect(isPressed('Online lessons')).toBe(false)
    expect(isPressed('Ho Chi Minh City')).toBe(true)
    // the other places of the same province (the 2025 merger) are offered, not picked
    expect(isPressed('Binh Duong')).toBe(false)
    expect(isPressed('Vung Tau')).toBe(false)
    expect(screen.getByRole('checkbox', { name: 'These are the places I can teach' }).getAttribute('aria-checked')).toBe('false')
  })

  it('ticking the confirmation confirms; any edit of the list is a confirmation too', async () => {
    const { user, seen } = mount(hcmc())
    await user.click(screen.getByRole('checkbox', { name: 'These are the places I can teach' }))
    expect(seen.confirmed).toEqual([true])
    await user.click(btn('Binh Duong'))
    expect(seen.areas.at(-1)).toEqual(['ho-chi-minh-city', 'binh-duong'])
  })

  it('shows the confirmation refusal on the checkbox, named and announced', () => {
    mount(hcmc(), { confirmError: 'Please confirm.' })
    const box = screen.getByRole('checkbox', { name: 'These are the places I can teach' })
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toBe('Please confirm.')
  })
})

describe('no double selection', () => {
  it('all of HCMC vs its districts: "Only some districts" swaps the city for the home district, and back', async () => {
    const { user, last } = mount(hcmc())
    await user.click(screen.getByRole('radio', { name: 'Only some districts' }))
    expect(last()).toEqual(['d7'])
    expect(isPressed('District 7 (Phu My Hung)')).toBe(true)
    await user.click(btn('District 1'))
    expect(last()).toEqual(['d1', 'd7'])
    await user.click(screen.getByRole('radio', { name: 'Anywhere in the city' }))
    expect(last()).toEqual(['ho-chi-minh-city'])
    expect(screen.queryByRole('button', { name: 'District 1' })).toBeNull()
  })

  it('Thủ Đức absorbs District 2 and 9: they show included (pressed, not tappable) and the list holds Thủ Đức alone', async () => {
    const start = { ...hcmc(), teachAreas: ['d2'] }
    const { user, last } = mount(start)
    expect(isPressed('District 2 (Thu Duc)')).toBe(true)
    await user.click(btn('Thu Duc City'))
    expect(last()).toEqual(['thu-duc'])
    expect(isPressed('District 2 (Thu Duc)')).toBe(true)
    expect(btn('District 2 (Thu Duc)').hasAttribute('disabled')).toBe(true)
    expect(btn('District 9 (Thu Duc)').hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Thủ Đức includes the former District 2 and District 9/)).toBeTruthy()
    // Thủ Đức off again: District 2 and 9 were only shown as included — they do not reappear as picks.
    await user.click(btn('Thu Duc City'))
    expect(last()).toEqual([])
  })

  it('"anywhere" vs other cities: after "Yes, anywhere" the cities are one line with Change; after "Some" they are chips', async () => {
    const anywhere = mount(hcmc({ relocate: 'anywhere' }))
    expect(screen.getByText('Anywhere in Vietnam')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hanoi' })).toBeNull()
    await anywhere.user.click(screen.getByRole('button', { name: 'Change' }))
    expect(anywhere.onChangeAnswer).toHaveBeenCalledTimes(1)
    cleanup()

    const some = mount(hcmc({ relocate: 'some' }))
    expect(screen.queryByText('Anywhere in Vietnam')).toBeNull()
    await some.user.click(btn('Hanoi'))
    expect(some.last()).toEqual(['ho-chi-minh-city', 'ha-noi'])
    // Never the home area among "other cities".
    expect(screen.getAllByRole('button', { name: 'Ho Chi Minh City' })).toHaveLength(1)
  })

  it('"No, only around …": no other city is offered at all', () => {
    mount(hcmc({ relocate: 'no' }))
    for (const name of ['Hanoi', 'Da Nang', 'Nha Trang', 'Da Lat', 'Phu Quoc']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.getAllByRole('button').length).toBe(1 + 3) // Online + the home province's three places
    expect(HUBS).toHaveLength(12)
  })
})

describe('Online, asked once', () => {
  it('"Online only" (abroad) shows Online locked, with why and a way back', async () => {
    const start = withRelocate(withSituation({ ...EMPTY_TEACHER, jobTypes: ['fulltime'] }, { livesIn: 'abroad' }), 'online-only')
    const { onChangeAnswer, user } = mount(start)
    expect(isPressed('Online lessons')).toBe(true)
    expect(btn('Online lessons').hasAttribute('disabled')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Change' }))
    expect(onChangeAnswer).toHaveBeenCalled()
  })

  it('a teacher abroad who would go to some cities picks them from every city (no home area)', () => {
    mount(withRelocate(withSituation({ ...EMPTY_TEACHER, jobTypes: ['parttime'] }, { livesIn: 'abroad' }), 'some'))
    expect(screen.getByText('Cities in Vietnam (whole city only)')).toBeTruthy()
    expect(screen.queryByText('Near you')).toBeNull()
    expect(screen.getByRole('button', { name: 'Ho Chi Minh City' })).toBeTruthy()
  })

  it('cover’s entry (?goal=cover) opens HCMC on its districts, with the home district picked', () => {
    const start = withRelocate(withSituation({ ...EMPTY_TEACHER, jobTypes: [] }, { livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7' }, true), '')
    mount(start, { coverIntent: true })
    expect(start.teachAreas).toEqual(['d7'])
    expect(screen.getByRole('radio', { name: 'Only some districts' }).getAttribute('aria-checked')).toBe('true')
    expect(isPressed('District 7 (Phu My Hung)')).toBe(true)
    expect(HCMC_DISTRICT_KEYS).toHaveLength(24)
  })
})
