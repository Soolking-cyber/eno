import { NextResponse } from 'next/server'
import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { VERIFICATION_PATH } from '@/lib/api/agent-auth'

/** The agent endpoints' JSON answers (auth.md: `{ error, message }`), never cached. */
export const agentJson = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
export const agentError = (status: number, error: string, message: string, headers: Record<string, string> = {}) =>
  agentJson(status, { error, message }, headers)

/** OPTIONS: what the endpoint accepts (agents and auditors probe it; a browser never calls it cross-site). */
export const agentOptions = () => new NextResponse(null, { status: 204, headers: { Allow: 'POST, OPTIONS', 'Cache-Control': 'no-store' } })

/** The page's forms: this deployment's own origin, or the one the request arrived on (www vs apex, a local preview). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  return !!origin && (origin === new URL(OAUTH_ISSUER).origin || origin === new URL(req.url).origin)
}

/**
 * Back to /oauth/agent with a state (303: the browser follows with a GET; form-action 'self' holds). ⛔ A RELATIVE
 * Location (commit gate, opus): behind nginx, req.url may carry the container's own host, and a redirect built from it
 * would send the person to an internal address. A path keeps them on whatever site they are on.
 */
export function backToPage(_req: Request, params: Record<string, string>): Response {
  const qs = new URLSearchParams(params).toString()
  return new Response(null, { status: 303, headers: { Location: `${VERIFICATION_PATH}${qs ? `?${qs}` : ''}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}
