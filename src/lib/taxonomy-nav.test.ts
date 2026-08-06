import { describe, expect, it } from 'vitest'
import { TAXONOMY } from '@/lib/taxonomy'
import { NAV_CATEGORIES } from '@/lib/taxonomy-nav'

/**
 * THE ANTI-DRIFT CHECK THAT MAKES THE DUPLICATION SAFE.
 *
 * `taxonomy-nav.ts` copies fifteen categories out of `TAXONOMY` so the footer — a client component
 * in the root layout — does not ship a 70 KB module to every page for fifteen links. A copy is only
 * acceptable while something proves it is still a copy, and that is this file.
 *
 * If it fails, do NOT edit the expectation: regenerate the constant from TAXONOMY, which is the
 * source of truth. The footer showing a category the taxonomy renamed is the failure this prevents.
 */
describe('NAV_CATEGORIES mirrors TAXONOMY', () => {
  it('is the exact slug/name/nameVi projection, in order', () => {
    expect(NAV_CATEGORIES).toEqual(TAXONOMY.map(({ slug, name, nameVi }) => ({ slug, name, nameVi })))
  })

  it('carries no extra fields — every one is bytes on every page', () => {
    // Guards the other direction: someone adding `icon` here to save a lookup would quietly
    // reintroduce weight into the global bundle, one field at a time.
    for (const c of NAV_CATEGORIES) expect(Object.keys(c).sort()).toEqual(['name', 'nameVi', 'slug'])
  })
})
