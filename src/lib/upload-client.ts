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
    if (!res.ok) throw new Error('upload')
    const data = await res.json().catch(() => ({}))
    const got: string[] = data.urls || []
    if (got.length < slice.length) throw new Error('upload')
    urls.push(...got)
  }
  return urls
}
