/**
 * A time limit for a client fetch whose placeholder holds part of the page until it answers.
 * Undefined where the browser has no AbortSignal.timeout (Safari before 16, Chrome before 103): such a
 * call throws at once, in an effect, which would take the page down with it, and no limit is the
 * behaviour those browsers had anyway.
 */
export function fetchTimeLimit(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined
}
