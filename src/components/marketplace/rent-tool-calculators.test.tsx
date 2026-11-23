// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * THE FOUR LIVE CALCULATORS, DRIVEN LIKE A READER DRIVES THEM: typing, leaving a field, fixing it. The language context is
 * a stand-in that returns the authored English or Vietnamese (`tr(en, vi)`), so each assertion reads the words on screen.
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own.
 */
const lang = vi.hoisted(() => ({ value: 'en' as 'en' | 'vi' }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: lang.value, tr: (en: string, viText?: string) => (lang.value === 'vi' && viText ? viText : en) }),
}))

const { AffordabilityCalculator } = await import('@/app/[lang]/rent-affordability-calculator/calculator')
const { MoveInCalculator } = await import('@/app/[lang]/move-in-cost-calculator/calculator')
const { ComparisonCalculator } = await import('@/app/[lang]/rental-cost-comparison/calculator')
const { PriceConverter } = await import('@/app/[lang]/vietnamese-price-converter/calculator')

beforeEach(() => { lang.value = 'en' })
afterEach(() => cleanup())

const type = (label: string | RegExp, value: string, index = 0) => fireEvent.change(screen.getAllByLabelText(label)[index], { target: { value } })
const leave = (label: string | RegExp, index = 0) => fireEvent.blur(screen.getAllByLabelText(label)[index])
const well = (c: HTMLElement) => c.querySelector('[aria-live="polite"]')!.textContent!.replace(/\s+/g, ' ')

describe('rent affordability', () => {
  it('waits quietly, then answers once both figures read', () => {
    const { container } = render(<AffordabilityCalculator />)
    expect(well(container)).toContain('Enter your take-home pay and the rent to see the result.')
    expect(screen.queryByRole('alert')).toBeNull()
    type('Monthly take-home pay', '25000000')
    type('Monthly rent', '8.5tr')
    const w = well(container)
    expect(w).toContain('34%')
    expect(w).toContain('16,500,000 đ')
    expect(w).toContain('7,500,000 đ')
    expect(w).toContain('10,000,000 đ')
    expect(w).toContain('Above the 30% rule of thumb, within 40%.')
  })

  it('leaving a field regroups what was read: "8.5tr" becomes 8,500,000', () => {
    render(<AffordabilityCalculator />)
    type('Monthly rent', '8,5tr')
    leave('Monthly rent')
    expect((screen.getByLabelText('Monthly rent') as HTMLInputElement).value).toBe('8,500,000')
  })

  it('a bad figure says why, under its field, wired to it; an empty one only once it has been left', () => {
    render(<AffordabilityCalculator />)
    const pay = screen.getByLabelText('Monthly take-home pay')
    leave('Monthly take-home pay')
    expect(screen.getByRole('alert').textContent).toBe('Enter an amount.')
    type('Monthly take-home pay', 'abc')
    expect(pay.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(pay.getAttribute('aria-describedby')!)!.textContent).toBe('Enter an amount in đồng, e.g. 15000000 or 15tr.')
    for (const [v, msg] of [['0', 'Enter an amount above 0.'], ['-3000000', 'This cannot be negative.'], ['50 tỷ', 'That is too large to be right. Check the number of zeros.'], ['25', 'Add a unit (500k, 15tr) or write the full amount (500000).']] as const) {
      type('Monthly take-home pay', v)
      expect(screen.getByRole('alert').textContent, v).toBe(msg)
    }
  })

  it('rent above the pay: "short each month", never a negative "left"', () => {
    const { container } = render(<AffordabilityCalculator />)
    type('Monthly take-home pay', '10tr')
    type('Monthly rent', '12tr')
    expect(well(container)).toContain('Short each month2,000,000 đ')
    expect(well(container)).toContain('The rent is more than your take-home pay.')
    expect(well(container)).not.toMatch(/NaN|Infinity|-\d/)
  })

  it('in Vietnamese: dot grouping and the Vietnamese words', () => {
    lang.value = 'vi'
    const { container } = render(<AffordabilityCalculator />)
    type('Thu nhập thực nhận mỗi tháng', '25tr')
    type('Tiền thuê mỗi tháng', '7tr')
    expect(well(container)).toContain('18.000.000 đ')
    expect(well(container)).toContain('Nằm trong mốc tham khảo 30%.')
  })
})

