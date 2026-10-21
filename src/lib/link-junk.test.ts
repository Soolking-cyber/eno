import { describe, expect, it } from 'vitest'
import { ENCODED_MARKS, RAW_MARKS, linkJunkFreePath } from './link-junk'

describe('linkJunkFreePath', () => {
  it('strips every listed mark, raw or encoded in either case, and any run of them', () => {
    const marks = [...RAW_MARKS, ...ENCODED_MARKS, ...ENCODED_MARKS.map((m) => m.toLowerCase())]
    for (const mark of marks) expect(linkJunkFreePath(`/teachers/join${mark}`), mark).toBe('/teachers/join')
    expect(linkJunkFreePath(`/teachers/join${marks.join('')}`)).toBe('/teachers/join')
  })

  it('drops the punctuation a chat app took into the link', () => {
    // The live case (2026-10-21): "teacher.eno.vn," in a Zalo message opened teacher.eno.vn/,
    expect(linkJunkFreePath('/,')).toBe('/')
    expect(linkJunkFreePath('/teachers/join,')).toBe('/teachers/join')
    expect(linkJunkFreePath('/teachers/join.')).toBe('/teachers/join')
    expect(linkJunkFreePath('/c/teachers)')).toBe('/c/teachers')
    expect(linkJunkFreePath('/teach-in-vietnam/the-teaching-year-in-vietnam):')).toBe('/teach-in-vietnam/the-teaching-year-in-vietnam')
    for (const p of [';', ':', '!', "'", ']', '}', '...', '),', '!!!']) expect(linkJunkFreePath(`/listings/abc${p}`), p).toBe('/listings/abc')
  })

  it('reads the percent-encoded spellings too, in either case', () => {
    expect(linkJunkFreePath('/%22')).toBe('/')
    expect(linkJunkFreePath('/c/rentals%3E')).toBe('/c/rentals')
    expect(linkJunkFreePath('/listings/abc%E2%80%A6')).toBe('/listings/abc') // …
    expect(linkJunkFreePath('/listings/abc%e2%80%a6')).toBe('/listings/abc')
    expect(linkJunkFreePath('/listings/abc%E2%80%9D')).toBe('/listings/abc') // ”
    expect(linkJunkFreePath('/listings/abc%E2%80%99')).toBe('/listings/abc') // ’
    expect(linkJunkFreePath('/listings/abc%EF%BC%8C')).toBe('/listings/abc') // ，
    expect(linkJunkFreePath('/listings/abc%E3%80%82')).toBe('/listings/abc') // 。
    expect(linkJunkFreePath('/listings/abc%2C%29')).toBe('/listings/abc')
  })

  it('leaves every path that ends in a character an address can end in', () => {
    for (const p of ['/', '/c/rentals', '/listings/cmv7bloav0056idq4et35wn99', '/sellers/sdc-store', '/~/not-found',
      '/teachers/join', '/schools/awards/2026', '/c/rentals/', '/s/apple_2', '/a-', '/%E2%82%AB']) {
      expect(linkJunkFreePath(p), p).toBeNull()
    }
  })

  it('takes a slash left at the end with it, so one redirect lands', () => {
    expect(linkJunkFreePath('/c/teachers/,')).toBe('/c/teachers')
    expect(linkJunkFreePath('//,')).toBe('/')
  })

  it('⛔ never answers a path that would leave the site as a relative Location', () => {
    expect(linkJunkFreePath('//evil.example/x,')).toBe('/evil.example/x')
    expect(linkJunkFreePath('/\\evil.example/x.')).toBe('/evil.example/x')
    expect(linkJunkFreePath('///evil.example,')).toBe('/evil.example')
  })

  it('⛔ THE PREMISE, CHECKED: no route folder, handle, slug or school slug of either edition ends in a mark', async () => {
    // Review, 2026-10-21: "no page of ours ends in punctuation" was a comment and a log count; this holds it mechanically.
    const { readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { HANDLE_RE } = await import('./handle-format')
    const { slugify } = await import('./slug')
    const { slugify: schoolSlug } = await import('./schools/import-entries')
    const endsInMark = (s: string) => linkJunkFreePath(`/${s}`) !== null
    // Every static URL segment under src/app — both editions' (the services edition's `.svc.` pages share the tree).
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())
      .flatMap((d) => [d.name, ...walk(join(dir, d.name))])
    const segments = walk('src/app').filter((name) => !/^[[(@_]/.test(name)) // dynamic, group, slot, private
    expect(segments.length).toBeGreaterThan(100)
    for (const s of segments) expect(endsInMark(s), s).toBe(false)
    // …and every file the site serves from public/ (its matcher entry must bring no asset to the proxy).
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : [d.name]))
    const shipped = files('public')
    expect(shipped.length).toBeGreaterThan(100)
    for (const f of shipped) expect(endsInMark(f), f).toBe(false)
    for (const mark of [...RAW_MARKS, ...ENCODED_MARKS]) expect(HANDLE_RE.test(`shop${mark}`), mark).toBe(false)
    for (const name of ['Café “Sài Gòn”…', 'Dr. Martens!', 'Trường Quốc tế (ABC).', 'Nhà 3/2, Q.10;', "O'Brien's: 'x'", '!!!']) {
      expect(endsInMark(slugify(name)), name).toBe(false)
      expect(endsInMark(schoolSlug(name)), name).toBe(false)
    }
  })

  it('stays linear on a hostile path — every page request passes through it', () => {
    // No wall-clock bound (review: load-dependent). A quadratic scan — the `…+$` regex this replaced — needs minutes on
    // the first of these and trips the test's own timeout; the backward scan answers all three in milliseconds.
    expect(linkJunkFreePath(`/${','.repeat(200_000)}a`)).toBeNull()
    expect(linkJunkFreePath(`/a${'/'.repeat(200_000)}b,`)).toBe(`/a${'/'.repeat(200_000)}b`)
    expect(linkJunkFreePath(`/${'%2C'.repeat(100_000)}`)).toBe('/')
  })
})
