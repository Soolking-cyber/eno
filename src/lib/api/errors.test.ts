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
  for (const c of codesReachingTheWireThroughAVariable(files)) found.add(c)
  return found
}

/**
 * ⚠️ THE CODES THE TEXT SCAN STRUCTURALLY CANNOT SEE — DERIVED AND RE-VERIFIED, NOT ALLOWLISTED.
 *
 * The scan above matches a string LITERAL next to `error:` / `ApiError(` / `apiFail(`. Two families
 * reach the wire through a VARIABLE instead, so it found neither, and all ten sat outside
 * `ApiErrorCode` while the app returned them every day. `apiErrorCode()` answered `null` for the
 * single most common refusal in the product. This is the same blind spot that briefly swallowed
 * `'reserved'`; the difference is that one announced itself by failing this test, and these did not.
 *
 * ⚠️ THE POINT IS THAT THIS IS NOT A LIST OF EXEMPTIONS. Each entry is re-derived from source on
 * every run and each is conditioned on the emitting code still existing, so deleting the route or
 * the union makes its codes go stale again exactly as they should. A hardcoded exemption list would
 * quietly become the next thing that is wrong.
 */
function codesReachingTheWireThroughAVariable(routeFiles: string[]): string[] {
  const out: string[] = []

  // 1. PublishBlockCode — `POST /api/listings` and `PATCH /api/listings/[id]` catch a
  //    PublishBlockedError and answer `{ error: e.code }`, so the WHOLE union is on the wire.
  //    Conditioned on a route actually re-emitting it; derived from the union's own declaration.
  //
  // ⚠️ THE CONDITION IS "CATCHES IT **AND** RE-EMITS `.code`", ON COMMENT-STRIPPED SOURCE — and
  // every one of those clauses replaces a bug that a review caught in the first draft. Each made the
  // condition permanently true, which would turn this whole function into the blanket exemption its
  // header promises it is not:
  //   · `.includes('PublishBlockedError')` matched the identifier in these files' own PROSE.
  //   · it is a SUBSTRING test, so renaming the symbol to `PublishBlockedErrorX` still satisfied it.
  //   · merely CATCHING the error is not emitting its code — a route that swaps
  //     `{ error: e.code }` for a generic 500 would keep all twelve codes marked as on-wire.
  // The re-emission site this is really asserting is `src/app/api/listings/route.ts`'s
  // `{ error: e.code, detail: e.detail }`.
  // ⚠️ A BACKREFERENCE, BECAUSE PROXIMITY IS NOT COUPLING. This condition took three attempts and
  // each intermediate version was provably vacuous — the mutation that exposed each is worth
  // knowing, since the failure mode is a check that looks rigorous and asserts nothing:
  //   1. `.includes('PublishBlockedError')` — matched the identifier in the file's own PROSE, and
  //      being a substring test it also accepted `PublishBlockedErrorX`.
  //   2. `\bPublishBlockedError\b` AND `error:\s*\w+\.code` as INDEPENDENT tests — proves only that
  //      both strings exist somewhere in the file.
  //   3. the two joined by a 400-character window — still just proximity: a route that catches the
  //      error, answers a generic 500, and emits `{ error: db.code }` for an unrelated failure a few
  //      lines below passed cleanly.
  // Capturing the identifier the `instanceof` binds and requiring `error: <that same identifier>
  // .code` is what finally ties the emission to the branch. `\1` is doing the real work here.
  //
  // ⚠️ IT IS STILL A HEURISTIC, AND SAYING SO IS THE POINT — a regex cannot match balanced braces,
  // so a file that catches `e instanceof PublishBlockedError`, answers generically, and then emits
  // `{ error: e.code }` for a DIFFERENT error reusing the name `e` within 400 characters would pass.
  // That is contrived but not impossible (review raised it), and the honest framing is that the real
  // guarantee lives elsewhere: `PublishBlockCode extends ApiErrorCode` is asserted at COMPILE time
  // in errors.ts, so no publish code can go missing from the union whatever this function decides.
  // What this function affects is only whether those codes count as on-wire — and both ways it can
  // be wrong produce a loud red suite (a spurious "stale code", or the throw below), never a silent
  // wire bug. A guard whose worst case is a false alarm is allowed to be a heuristic; one whose
  // worst case is a false pass is not.
  const reEmitters = routeFiles.filter((f) =>
    // ⚠️ `PublishBlockedError\b` — the word boundary is load-bearing and was LOST once already while
    // adding the backreference above, which silently re-opened flaw (1): without it,
    // `PublishBlockedErrorX` matches by prefix. Re-caught by re-running the mutation battery rather
    // than by reading, which is the argument for keeping that battery.
    /(\w+)\s+instanceof\s+PublishBlockedError\b[\s\S]{0,400}?\berror:\s*\1\.code\b/.test(stripComments(readFileSync(f, 'utf8'))),
  )
  if (reEmitters.length) {
    // ⚠️ A LINE SCAN, NOT A TERMINATOR REGEX, AND THE THIRD SHAPE THIS PARSE HAS TAKEN.
    // `[^\n]+` broke on a multi-line reformat (one member, tripping the floor below and throwing on
    // a cosmetic change). Its replacement read to `(?:\n\n|\nexport |\n\/\*)`, which review showed
    // is worse in a subtler way: `stripComments` leaves the newlines around a stripped JSDoc, so a
    // doc comment BETWEEN two members becomes a blank line, the capture stops mid-union at say 8 of
    // 12, the `< 5` floor waves it through, and the four survivors report as "stale codes" — a red
    // suite pointing at the union instead of at the parser. It also matched nothing at all if the
    // declaration ended the file.
    // Consuming the declaration line plus every following blank-or-`|` line handles all four
    // shapes: one-liner, reformatted, JSDoc-interrupted, and end-of-file.
    // ⚠️ COMMENT-STRIPPED TOO, AND THIS IS THE ONE THAT MATTERS MOST — it is the only file whose
    // string LITERALS are harvested, so a comment near the union carrying a quoted example would be
    // read as a wire code and silently widen the exemption. The draft stripped comments from the
    // route files and not from this one; a reviewer pointed out the omission sat directly under a
    // paragraph arguing that membership tests over commented source are guilty until proven
    // otherwise. (`SharedApiErrorCode` in this very file carries trailing `// 89` counts, so
    // commented unions are the local norm, not a hypothetical.)
    const lines = stripComments(readFileSync('src/lib/publish-guard.ts', 'utf8')).split('\n')
    const start = lines.findIndex((l) => /export type PublishBlockCode\s*=/.test(l))
    if (start === -1) throw new Error('PublishBlockCode declaration not found — fix this derivation')
    const decl: string[] = [lines[start]]
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].trim() === '' || lines[i].trim().startsWith('|')) decl.push(lines[i])
      else break
    }
    const members = [...decl.join('\n').matchAll(/'([A-Za-z0-9_.-]+)'/g)].map((m) => m[1])
    // Guard the derivation itself: a change that breaks the parse must fail LOUDLY, not silently
    // contribute nothing (which re-opens the hole) or contribute a truncated set (which reports the
    // survivors as stale). The floor is deliberately close to the real count — 12 today — so a
    // partial parse is caught rather than waved through the way `< 5` would have been.
    if (members.length < 10) {
      throw new Error(`PublishBlockCode union parsed as ${members.length} members — fix this derivation`)
    }
    out.push(...members)
  }

  // 2. One-off COMPUTED codes: `{ error: cond ? 'x' : y }` puts an identifier after `error:`.
  //    Each is pinned to the file that emits it and only counts while that file still contains it.
  // 2. ⚠️ THERE IS DELIBERATELY NO SECOND FAMILY, AND THE ONE THAT WAS HERE IS WORTH REMEMBERING.
  //    `visa_schema_not_ready` is also invisible to the scan — it is computed,
  //    `{ error: missing ? 'visa_schema_not_ready' : message }` at
  //    src/app/api/visa/applications/route.svc.ts:261 — and a draft of this file added it to the
  //    union with a per-code "does that file still contain the literal" pin. Two things killed it:
  //      · it is emitted ONLY by `.svc.ts` routes, so on the marketplace edition it would be
  //        vocabulary for a route that does not exist — and `ALL` is a RUNTIME array, so it would
  //        put a visa-named string into eno.vn's bundle the day `lib/api/client.ts` gains its first
  //        production importer. CLAUDE.md makes that a licensing boundary, not a style question.
  //      · the pin was weak anyway: a literal surviving in a constant, a log line or dead code kept
  //        the code "on the wire" after the emission was gone.
  //    So it stays out, and stays invisible, exactly as it was before. The right fix is an edition
  //    split of this vocabulary; see the note in errors.ts. Do not re-add it without that.

  return out
}

