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
  // ⚠️ `route.forum.svc.ts` IS IN THE HARVEST TOO. Two routes carry that stricter infix — the visa
  // checkout and payment-confirm — because eno.vn must never compile them at any flag setting
  // (owner: "remove paypal checkout from eno.vn only on eno.forum"; see FORUM_ONLY_EXTENSIONS in
  // next.config.ts). They are still live routes on eno.forum and still emit codes, so leaving them
  // out of this glob made 11 codes look unemitted — including `checkout_failed` — and this suite
  // would have told the next reader to DELETE them from the type.
  const files = execFileSync('git', ['ls-files', 'src/app/api/**/route.ts', 'src/app/api/**/route.svc.ts', 'src/app/api/**/route.forum.svc.ts'], {
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
/**
 * The helper unions a route re-emits verbatim. `floor` is the member count guard — see
 * `unionMembers`. Adding a row is how a newly-NAMED helper union becomes visible to this harvest;
 * naming the union in the first place is what makes the compile-time assertion in errors.ts
 * possible, and that assertion is the real guarantee. This table only decides on-wire-ness.
 */
const RE_EMITTED_UNIONS = [
  { fn: 'updateListingCore', type: 'ListingUpdateErrorCode', file: 'src/lib/core/listings.ts', floor: 5 },
  { fn: 'setStatusCore', type: 'ListingStatusErrorCode', file: 'src/lib/core/listings.ts', floor: 2 },
  { fn: 'updateSellerCore', type: 'SellerUpdateErrorCode', file: 'src/lib/core/seller.ts', floor: 7 },
  // ⚠️ THESE THREE ARE A LAYER DEEPER, AND THAT LAYER IS WHY FIFTEEN CODES WERE MISSING. They are
  // not route helpers — they are LIBRARY flows that emit through an internal `fail(code)`, one step
  // below anything the route-file scan can see. `human_help_pending` is the tell: errors.ts's own
  // header cites `messages/[id]/page.tsx  data?.error === 'human_help_pending'` as its example of a
  // client branching on a code, and it was not a member of the union the header introduces.
  // The wire is not only what routes write; it is what everything routes delegate to writes.
  { fn: 'advanceVisaDmFlow', type: 'VisaDmErrorCode', file: 'src/lib/visa/dm-flow.ts', floor: 20 },
  { fn: 'askVisaConcierge', type: 'VisaConciergeErrorCode', file: 'src/lib/visa/concierge.ts', floor: 6 },
  { fn: 'requestAssistance', type: 'AssistanceError', file: 'src/lib/trips/assistance.ts', floor: 4 },
] as const

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
    out.push(...unionMembers('src/lib/publish-guard.ts', 'PublishBlockCode', 10))
  }

  // 2. One-off COMPUTED codes: `{ error: cond ? 'x' : y }` puts an identifier after `error:`.
  //    Each is pinned to the file that emits it and only counts while that file still contains it.
  // 2. HELPER UNIONS RE-EMITTED AS `{ error: <result>.error }`. A route calls a core helper and
  //    hands its code straight to the client, so the helper's union IS an API union. There are 40
  //    such sites; these are the ones whose helper return type is NAMED (the rest still say
  //    `error: string`, and until a union is named neither the compiler nor this harvest can see
  //    what it puts on the wire — that is how eleven live codes went missing).
  //
  //    Same backreference discipline as family 1: bind the identifier the helper is assigned to and
  //    require the re-emission to read `.error` off THAT identifier. Two independent matches would
  //    pass on any file that calls the helper and separately emits some other result's `.error`,
  //    which describes most routes in this tree.
  for (const { fn, type, file, floor } of RE_EMITTED_UNIONS) {
    const emits = routeFiles.some((f) =>
      new RegExp(String.raw`(\w+)\s*=\s*await\s+${fn}\b[\s\S]{0,400}?\berror:\s*\1\.error\b`)
        .test(stripComments(readFileSync(f, 'utf8'))),
    )
    if (emits) out.push(...unionMembers(file, type, floor))
  }

  // 3. COMPUTED codes — `{ error: cond ? 'x' : y }` puts an identifier after `error:`, so the
  //    literal scan skips the whole expression. Today that is exactly one code.
  //
  //    ⚠️ MATCHED INSIDE THE `error:` VALUE, NOT ANYWHERE IN THE FILE. A draft pinned this with
  //    "does that file still contain the literal", which review correctly called vacuous: the string
  //    surviving in a constant, a log line or dead code would keep the code marked on-wire after the
  //    emission was gone. Requiring it to sit within the `error:` expression itself is what makes
  //    deleting the ternary turn this red.
  //
  //    ⚠️ IT IS A SERVICES CODE AND THAT IS NOW SAFE TO SAY. An earlier attempt added it to `ALL`,
  //    which would have put a visa-named string in eno.vn's runtime array; it lives in
  //    `errors-services.ts` instead, aliased to an empty stub on a marketplace build.
  for (const [code, file] of [
    ['visa_schema_not_ready', 'src/app/api/visa/applications/route.svc.ts'],
  ] as const) {
    if (!routeFiles.includes(file)) continue
    if (new RegExp(String.raw`\berror:\s*[^,}]*?'${code}'`).test(stripComments(readFileSync(file, 'utf8')))) {
      out.push(code)
    }
  }

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
/**
 * Extract the string-literal members of a named TS union, from comment-stripped source.
 *
 * ⚠️ A LINE SCAN, NOT A TERMINATOR REGEX, AND THE THIRD SHAPE THIS PARSE HAS TAKEN. `[^\n]+` broke
 * on a multi-line reformat (one member, tripping the floor and throwing on a cosmetic change). Its
 * replacement read to `(?:\n\n|\nexport |\n/*)`, which is worse in a subtler way: `stripComments`
 * leaves the newlines around a stripped JSDoc, so a doc comment BETWEEN two members becomes a blank
 * line, the capture stops mid-union at say 8 of 12, and the survivors report as "stale codes" — a
 * red suite pointing at the union instead of at the parser. It also matched nothing at all when the
 * declaration ended the file. Consuming the declaration line plus every following blank-or-`|` line
 * handles all four shapes: one-liner, reformatted, JSDoc-interrupted, end-of-file.
 *
 * `floor` must sit just under the real member count. It exists so a change that breaks the parse
 * fails LOUDLY rather than silently contributing nothing (re-opening the hole this file exists to
 * close) or contributing a truncated set. A floor far below the count — `< 5` against 12 — waves a
 * partial parse straight through, which is how the first draft would have failed.
 */
function unionMembers(file: string, typeName: string, floor: number): string[] {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
  const start = lines.findIndex((l) => new RegExp(`export type ${typeName}\\s*=`).test(l))
  if (start === -1) throw new Error(`${typeName} declaration not found in ${file} — fix this derivation`)
  const decl: string[] = [lines[start]]
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === '' || lines[i].trim().startsWith('|')) decl.push(lines[i])
    else break
  }
  const members = [...decl.join('\n').matchAll(/'([A-Za-z0-9_.-]+)'/g)].map((m) => m[1])
  if (members.length < floor) {
    throw new Error(`${typeName} parsed as ${members.length} members (floor ${floor}) — fix this derivation`)
  }
  return members
}

