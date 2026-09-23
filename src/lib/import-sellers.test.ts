import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { IMPORT_SELLERS, isImportSeller } from './import-sellers'

/**
 * ⛔ AN IMPORTER WHOSE SELLER IS NOT IN IMPORT_SELLERS IS INVISIBLE TO EVERY "ALL IMPORTS" SCRIPT.
 * scripts/hide-imageless-imports.ts and scripts/recompute-seller-rank.ts both scope by
 * `sellerId IN (IMPORT_SELLERS)`, so a missing id is not an error anywhere — its rows are simply
 * never hidden or re-ranked. The 2026-09-24 review found exactly that for three new importers.
 */

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'generated' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/** Every `'<source>-import-seller-<n>'` id literal written anywhere an importer can live. */
function importerSellerIds(): Map<string, string> {
  const found = new Map<string, string>()
  // ⚠️ NOT the list itself: it holds every id as a literal, so scanning it would "find" each one and
  // the guard below would pass with no importer in the tree at all.
  for (const f of [...sourceFiles('scripts'), ...sourceFiles('src/lib')].filter((f) => !f.endsWith(join('src', 'lib', 'import-sellers.ts')))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/['"`]([a-z0-9][a-z0-9.-]*-import-seller-\d+)['"`]/g)) {
      if (!found.has(m[1])) found.set(m[1], f)
    }
  }
  return found
}

describe('IMPORT_SELLERS', () => {
  it('carries every import seller id an importer writes', () => {
    const ids = importerSellerIds()
    // Guard the guard: the scan must actually find the importers, or it proves nothing — and find
    // them in an IMPORTER, never in the list it is checking.
    expect(ids.get('bds-vn-import-seller-0001')).toMatch(/^scripts[/\\]/)
    expect([...ids.values()].filter((f) => f.endsWith('import-sellers.ts'))).toEqual([])
    const missing = [...ids].filter(([id]) => !isImportSeller(id)).map(([id, f]) => `${id} (${f})`)
    expect(missing, 'add these to src/lib/import-sellers.ts').toEqual([])
  })

  it('carries the three sellers the 2026-09-24 review found missing, and the two reserved next', () => {
    for (const id of [
      'nhatot-import-seller-0001',
      'muaban-net-import-seller-0001',
      'honeycomb-import-seller-0001',
      'mogi-vn-import-seller-0001',
      'alonhadat-com-vn-import-seller-0001',
    ]) expect(isImportSeller(id), id).toBe(true)
  })

  it('keeps the two original sellers, and has no duplicates', () => {
    expect(IMPORT_SELLERS).toContain('bds-vn-import-seller-0001')
    expect(IMPORT_SELLERS).toContain('cmub0wead0000zrq418bqq27m') // Rever
    expect(new Set(IMPORT_SELLERS).size).toBe(IMPORT_SELLERS.length)
  })

  it('is the list hide-imageless-imports.ts uses — no private copy left behind to drift', () => {
    const src = readFileSync('scripts/hide-imageless-imports.ts', 'utf8')
    expect(src).toMatch(/import \{ IMPORT_SELLERS \} from '\.\.\/src\/lib\/import-sellers'/)
    expect(src).not.toMatch(/const IMPORT_SELLERS\s*=/)
  })
})
