import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { slugifyHandle, validateHandle, HANDLE_RE } from './handle-format'

// @handle rules: "Alex Doe" → alex-doe, one global namespace.
// Slugify must always yield a VALID base; validate must reject impersonation names.
//
// ⚠️ THE SEPARATOR IS A HYPHEN AS OF 2026-08-30, and it changed for a reason outside this file: a
// handle is now also a HOSTNAME (`<handle>.eno.vn`). RFC 1123 allows `-` in a host label and
// forbids `_`, so the old underscore meant every multi-word shop name auto-claimed a handle that
// could never have a subdomain. Underscore is still ACCEPTED by HANDLE_RE — handles claimed before
// today keep working — it is simply no longer produced.

describe('slugifyHandle', () => {
  it('turns display names into handles', () => {
    expect(slugifyHandle('Alex Doe')).toBe('alex-doe')
    expect(slugifyHandle('Apple Store')).toBe('apple-store')
    expect(slugifyHandle('SDC GIFT SHOP')).toBe('sdc-gift-shop')
  })

  it('folds Vietnamese diacritics', () => {
    expect(slugifyHandle('Nguyễn Văn Ánh')).toBe('nguyen-van-anh')
    expect(slugifyHandle('Cửa hàng Đồ cũ')).toBe('cua-hang-do-cu')
  })

  it('collapses punctuation runs and trims separators', () => {
    expect(slugifyHandle("Anna's — Café & Bakery!")).toBe('anna-s-cafe-bakery')
    expect(slugifyHandle('__weird__name__')).toBe('weird-name')
  })

  it('⛔ the GRAMMAR itself refuses a trailing separator, not just the slugifier', () => {
    // A handle typed into the editor or POSTed to /api/handle is validated by HANDLE_RE alone —
    // slugify never sees it. `bob-` used to match, which would have been a legal handle and an
    // illegal host label. Three reviewers found it in the same round.
    expect(validateHandle('bob-')).toBe('invalid')
    expect(validateHandle('bob_')).toBe('invalid')
    expect(validateHandle('my-shop')).toBeNull()
  })

  it('⛔ a reserved word stays reserved however it is spelled', () => {
    // The hyphen made `sign-in` claimable while `signin` was reserved — and `sign-in.eno.vn` on a
    // passwordless product is a phishing page. isReservedHandle folds separators out first.
    for (const h of ['signin', 'sign-in', 'sign_in', 'log-in', 'ad-min']) {
      expect(validateHandle(h), h).toBe('reserved')
    }
  })

  it('⛔ every name it produces is a legal HOST label, which is the point of the change', () => {
    // A handle that HANDLE_RE accepts but DNS does not is a storefront nobody can reach — the
    // exact failure the underscore separator caused. Assert the stronger property directly.
    for (const name of ['Alex Doe', "Anna's — Café & Bakery!", 'Bền Computer', '84 Motors', '   ', 'ồ', 'a'.repeat(80)]) {
      const s = slugifyHandle(name)
      expect(s, `from "${name}"`).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
      expect(s.length, `from "${name}"`).toBeLessThanOrEqual(63)
    }
  })

  it('always yields a valid handle, even from hostile names', () => {
    for (const name of ['84 Motors', '123', '🦄🦄', '', '   ', 'ồ', 'a'.repeat(80)]) {
      const s = slugifyHandle(name)
      expect(s, `from "${name}"`).toMatch(HANDLE_RE)
    }
  })

  it('caps at 30 chars', () => {
    expect(slugifyHandle('a'.repeat(80)).length).toBeLessThanOrEqual(30)
  })
})