/**
 * Split `src` into the source a MARKETPLACE build compiles and the `.svc` source it does not, read
 * ONCE. Tests are excluded (never shipped) and `errors*.ts` is excluded (the vocabulary lists are
 * declarations, not emissions).
 *
 * ⚠️ INDEXED ONCE, NOT PER CODE, AND THE FIRST DRAFT WAS O(codes x files). It re-ran `git ls-files`
 * and re-read ~780 files for each of 186 codes — roughly 145,000 reads, which passed once at 4.9s
 * and then TIMED OUT at vitest's 5s default. Worth recording because of how it failed: a timeout is
 * reported as a red test, so for one confusing round the mutation battery showed every mutation
 * "failing" including the unmutated baseline. A guard that is too slow does not degrade gracefully,
 * it degrades into noise that looks like signal.
 */
const SOURCE_HALVES = (() => {
  const files = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
    .trim().split('\n')
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes('lib/api/errors'))
  let services = ''
  let marketplace = ''
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    if (f.includes('.svc.')) services += src
    else marketplace += src
  }
  return { services, marketplace }
})()

/** True when a code's literal appears in `.svc` source and in NO marketplace-compiled file. */
function onlyEmittedByServices(code: string): boolean {
  const lit = `'${code}'`
  return SOURCE_HALVES.services.includes(lit) && !SOURCE_HALVES.marketplace.includes(lit)
}

