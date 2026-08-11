// Client helper: upload already-prepared image Files in small batches so the
// multipart request body stays under the serverless request-size cap (Vercel
// ~4.5MB) — the cause of the 413 on full-size phone photos. Files should already
// be downscaled via compressImageFile(); this just paces the network side.
// Returns public URLs in input order; throws 'upload' if any file fails.
const BATCH = 3

export async function uploadInBatches(files: File[]): Promise<string[]> {
  const urls: string[] = []
  for (let i = 0; i < files.length; i += BATCH) {
    const slice = files.slice(i, i + BATCH)
    const form = new FormData()
    slice.forEach((f) => form.append('files', f))
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    // ⚠️ 429 IS NOT "TRY AGAIN" — IT IS "WAIT". Collapsing it into the generic upload error told
    // someone who had hit the hourly cap to keep retrying, which is the one thing guaranteed not
    // to work and which drives them further into the limit.
    if (res.status === 429) throw new Error('upload_rate_limited')
    if (!res.ok) throw new Error('upload')
    const data = await res.json().catch(() => ({}))
    const got: string[] = data.urls || []
    if (got.length < slice.length) {
      // ⚠️ A 200 WITH A SHORT LIST IS A REJECTION, and the reason matters. The server answers 200
      // and silently drops files it will not take; the visitor got "please try again" for a photo
      // that will NEVER upload no matter how many times they try — wrong format, too large, or
      // undecodable. Naming it is the difference between a fixable problem and a dead end.
      // ⚠️ EVERY reason MAPS. An earlier version handled only 'type' and 'size', so 'empty' and
      // 'decode' — a corrupt or mislabelled photo — fell through to "please try again", which a
      // reviewer rightly called the dead end this change exists to remove: that file will fail
      // identically forever. They share one message because the fix is the same for both.
      const reasons: string[] = data.reasons || []
      if (reasons.includes('type')) throw new Error('upload_type')
      if (reasons.includes('size')) throw new Error('upload_size')
      if (reasons.includes('empty') || reasons.includes('decode')) throw new Error('upload_broken')
      throw new Error('upload')
    }
    urls.push(...got)
  }
  return urls
}
