// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import vectors from '@/lib/tools/test-vectors.json'
import { MAX_ONE_OFF_VND } from '@/lib/rent-tools/calc'
import type { ToolSpec } from '@/lib/tools/spec'

/**
 * A GENERATED TOOL'S CALCULATOR, DRIVEN LIKE A READER DRIVES IT (the rent tools' harness): it starts from the spec's defaults,
 * answers as the figures change, holds each field to the spec's range, picks a choice, shows a note when its condition holds,
 * and says "cannot compute" rather than print a number that is not one.
 */
const lang = vi.hoisted(() => ({ value: 'en' as 'en' | 'vi' }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: lang.value, tr: (en: string, viText?: string) => (lang.value === 'vi' && viText ? viText : en) }),
}))
const { GeneratedToolCalculator } = await import('./calculator')

const SPEC = vectors.spec as unknown as ToolSpec
beforeEach(() => { lang.value = 'en' })
afterEach(() => cleanup())
const well = (c: HTMLElement) => c.querySelector('[aria-live="polite"]')!.textContent!.replace(/\s+/g, ' ')
const commit = (label: string, value: string) => {
  const el = screen.getByLabelText(label)
  fireEvent.focus(el)
  fireEvent.change(el, { target: { value } })
  fireEvent.blur(el)
}

describe('a generated tool’s calculator', () => {
  it('starts from the defaults and answers at once', () => {
    const { container } = render(<GeneratedToolCalculator spec={SPEC} />)
    expect((screen.getByLabelText('Monthly rent') as HTMLInputElement).value).toBe('12,000,000')
    const w = well(container)
    expect(w).toContain('Each person pays a month')
    expect(w).toContain('6,750,000 đ')
    expect(w).toContain('81,000,000 đ')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reads the shorthand, picks a choice, and shows a note when its condition holds', () => {
    const { container } = render(<GeneratedToolCalculator spec={SPEC} />)
    commit('Monthly rent', '9tr')
    expect((screen.getByLabelText('Monthly rent') as HTMLInputElement).value).toBe('9,000,000')
    commit('Monthly bills', '600k')
    fireEvent.click(screen.getByRole('radio', { name: '3 people' }))
    expect(well(container)).toContain('3,200,000 đ')
    commit('Monthly bills', '10tr')
    expect(well(container)).toContain('The bills are more than the rent: check the figures.')
  })

  it('holds a field to the spec’s range, and says so once the reader has left it', () => {
    const { container } = render(<GeneratedToolCalculator spec={SPEC} />)
    const rent = screen.getByLabelText('Monthly rent')
    fireEvent.focus(rent)
    fireEvent.change(rent, { target: { value: '50k' } })
    expect(screen.queryByRole('alert')).toBeNull() // not while typing
    fireEvent.blur(rent)
    expect(screen.getByRole('alert').textContent).toBe('Enter a value from 100,000 đ to 10,000,000,000 đ.')
    expect(rent.getAttribute('aria-invalid')).toBe('true')
    expect(well(container)).toContain('Check “Monthly rent” to see the result.')
  })

  it('an output that cannot be computed says so, in the page’s language', () => {
    const spec = JSON.parse(JSON.stringify(SPEC)) as ToolSpec
    spec.outputs[0].formula = '(rent + bills) / (people - 2)'
    lang.value = 'vi'
    const { container } = render(<GeneratedToolCalculator spec={spec} />)
    const w = well(container)
    expect(w).toContain('Không tính được với các số này')
    expect(w).toContain('13.500.000 đ')
  })

  it('a plain number field: its decimals, its range, written back as read', () => {
    const spec = JSON.parse(JSON.stringify(SPEC)) as ToolSpec
    spec.inputs.push({ id: 'rate', kind: 'percent', label: { en: 'Yearly increase', vi: 'Mức tăng mỗi năm' }, help: { en: 'What the contract says.', vi: 'Theo hợp đồng.' }, default: 5, min: 0, max: 50 })
    spec.outputs.push({ id: 'next', label: { en: 'Rent next year', vi: 'Tiền thuê năm sau' }, formula: 'rent * (100 + rate) / 100', format: 'money' })
    const { container } = render(<GeneratedToolCalculator spec={spec} />)
    expect(well(container)).toContain('12,600,000 đ')
    commit('Yearly increase', '7,5')
    expect((screen.getByLabelText('Yearly increase') as HTMLInputElement).value).toBe('7.5')
    expect(well(container)).toContain('12,900,000 đ')
    commit('Yearly increase', '75')
    expect(screen.getByRole('alert').textContent).toBe('Enter a value from 0% to 50%.')
    commit('Yearly increase', '1.234')
    expect(screen.getByRole('alert').textContent).toBe('Use at most 2 decimals.')
  })

  it('a money input takes every amount up to its max — the spec’s ceiling is the reader’s (100 tỷ) — and names its range past it', () => {
    const spec = JSON.parse(JSON.stringify(SPEC)) as ToolSpec
    // spec.ts allows a money input up to 100 tỷ (tools.test.ts holds that), and readMoney's ceiling here is the same figure.
    spec.inputs[0].max = 100_000_000_000
    expect(MAX_ONE_OFF_VND).toBe(100_000_000_000)
    const { container } = render(<GeneratedToolCalculator spec={spec} />)
    commit('Monthly rent', '100 tỷ')
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByLabelText('Monthly rent') as HTMLInputElement).value).toBe('100,000,000,000')
    expect(well(container)).toContain('50,000,750,000 đ') // (100 tỷ + 1,5tr) / 2
    commit('Monthly rent', '100000000001')
    expect(screen.getByRole('alert').textContent).toBe('Enter a value from 100,000 đ to 100,000,000,000 đ.')
  })

  it('a range is said at the input’s own precision: 0.25% to 7.25%, never 0.3% to 7.3%', () => {
    const spec = JSON.parse(JSON.stringify(SPEC)) as ToolSpec
    spec.inputs.push({ id: 'rate', kind: 'percent', label: { en: 'Yearly increase', vi: 'Mức tăng mỗi năm' }, help: { en: 'What the contract says.', vi: 'Theo hợp đồng.' }, default: 5, min: 0.25, max: 7.25 })
    spec.outputs.push({ id: 'next', label: { en: 'Rent next year', vi: 'Tiền thuê năm sau' }, formula: 'rent * (100 + rate) / 100', format: 'money' })
    render(<GeneratedToolCalculator spec={spec} />)
    commit('Yearly increase', '8')
    expect(screen.getByRole('alert').textContent).toBe('Enter a value from 0.25% to 7.25%.')
    cleanup()
    lang.value = 'vi'
    render(<GeneratedToolCalculator spec={spec} />)
    commit('Mức tăng mỗi năm', '8')
    expect(screen.getByRole('alert').textContent).toBe('Hãy nhập giá trị từ 0,25% đến 7,25%.')
  })
})

