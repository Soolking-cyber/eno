// @vitest-environment jsdom
/**
 * Cover lessons (2026-10-07): the quick picks are TOGGLES a screen reader can read. Each is pressed while every one
 * of its periods is picked; pressing adds them all, un-pressing takes them all out (gate review — an action chip that
 * behaved like a toggle hid its state).
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

import { CoverFields, type CoverValue } from './cover-fields'

const base: CoverValue = {
  coverOpen: true, coverSlots: [], coverAreas: [], coverRateVnd: null, coverConsent: false,
  currentCity: 'ho-chi-minh-city', preferredCities: ['ho-chi-minh-city'],
}
const WEEKDAY_MORNINGS = ['mon-am', 'tue-am', 'wed-am', 'thu-am', 'fri-am']
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

afterEach(cleanup)

describe('cover quick picks', () => {
  it('read as pressed only while every one of their periods is picked', () => {
    const { rerender } = render(<CoverFields value={{ ...base, coverSlots: WEEKDAY_MORNINGS.slice(0, 4) }} onChange={() => {}} errors={{}} />)
    expect(pressed('Weekday mornings')).toBe('false')
    rerender(<CoverFields value={{ ...base, coverSlots: WEEKDAY_MORNINGS }} onChange={() => {}} errors={{}} />)
    expect(pressed('Weekday mornings')).toBe('true')
  })

  it('add every period when pressed, and take them all out when un-pressed', () => {
    const onChange = vi.fn()
    const { rerender } = render(<CoverFields value={{ ...base, coverSlots: ['sat-am', 'mon-pm'] }} onChange={onChange} errors={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Weekends' }))
    expect([...onChange.mock.calls[0][0].coverSlots].sort()).toEqual(['mon-pm', 'sat-am', 'sat-eve', 'sat-pm', 'sun-am', 'sun-eve', 'sun-pm'])

    onChange.mockClear()
    rerender(<CoverFields value={{ ...base, coverSlots: ['mon-pm', ...WEEKDAY_MORNINGS] }} onChange={onChange} errors={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Weekday mornings' }))
    expect(onChange.mock.calls[0][0].coverSlots).toEqual(['mon-pm'])
  })
})
