// @vitest-environment jsdom
/**
 * Cover lessons (2026-10-07; the switch became the consent 2026-10-08):
 *   · the quick picks are TOGGLES a screen reader can read — pressed while every one of their periods is picked;
 *   · ⛔ THE SWITCH IS THE CONSENT: one act, its notice beside it as its description, no tick box anywhere;
 *   · the areas are not picked here: one read-only line says where schools find the teacher, with Change.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

import { CoverFields, type CoverValue } from './cover-fields'

const base: CoverValue = {
  coverOpen: true, coverSlots: [], coverRateVnd: null, coverConsent: true,
  livesIn: 'city', currentCity: 'ho-chi-minh-city', currentProvince: '', teachAreas: ['d7', 'd4'],
}
const errText = (_f: string, code: string | undefined) => code ?? ''
const WEEKDAY_MORNINGS = ['mon-am', 'tue-am', 'wed-am', 'thu-am', 'fri-am']
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')
const ui = (value: CoverValue, onChange = vi.fn(), onChangePlaces = vi.fn(), errors = {}) =>
  <CoverFields value={value} onChange={onChange} errors={errors} errText={errText} onChangePlaces={onChangePlaces} />

afterEach(cleanup)

describe('cover quick picks', () => {
  it('read as pressed only while every one of their periods is picked', () => {
    const { rerender } = render(ui({ ...base, coverSlots: WEEKDAY_MORNINGS.slice(0, 4) }))
    expect(pressed('Weekday mornings')).toBe('false')
    rerender(ui({ ...base, coverSlots: WEEKDAY_MORNINGS }))
    expect(pressed('Weekday mornings')).toBe('true')
  })

  it('add every period when pressed, and take them all out when un-pressed', () => {
    const onChange = vi.fn()
    const { rerender } = render(ui({ ...base, coverSlots: ['sat-am', 'mon-pm'] }, onChange))
    fireEvent.click(screen.getByRole('button', { name: 'Weekends' }))
    expect([...onChange.mock.calls[0][0].coverSlots].sort()).toEqual(['mon-pm', 'sat-am', 'sat-eve', 'sat-pm', 'sun-am', 'sun-eve', 'sun-pm'])

    onChange.mockClear()
    rerender(ui({ ...base, coverSlots: ['mon-pm', ...WEEKDAY_MORNINGS] }, onChange))
    fireEvent.click(screen.getByRole('button', { name: 'Weekday mornings' }))
    expect(onChange.mock.calls[0][0].coverSlots).toEqual(['mon-pm'])
  })
})

describe('⛔ the switch is the consent', () => {
  it('switching ON gives the consent with it, OFF withdraws it — one act, never a tick box', () => {
    const onChange = vi.fn()
    const { rerender } = render(ui({ ...base, coverOpen: false, coverConsent: false }, onChange))
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Available for cover lessons' }))
    expect(onChange).toHaveBeenLastCalledWith({ coverOpen: true, coverConsent: true })
    rerender(ui(base, onChange))
    fireEvent.click(screen.getByRole('switch', { name: 'Available for cover lessons' }))
    expect(onChange).toHaveBeenLastCalledWith({ coverOpen: false, coverConsent: false })
  })

  it('the notice is the switch’s description — read with it, not part of its name, and a tap on it flips nothing', () => {
    const onChange = vi.fn()
    render(ui({ ...base, coverOpen: false, coverConsent: false }, onChange))
    const sw = screen.getByRole('switch', { name: 'Available for cover lessons' })
    const notice = document.getElementById(sw.getAttribute('aria-describedby')!)!
    expect(notice.textContent).toMatch(/never your phone, email or address/)
    fireEvent.click(notice)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText('When are you usually free?')).toBeNull() // off: nothing else is asked
  })
})

describe('where schools find the teacher for cover', () => {
  it('is one read-only line — the teach areas near home — with Change to the Where step', () => {
    const onChangePlaces = vi.fn()
    render(ui(base, vi.fn(), onChangePlaces))
    expect(screen.getByTestId('cover-reach').textContent).toBe('District 4 · District 7 (Phu My Hung)')
    expect(screen.queryByText(/Tip: schools look for cover by district/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(onChangePlaces).toHaveBeenCalledTimes(1)
  })

  it('never a relocation city, Online or "anywhere"; "All of HCMC" adds the tip to narrow it to districts', () => {
    render(ui({ ...base, teachAreas: ['online', 'ho-chi-minh-city', 'ha-noi', 'anywhere'] }))
    expect(screen.getByTestId('cover-reach').textContent).toBe('Ho Chi Minh City')
    expect(screen.getByText(/Tip: schools look for cover by district/)).toBeTruthy()
  })

  it('says so when there is nowhere near home yet', () => {
    render(ui({ ...base, teachAreas: ['online'] }))
    expect(screen.getByTestId('cover-reach').textContent).toBe('nowhere yet')
  })

  it('the step’s refusals sit under the switch, marked for the error reveal', () => {
    render(ui({ ...base, coverOpen: false, coverConsent: false }, vi.fn(), vi.fn(), { coverOpen: 'goal_required' }))
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('goal_required')
    expect(alert.closest('[data-invalid]')).toBeTruthy()
  })

  it('a refused hourly rate is marked ON ITS FIELD — aria-invalid, the one the error reveal focuses — and tied to its words', () => {
    // Gate review, 2026-10-08: the diff dropped `errProps`, but VndInput takes `invalid` + `aria-describedby` itself.
    render(ui({ ...base, coverSlots: ['mon-am'], coverRateVnd: 30_000 }, vi.fn(), vi.fn(), { coverRateVnd: 'rate_range' }))
    const rate = screen.getByRole('textbox', { name: 'Hourly rate for a cover lesson' })
    expect(rate.getAttribute('aria-invalid')).toBe('true')
    const described = (rate.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '')
    expect(described).toContain('rate_range')
  })
})
