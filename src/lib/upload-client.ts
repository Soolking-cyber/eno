// Client helper: upload already-prepared image Files in small batches so the
// multipart request body stays under the serverless request-size cap (Vercel
// ~4.5MB) — the cause of the 413 on full-size phone photos. Files should already
// be downscaled via compressImageFile(); this just paces the network side.
// Returns public URLs in input order; throws 'upload' if any file fails.
const BATCH = 3

/** Why the listing photo check refused a photo (src/lib/listing-photo-check.ts). */
export type PhotoRefusal = 'flyer' | 'contact'

/**
 * Some photos were refused by the listing photo check (/api/upload `check=listing`): every batch was still sent and the
 * accepted ones reported, so a retry sends only the rest. `refused` is keyed by the File itself.
 */
export class PhotoRefusedError extends Error {
  constructor(public refused: Map<File, PhotoRefusal>) {
    super('upload_photo_refused')
    this.name = 'PhotoRefusedError'
  }
}

const REFUSALS: Record<string, PhotoRefusal> = { photo_flyer: 'flyer', photo_contact: 'contact' }

/** The save's `photo_not_allowed` detail ('<rule>:<url> …', listing-photo-refusal.ts) as refusals by URL. */
export function parsePhotoRefusalDetail(detail: string | undefined): Map<string, PhotoRefusal> {
  const out = new Map<string, PhotoRefusal>()
  for (const part of (detail ?? '').split(' ')) {
    const at = part.indexOf(':')
    const rule = part.slice(0, at)
    if (rule === 'flyer' || rule === 'contact') out.set(part.slice(at + 1), rule)
  }
  return out
}

/**
 * ⚠️ A 200 WITH A SHORT LIST IS A REJECTION, and the reason matters. The server answers 200
 * and silently drops files it will not take; the visitor got "please try again" for a photo
 * that will NEVER upload no matter how many times they try — wrong format, too large, or
 * undecodable. Naming it is the difference between a fixable problem and a dead end.
 * ⚠️ EVERY reason MAPS. An earlier version handled only 'type' and 'size', so 'empty' and
 * 'decode' — a corrupt or mislabelled photo — fell through to "please try again", which a
 * reviewer rightly called the dead end this change exists to remove: that file will fail
 * identically forever. They share one message because the fix is the same for both.
 * The check's photo_flyer / photo_contact are not here: they are collected and thrown last (PhotoRefusedError).
 */
function rejection(reasons: string[]): Error {
  if (reasons.includes('type')) return new Error('upload_type')
  if (reasons.includes('size')) return new Error('upload_size')
  if (reasons.includes('empty') || reasons.includes('decode')) return new Error('upload_broken')
  return new Error('upload')
}

// `onBatch` hears each batch the moment it lands — its files and their URLs, in order — so a caller can
// show "2/6" and remember what is already up before a later batch fails (the wizard's retry skips them).
// `check` (the post wizard): the server checks each photo for the listing's category and answers per file; `onBatch`
// then hears only the accepted, every batch is sent, and the refused are thrown at the end. Its aisle and storefront let
// the server skip the check where the pass never checks (listing-photo-check.ts PHOTO_CHECK_EXEMPT).
export async function uploadInBatches(
  files: File[],
  onBatch?: (files: File[], urls: string[]) => void,
  opts: { check?: { category: string; subcategory?: string | null; seller?: string | null } } = {},
): Promise<string[]> {
  const urls: string[] = []
  const refused = new Map<File, PhotoRefusal>()
  for (let i = 0; i < files.length; i += BATCH) {
    const slice = files.slice(i, i + BATCH)
    const form = new FormData()
    slice.forEach((f) => form.append('files', f))
    if (opts.check) {
      form.append('check', 'listing'); form.append('category', opts.check.category)
      if (opts.check.subcategory) form.append('subcategory', opts.check.subcategory)
      if (opts.check.seller) form.append('seller', opts.check.seller)
    }
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    // ⚠️ 429 IS NOT "TRY AGAIN" — IT IS "WAIT". Collapsing it into the generic upload error told
    // someone who had hit the hourly cap to keep retrying, which is the one thing guaranteed not
    // to work and which drives them further into the limit.
    if (res.status === 429) throw new Error('upload_rate_limited')
    if (!res.ok) throw new Error('upload')
    const data = await res.json().catch(() => ({}))
    const reasons: string[] = data.reasons || []
    // Per file, in the order sent (check=listing). Without it (an older server), the short-list rule below.
    const results: { url?: unknown; reason?: unknown }[] | null = opts.check && Array.isArray(data.results) && data.results.length === slice.length ? data.results : null
    if (results) {
      const landed: File[] = []
      const got: string[] = []
      let other = false
      results.forEach((r, n) => {
        const why = REFUSALS[String(r?.reason)]
        if (typeof r?.url === 'string') { landed.push(slice[n]); got.push(r.url) }
        else if (why) refused.set(slice[n], why)
        else other = true
      })
      urls.push(...got)
      // The accepted are kept even when another file in the batch is not (A PHOTO UPLOADS ONCE, use-post-media.ts).
      if (landed.length) onBatch?.(landed, got)
      if (other) throw rejection(reasons)
      continue
    }
    const got: string[] = data.urls || []
    if (got.length < slice.length) throw rejection(reasons)
    urls.push(...got)
    onBatch?.(slice, got)
  }
  if (refused.size) throw new PhotoRefusedError(refused)
  return urls
}
