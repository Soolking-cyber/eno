import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// The importer's validation, which lives apart from the script so this test loads neither the database nor .env.
import { clean, readEntries, slugify } from './import-entries'

const ok = { name: 'ILA Vietnam', kind: 'language_centre', website: 'https://ila.edu.vn', districts: ['District 1'], aliases: ['ILA'], sourceUrls: ['https://ila.edu.vn/'] }

describe('import-schools clean()', () => {
  it('accepts a good entry and derives the slug and aliases', () => {
    const r = clean(ok)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.row.slug).toBe('ila-vietnam')
      expect(r.row.aliases).toEqual(['ila'])
      expect(r.row.summaryVi).toBeUndefined() // absent = keep whatever the database has
    }
  })
  it('refuses malformed or oversized lists and non-http sources instead of coercing them', () => {
    expect(clean({ ...ok, districts: 'District 1' as unknown as string[] }).ok).toBe(false)
    // An area the filter does not offer, e.g. a pre-merger name for part of Thu Duc City.
    expect(clean({ ...ok, districts: ['District 2 (Thu Duc)'] }).ok).toBe(false)
    expect(clean({ ...ok, aliases: [1, 2] as unknown as string[] }).ok).toBe(false)
    expect(clean({ ...ok, curricula: Array.from({ length: 11 }, (_, i) => `C${i}`) }).ok).toBe(false)
    expect(clean({ ...ok, sourceUrls: ['javascript:alert(1)'] }).ok).toBe(false)
    expect(clean({ ...ok, kind: 'casino' }).ok).toBe(false)
  })
  it('a slug that is one of /schools’ own pages is refused (the school could never be reached)', () => {
    expect(clean({ name: 'Awards', kind: 'agency' })).toMatchObject({ ok: false, why: ['slug "awards" is reserved'] })
    expect(clean({ name: 'Suggest Academy', kind: 'language_centre', slug: 'suggest' })).toMatchObject({ ok: false })
    expect(clean({ name: 'Awards Academy', kind: 'language_centre' }).ok).toBe(true)
  })

  it('null in the file clears a summary; absent keeps it', () => {
    const r = clean({ ...ok, summary: null as unknown as string, summaryVi: null })
    expect(r.ok && [r.row.summary, r.row.summaryVi]).toEqual(['', null])
  })

  it('an alias carrying a banned word or a phone number, or over 120 chars, refuses the entry', () => {
    expect(clean({ ...ok, aliases: ['ILA 0909 123 456'] }).ok).toBe(false)
    expect(clean({ ...ok, aliases: ['x'.repeat(121)] }).ok).toBe(false)
  })

  it('THE REAL FILE: every entry valid, every area offered, no slug or alias claimed twice', () => {
    const { rows, refused } = readEntries(JSON.parse(readFileSync('data/schools/hcmc.json', 'utf8')))
    expect(refused).toEqual([])
    expect(rows.length).toBeGreaterThanOrEqual(150)
  })

  it('a file that is not { schools: [...] } stops before anything is read', () => {
    for (const bad of [null, {}, { schools: null }, { schools: 'x' }, []]) expect(() => readEntries(bad)).toThrow(/schools/)
  })

  it('an entry that is not an object is refused with a reason, not a crash', () => {
    for (const bad of [null, 'ILA', 7, ['ILA']]) expect(clean(bad as unknown as Parameters<typeof clean>[0])).toEqual({ ok: false, why: ['entry is not an object'] })
  })

  it('an absent field stays undefined (kept on update); a wrong type is refused, not a crash', () => {
    const r = clean({ name: 'Somewhere English', kind: 'language_centre' })
    expect(r.ok && [r.row.website, r.row.summary, r.row.districts, r.row.sourceUrls]).toEqual([undefined, undefined, undefined, undefined])
    expect(clean({ ...ok, name: 42 as unknown as string }).ok).toBe(false)
    expect(clean({ ...ok, summary: {} as unknown as string }).ok).toBe(false)
  })
  it('never makes a generic phrase an alias, even the school\'s own name', () => {
    const r = clean({ ...ok, name: 'The International School', aliases: ['TIS'] })
    expect(r.ok && r.row.aliases).toEqual(['tis'])
  })
  it('slugs drop apostrophes and accents', () => {
    expect(slugify("Let's Learn English Centre")).toBe('lets-learn-english-centre')
    expect(slugify('Trường Quốc tế Á Châu')).toBe('truong-quoc-te-a-chau')
  })
})
