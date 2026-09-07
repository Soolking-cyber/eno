import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { readZipMedia, resolveRowMedia, mediaTokens, isFilename, isVideoName } from './bulk-media'

/**
 * The matching rules are the whole feature: a seller zips a folder from a phone or a Mac and types
 * names into a spreadsheet, so every mismatch these tests pin is one somebody will actually hit.
 */
const zip = (files: Record<string, string>) =>
  readZipMedia(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))))

describe('readZipMedia', () => {
  it('indexes by basename so a zipped FOLDER still matches', () => {
    const m = zip({ 'photos/sku-1-a.jpg': 'x', 'sku-1-b.jpg': 'y' })
    expect([...m.files.keys()].sort()).toEqual(['sku-1-a.jpg', 'sku-1-b.jpg'])
  })

  // ⚠️ A phone writes IMG_1234.JPG; the spreadsheet says img_1234.jpg. Case-sensitive matching
  // would miss nearly every real ZIP, and it would look like "my photos did not upload".
  it('matches case-insensitively', () => {
    const m = zip({ 'IMG_1234.JPG': 'x' })
    expect(m.files.has('img_1234.jpg')).toBe(true)
  })

  /**
   * ⛔ THE macOS SHADOW TREE. Compressing a folder in Finder adds `__MACOSX/._name` AppleDouble
   * stubs — one per real file, with the same extension and a few hundred bytes of metadata. Without
   * this filter every listing would gain a duplicate entry that fails validation server-side.
   */
  it('⛔ SKIPS THE __MACOSX SHADOW TREE AND DOTFILES', () => {
    const m = zip({ 'a.jpg': 'x', '__MACOSX/._a.jpg': 'junk', '.DS_Store': 'junk', '._b.jpg': 'junk' })
    expect([...m.files.keys()]).toEqual(['a.jpg'])
  })

  it('ignores non-media entries and reports them', () => {
    const m = zip({ 'a.jpg': 'x', 'notes.txt': 'y', 'price.xlsx': 'z' })
    expect([...m.files.keys()]).toEqual(['a.jpg'])
    expect(m.skipped.sort()).toEqual(['notes.txt', 'price.xlsx'])
  })

  // Two folders can each hold `1.jpg`. Keeping the last would silently attach the wrong photo to a
  // listing, which is worse than saying so.
  it('⛔ REPORTS A DUPLICATE BASENAME RATHER THAN OVERWRITING', () => {
    const m = zip({ 'red/1.jpg': 'x', 'blue/1.jpg': 'y' })
    expect(m.files.size).toBe(1)
    expect(m.skipped.some((s) => s.includes('duplicate'))).toBe(true)
  })

  it('skips directory entries and empty files', () => {
    const m = zip({ 'a.jpg': 'x', 'empty.jpg': '' })
    expect([...m.files.keys()]).toEqual(['a.jpg'])
  })
})

describe('resolveRowMedia', () => {
  const media = zip({ 'a.jpg': '1', 'b.jpg': '2', 'c.jpg': '3', 'clip.mp4': '4', 'second.mp4': '5' })

  it('splits on | , and newlines, as Excel produces all three', () => {
    expect(mediaTokens('a.jpg|b.jpg,c.jpg\nclip.mp4')).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'clip.mp4'])
  })

  it('resolves photos and one clip', () => {
    const r = resolveRowMedia('a.jpg|b.jpg|c.jpg|clip.mp4', media)
    expect(r.images.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(r.video?.name).toBe('clip.mp4')
    expect(r.missing).toEqual([])
  })

  // ⚠️ URLs PASS THROUGH UNTOUCHED. The column predates the ZIP and the server re-hosts remote URLs;
  // a seller migrating from URLs to a ZIP has rows with both.
  it('leaves http(s) URLs alone and mixes them with filenames', () => {
    const r = resolveRowMedia('https://x.test/1.jpg|a.jpg', media)
    expect(r.images.map((f) => f.name)).toEqual(['a.jpg'])
    expect(r.missing).toEqual([])
    expect(isFilename('https://x.test/1.jpg')).toBe(false)
    expect(isFilename('a.jpg')).toBe(true)
  })

  it('reports a filename that is not in the ZIP', () => {
    const r = resolveRowMedia('a.jpg|typo.jpg', media)
    expect(r.missing).toEqual(['typo.jpg'])
  })

  // One clip per listing, matching the post wizard. A second is reported, never silently dropped.
  it('⛔ REPORTS A SECOND VIDEO INSTEAD OF DROPPING IT', () => {
    const r = resolveRowMedia('clip.mp4|second.mp4', media)
    expect(r.video?.name).toBe('clip.mp4')
    expect(r.missing.some((m) => m.includes('only one video'))).toBe(true)
  })

  // With no ZIP attached, every filename is missing — which is what tells the seller to attach one,
  // rather than the row silently passing validation and creating a listing with no photos.
  it('with no ZIP, filenames are all missing', () => {
    const r = resolveRowMedia('a.jpg|b.jpg', null)
    expect(r.missing).toEqual(['a.jpg', 'b.jpg'])
    expect(r.images).toEqual([])
  })

  it('knows which extensions are video', () => {
    expect(isVideoName('a.mp4')).toBe(true)
    expect(isVideoName('a.MOV')).toBe(true)
    expect(isVideoName('a.jpg')).toBe(false)
  })
})
