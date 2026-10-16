import type { Instrumentation } from 'next'
import { logError } from '@/lib/log'

/**
 * THE ONE PLACE EVERY SERVER-SIDE THROW IS REPORTED.
 *
 * ⚠️ WHY A FRAMEWORK HOOK RATHER THAN 265 EDITS. Next calls `onRequestError` for anything that
 * throws while serving a request — a Server Component render, a route handler, a Server Action —
 * and hands over the route, the method and the request headers. Wrapping call sites by hand would
 * cover only the places someone remembered, would miss every throw that nobody caught, and would
 * have to be re-remembered for each new route. This file cannot be forgotten: the framework calls
 * it or nothing does.
 *
 * ⚠️ IT DOES NOT REPLACE `try/catch`. A caught-and-handled error never reaches here, by design —
 * this is the net under the ones nobody expected. Deliberate handling still calls `logError`
 * directly with an `op`, which is what makes those greppable.
 *
 * ⚠️ CLIENT ERRORS DO NOT REACH THIS FILE, AND THAT GAP IS REAL. `src/app/[lang]/error.tsx` and
 * `global-error.tsx` are CLIENT components, so their `console.error` lands in the user's browser
 * devtools and nowhere else. This hook covers the server only. Closing the client half needs an
 * endpoint to POST to, which is an unauthenticated write surface and therefore its own decision
 * (rate limiting, payload caps, abuse) rather than a line in this file.
 *
 * `register()` starts the `[eno-runtime]` stats line (src/lib/runtime-stats.ts, speed plan item 5): event-loop
 * delay, memory and the database pool's queue, every 10 minutes. Node runtime only — the import sits behind the
 * NEXT_RUNTIME check so the edge bundle never sees `node:perf_hooks` — and never while `next build` prerenders.
 */

export async function register(): Promise<void> {
  // ⚠️ Next's documented shape — the import INSIDE the `=== 'nodejs'` branch — is what lets the edge compile drop it.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    try {
      const { startRuntimeStats } = await import('./lib/runtime-stats')
      startRuntimeStats()
    } catch {
      // A stats line is never worth a failed boot.
    }
  }
}

export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  logError(err, {
    op: 'request',
    // Route SHAPE, not the resolved URL — `/listings/[id]` groups in Error Reporting, whereas
    // `/listings/clx123…` produces one bucket per listing and drowns the signal.
    route: context.routePath,
    routeType: context.routeType, // render | route | action | proxy
    renderSource: context.renderSource,
    method: request.method,
    /**
     * ⚠️ PATHNAME ONLY — THE QUERY STRING IS DROPPED, NOT REDACTED.
     * `request.path` is the real URL, and on this app a query string routinely carries whatever the
     * user typed: `/?q=…` on search, filter values, a `handle`. The logger scrubs emails and
     * Vietnamese phone numbers, but a reviewer was right that this is the wrong place to rely on
     * pattern-matching — names, addresses, passport text and foreign numbers all pass it, and Cloud
     * Logging retention outlives any of it.
     *
     * Dropping the query costs nothing diagnostically: `route` above already carries the route
     * SHAPE, which is what groups the error, and the concrete id is in the pathname. If a specific
     * parameter is ever genuinely needed to reproduce a bug, add that ONE key deliberately rather
     * than re-opening the whole string.
     */
    path: pathnameOf(request.path),
    /**
     * ⚠️ NO CLIENT IP, DELIBERATELY — AN EARLIER VERSION LOGGED ONE AND A REVIEWER WAS RIGHT.
     * An IP address is personal data, Cloud Logging retention outlives the incident, and the
     * logger's redaction covers phone numbers and emails rather than addresses. The question it was
     * there to answer — "is one user seeing this, or everyone?" — is already answered by the volume
     * of distinct `digest` values on the same `route`, which costs no personal data at all.
     *
     * Hashing it instead was considered and rejected: a useful hash needs a stable secret, and WS1
     * has just finished removing exactly that pattern from the contact route, where a default salt
     * over a 2^32 input space made the digests reversible. Not collecting it is the version with no
     * failure mode.
     */
    revalidateReason: context.revalidateReason,
  })
}

/**
 * Everything before the `?` or `#`. Kept as string surgery rather than `new URL()` because
 * `request.path` may be relative, and a URL parse would throw on exactly the malformed input most
 * likely to be present when something has already gone wrong.
 */
function pathnameOf(path: unknown): string {
  // ⚠️ TYPED `unknown` ON PURPOSE. Next builds the argument as `{ path: req.url || '', … }`
  // (next/dist/server/base-server.js:451), so it is always a string and the shipped type says so —
  // a reviewer's claim that it is absent and would throw here was checked against that source and
  // is wrong. The guard stays anyway because this file's whole job is to run when something has
  // already gone wrong: Next wraps this hook in its own try/catch and only `console.error`s a
  // throw, so a TypeError here would silently cost every server error report at once. One line is
  // a cheap premium against that.
  if (typeof path !== 'string') return ''
  const cut = path.search(/[?#]/)
  return cut === -1 ? path : path.slice(0, cut)
}

