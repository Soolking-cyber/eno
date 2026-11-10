'use client'

import { Component, type ReactNode } from 'react'

/**
 * ⚠️ A DECORATIVE ISLAND THAT FAILS DRAWS NOTHING, AND THE PAGE AROUND IT STAYS (R22, 2026-11-10).
 *
 * With no boundary of its own, a throw inside an island climbs to `[lang]/error.tsx`, and the whole page becomes
 * "Something went wrong". Measured on live (resilience-01): one card clip chunk that would not load did that to `/`, `/vi`
 * and `/c/rentals`, and the page stayed broken until a reload. This is the same class as error.tsx's `ChromeGuard`.
 *
 * ⛔ ONLY AROUND SOMETHING THE PAGE IS WHOLE WITHOUT. It renders nothing from then on: next/dynamic's React.lazy keeps a
 * failed load, so there is nothing to retry from here (the loader's own one retry is `withOneRetry`, src/lib/import-retry.ts).
 * An island a visitor works (a sheet, the facet bar, the map) needs its fallback and a retry from a tap instead
 * (picker-sheet-kit `retryingLazy`), and nothing that can call redirect() or notFound() goes inside.
 * ⚠️ NO DOM AND NO SUSPENSE: the server HTML is the same with or without it (and the server renderer has no error
 * boundaries; next/dynamic's own Suspense catches its ssr:false bail-out first). React still logs what it caught to the
 * console, so a failure hidden here can be counted.
 */
export class IslandGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
