'use client'

import React, { createContext, useCallback, useMemo, useContext, useEffect, useState } from 'react'
import { formatMoney, CURRENCY_CODES } from '@/lib/currencies'
import type { MoneyLocale } from '@/lib/vnd'

const CUR_KEY = 'eno-currency'
const FX_KEY = 'eno-fx'
const FX_MAX_AGE = 12 * 60 * 60 * 1000 // refetch rates if older than 12h

type CurrencyCtx = {
  currency: string
  setCurrency: (c: string) => void
  rates: Record<string, number>
  /** Format a VND amount in the active display currency. Pass the viewer's
   *  money locale (moneyLocale(lang)) for Vietnamese-native separators; the
   *  default 'en' keeps the international style. */
  format: (amountVnd: number, locale?: MoneyLocale) => string
}

const CurrencyContext = createContext<CurrencyCtx | undefined>(undefined)

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState('VND')
  const [rates, setRates] = useState<Record<string, number>>({})

  useEffect(() => {
    try {
      const c = localStorage.getItem(CUR_KEY)
      if (c && CURRENCY_CODES.includes(c as never)) setCurrencyState(c)
    } catch { /* storage blocked */ }

    // Paint instantly from cached rates, then refresh if stale (or always, cheap —
    // /api/fx is edge-cached). VND-only users never need rates, but prefetching
    // makes the first currency switch instant.
    let fresh = false
    try {
      const raw = localStorage.getItem(FX_KEY)
      if (raw) {
        const { rates: r, at } = JSON.parse(raw)
        if (r && Object.keys(r).length) { setRates(r); fresh = Date.now() - (at || 0) < FX_MAX_AGE }
      }
    } catch { /* ignore */ }
    if (!fresh) {
      const refresh = () => fetch('/api/fx')
        .then((r) => r.json())
        .then((d) => {
          if (d?.rates && Object.keys(d.rates).length) {
            setRates(d.rates)
            try { localStorage.setItem(FX_KEY, JSON.stringify({ rates: d.rates, at: Date.now() })) } catch { /* ignore */ }
          }
        })
        .catch(() => {})
      // Perf Phase 1: a VND user (the default) doesn't need rates to paint anything —
      // defer the refresh to a post-load idle slot so it never competes with LCP.
      // A non-VND user needs them for the very first price render → fetch now.
      let cur = 'VND'
      try { cur = localStorage.getItem(CUR_KEY) || 'VND' } catch { /* storage blocked */ }
      if (cur !== 'VND') refresh()
      else if (typeof requestIdleCallback === 'function') requestIdleCallback(() => refresh(), { timeout: 10_000 })
      else setTimeout(refresh, 4000)
    }
  }, [])

  const setCurrency = useCallback((c: string) => {
    setCurrencyState(c)
    try { localStorage.setItem(CUR_KEY, c) } catch { /* ignore */ }
  }, [])

  const format = useCallback((amountVnd: number, locale?: MoneyLocale) => formatMoney(amountVnd, currency, rates, locale), [currency, rates])

  const value = useMemo(() => ({ currency, setCurrency, rates, format }), [currency, setCurrency, rates, format])

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext)
  if (!ctx) throw new Error('useCurrency must be used within a CurrencyProvider')
  return ctx
}

/**
 * A đồng amount rendered in the viewer's display currency PLUS a quiet approximation in the other
 * one — "12.000.000 đ ≈ $456", or "$456 ≈ 12.000.000 đ" when the display already is USD.
 *
 * ⚠️ ONE IMPLEMENTATION OF THIS RULE, ON PURPOSE. It existed in <Price> and was copied twice more
 * while making itinerary prices dual (owner, 2026-07-29) — three places that all had to agree on
 * which side gets the "≈", what happens with no rate, and whether a zero is money. The moment they
 * disagree, the same trip shows two different approximations on two screens. <Price> keeps its own
 * copy for now because it also handles non-VND stored listings, free prices and unit suffixes;
 * anything simpler than that should use this.
 *
 * Returns the plain figure when no rate has loaded — never "≈ NaN" and never a dangling "≈".
 */
export function useDualMoney() {
  const { currency, rates, format } = useCurrency()
  return useCallback((amountVnd: number, locale?: MoneyLocale) => {
    const main = format(amountVnd, locale)
    if (!amountVnd) return main
    const approx = currency === 'USD'
      ? formatMoney(amountVnd, 'VND', rates, locale)
      : vndPerUsd(rates) ? formatMoney(amountVnd, 'USD', rates, locale) : null
    return approx ? `${main} ≈ ${approx}` : main
  }, [currency, rates, format])
}

/**
 * ĐỒNG PER ONE DOLLAR (≈ 26 000) from the /api/fx table, or null when the rate is unusable.
 *
 * ⚠️ THE BAND IS THE POINT, and it is the same reasoning visa/fx.ts spells out at length: the
 * upstream publishes "currency per 1 VND", so `rates.USD` ≈ 0.0000383 and the figure we want is the
 * RECIPROCAL. Every way of getting that wrong lands far outside the tens of thousands — an
 * un-inverted rate gives 0.0000383, a rate quoted in thousands gives 26.1, a broken payload gives 0
 * or NaN — so asserting the magnitude catches all of them, while a bare `> 0` check catches none.
 *
 * Callers that merely DISPLAY an approximation degrade to showing one currency. The builder's
 * custom-budget field additionally refuses to submit, because there the number becomes the model's
 * spending target rather than a hint. Both were flagged in review as accepting an absurd rate.
 */
export function vndPerUsd(rates: Record<string, number>): number | null {
  const perVnd = rates.USD
  if (!perVnd || !Number.isFinite(perVnd) || perVnd <= 0) return null
  const rate = 1 / perVnd
  return rate >= 5_000 && rate <= 100_000 ? rate : null
}
