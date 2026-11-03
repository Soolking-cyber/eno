// @vitest-environment jsdom
/** A SERVER RATE MEANS A DEFAULT VIEWER'S PRICES ARE IN THE FIRST PAINT AND NEVER RE-RENDER (speed audit, 2026-11-03). */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CurrencyProvider, useCurrency } from './currency-context'

const SEED = 1 / 26_000
let renders = 0
const Probe = () => {
  const { rates, ratesPending, currency, setCurrency } = useCurrency()
  renders++
  return <button onClick={() => setCurrency('EUR')} data-testid="p" data-usd={rates.USD ?? ''} data-eur={rates.EUR ?? ''} data-pending={String(ratesPending)} data-cur={currency} />
}
const p = () => screen.getByTestId('p').dataset
const fxAnswers = (rates: Record<string, number>) => vi.fn(async () => ({ json: async () => ({ rates }) }))
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(5000) }) }

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); renders = 0; vi.stubGlobal('requestIdleCallback', undefined) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('CurrencyProvider with a server rate', () => {
  it('starts with the rate and nothing pending, the same on the server and the first client render', () => {
    vi.stubGlobal('fetch', fxAnswers({ USD: SEED }))
    render(<CurrencyProvider seedUsd={SEED}><Probe /></CurrencyProvider>)
    expect(p().usd).toBe(String(SEED))
    expect(p().pending).toBe('false')
  })

  it('a fresh rate within 1% re-renders nothing, and the table is still there for a switch', async () => {
    vi.stubGlobal('fetch', fxAnswers({ USD: SEED * 1.005, EUR: 0.00003 }))
    render(<CurrencyProvider seedUsd={SEED}><Probe /></CurrencyProvider>)
    const afterMount = renders
    await settle()
    expect(renders).toBe(afterMount)
    expect(p().usd).toBe(String(SEED))
    fireEvent.click(screen.getByTestId('p'))
    expect(p().cur).toBe('EUR')
    expect(p().eur).toBe('0.00003')
  })

  it('past 1% the real rate wins: the seed is an approximation, not a price', async () => {
    const fresh = SEED * 1.05
    vi.stubGlobal('fetch', fxAnswers({ USD: fresh, EUR: 0.00003 }))
    render(<CurrencyProvider seedUsd={SEED}><Probe /></CurrencyProvider>)
    await settle()
    expect(p().usd).toBe(String(fresh))
  })

  it('picking a currency before the table arrived fetches it now', async () => {
    const f = fxAnswers({ USD: SEED, EUR: 0.00003 })
    vi.stubGlobal('fetch', f)
    render(<CurrencyProvider seedUsd={SEED}><Probe /></CurrencyProvider>)
    expect(f).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('p'))
    expect(f).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(p().eur).toBe('0.00003')
  })

  it('a viewer who stored another currency gets the full table as before', async () => {
    localStorage.setItem('eno-currency', 'EUR')
    vi.stubGlobal('fetch', fxAnswers({ USD: SEED, EUR: 0.00003 }))
    render(<CurrencyProvider seedUsd={SEED}><Probe /></CurrencyProvider>)
    await settle()
    expect(p().cur).toBe('EUR')
    expect(p().eur).toBe('0.00003')
  })
})

describe('CurrencyProvider with no server rate', () => {
  it('behaves as it always did: pending, then the table', async () => {
    vi.stubGlobal('fetch', fxAnswers({ USD: SEED, EUR: 0.00003 }))
    render(<CurrencyProvider><Probe /></CurrencyProvider>)
    expect(p().pending).toBe('true')
    expect(p().usd).toBe('')
    await settle()
    expect(p().pending).toBe('false')
    expect(p().usd).toBe(String(SEED))
  })
})
