// Client helper: POST a photo to the visual-search endpoint and get back a text
// query (+ best-guess category/brand) to drive the normal keyword search.
import { compressImageFile } from './normalize-image'

export type VisualSearchResult = {
  query: string
  category: string | null
  brand: string | null
  unclear?: boolean
}

export async function runVisualSearch(file: File): Promise<VisualSearchResult | Unauthorized | null> {
  // Downscale + re-encode in the browser first (same helper as the post wizard).
  // Raw phone photos are 5–15MB and Vercel caps request bodies at ~4.5MB, so the
  // platform 413'd BEFORE our route ran; the server resizes to 512px anyway, so
  // shipping a ~300KB 1600px WebP loses nothing. Falls back to the original file
  // if canvas decoding fails (the server still accepts ≤12MB when it gets through).
  const compressed = await compressImageFile(file).catch(() => file)
  const fd = new FormData()
  fd.append('file', compressed)
  const res = await fetch('/api/ai/visual-search', { method: 'POST', body: fd })
  // Visual search is members-only (paid Gemini Vision). On 401, ask the AuthProvider
  // to open the sign-in modal instead of failing silently on the camera tap.
  // ⛔ 401 IS DISTINGUISHABLE NOW, because collapsing it to `null` made the caller lie. Both the
  // paste handler and the button treat a null as "could not recognise the item", so a signed-out
  // visitor pasting a perfectly good photo got the sign-in modal AND "try a clearer photo" — an
  // error about their photograph, which was fine. The sign-in prompt is the whole message.
  if (res.status === 401) { window.dispatchEvent(new CustomEvent('eno:require-signin')); return UNAUTHORIZED }
  // ⛔ A SERVER FAILURE IS NOT A BAD PHOTOGRAPH. Every non-ok status used to collapse to `null`,
  // which both callers render as "Couldn't recognize the item — try a clearer photo." So a 500, a
  // 429 or a Gemini outage told the visitor their picture was the problem and invited them to take
  // another one, which could not possibly help. Throwing routes it to the callers' existing catch,
  // whose copy — "Visual search failed — try again" — is both true and actionable.
  if (!res.ok) throw new Error(`visual-search ${res.status}`)
  const d = (await res.json()) as VisualSearchResult
  return d
}

/**
 * Returned instead of `null` when the caller is not signed in, so callers can stay SILENT on that
 * branch. A sentinel rather than a thrown error: this runs in a paste handler and a click handler
 * that both already treat a falsy result as "no match", and an exception there would be a second
 * failure mode to get wrong.
 */
export type Unauthorized = { unauthorized: true }
export const UNAUTHORIZED: Unauthorized = { unauthorized: true }
export function isUnauthorized(r: unknown): r is Unauthorized {
  return !!r && typeof r === 'object' && (r as { unauthorized?: boolean }).unauthorized === true
}

/** Pull the first image File out of a paste event's clipboard, if any. Structural
 *  param so it accepts both a native ClipboardEvent and a React.ClipboardEvent. */
export function imageFromPaste(e: { clipboardData?: DataTransfer | null }): File | null {
  const items = e.clipboardData?.items
  if (!items) return null
  for (const it of Array.from(items)) {
    if (it.type.startsWith('image/')) {
      const f = it.getAsFile()
      if (f) return f
    }
  }
  return null
}