describe('readPlain: a plain number is read the way the page writes numbers, never guessed (Opus gate 2026-11-23)', () => {
  it('"1,500" on an English page is fifteen hundred, not 1.5; "1.500" on a Vietnamese page is too', async () => {
    const { readPlain } = await import('./calculator')
    expect(readPlain('1,500', 4, 'en')).toEqual({ ok: true, value: 1500 })
    expect(readPlain('12,000', 4, 'en')).toEqual({ ok: true, value: 12000 })
    expect(readPlain('1.500', 4, 'vi')).toEqual({ ok: true, value: 1500 })
    expect(readPlain('1,234,567.5', 4, 'en')).toEqual({ ok: true, value: 1234567.5 })
    expect(readPlain('1.234.567,5', 4, 'vi')).toEqual({ ok: true, value: 1234567.5 })
  })
  it('a mark followed by anything but three digits can only be a decimal point, in either language', async () => {
    const { readPlain } = await import('./calculator')
    expect(readPlain('1.5', 4, 'en')).toEqual({ ok: true, value: 1.5 })
    expect(readPlain('1,5', 4, 'en')).toEqual({ ok: true, value: 1.5 })
    expect(readPlain('7,25', 2, 'vi')).toEqual({ ok: true, value: 7.25 })
    expect(readPlain('7.25', 2, 'vi')).toEqual({ ok: true, value: 7.25 })
    expect(readPlain('-3.5', 2, 'en')).toEqual({ ok: true, value: -3.5 })
    expect(readPlain('−3,5', 2, 'vi')).toEqual({ ok: true, value: -3.5 })
  })
  it('three digits after one mark follow the page: decimal on the side that writes it as decimal', async () => {
    const { readPlain } = await import('./calculator')
    expect(readPlain('1.125', 4, 'en')).toEqual({ ok: true, value: 1.125 })
    expect(readPlain('1,125', 4, 'vi')).toEqual({ ok: true, value: 1.125 })
  })
  it('what the field writes back on leaving reads back to the same value, both languages', async () => {
    const { readPlain, plain } = await import('./calculator')
    for (const v of [0, 0.125, 0.25, 1, 1.5, 1.125, 7.25, 1500, 1500.5, 1234567.0625, -40.5]) {
      for (const lang of ['en', 'vi'] as const) {
        const written = plain(v, lang, 4) // the field's own writer, used on leaving
        expect(readPlain(written, 4, lang)).toEqual({ ok: true, value: v })
      }
    }
  })
  it('malformed grouping, two decimal points or stray marks are refused, never read', async () => {
    const { readPlain } = await import('./calculator')
    for (const s of ['1,50,0', '1.2.3,4.5', '1,', ',5', '1..5', '12,34,567', 'abc', '1,234.5.6']) expect(readPlain(s, 4, 'en').ok).toBe(false)
    expect(readPlain('', 4, 'en')).toEqual({ ok: false, error: 'empty' })
    expect(readPlain('1.23456', 4, 'en')).toEqual({ ok: false, error: 'notWhole' })
  })
  it('a leading 0 group is a decimal, never thousands; inner spaces only as thousands separators (Opus gate round 2)', async () => {
    const { readPlain } = await import('./calculator')
    expect(readPlain('0,125', 4, 'en')).toEqual({ ok: true, value: 0.125 })
    expect(readPlain('0.250', 4, 'vi')).toEqual({ ok: true, value: 0.25 })
    expect(readPlain('012,500', 4, 'en').ok).toBe(false)
    expect(readPlain('1 500 000', 4, 'en')).toEqual({ ok: true, value: 1500000 })
    expect(readPlain('1 500 000,5', 4, 'vi')).toEqual({ ok: true, value: 1500000.5 })
    for (const s of ['1 5', '7 25', '12 34', '1  500']) expect(readPlain(s, 4, 'en').ok).toBe(false)
  })
})
