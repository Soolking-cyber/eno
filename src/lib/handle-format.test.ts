import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { slugifyHandle, validateHandle, HANDLE_RE } from './handle-format'

// @handle rules: "Alex Doe" → alex_doe (Telegram-style), one global namespace.
// Slugify must always yield a VALID base; validate must reject impersonation names.

describe('slugifyHandle', () => {
  it('turns display names into handles', () => {
    expect(slugifyHandle('Alex Doe')).toBe('alex_doe')
    expect(slugifyHandle('Apple Store')).toBe('apple_store')
    expect(slugifyHandle('SDC GIFT SHOP')).toBe('sdc_gift_shop')
  })

  it('folds Vietnamese diacritics', () => {
    expect(slugifyHandle('Nguyễn Văn Ánh')).toBe('nguyen_van_anh')
    expect(slugifyHandle('Cửa hàng Đồ cũ')).toBe('cua_hang_do_cu')
  })

  it('collapses punctuation runs and trims underscores', () => {
    expect(slugifyHandle("Anna's — Café & Bakery!")).toBe('anna_s_cafe_bakery')
    expect(slugifyHandle('__weird__name__')).toBe('weird_name')
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
