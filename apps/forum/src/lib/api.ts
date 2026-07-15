'use client'

import { createSupabaseBrowser } from '@/lib/supabase/browser'

const API_URL = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_MARKETPLACE_URL || 'https://eno.vn').replace(/\/$/, '')

export class ForumApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
  }
}

export async function forumApi<T>(
  path: string,
  init?: RequestInit & { auth?: 'optional' | 'required' },
): Promise<T> {
  const { auth = 'optional', headers: inputHeaders, ...requestInit } = init || {}
  const headers = new Headers(inputHeaders)
  headers.set('Accept', 'application/json')
  if (requestInit.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  try {
    const { data } = await createSupabaseBrowser().auth.getSession()
    if (data.session?.access_token) headers.set('Authorization', `Bearer ${data.session.access_token}`)
    else if (auth === 'required') {
      window.dispatchEvent(new Event('eno-forum:require-signin'))
      throw new ForumApiError(401, 'auth_required')
    }
  } catch (error) {
    if (error instanceof ForumApiError) throw error
    if (auth === 'required') throw new ForumApiError(401, 'auth_unavailable')
  }

  const response = await fetch(`${API_URL}${path}`, { ...requestInit, headers, cache: 'no-store' })
  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('eno-forum:require-signin'))
    throw new ForumApiError(response.status, payload.error || 'request_failed')
  }
  return payload as T
}

