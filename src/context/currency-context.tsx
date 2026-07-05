'use client'

import React, { createContext, useCallback, useMemo, useContext, useEffect, useState } from 'react'
import { formatMoney, CURRENCY_CODES } from '@/lib/currencies'

const CUR_KEY = 'eno-currency'
const FX_KEY = 'eno-fx'
const FX_MAX_AGE = 12 * 60 * 60 * 1000 // refetch rates if older than 12h

type CurrencyCtx = {
  currency: string
  setCurrency: (c: string) => void
  rates: Record<string, number>
  /** Format a VND amount in the active display currency. */
  format: (amountVnd: number) => string
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
      fetch('/api/fx')
        .then((r) => r.json())
        .then((d) => {
          if (d?.rates && Object.keys(d.rates).length) {
            setRates(d.rates)
            try { localStorage.setItem(FX_KEY, JSON.stringify({ rates: d.rates, at: Date.now() })) } catch { /* ignore */ }
          }
        })
        .catch(() => {})
    }
  }, [])

  const setCurrency = useCallback((c: string) => {
    setCurrencyState(c)
    try { localStorage.setItem(CUR_KEY, c) } catch { /* ignore */ }
  }, [])

  const format = useCallback((amountVnd: number) => formatMoney(amountVnd, currency, rates), [currency, rates])

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
