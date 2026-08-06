import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { apiErrorCode, type ApiErrorCode } from '@/lib/api/errors'

/**
 * THE CONTRACT IS ONLY WORTH ANYTHING IF IT STAYS TRUE.
 *
 * ⚠️ A HAND-MAINTAINED LIST OF 197 STRINGS DECAYS THE WEEK IT LANDS. `errors.ts` was harvested from
 * the routes, and the next handler someone writes will invent a code without thinking about a type
 * two directories away — that is not a discipline problem, it is what a list nobody re-derives
 * always does. So this test RE-HARVESTS the wire on every run and fails when the two disagree.
 *
 * It is deliberately the same grep the file's header documents, so there is one definition of
 * "what the API can return" and it lives in the routes, where the truth is.
 *
 * ⚠️ IT IS A TEXT SCAN, AND THAT IS A REAL LIMIT WORTH STATING. It sees three LITERAL forms (below)
 * and nothing else — a code built from a variable, a template string or a bespoke helper is
 * invisible to it. That covers today's codebase, and it stopped covering it once already: the first
 * route migrated to `route()` moved its code from `{ error: 'x' }` to `throw new ApiError('x')`, and
 * `invalid_locale` disappeared from the scan while still being returned. The test failed, which is
 * how the gap was found — but the next shape will not announce itself. If this ever looks
 * suspiciously easy to pass, check this assumption before believing it.
 */

/**
 * ⚠️ THREE FORMS, BECAUSE THE WRAPPER ADDED TWO. A pre-`route()` handler emits a code as
 * `NextResponse.json({ error: 'x' })`; a migrated one throws `new ApiError('x', 400)` or returns
 * `apiFail('x', 400)`. The harvest missed the new forms the moment the first route migrated —
 * `invalid_locale` vanished from the wire scan while still very much on the wire — and this test
 * caught it, which is the only reason it is right now.
 */
const HARVEST = String.raw`(?:error: '|ApiError\('|apiFail\(')([A-Za-z0-9_.-]+)'`

/** Every `{ error: '…' }` literal in a first-party (non-/api/v1) route handler. */
function codesOnTheWire(): Set<string> {
  const files = execFileSync('git', ['ls-files', 'src/app/api/**/route.ts', 'src/app/api/**/route.svc.ts'], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter((f) => f && !f.includes('/api/v1/'))

  const found = new Set<string>()
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(new RegExp(HARVEST, 'g'))) {
      found.add(m[1])
    }
  }
  return found
}

/** The runtime list inside errors.ts — read as text so the test does not depend on it being exported. */
function codesInTheType(): Set<string> {
  const src = readFileSync('src/lib/api/errors.ts', 'utf8')
  const block = src.slice(src.indexOf('const ALL = ['))
  return new Set([...block.matchAll(/'([A-Za-z0-9_.-]+)',/g)].map((m) => m[1]))
}

describe('the error contract matches the wire', () => {
  const wire = codesOnTheWire()
  const type = codesInTheType()

  it('harvests a plausible number of codes — guards the grep itself', () => {
    // If a refactor changes how routes return errors, the harvest could quietly find nothing and
    // every assertion below would pass vacuously. This is the tripwire for that.
    expect(wire.size).toBeGreaterThan(150)
  })

  it('every code the routes emit is in the type', () => {
    const missing = [...wire].filter((c) => !type.has(c)).sort()
    expect(
      missing,
      `These error codes are returned by a route but absent from src/lib/api/errors.ts, so a client ` +
        `cannot type-check against them. Add them (or better, regenerate — see that file's header).`,
    ).toEqual([])
  })

  it('every code in the type is still emitted by some route', () => {
    // The other direction. A code left behind after its route was deleted is a member of the union
    // that no client will ever see — harmless, but it makes the type a worse description of reality
    // every time it happens.
    const stale = [...type].filter((c) => !wire.has(c)).sort()
    expect(stale, 'These codes are in the type but no route emits them any more — remove them.').toEqual([])
  })
})

describe('apiErrorCode narrows a response body', () => {
  it('recognises a real code', () => {
    expect(apiErrorCode({ error: 'auth_required' })).toBe('auth_required')
  })

  it('rejects an unknown string rather than trusting it', () => {
    // The case that matters: an unrecognised code means the harvest is stale, and silently
    // returning it would let a client believe it type-checked something the type never described.
    expect(apiErrorCode({ error: 'definitely_not_a_real_code' })).toBeNull()
  })

  it.each([null, undefined, 42, 'auth_required', {}, { error: 7 }, { notError: 'auth_required' }])(
    'returns null for %s',
    (body) => {
      expect(apiErrorCode(body)).toBeNull()
    },
  )

  it('is case-sensitive, because the wire is', () => {
    // Both spellings are live (21 sites vs 16), so both are members and neither may be folded into
    // the other by this helper — that would hide the very collision the type exists to expose.
    expect(apiErrorCode({ error: 'forbidden' })).toBe('forbidden')
    expect(apiErrorCode({ error: 'Forbidden' })).toBe('Forbidden')
  })

  it('the narrowed value is assignable to ApiErrorCode', () => {
    const code = apiErrorCode({ error: 'not_found' })
    const typed: ApiErrorCode | null = code // compile-time assertion, kept explicit
    expect(typed).toBe('not_found')
  })
})
