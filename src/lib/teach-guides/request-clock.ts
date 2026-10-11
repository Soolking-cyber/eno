import { cache } from 'react'

/**
 * ONE CLOCK PER REQUEST for the teach pages (the hub and the guide route).
 *
 * `generateMetadata` and the page render separately; with a `new Date()` each, a request straddling
 * midnight in Vietnam — the instant a wave opens (registry.ts) — could get live metadata with a 404 body,
 * or a noindex head on a live page. React's `cache` memoises per request, so both read the same instant.
 */
export const requestNow = cache(() => new Date())
