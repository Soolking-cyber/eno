'use client'

import React, { createContext, useCallback, useLayoutEffect, useMemo, useContext, useEffect, useState } from 'react'

/** ⚠️ `useLayoutEffect` WARNS ON THE SERVER, AND THIS PROVIDER IS SSR'd ON EVERY PAGE. React logs
 *  "useLayoutEffect does nothing on the server" for any client component rendered there, so the
 *  hook has to degrade to `useEffect` where there is no layout to read. A reviewer caught the
 *  unguarded version. The layout timing is only wanted in the browser anyway — that is the whole
 *  reason it is not a plain effect. */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
import { formatMoney, CURRENCY_CODES } from '@/lib/currencies'
import type { MoneyLocale } from '@/lib/vnd'

const CUR_KEY = 'eno-currency'
const FX_KEY = 'eno-fx'
const FX_FAIL_KEY = 'eno-fx-fail'
/** How long a remembered /api/fx failure suppresses the reserved approximation slot. Matched to
 *  FX_MAX_AGE so a reader whose rates are unreachable is asked again on the same cadence as one
 *  whose cached rates went stale. */
const FX_FAIL_TTL = 12 * 60 * 60 * 1000
/**
 * ⛔ ONE PREDICATE FOR "ARE THE RATES ANY USE", AND THREE PLACES USED TO DISAGREE. <Price> decides
 * whether to draw the approximation with `vndPerUsd(rates)`; the cache-freshness check and the
 * failure memory each asked something weaker — "does the table have any keys at all". A reviewer
 * walked the gap: an /api/fx table that answers 200 with rates but no usable USD entry satisfies
 * the weak test and fails the real one, so no failure was remembered, the cache stayed "fresh",
 * no refresh ran, and every page view reserved the slot and then collapsed it. Permanently, for
 * every reader — the exact shift this mechanism exists to remove, made unconditional.
 * ⚠️ KEEP THIS AS THE ONLY QUESTION ANYTHING IN THIS FILE ASKS ABOUT A RATE TABLE. Two copies of a
 * rule are equal only until one of them changes, which is the same lesson vndPerUsd itself carries.
 */
const FX_USABLE = (r: Record<string, number>) => vndPerUsd(r) !== null
const FX_MAX_AGE = 12 * 60 * 60 * 1000 // refetch rates if older than 12h

type CurrencyCtx = {
  currency: string
  setCurrency: (c: string) => void
  rates: Record<string, number>
  /** True until the first rate table has either landed or failed. The ONLY consumer is layout
   *  reservation: <Price> renders an invisible stand-in for the "≈ $x" approximation while this
   *  is true, so the slot occupies its eventual width in the SSR HTML instead of appearing ~600ms
   *  later and dropping the whole desktop buy box by a line. It must NEVER gate a real figure —
   *  a pending rate table is not a reason to hide a price. */
  ratesPending: boolean
  /** Format a VND amount in the active display currency. Pass the viewer's
   *  money locale (moneyLocale(lang)) for Vietnamese-native separators; the
   *  default 'en' keeps the international style. */
  format: (amountVnd: number, locale?: MoneyLocale) => string
}

