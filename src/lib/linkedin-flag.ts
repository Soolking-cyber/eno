import { useSyncExternalStore } from 'react'

/**
 * "Sign in with LinkedIn" is offered on THIS page (2026-10-15): set by the teacher pages, which know from the server
 * whether GoTrue has LinkedIn on (src/lib/auth/linkedin.ts), and read by the sign-in form — so the header, the toast and
 * the form's own popup all offer it on teacher pages, and nowhere else. False until a page says so (server render too).
 */
let here = false
// How many mounted flags say "on" — one page can hold two (a page and a dialog), and one unmounting never switches the
// other off.
let ons = 0
const subscribers = new Set<() => void>()

/** One flag's word: `true` adds an "on", `false` takes one back. The button shows while any flag says on. */
export function setLinkedInSignInHere(on: boolean): void {
  ons = Math.max(0, ons + (on ? 1 : -1))
  const next = ons > 0
  if (here === next) return
  here = next
  subscribers.forEach((notify) => notify())
}

export function useLinkedInSignInHere(): boolean {
  return useSyncExternalStore(
    (notify) => { subscribers.add(notify); return () => { subscribers.delete(notify) } },
    () => here,
    () => false,
  )
}
