'use client'

import { useSyncExternalStore } from 'react'

/**
 * THE DELAY TRACE (owner, 2026-10-26: "trace every delay issue and fix"). Every stage of a session marks the time since
 * the trace began — the face's load, then for each turn: speech ended, sent, the reply's text, each part of its voice,
 * the face playing. Printed to the console in development and drawn on the session screen with `?trace=1` (also in a
 * production build, for a real phone). ⛔ Kept in this tab's memory only: never sent, never stored.
 */
export type Mark = { at: number; what: string; note?: string }

let t0 = typeof performance !== 'undefined' ? performance.now() : 0
let marks: Mark[] = []
const subs = new Set<() => void>()
const dev = process.env.NODE_ENV !== 'production'

export function traceVisible(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('trace') === '1'
  } catch {
    return false
  }
}

/** Start a fresh trace (a session's start, then each learner turn). */
export function beginTrace(what: string): void {
  t0 = performance.now()
  marks = []
  mark(what)
}

/** One mark as a line: `+1234ms what · note` (developer-facing, English only). */
export function formatMark(m: Mark): string {
  return `+${m.at}ms ${m.what}${m.note ? ` · ${m.note}` : ''}`
}

export function mark(what: string, note?: string): void {
  const m: Mark = { at: Math.round(performance.now() - t0), what, ...(note ? { note } : {}) }
  marks = [...marks, m].slice(-40)
  if (dev || traceVisible()) console.info(`[trace] ${formatMark(m)}`)
  subs.forEach((f) => f())
}

export function useTrace(): Mark[] {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f) } },
    () => marks,
    () => marks,
  )
}