/** The services-edition runtime list, read as text so this test does not depend on the alias. */
function codesInServicesList(): string[] {
  const src = stripComments(readFileSync('src/lib/api/errors-services.ts', 'utf8'))
  const block = src.slice(src.indexOf('SERVICES_ALL = ['))
  return [...block.matchAll(/'([A-Za-z0-9_.-]+)',/g)].map((m) => m[1])
}

/**
 * Every member of the `ApiErrorCode` TYPE — the two union declarations, not the runtime array.
 * ⚠️ Read separately from `codesInTheType()`, which despite its name reads `ALL`. Keeping both is
 * what lets the edition test assert the type stayed WHOLE while only the array was split.
 */
function typeUnionMembers(): Set<string> {
  return new Set([
    ...unionMembers('src/lib/api/errors.ts', 'SharedApiErrorCode', 20),
    ...unionMembers('src/lib/api/errors.ts', 'NicheApiErrorCode', 100),
  ])
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** The runtime list inside errors.ts — read as text so the test does not depend on it being exported. */
function codesInMarketplaceAll(): Set<string> {
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

/**
 * The COMPLETE runtime vocabulary — both editions' arrays — which is exactly what `apiErrorCode()`
 * recognises when it is not aliased.
 *
 * ⚠️ THE TWO CONTRACT TESTS BELOW MUST USE THIS, NOT `codesInMarketplaceAll()`. The wire harvest
 * scans `route.svc.ts` files as well as `route.ts`, so a services code IS on the wire; checking it
 * against the marketplace half alone would report all eight as both "emitted but untyped" and
 * "typed but unemitted" at once. Only the edition test above wants the marketplace half in
 * isolation, and it wants it precisely because that is the array that ships to eno.vn.
 */
function codesInTheType(): Set<string> {
  return new Set([...codesInMarketplaceAll(), ...codesInServicesList()])
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

/**
 * ⚠️ THE EDITION BOUNDARY, ENFORCED RATHER THAN DOCUMENTED.
 *
 * `ALL` is a RUNTIME array in a module that `src/lib/api/client.ts` imports, and client.ts exists to
 * be adopted by the 176 hand-rolled fetch call sites — so `errors.ts` sits on a path into eno.vn's
 * client chunks. Eight codes name the visa/itinerary surfaces the licensed marketplace may not
 * mention, so they live in `errors-services.ts`, which `next.config.ts` aliases to an empty stub on
 * a marketplace build. That alias is what removes the strings from the ARTIFACT; a call-site gate
 * could not (see scripts/edition-lint.mjs RULE C, and the sitemap leak that produced it).
 *
 * The alias is only as good as the split, and nothing structural stops someone appending
 * `'visa_foo'` to `ALL` — which is why this runs on every test run instead of living in a comment.
 */
describe('the error vocabulary respects the edition boundary', () => {
  /**
   * ⚠️ THIS MATCHES SERVICES *VOCABULARY*, NOT SERVICES-ONLY *EMISSION*, AND THE DIFFERENCE IS A
   * MEASURED GAP RATHER THAN A HYPOTHETICAL ONE. The leak this file guards is a prohibited WORD
   * reaching eno.vn's bundle, so a name-based rule is the right shape for that harm — `body_too_large`
   * shipping to the marketplace tells a reader nothing about visa, while `visa_database_unavailable`
   * does.
   *
   * But it is not the same question as "which codes belong to the services edition". Measured
   * 2026-08-06: **48 codes in `ALL` are emitted only by `route.svc.ts` handlers**, of which this
   * regex catches the eight that happen to be named after the surface. The other 40 are vocabulary
   * for routes a marketplace build does not compile — harmless as strings, but a more honest split
   * would move them.
   *
   * ⚠️ IT WAS NOT DONE HERE BECAUSE THE OBVIOUS MECHANICAL RULE IS WRONG. "Emitted only by
   * `.svc.ts`" has at least one false positive: `invalid_request` is also emitted by
   * `src/app/api/v1/oauth/token/route.ts`, a MARKETPLACE route excluded from that scan because
   * `/api/v1` is a different error envelope entirely. A correct rule has to reason about `/api/v1`
   * and about codes reachable through shared `src/lib` helpers, and moving 40 entries out of a
   * shared runtime array on a rule with a known hole is how the next silent breakage gets written.
   * Two reviewers raised the regex's narrowness; this is the honest answer to it.
   */
  const SERVICES_VOCABULARY = /visa|itinerar|paypal|evisa/i

  it('no code in the marketplace ALL array is emitted only by .svc routes', () => {
    /**
     * ⚠️ THE MECHANICAL RULE, AND IT REPLACES A VOCABULARY GUESS. The first version of this test
     * matched code NAMES against /visa|itinerar|paypal|evisa/, which is the right shape for the
     * narrow harm (a prohibited WORD in eno.vn's bundle) and the wrong shape for the question
     * actually being asked — which codes belong to the services edition at all. It caught 8 of 35.
     *
     * ⚠️ IT IS A LOWER BOUND, NOT A DECISION PROCEDURE, AND THE GAP IS REAL RATHER THAN THEORETICAL.
     * The question that actually decides membership is EDITION REACHABILITY — can a route a
     * marketplace build compiles actually emit this code — and a grep cannot compute that. Fifteen
     * members of `SERVICES_ALL` are there on a reachability argument this test cannot see: they are
     * emitted by `src/lib/visa/{dm-flow,concierge}.ts` and `src/lib/trips/assistance.ts`, plain
     * `.ts` libraries the marketplace build compiles, so their literals ARE in non-`.svc` source.
     * They belong to the services edition anyway because `advanceVisaDmFlow` / `askVisaConcierge` /
     * `requestAssistance` have no marketplace-route caller at all, and the one flow that does
     * (`startVisaDmFlow`, from `api/conversations/route.ts`) sits behind `scopedListingWhere`, which
     * excludes the desk's listings on eno.vn.
     *
     * So this test catches the EASY direction and nothing more. It cannot be strengthened into the
     * real rule without modelling reachability, and an earlier attempt to do so by testing textual
     * presence produced the opposite of the right answer — it demanded two codes move INTO the
     * marketplace array, which would have carried them into client chunks for no benefit.
     *
     * The rule it does enforce: a code whose literal appears ONLY in `.svc` source is services-only, because
     * `pageExtensions` means a marketplace build never compiles those files. Nothing else has to be
     * maintained, and a code that starts being emitted by a marketplace route turns this red.
     *
     * ⚠️ `/api/v1` COUNTS AS MARKETPLACE, and getting that wrong is how the obvious version of this
     * rule failed. An earlier scan excluded it — reasonably, since `/api/v1` has its own error
     * envelope — and therefore reported `invalid_request` as services-only when
     * `src/app/api/v1/oauth/token/route.ts` emits it on eno.vn. Exclusion by ENVELOPE is not
     * exclusion by EDITION. Everything a marketplace build compiles is marketplace here.
     */
    const offenders = [...codesInMarketplaceAll()].filter(onlyEmittedByServices).sort()
    expect(
      offenders,
      'These are emitted only by .svc routes, so on eno.vn they are vocabulary for routes that do ' +
        'not exist — and ALL is a RUNTIME array on a path into the marketplace bundle. Move them ' +
        'to src/lib/api/errors-services.ts, which is aliased to an empty stub on that edition.',
    ).toEqual([])
  })

  it('the marketplace array adds no services WORD the bundle does not already contain', () => {
    /**
     * ⚠️ "ADDS NO WORD", NOT "CONTAINS NO WORD" — and the difference is the whole subtlety.
     * A cheaper tripwire than the emission rule above, and it fires EARLIER: a code named after the
     * surface but not yet emitted anywhere is invisible to an emission scan and still ships the
     * string.
     *
     * But it must NOT fire for a code whose literal is already in marketplace source, because for
     * those, membership in `ALL` costs the bundle nothing — the word is there either way — while
     * EXCLUSION costs something real: `apiErrorCode()` returning `null` on eno.vn for a code eno.vn
     * genuinely sends.
     *
     * `visa_encryption_not_configured` and `visa_schema_not_ready` are exactly that case. A
     * name-based pass moved them to the services list; the artifact grep then found them still in
     * the marketplace build, because `src/lib/visa/{dm-flow,concierge}.ts` are plain `.ts` libraries
     * reachable from `api/conversations/route.ts`. Moving them out had removed no string and broken
     * recognition — a strictly worse trade, and one that only showed up in a built artifact.
     */
    const adds = [...codesInMarketplaceAll()]
      .filter((c) => /visa|itinerar|paypal|evisa/i.test(c))
      .filter((c) => !SOURCE_HALVES.marketplace.includes(`'${c}'`))
      .sort()
    expect(
      adds,
      'These name a services surface and their literal is NOWHERE in marketplace source, so listing ' +
        'them in the runtime ALL array is the only thing putting the word in eno.vn\'s bundle. ' +
        'Move them to src/lib/api/errors-services.ts.',
    ).toEqual([])
  })

  it('every services code is still a member of the shared type', () => {
    // The other direction. The type is deliberately NOT split — it is erased, so it costs the
    // marketplace bundle nothing — and keeping it whole is what lets a .svc.ts handler and the
    // compile-time subset assertions share one vocabulary. A services code missing from the type
    // would make `apiErrorCode()` unable to narrow it on the edition that DOES emit it.
    const all = codesInTheType()
    const typeMembers = typeUnionMembers()
    expect([...all].filter((c) => !typeMembers.has(c)).sort()).toEqual([])
  })

  /**
   * ⚠️ A TEST THAT USED TO SIT HERE WAS DELETED, AND THE REASON IS WORTH MORE THAN THE TEST WAS.
   * It asserted "no code in SERVICES_ALL appears in marketplace-compiled source" — sound-looking,
   * and it fired on `visa_encryption_not_configured` / `visa_schema_not_ready` because
   * `src/lib/visa/{dm-flow,concierge}.ts` are plain `.ts` libraries the marketplace build compiles.
   *
   * The premise was wrong. Whether a LITERAL appears in compiled source is a different question
   * from whether a marketplace route can EMIT it: `api/conversations/route.ts:75` resolves listings
   * through `scopedListingWhere`, which excludes the desk's rows on eno.vn, so the branch that
   * would return those codes is unreachable there. Acting on the failing test moved two codes into
   * the marketplace runtime array, which removed no string from the bundle (the libraries put it
   * there) and would have carried both into CLIENT chunks the day `lib/api/client.ts` gains a
   * production importer — strictly worse than the state it was "fixing".
   *
   * The route-scoped check below is the correct question and was right all along. If a stronger
   * guard is ever wanted it has to model EDITION REACHABILITY, not textual presence, and that is a
   * different and much harder tool than a grep.
   */
  it('every services code is emitted only by .svc.ts routes', () => {
    // The premise the whole split rests on: if a marketplace `route.ts` emitted one of these, the
    // alias would break that route rather than protect it — apiErrorCode() would return null for a
    // code eno.vn genuinely sends.
    const marketplaceRoutes = execFileSync('git', ['ls-files', 'src/app/api/**/route.ts'], { encoding: 'utf8' })
      .trim().split('\n').filter((f) => f && !f.includes('/api/v1/'))
    const offenders: string[] = []
    for (const code of codesInServicesList()) {
      const emitters = marketplaceRoutes.filter((f) => stripComments(readFileSync(f, 'utf8')).includes(`'${code}'`))
      if (emitters.length) offenders.push(`${code} <- ${emitters.join(', ')}`)
    }
    expect(offenders).toEqual([])
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
