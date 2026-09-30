import { INDEXNOW_HOST, batches } from '@/lib/indexnow-diff'

/**
 * THE INDEXNOW POST (SEO wave B, I4). One POST per batch of ≤ 10,000 URLs, to Bing's endpoint, which
 * shares every submission with the other IndexNow engines.
 *
 * ⚠️ `INDEXNOW_ENDPOINT` EXISTS FOR TESTS AND LOCAL PROOFS ONLY — a fake endpoint, so no proof ever
 * pings a real engine. It is honoured ONLY on a loopback host (127.0.0.1, localhost, ::1); any other
 * value, https included, falls back to Bing, so a stray or mistyped production env value can never send
 * the key and the URL list anywhere else (codex, diff review).
 */
export const INDEXNOW_ENDPOINT = 'https://www.bing.com/indexnow'
const TIMEOUT_MS = 30_000

export function indexNowEndpoint(env: Record<string, string | undefined> = process.env): string {
  const o = env.INDEXNOW_ENDPOINT?.trim()
  if (!o) return INDEXNOW_ENDPOINT
  try {
    const u = new URL(o)
    if ((u.protocol === 'http:' || u.protocol === 'https:') && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return o
  } catch {
    // fall through
  }
  return INDEXNOW_ENDPOINT
}

/**
 * How the run ends, from the engine's answers:
 *   · `accepted` — every batch answered 200 or 202: save the snapshot.
 *   · `deferred` — a 429, a 5xx, a timeout or a network error: keep the old snapshot, so the same
 *     URLs are offered again next run, and answer 200 (a busy engine is not our failure).
 *   · `rejected` — anything else (400 bad request, 403 key not valid, 422 URLs not on the host):
 *     keep the snapshot and answer non-200, loudly, because it will not fix itself.
 * Earlier batches of a run that stops are re-sent next run; IndexNow takes repeats.
 */
export type SendResult =
  | { outcome: 'accepted'; batches: number; statuses: number[] }
  | { outcome: 'deferred' | 'rejected'; batches: number; statuses: number[]; status: number | null; detail: string }

export async function sendIndexNow(key: string, urlList: string[], fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const endpoint = indexNowEndpoint()
  const statuses: number[] = []
  const parts = batches(urlList)
  for (const part of parts) {
    let res: Response
    try {
      res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host: INDEXNOW_HOST, key, keyLocation: `https://${INDEXNOW_HOST}/${key}.txt`, urlList: part }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (e) {
      return { outcome: 'deferred', batches: parts.length, statuses, status: null, detail: e instanceof Error ? e.message : String(e) }
    }
    statuses.push(res.status)
    if (res.status === 200 || res.status === 202) continue
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    const outcome = res.status === 429 || res.status >= 500 ? 'deferred' : 'rejected'
    return { outcome, batches: parts.length, statuses, status: res.status, detail }
  }
  return { outcome: 'accepted', batches: parts.length, statuses }
}