describe('move-in cost', () => {
  it('starts at 1 month’s deposit, 1 month in advance and no fee; the advance is counted once', () => {
    const { container } = render(<MoveInCalculator />)
    expect((screen.getByLabelText('Deposit (months of rent)') as HTMLInputElement).value).toBe('1')
    expect((screen.getByLabelText('Months paid in advance') as HTMLInputElement).value).toBe('1')
    expect((screen.getByLabelText('Agent fee') as HTMLInputElement).value).toBe('0')
    type('Monthly rent', '12000000')
    const w = well(container)
    expect(w).toContain('Cash needed at signing24,000,000 đ')
    expect(w).toContain('Then 12,000,000 đ a month, from month 2.')
  })

  it('the example’s figures: 2 months’ deposit, a fee and setup costs → 43,000,000 đ', () => {
    const { container } = render(<MoveInCalculator />)
    type('Monthly rent', '12tr')
    type('Deposit (months of rent)', '2')
    type('Agent fee', '2tr')
    type('Setup costs (optional)', '5tr')
    expect(well(container)).toContain('43,000,000 đ')
    expect(well(container)).toContain('Deposit (2 months)24,000,000 đ')
    type('Months paid in advance', '3')
    expect(well(container)).toContain('from month 4.')
  })

  it('half a month of deposit is allowed; nonsense months are refused with a reason', () => {
    const { container } = render(<MoveInCalculator />)
    type('Monthly rent', '10tr')
    type('Deposit (months of rent)', '1,5')
    expect(well(container)).toContain('Deposit (1.5 months)15,000,000 đ')
    type('Deposit (months of rent)', '13')
    expect(screen.getByRole('alert').textContent).toBe('That is too large to be right. Check the number of zeros.')
    // The rent is there: the well names the field to fix, never "Enter the monthly rent" (gate round 1).
    expect(well(container)).toContain('Check “Deposit (months of rent)” to see the result.')
    expect(well(container)).not.toContain('Enter the monthly rent')
    type('Deposit (months of rent)', '1')
    type('Months paid in advance', '1.5')
    expect(screen.getByRole('alert').textContent).toBe('Use whole months (or halves for a deposit).')
  })
})

describe('gate round 1 regressions', () => {
  it('an amount under 1.000 keeps its “đ” when it is regrouped, so a valid entry never turns invalid on blur', () => {
    const { container } = render(<MoveInCalculator />)
    type('Monthly rent', '10tr')
    type('Agent fee', '500đ')
    leave('Agent fee')
    expect((screen.getByLabelText('Agent fee') as HTMLInputElement).value).toBe('500 đ')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(well(container)).toContain('Agent fee500 đ')
    leave('Agent fee')
    expect((screen.getByLabelText('Agent fee') as HTMLInputElement).value).toBe('500 đ')
    type('Agent fee', '2tr')
    leave('Agent fee')
    expect((screen.getByLabelText('Agent fee') as HTMLInputElement).value).toBe('2,000,000')
  })

  it('an empty months field asks for months, not money — in both languages', () => {
    render(<MoveInCalculator />)
    type('Deposit (months of rent)', '')
    leave('Deposit (months of rent)')
    expect(screen.getByRole('alert').textContent).toBe('Enter a number of months.')
    cleanup()
    lang.value = 'vi'
    render(<ComparisonCalculator />)
    type('Thời hạn thuê (tháng)', '')
    leave('Thời hạn thuê (tháng)')
    expect(screen.getByRole('alert').textContent).toBe('Hãy nhập số tháng.')
  })

  it('with the rent filled, the well names the field that does not read — and asks for the rent only when it is empty', () => {
    const { container } = render(<MoveInCalculator />)
    expect(well(container)).toContain('Enter the monthly rent to see the cash needed at signing.')
    type('Monthly rent', '10tr')
    type('Months paid in advance', '')
    expect(well(container)).toContain('Check “Months paid in advance” to see the result.')
    type('Months paid in advance', '1')
    type('Setup costs (optional)', 'abc')
    expect(well(container)).toContain('Check “Setup costs (optional)” to see the result.')
    cleanup()
    const aff = render(<AffordabilityCalculator />)
    type('Monthly take-home pay', '25tr')
    type('Monthly rent', 'abc')
    expect(well(aff.container)).toContain('Check “Monthly rent” to see the result.')
    cleanup()
    const cmp = render(<ComparisonCalculator />)
    type('Monthly rent', '9tr', 0)
    type('Monthly rent', '10tr', 1)
    type('Deposit', '16tr', 2)
    expect(well(cmp.container)).toContain('Check “Home C: Monthly rent” to see the result.')
  })

  it('the affordability band agrees with the figure it is printed beside', () => {
    const { container } = render(<AffordabilityCalculator />)
    type('Monthly take-home pay', '10000000')
    type('Monthly rent', '3001000')
    expect(well(container)).toContain('30%')
    expect(well(container)).toContain('Within the 30% rule of thumb.')
    type('Monthly rent', '3006000')
    expect(well(container)).toContain('30.1%')
    expect(well(container)).toContain('Above the 30% rule of thumb, within 40%.')
  })

  it('the converter refuses "1 triệu 500 đồng" with both readings, and reads a spelled "năm trăm" tail as đồng, saying so', () => {
    const { container } = render(<PriceConverter />)
    type('Price as written', '1 triệu 500 đồng')
    expect(screen.getByRole('alert').textContent).toBe('Two readings: 1,500,000 đ if the last digits continue the unit, or 1,000,500 đ if they are đồng, as written. Write the full amount.')
    type('Price as written', '1 triệu 500')
    expect(well(container)).toContain('1,500,000 đ')
    type('Price as written', 'mười lăm triệu năm trăm')
    expect(well(container)).toContain('15,000,500 đ')
    expect(well(container)).toContain('năm trăm after triệu is read as 500 đ, as written in words. For thousands, add “nghìn”.')
  })
})

