'use client'

/**
 * The classroom pages' one way to call /api/classroom/*: JSON in, JSON out, the error CODE kept (the page explains it with
 * classroom-copy.ts) — never a thrown string the UI has to parse. Same-origin fetch, the session cookie rides along.
 */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; body: Record<string, unknown> }

export async function api<T>(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: BodyInit; signal?: AbortSignal }): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(path, {
      method: init?.method ?? (init?.body !== undefined || init?.raw !== undefined ? 'POST' : 'GET'),
      headers: init?.raw !== undefined ? init.headers : { 'content-type': 'application/json', ...init?.headers },
      body: init?.raw ?? (init?.body !== undefined ? JSON.stringify(init.body) : undefined),
      cache: 'no-store',
      signal: init?.signal,
    })
  } catch {
    return { ok: false, status: 0, error: 'network', body: {} }
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.ok) return { ok: true, data: body as T }
  return { ok: false, status: res.status, error: typeof body.error === 'string' ? body.error : 'unknown', body }
}