const CurrencyContext = createContext<CurrencyCtx | undefined>(undefined)

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState('VND')
  const [rates, setRates] = useState<Record<string, number>>({})
  // ⚠️ STARTS TRUE ON THE SERVER AND ON THE FIRST CLIENT RENDER, deliberately: that is what makes
  // the reserved slot part of the SSR HTML and keeps hydration identical. It is cleared the moment
  // the rates are known — including when they are known to be UNAVAILABLE, so a broken /api/fx
  // collapses the placeholder once rather than leaving a permanent blank beside every price.
  const [ratesPending, setRatesPending] = useState(true)

  /**
   * ⛔ THE COHORT WHOSE /api/fx NEVER ANSWERS PREVIOUSLY HAD **ZERO** MOVEMENT, AND RESERVING THE
   * SLOT TOOK THAT AWAY. A reviewer found it and it is the sharpest objection to this whole
   * mechanism: with rates unreachable, `approx` used to be null from first paint and nothing ever
   * moved. With the reservation, that reader gets the stand-in, the 12s ceiling fires, and every
   * price on the page collapses at once — a shift where there was none, and 12s in it is well past
   * the 500ms input window, so it counts against CLS in full.
   * ⛔ IT CANNOT BE FIXED ON THE FIRST LOAD — nothing on the server or at mount knows the request
   * will fail — so it is fixed on the SECOND: a failure is remembered, and while that memory is
   * warm the slot is never reserved. The affected reader pays the collapse once, then behaves
   * exactly as they did before this change.
   * ⚠️ `useLayoutEffect`, NOT `useState` INITIALIZER: the initializer runs on the server too, where
   * localStorage does not exist and the answer would differ from the client's — a hydration
   * mismatch on every price in the feed. Reading it after hydration but BEFORE paint gets the same
   * result with none of that: the reserved span never reaches the screen.
   * ⚠️ ORDER MATTERS — this runs before the effect below arms anything, so a remembered failure
   * short-circuits the reservation rather than racing it.
   */
  useIsoLayoutEffect(() => {
    try {
      const at = Number(localStorage.getItem(FX_FAIL_KEY) || 0)
      if (at && Date.now() - at < FX_FAIL_TTL) setRatesPending(false)
    } catch { /* storage blocked */ }
  }, [])

  useEffect(() => {
    // ⚠️ `cancelled` GUARDS A CALLBACK THAT OUTLIVES THE EFFECT. `refresh` is handed to
    // requestIdleCallback (up to a 10s timeout) or a 4s setTimeout, neither of which is cancelled
    // on unmount — so without this the deadline timer below could be ARMED after teardown and
    // never cleared by the cleanup that already ran. The provider sits at the app root and does
    // not realistically unmount, which is exactly why the leak would never be noticed.
    let cancelled = false
    let deadline: ReturnType<typeof setTimeout> | null = null
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
        // ⛔ `fresh` MUST ASK THE RENDER'S QUESTION, NOT A WEAKER ONE. See FX_USABLE below: a
        // cached table with entries but no usable USD rate produced `fresh = true`, so no refresh
        // ran, so nothing ever cleared `ratesPending` except the 12s deadline — reserve then
        // collapse, on every single page view, forever. A reviewer found it.
        if (r && Object.keys(r).length) { setRates(r); fresh = FX_USABLE(r) && Date.now() - (at || 0) < FX_MAX_AGE }
      }
    } catch { /* ignore */ }
    if (fresh) setRatesPending(false)
    if (!fresh) {
      // ⛔ `.finally()` ALONE DOES NOT BOUND `ratesPending`, AND ABORTING THE FETCH IS THE WRONG
      // FIX. A reviewer caught the first hole: `.finally()` runs on SETTLEMENT, so a response that
      // connects and then never completes never settles, and the reserved approximation slot stays
      // blank beside every price for the life of the page.
      // ⛔ THE OBVIOUS ANSWER — `AbortSignal.timeout(8000)` — WAS WRITTEN AND REVERTED, because it
      // trades a layout nicety for the rates themselves. This app's readers are in Vietnam, plenty
      // of them on mobile data where an 8s /api/fx is slow but not broken; there is no retry after
      // this one call, so killing it means that reader never gets converted prices AT ALL. The
      // deadline therefore releases the LAYOUT and lets the request run to completion — see the
      // 12s ceiling below for where the clock actually starts.
      // ⚠️ ON THAT SLOWEST PATH THE LINE MOVES TWICE, NOT ONCE, and a reviewer was right to say so:
      // the slot collapses at 12s and re-expands if the rates land at 15s. That is worse than one
      // shift and better than the alternative, which is holding blank space beside every price
      // indefinitely on a request that may never answer. It is bounded, rare, and long after the
      // reader has started reading — unlike the 620ms drop this whole change exists to remove.
      // ⚠️ The timer is cleared by `.finally()` on the normal path and by the effect cleanup on
      // unmount, so neither the fast case nor a navigation leaves it running.
      const refresh = () => {
        if (cancelled) return
        return fetch('/api/fx')
          .then((r) => r.json())
          .then((d) => {
            if (cancelled) return
            // ⛔ STORE THE TABLE ON ITS OWN MERITS, AND JUDGE IT SEPARATELY. This read
            // `FX_USABLE(d.rates)` for one round and a reviewer caught the blast radius: these
            // rates render the ACTUAL PRICE for a viewer whose display currency is EUR or KRW, and
            // gating the store on a usable USD entry threw their whole table away over a currency
            // they are not looking at. FX_USABLE answers one question — "will there be an
            // approximation to reserve space for" — so it belongs on the failure memory below,
            // never on whether we keep what the endpoint gave us.
            if (d?.rates && Object.keys(d.rates).length) {
              setRates(d.rates)
              // A usable table clears the failure memory, so one bad network moment does not
              // suppress the reservation for the next 12 hours. A table that arrived but carries
              // no usable USD rate is stored — it still converts prices — and remembered as a
              // failure for the RESERVATION, because it will never produce an approximation.
              try {
                localStorage.setItem(FX_KEY, JSON.stringify({ rates: d.rates, at: Date.now() }))
                if (FX_USABLE(d.rates)) localStorage.removeItem(FX_FAIL_KEY)
                else localStorage.setItem(FX_FAIL_KEY, String(Date.now()))
              } catch { /* ignore */ }
            } else {
              // A 200 with no usable rate table is a failure for our purposes: it produces no
              // approximation, so reserving space for one on the next load would shift again.
              try { localStorage.setItem(FX_FAIL_KEY, String(Date.now())) } catch { /* ignore */ }
            }
          })
          .catch(() => { try { localStorage.setItem(FX_FAIL_KEY, String(Date.now())) } catch { /* ignore */ } })
          .finally(() => { if (deadline) { clearTimeout(deadline); deadline = null } if (!cancelled) setRatesPending(false) })
      }
      // ⛔ THE DEADLINE IS ARMED HERE, NOT INSIDE `refresh`, AND THAT WAS THE SECOND REVIEW ROUND.
      // Arming it when the fetch starts sounds right and is not: for the default VND viewer
      // `refresh` is deferred to an idle slot that can wait its full 10s timeout, so an 8s
      // fetch-relative deadline meant up to 18s of blank reserved space (12s on the setTimeout
      // fallback). The number that matters to a reader is how long the slot can stay empty, so the
      // clock starts at mount and covers the whole window: defer + request.
      // ⚠️ 12s, and it is a CEILING not a target — the normal path clears it in `.finally()` long
      // before, and a VND viewer's rates are wanted for a quiet second line, not for the price.
      deadline = setTimeout(() => {
        if (cancelled) return
        setRatesPending(false)
        // The request may still be in flight — see above, it is deliberately not aborted — but a
        // reader who waited 12s for it should not be asked to wait again on the next page.
        try { localStorage.setItem(FX_FAIL_KEY, String(Date.now())) } catch { /* ignore */ }
      }, 12_000)
      // Perf Phase 1: a VND user (the default) doesn't need rates to paint anything —
      // defer the refresh to a post-load idle slot so it never competes with LCP.
      // A non-VND user needs them for the very first price render → fetch now.
      let cur = 'VND'
      try { cur = localStorage.getItem(CUR_KEY) || 'VND' } catch { /* storage blocked */ }
      if (cur !== 'VND') refresh()
      else if (typeof requestIdleCallback === 'function') requestIdleCallback(() => refresh(), { timeout: 10_000 })
      else setTimeout(refresh, 4000)
    }
    return () => { cancelled = true; if (deadline) clearTimeout(deadline) }
  }, [])

  const setCurrency = useCallback((c: string) => {
    setCurrencyState(c)
    try { localStorage.setItem(CUR_KEY, c) } catch { /* ignore */ }
  }, [])

  const format = useCallback((amountVnd: number, locale?: MoneyLocale) => formatMoney(amountVnd, currency, rates, locale), [currency, rates])

  const value = useMemo(() => ({ currency, setCurrency, rates, ratesPending, format }), [currency, setCurrency, rates, ratesPending, format])

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