/**
 * Remove `//` and block comments so a claim about what a file EMITS is not satisfied by a file that
 * merely TALKS about emitting it. This codebase comments unusually heavily — several routes discuss
 * their own error codes at length — so on this repo that distinction is the difference between a
 * real check and a decorative one.
 *
 * ⚠️ INLINE `//`, NOT JUST WHOLE-LINE. The first draft anchored the pattern with `^`, so it stripped
 * only comments that START a line — and a trailing `// … PublishBlockedError …` on a line of real
 * code sailed straight through and satisfied the guard. Review caught it; it is the same species of
 * near-miss as the substring test above, and it is why every clause here is spelled out.
 *
 * Deliberately naive (it does not understand `//` inside a string or a regex literal), because the
 * only consumers are the two membership tests above; over-matching can only make a check STRICTER,
 * never vacuous, which is the safe direction for a guard to fail in.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** The runtime list inside errors.ts — read as text so the test does not depend on it being exported. */
function codesInTheType(): Set<string> {
  // ⚠️ COMMENT-STRIPPED, FOR CONSISTENCY WITH EVERY OTHER HARVEST IN THIS FILE. Two things already
  // protect this one — the slice starts at `const ALL = [`, and the pattern demands a trailing
  // comma, so a quoted code mentioned in the prose ABOVE the array cannot become a phantom member
  // (measured: it does not). But `errors.ts` now carries JSDoc quoting real code names, this file
  // argues at length that a membership test over commented source is guilty until proven otherwise,
  // and leaving the type-side harvest as the one un-stripped exception is how the next trap gets
  // set. Stripping first makes the guarantee structural rather than incidental.
  const src = stripComments(readFileSync('src/lib/api/errors.ts', 'utf8'))
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
