import { apiErrorCode, type ApiErrorCode } from '@/lib/api/errors'

/**
 * THE CLIENT HALF OF THE API CONTRACT.
 *
 * ⚠️ WHAT THIS REPLACES. There are 176 raw `fetch('/api/…')` call sites across 84 files and no
 * wrapper at all, so every one of them re-implements the same four steps by hand: check `res.ok`,
 * parse JSON, dig out `data.error`, compare it to a string literal. The comparison is the problem —
 * `data?.error === 'phone_taken'` is a string on both sides, so renaming the server code changes
 * nothing the compiler can see and the branch silently stops matching.
 *
 * ⚠️ IT DOES NOT CHANGE ANY REQUEST OR RESPONSE. Same URL, same method, same body, same status
 * codes. It only puts a type around what comes back, which is why it can be adopted one call site
 * at a time with no coordination and no wire risk.
 *
 * ⚠️ IT IS NOT A DATA-FETCHING LIBRARY, AND DELIBERATELY SO. `@tanstack/react-query` is already a
 * dependency with a configured `QueryClient` (`src/components/marketplace/query-provider.tsx`) and
 * only two files use it, while 52 hand-roll `useEffect` + `fetch` — 35 of those with neither an
 * AbortController nor a cancellation flag, so a slow response can land after unmount and overwrite
 * fresher state. That is a real problem and react-query is its answer; this function is the
 * transport those queries should call, not a replacement for them.
 *
 * Usage:
 *   const r = await apiFetch<{ id: string }>('/api/conversations', { method: 'POST', json: { listingId } })
 *   if (!r.ok) {
 *     if (r.code === 'reply_required') return showReplyFirstNotice()
 *     return showGenericError()
 *   }
 *   router.push(`/messages/${r.data.id}`)
 */

export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  /**
   * `code` is `null` when the failure had no recognisable error code — a 502 from the edge, an
   * HTML error page, a network drop, or a code the harvest in `errors.ts` has not caught up with.
   * Callers must handle it, which is the point: those cases exist today and are currently handled
   * by accident.
   */
  | { ok: false; code: ApiErrorCode | null; status: number; body: unknown }

export type ApiFetchInit = Omit<RequestInit, 'body'> & {
  /** JSON body. Sets `content-type` and stringifies — the thing every call site writes by hand. */
  json?: unknown
  body?: BodyInit | null
}

export async function apiFetch<T = unknown>(path: string, init: ApiFetchInit = {}): Promise<ApiResult<T>> {
  const { json, headers, ...rest } = init
  /**
   * ⚠️ `new Headers()`, NOT AN OBJECT SPREAD — the spread silently drops everything.
   * `HeadersInit` is `Headers | string[][] | Record<string, string>`, and
   * `{ 'content-type': …, ...headers }` only works for the third. Spreading a `Headers` instance
   * yields `{}` (its entries live behind an iterator, not own properties) and spreading an array
   * yields `{ "0": [...] }`. Either way an Authorization or Idempotency-Key header vanishes from
   * the wire with no error — caught in review before any call site could hit it.
   *
   * `set` only when absent, so an explicit content-type still wins.
   */
  const merged = new Headers(headers)
  if (json !== undefined && !merged.has('content-type')) merged.set('content-type', 'application/json')
  let res: Response
  try {
    res = await fetch(path, {
      ...rest,
      headers: merged,
      body: json === undefined ? (init.body ?? null) : JSON.stringify(json),
    })
  } catch (e) {
    /**
     * ⚠️ A NETWORK FAILURE IS A RESULT, NOT AN EXCEPTION. `fetch` rejects on a dropped connection or
     * an aborted request, and the hand-rolled call sites this replaces mostly do not catch it — the
     * rejection escapes into an unhandled promise or a react-query error boundary either way. Making
     * it an `ok: false` means one branch handles every failure, which is the only way a call site
     * ends up handling all of them.
     *
     * An AbortError is re-thrown, deliberately: react-query and every cancellation pattern rely on
     * it propagating to know the request was cancelled rather than failed.
     */
    // Matched by NAME, not by `instanceof DOMException`: an aborted fetch surfaces as a plain
    // Error under some polyfills and older runtimes, and treating a cancellation as a failure is
    // what makes an aborted navigation raise an error toast.
    if (typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError') throw e
    return { ok: false, code: null, status: 0, body: e }
  }

  // 204 and friends have no body; parsing them throws and every hand-rolled site forgets this.
  const text = res.status === 204 ? '' : await res.text().catch(() => '')
  let body: unknown = undefined
  if (text) { try { body = JSON.parse(text) } catch { body = text } }

  if (res.ok) return { ok: true, data: body as T, status: res.status }
  return { ok: false, code: apiErrorCode(body), status: res.status, body }
}