describe('rental cost comparison', () => {
  it('two homes ranked cheapest first; the third is left out while it is empty', () => {
    const { container } = render(<ComparisonCalculator />)
    expect(screen.getByText('Home A')).toBeTruthy()
    expect(screen.getByText('Home C (optional)')).toBeTruthy()
    type('Monthly rent', '9tr', 0)
    type('Commute per month', '1.5tr', 0)
    type('Monthly rent', '10tr', 1)
    const w = well(container)
    expect(w).toContain('1. Home B')
    expect(w).toContain('120,000,000 đ over 12 months')
    expect(w).toContain('2. Home A · 6,000,000 đ more')
    expect(w).not.toContain('Home C')
  })

  it('a started third home asks for its rent, then joins the ranking; the deposit stays out of the total', () => {
    const { container } = render(<ComparisonCalculator />)
    type('Monthly rent', '9tr', 0)
    type('Monthly rent', '10tr', 1)
    type('Deposit', '16tr', 2)
    expect(screen.getByRole('alert').textContent).toBe('Enter an amount.')
    type('Monthly rent', '8tr', 2)
    const w = well(container)
    expect(w).toContain('1. Home C')
    expect(w).toContain('96,000,000 đ over 12 months')
    expect(w).toContain('cash up front 24,000,000 đ, of which deposit 16,000,000 đ (assumed returned)')
  })

  it('the lease length is checked: 0 and 61 months are refused', () => {
    render(<ComparisonCalculator />)
    type('Lease length (months)', '0')
    expect(screen.getByRole('alert').textContent).toBe('Enter at least 1 month.')
    type('Lease length (months)', '61')
    expect(screen.getByRole('alert').textContent).toBe('That is too large to be right. Check the number of zeros.')
  })
})

describe('Vietnamese price converter', () => {
  it('says how it read the input before the number, then the Vietnamese grouping and the words', () => {
    const { container } = render(<PriceConverter />)
    type('Price as written', '15 triệu 500')
    const w = well(container)
    expect(w.indexOf('“15 triệu 500” read as')).toBeLessThan(w.indexOf('15,500,000 đ'))
    expect(w).toContain('Written in Vietnam: 15.500.000 đ')
    expect(w).toContain('mười lăm triệu năm trăm nghìn đồng')
    expect(w).toContain('That is 15 million 500 thousand đồng.')
    expect(w).toContain('500 after triệu continues it: 500,000 đ more.')
  })

  it('refuses what reads two ways, naming both readings', () => {
    const { container } = render(<PriceConverter />)
    type('Price as written', '15tr50')
    expect(screen.getByRole('alert').textContent).toBe('Two readings: 15,500,000 đ if the digits continue the unit, or 15,050,000 đ if they are the next unit. Write three digits after the unit, such as 500 or 050.')
    type('Price as written', '15')
    expect(well(container)).toContain('“15” has no unit')
    type('Price as written', '')
    expect(well(container)).toContain('Type a price to see the exact amount.')
  })

  it('in Vietnamese: no duplicate English line, dot grouping', () => {
    lang.value = 'vi'
    const { container } = render(<PriceConverter />)
    type('Giá cần đổi', '2 tỷ 3')
    const w = well(container)
    expect(w).toContain('“2 tỷ 3” được hiểu là')
    expect(w).toContain('2.300.000.000 đ')
    expect(w).toContain('hai tỷ ba trăm triệu đồng')
    expect(w).not.toContain('Written in Vietnam')
  })
})
