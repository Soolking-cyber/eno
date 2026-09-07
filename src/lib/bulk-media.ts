import { unzipSync } from 'fflate'

/**
 * THE MEDIA HALF OF A BULK IMPORT: a ZIP of photos and clips, matched to the CSV by FILENAME.
 *
 * Owner, 2026-09-07: *"we need a form to attach photos and videos in bulk too so user uploads 2
 * files a cvs file and a zip file with images and videos format should match so once uploaded all
 * will be uploaded properly and listed as ready product"*.
 *
 * ⛔ THE ZIP IS OPENED IN THE BROWSER, NOT POSTED TO THE SERVER, AND THAT IS THE WHOLE DESIGN.
 * `image_urls` already carries remote URLs the server re-hosts, so the obvious move was a second
 * multipart field on `/api/listings/bulk`. It is the wrong one: 200 listings x 3 photos is a
 * several-hundred-megabyte body arriving at a serverless function with a ~4.5MB request cap, and it
 * would have needed a new server contract, a new size ladder and a new failure vocabulary. Unzipping
 * here instead means the files go up through `/api/upload` — the SAME path a single listing uses, so
 * they get the same validation, the same watermark and the same perceptual hash — and the bulk
 * endpoint keeps taking exactly the JSON it takes today, with hosted URLs in the column that has
 * always held hosted URLs. No server change at all.
 *
 * ⚠️ fflate IS ALREADY A DIRECT DEPENDENCY (package.json), used by the visa bundle writer. Nothing
 * is added to the tree for this.
 */

/** Extensions we will hand to `/api/upload`; anything else in the ZIP is ignored, not an error. */
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif'])
const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'webm'])

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm',
}

export type ZipMedia = {
  /** Lower-cased BASENAME → the file, e.g. `sku-1-a.jpg`. */
  files: Map<string, File>
  /** Entries skipped, and why — surfaced so a seller can see a typo rather than a silent drop. */
  skipped: string[]
}

const ext = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase()

/**
 * Read a ZIP into a filename → File index.
 *
 * ⚠️ MATCHED ON BASENAME, CASE-INSENSITIVELY. A seller zips a folder, so entries arrive as
 * `photos/sku-1-a.JPG` while the CSV says `sku-1-a.jpg`. Matching the full path, or matching case
 * sensitively, would miss nearly every real ZIP — and the failure would look like "my photos did
 * not upload" rather than "your paths do not match".
 *
 * ⛔ macOS ZIPS CARRY A `__MACOSX/` SHADOW TREE of `._name` AppleDouble stubs, one per real file.
 * They have image extensions and are a few hundred bytes of metadata, so without this filter every
 * listing would get a duplicate entry that fails validation server-side. Directory entries and
 * dotfiles go the same way.
 */
export function readZipMedia(bytes: Uint8Array): ZipMedia {
  const files = new Map<string, File>()
  const skipped: string[] = []
  /**
   * ⛔ THE BUDGET IS SPENT IN THE FILTER, BEFORE ANYTHING IS INFLATED. An earlier version checked
   * sizes in the copy loop below — which runs after `unzipSync` has already decompressed the whole
   * archive, so a small compression bomb had allocated gigabytes before the first check. All four
   * reviewers said so, twice. fflate's `filter` is called with each entry's `originalSize` while
   * still compressed, and returning false means that entry is never expanded at all.
   *
   * ⚠️ THE EXTENSION TEST MOVED IN HERE FOR THE SAME REASON: a ZIP full of huge non-media files
   * used to be inflated in full and then discarded. Now it costs nothing.
   */
  const MAX_TOTAL_BYTES = 600 * 1024 * 1024
  const MAX_ENTRIES = 5000
  let budget = MAX_TOTAL_BYTES
  let kept = 0
  let overflowed = false
  const entries = unzipSync(bytes, {
    filter: (f) => {
      const path = f.name.replace(/\\/g, '/')
      if (path.endsWith('/')) return false
      const base = path.slice(path.lastIndexOf('/') + 1)
      if (path.startsWith('__MACOSX/') || base.startsWith('._') || base.startsWith('.')) return false
      const e = ext(base)
      if (!IMAGE_EXT.has(e) && !VIDEO_EXT.has(e)) { skipped.push(base); return false }
      if (kept >= MAX_ENTRIES || f.originalSize > budget) { overflowed = true; return false }
      kept++
      budget -= f.originalSize
      return true
    },
  })
  if (overflowed) skipped.push(`archive too large or too many files (limits: ${MAX_ENTRIES} files, ${MAX_TOTAL_BYTES / 1024 / 1024}MB expanded)`)
  for (const [rawPath, data] of Object.entries(entries)) {
    if (data.length === 0) continue
    // ⚠️ WINDOWS ZIPS USE BACKSLASHES. `photos\\a.jpg` from Explorer would otherwise keep the whole
    // path as its "basename" and match nothing a seller typed. Normalise before splitting.
    const base = rawPath.replace(/\\/g, '/').slice(rawPath.replace(/\\/g, '/').lastIndexOf('/') + 1)
    const key = base.toLowerCase()
    // ⚠️ FIRST WINS, and a collision is reported. Two folders can hold `1.jpg`; silently keeping
    // the last would attach the wrong photo to a listing, which is worse than saying so.
    if (files.has(key)) { skipped.push(`${base} (duplicate name)`); continue }
    // `data.slice()` copies out of fflate's buffer — a Blob over the shared view would otherwise
    // read whatever the next entry wrote there.
    files.set(key, new File([data.slice()], base, { type: MIME[ext(base)] ?? 'application/octet-stream' }))
  }
  return { files, skipped }
}

export const isVideoName = (name: string) => VIDEO_EXT.has(ext(name))

/**
 * Split a CSV cell into tokens. The column has always accepted `|`, `,` or newlines, and a bulk
 * import written in Excel produces all three.
 */
export const mediaTokens = (cell: string | undefined): string[] =>
  String(cell ?? '').split(/[|,\n]/).map((s) => s.trim()).filter(Boolean)

/** A token is a filename to resolve from the ZIP, rather than a URL to leave alone. */
export const isFilename = (token: string) => !/^https?:\/\//i.test(token)

export type RowMedia = { images: File[]; video: File | null; missing: string[] }

/**
 * Resolve one row's media tokens against the ZIP.
 *
 * ⚠️ URLS STILL PASS THROUGH UNTOUCHED. The column predates the ZIP and the server re-hosts remote
 * URLs; a seller with a working URL-based sheet must not have to rezip anything. A row can mix the
 * two, which is what someone migrating from URLs to a ZIP will actually have.
 */
export function resolveRowMedia(cell: string | undefined, zip: ZipMedia | null): RowMedia {
  const images: File[] = []
  const missing: string[] = []
  let video: File | null = null
  for (const token of mediaTokens(cell)) {
    if (!isFilename(token)) continue
    const f = zip?.files.get(token.toLowerCase())
    if (!f) { missing.push(token); continue }
    if (isVideoName(token)) {
      // One clip per listing, matching the post wizard. A second is reported, not silently dropped.
      if (video) missing.push(`${token} (only one video per listing)`)
      else video = f
    } else {
      images.push(f)
    }
  }
  return { images, video, missing }
}
