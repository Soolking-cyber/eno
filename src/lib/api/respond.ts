import { NextResponse } from 'next/server'
import crypto from 'crypto'
import type { ApiAuthResult } from './auth'

// Standard JSON envelopes + headers for /api/v1. Success returns the payload directly
// (list endpoints add a top-level `next_cursor`); errors are `{ error: { code, message } }`.
// Every response carries X-Request-Id; authed ones add X-RateLimit-Limit/Remaining.

function baseHeaders(rate?: { limit: number; remaining: number }): Record<string, string> {
  const h: Record<string, string> = { 'X-Request-Id': crypto.randomUUID() }
  if (rate) {
    h['X-RateLimit-Limit'] = String(rate.limit)
    h['X-RateLimit-Remaining'] = String(rate.remaining)
  }
  return h
}

export function apiOk(data: unknown, rate?: { limit: number; remaining: number }, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: baseHeaders(rate) })
}

export function apiError(status: number, code: string, message: string, rate?: { limit: number; remaining: number }): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers: baseHeaders(rate) })
}

// Turn a failed resolveApiKey() result into its response (handy guard at the top of a route).
export function apiAuthError(r: Extract<ApiAuthResult, { ok: false }>): NextResponse {
  return apiError(r.status, r.code, r.message)
}
