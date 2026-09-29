import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ⛔ A /c PAGE'S SERVER PREDICATE AND ITS `serverScope.params` ARE ONE SCOPE (C1-DEADEND, 2026-09-29).
 *
 * The page renders page 1 from its own `where`; every sort and Show-more after that is /api/listings
 * with `serverScope.params`. If the two disagree, the first Show-more continues a DIFFERENT sequence
 * and every sort answers over a different set than the one the page counted — the seam C1-DEADEND
 * closed. Nothing at runtime notices: both halves render, just not the same list.
 *
 * The concrete case is already in flight: build/vehicle-rentals (c323347c) narrows /c/rentals to
 * PLACES (`RENTAL_PLACES`) on the server, and the API only agrees when the params carry
 * `kind=places` (`PLACES_KIND_PARAM`). Its district page does both; the index page's `serverScope`
 * arrived from a different branch, and a scratch 3-way merge of the two is textually CLEAN — so a
 * merge that narrows the server without the params would ship silently. This is the tripwire: a
 * page that narrows by RENTAL_PLACES must send PLACES_KIND_PARAM from the same `serverScope`
 * (and its `total` must be the places total, e.g. `rentals?.total ?? total`).
 * Read as source because these are async server pages over a live database.
 */
const DIR = join(process.cwd(), 'src/app/[lang]/c/[category]')
const PAGES = ['(index)/page.tsx', '[district]/page.tsx']

/** The source with its comments removed — the pages' own comments name both symbols. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** The `{…}` expression passed as `serverScope=`, by brace matching (it spans lines on the district page). */
function serverScopeExpr(src: string): string | null {
  const at = src.indexOf('serverScope={')
  if (at < 0) return null
  const open = at + 'serverScope='.length
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  return null
}

describe('/c scope parity — the server where and serverScope.params narrow together', () => {
  for (const page of PAGES) {
    it(`${page}: a places-only predicate is sent as kind=places too`, () => {
      const src = code(readFileSync(join(DIR, page), 'utf8'))
      const scope = serverScopeExpr(src)
      expect(scope, `${page} no longer passes serverScope — re-read this contract`).not.toBeNull()
      if (/\bRENTAL_PLACES\b/.test(src)) {
        expect(
          scope,
          `${page} narrows its server predicate with RENTAL_PLACES, but its serverScope sends no PLACES_KIND_PARAM: ` +
            'sorts and Show-more would page over vehicle hire the first page never showed. Add ' +
            '`...(<places-only> ? { [PLACES_KIND_PARAM.key]: PLACES_KIND_PARAM.value } : {})` to params and the places total.',
        ).toMatch(/\bPLACES_KIND_PARAM\b/)
      }
    })
  }
})
