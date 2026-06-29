// Client helper: POST a photo to the visual-search endpoint and get back a text
// query (+ best-guess category/brand) to drive the normal keyword search.
export type VisualSearchResult = {
  query: string
  category: string | null
  brand: string | null
  unclear?: boolean
}

export async function runVisualSearch(file: File): Promise<VisualSearchResult | null> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/ai/visual-search', { method: 'POST', body: fd })
  // Visual search is members-only (paid Gemini Vision). On 401, ask the AuthProvider
  // to open the sign-in modal instead of failing silently on the camera tap.
  if (res.status === 401) { window.dispatchEvent(new CustomEvent('eno:require-signin')); return null }
  if (!res.ok) return null
  const d = (await res.json()) as VisualSearchResult
  return d
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
