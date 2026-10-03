import { describe, expect, it } from 'vitest'
import { resolveImportSeller, sellerIdArg } from './script-seller-arg'

const argv = (...a: string[]) => ['node', 'script.ts', ...a]

describe('sellerIdArg — --seller <id>, required', () => {
  it('there is no default: a bare run is an error, not CellphoneS', () => {
    expect(sellerIdArg(argv()).error).toMatch(/required/)
    expect(sellerIdArg(argv('--apply')).error).toMatch(/required/)
    expect(sellerIdArg(argv('--seller', '--apply')).error).toMatch(/required/)
  })
  it('a display name is refused — names are not unique', () => {
    expect(sellerIdArg(argv('--seller', 'CellphoneS')).error).toMatch(/not a seller id/)
    expect(sellerIdArg(argv('--seller', 'Minh Tuấn Mobile')).error).toMatch(/not a seller id/)
  })
  it('accepts a stored id', () => {
    expect(sellerIdArg(argv('--seller', 'cmtsev07l00089zq4tdg845f8'))).toEqual({ id: 'cmtsev07l00089zq4tdg845f8', error: null })
    expect(sellerIdArg(argv('--apply', '--seller', 'bds-vn-import-seller-0001')).id).toBe('bds-vn-import-seller-0001')
  })
  it('accepts --seller=<id>, and refuses more than one --seller', () => {
    expect(sellerIdArg(argv('--seller=cmtsev07l00089zq4tdg845f8')).id).toBe('cmtsev07l00089zq4tdg845f8')
    expect(sellerIdArg(argv('--seller=')).error).toMatch(/required/)
    expect(sellerIdArg(argv('--seller', 'cmtsev07l00089zq4tdg845f8', '--seller=cmt78nvif0000gpq48kvzmxjw')).error).toMatch(/more than once/)
  })
})

describe('resolveImportSeller', () => {
  const db = (row: { id: string; name: string; ownerId: string | null } | null) => ({ seller: { findUnique: async () => row } })
  it('returns an ownerless storefront', async () => {
    await expect(resolveImportSeller(db({ id: 's1', name: 'Shop', ownerId: null }), 's1')).resolves.toEqual({ id: 's1', name: 'Shop' })
  })
  it('refuses an owned storefront and a missing one', async () => {
    await expect(resolveImportSeller(db({ id: 's1', name: 'CellphoneS', ownerId: 'u1' }), 's1')).rejects.toThrow(/owned by a real account/)
    await expect(resolveImportSeller(db(null), 's1')).rejects.toThrow(/no storefront/)
  })
})