describe('validateHandle', () => {
  it('accepts canonical handles', () => {
    expect(validateHandle('alex_doe')).toBeNull()
    expect(validateHandle('shop99')).toBeNull()
  })

  it('rejects bad shapes', () => {
    expect(validateHandle('ab')).toBe('invalid') // too short
    expect(validateHandle('9lives')).toBe('invalid') // digit start
    expect(validateHandle('Alex')).toBe('invalid') // uppercase (must be pre-lowercased)
    expect(validateHandle('a b')).toBe('invalid')
    expect(validateHandle('a'.repeat(31))).toBe('invalid')
  })

  it('rejects reserved / impersonation names', () => {
    for (const h of ['admin', 'eno', 'support', 'official', 'sellers', 'api', 'verified']) {
      expect(validateHandle(h), h).toBe('reserved')
    }
  })

  /**
   * ⛔ THE INVARIANT THAT MAKES ROOT-LEVEL REWRITES SAFE, not a spot-check of one name.
   *
   * `src/app/[handle]` is a ROOT dynamic segment, so any single-segment path next.config.ts
   * claims — a rewrite or a redirect — sits at the same address as somebody's storefront. Next
   * resolves both `afterFiles` rewrites and redirects BEFORE dynamic routes, so config always
   * wins: a seller who held that handle would have a permanently unreachable page, and for a
   * redirect the browser would cache that forever. Reserving the name is the only fix (the
   * `eno_vietnam` note in handle-format.ts records the same lesson).
   *
   * This reads the real config rather than restating a list, so ADDING a root-level rewrite
   * without reserving its name fails here instead of in production. Mutation-checked: deleting
   * 'docs' from RESERVED turns this red.
   */
  /**
   * ⛔ THE SAME INVARIANT FOR REAL PAGES, WHICH THE CONFIG-ONLY VERSION BELOW COULD NOT SEE. It
   * guarded rewrites and redirects and left every `src/app/<seg>/page.tsx` unprotected — twelve of
   * them were claimable when this was written (2026-09-07), including `itinerary` and
   * `vietnam-evisa`, the two routes the e2e suite uses to tell the editions apart. A static route
   * always outranks `src/app/[handle]`, so a seller holding one of those names gets a storefront
   * that silently resolves to somebody else's page.
   * ⚠️ IT READS THE DIRECTORY, NOT A LIST, so adding a root page without reserving its name fails
   * here rather than in production. Mutation-checked: dropping 'itinerary' from RESERVED turns this
   * red.
   */
  it('reserves every root-level page route in src/app', () => {
    const appDir = new URL('../app/', import.meta.url)
    /**
     * ⚠️ ROUTE GROUPS ARE TRAVERSED, NOT SKIPPED. `src/app/(home)/page.tsx` proves the shape is in
     * use here: a `(group)` contributes NOTHING to the URL, so `src/app/(marketing)/offers/page.tsx`
     * serves `/offers` and would collide with a handle exactly as a top-level directory does. The
     * first version of this guard filtered `(` out along with `[` and `_` and would have missed
     * every one of them — two reviewers caught it while only `(home)` existed, which is the moment
     * to fix it rather than after somebody adds `(marketing)`.
     */
    /**
     * Does this segment serve a URL — directly, or through a transparent route group?
     * ⚠️ `route.*` COUNTS TOO, not just `page.*`. A root handler occupies the same address as a
     * handle exactly as a page does. Nothing collides today because every such directory here is
     * dotted (`robots.txt`, `sitemap.xml`, `openapi.json`, `llms.txt`) and HANDLE_RE rejects a dot
     * — measured — but a future `src/app/feed/route.ts` would, and this is the guard that should
     * notice rather than a user with a broken storefront.
     */
    const hasPage = (dir: URL): boolean =>
      readdirSync(dir, { withFileTypes: true }).some(
        (e) =>
          (e.isFile() && (e.name.startsWith('page.') || e.name.startsWith('route.'))) ||
          (e.isDirectory() && /^\(.*\)$/.test(e.name) && hasPage(new URL(`${e.name}/`, dir))),
      )
    const rootSegments = (dir: URL): string[] =>
      readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .flatMap((d) =>
          // A route group is transparent: recurse and treat its children as root segments.
          /^\(.*\)$/.test(d.name)
            ? rootSegments(new URL(`${d.name}/`, dir))
            // `[dynamic]`, `_private` and `api` can never collide with a root handle.
            : /^[[_]/.test(d.name) || d.name === 'api'
              ? []
              // ⚠️ A NAMED SEGMENT ALSO COUNTS WHEN ITS page LIVES IN A GROUP BENEATH IT.
              // `src/app/offers/(marketing)/page.tsx` serves `/offers`, and checking only for an
              // immediate `page.*` skipped it — a reviewer's catch, and the mirror image of the
              // group-traversal case above.
              : hasPage(new URL(`${d.name}/`, dir))
                ? [d.name]
                : [],
        )
    const segs = rootSegments(appDir).filter((n) => HANDLE_RE.test(n))
    // Guard the guard: an empty list must not pass silently.
    expect(segs).toContain('about')
    expect(segs).toContain('itinerary')
    for (const seg of segs) {
      expect(validateHandle(seg), `src/app/${seg} is a root page route but /${seg} is a claimable handle`).toBe('reserved')
    }
  })

  it('reserves every root-level path next.config.ts claims', () => {
    const cfg = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8')
    const claimed = [...cfg.matchAll(/source:\s*["'](\/[a-z][a-z0-9_]*)["']/g)]
      .map((m) => m[1].slice(1))
      .filter((seg) => HANDLE_RE.test(seg))
    // Guard the guard: if the regex ever stops matching, this test must not silently pass.
    expect(claimed).toContain('docs')
    for (const seg of new Set(claimed)) {
      expect(validateHandle(seg), `next.config.ts claims /${seg} but it is not a reserved handle`).toBe('reserved')
    }
  })
})
