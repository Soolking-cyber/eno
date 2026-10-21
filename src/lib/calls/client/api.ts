import type { CallMedia, CallRole } from '../types'
import type { ClientEvent, ResyncSnapshot } from '../protocol'
import { parseSnapshot } from '../protocol'
import { logError } from '@/lib/log'

/**
 * In-app calls — the phone's side of the call routes (src/app/api/calls/**, src/app/api/conversations/[id]/call*).
 * Thin, typed fetches; every decision is the server's or the engine's.
 *
 * ⚠️ THE TAB ID IS PER PAGE LOAD, NOT PER sessionStorage. sessionStorage is CLONED when a tab is duplicated, so two
 * live tabs would share an id and the box could not tell which one it bound (negotiation review). A reload gets a new
 * id too — and calls do not resume across a reload: the old page's call ends (its pagehide beacon, or the 45 s
 * heartbeat), which is the honest outcome for a page that lost its RTCPeerConnection anyway.
 */
export const TAB_ID: string = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? `t-${crypto.randomUUID()}` : `t-${Date.now()}`

export class CallApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
    this.name = 'CallApiError'
  }
}

/** No call request may hang a screen: 15 s, then it fails like any other error (client review — "Starting…" forever). */
const REQUEST_TIMEOUT_MS = 15_000

/**
 * AbortSignal.timeout where it exists; an AbortController on a timer where it does not (Safari < 16 — r9 review),
 * whose timer `done` clears once the request has settled.
 */
function timeoutSignal(ms: number): { signal?: AbortSignal; done(): void } {
  if (typeof AbortSignal === 'undefined') return { done() {} }
  if ('timeout' in AbortSignal) return { signal: AbortSignal.timeout(ms), done() {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  // The bound covers the body as well as the headers: cleared only once both are in.
  const bound = timeoutSignal(REQUEST_TIMEOUT_MS)
  let res: Response
  let body: unknown = null
  try {
    // The bound comes LAST: no caller's init can lift it.
    res = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...init, signal: bound.signal })
    try {
      body = await res.json()
    } catch (e) {
      // An empty or non-JSON body reads as null — but a body the bound CUT OFF is a failed request, never a "success"
      // with nothing in it (review: a slow start answered null, and the engine read .callId of it).
      if (bound.signal?.aborted) throw e
    }
  } finally {
    bound.done()
  }
  if (!res.ok) {
    const code = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : 'network_error'
    throw new CallApiError(code, res.status)
  }
  return body as T
}

const post = <T>(url: string, body: unknown) =>
  call<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export interface CallsConfigView {
  enabled: boolean
  video: boolean
  protocolVersion: number
  userId?: string | null
  /** No answer at all (a timeout, the network): NOT "calls are off" — ask again later (call-host.tsx). */
  failed?: boolean
}
export type ButtonState = 'ok' | string
export interface ThreadCallState {
  protocolVersion: number
  audio: ButtonState
  video: ButtonState
  consent: { theyAllowMe: boolean; iAllowThem: boolean }
  commitIds: { caller: string; callee: string } | null
  /** The other person, for the caller's screen — the same card the callee's screen gets (server http.ts peerCard). */
  peer: CallDetails['peer'] | null
}
export interface RelayGrant { provider: string; iceServers: RTCIceServer[]; iceTransportPolicy: 'relay'; expiresAt: number }
export type StartResponse =
  | { kind: 'ringing'; callId: string; relay: RelayGrant; ringTimeoutSec: number }
  | { kind: 'merge'; callId: string }
  | { kind: 'unavailable'; callId: string }
export interface CallDetails {
  callId: string
  conversationId: string
  media: CallMedia
  role: CallRole
  state: string
  endReason: string | null
  protocolVersion: number
  ringingAt: string
  ringTimeoutSec: number
  /** How long it still rings, by the server's clock — never computed from ringingAt on the phone's clock. */
  ringRemainingMs: number
  connectedAt: string | null
  commit: string | null
  commitIds: { caller: string; callee: string } | null
  peer: { name: string | null; avatarUrl: string | null; verified: boolean; memberSince: string | null; side: 'buyer' | 'seller' | null }
  listing: { id: string; title: string } | null
}

let configCache: { at: number; user: string; value: CallsConfigView } | null = null
/**
 * ≤ 60 s cached (the route says so too), PER ACCOUNT: a sign-out and another person's sign-in in the same tab never
 * inherit the last answer (client review — the beta boundary).
 */
export async function getCallsConfig(userId: string, force = false): Promise<CallsConfigView> {
  if (!force && configCache && configCache.user === userId && Date.now() - configCache.at < 60_000) return configCache.value
  try {
    const value = await call<CallsConfigView>('/api/calls/config')
    // Filed under the account the SERVER answered for; an answer for anyone else is not this person's.
    if (value.userId) configCache = { at: Date.now(), user: value.userId, value }
    return value.userId === userId ? value : { enabled: false, video: false, protocolVersion: 0 }
  } catch {
    return { enabled: false, video: false, protocolVersion: 0, failed: true }
  }
}

export const getThreadCallState = (conversationId: string) => call<ThreadCallState>(`/api/conversations/${encodeURIComponent(conversationId)}/call`)
export const startCallRequest = (conversationId: string, body: { v: number; media: CallMedia; tabId: string; commit: string; capabilities: unknown; startId: string }) =>
  post<StartResponse>(`/api/conversations/${encodeURIComponent(conversationId)}/call`, body)
export const setCallConsent = (conversationId: string, allow: boolean) =>
  post<{ allow: boolean }>(`/api/conversations/${encodeURIComponent(conversationId)}/call-consent`, { allow })
export const getCallConsent = (conversationId: string) =>
  call<{ theyAllowMe: boolean; iAllowThem: boolean }>(`/api/conversations/${encodeURIComponent(conversationId)}/call-consent`)
export const requestCall = (conversationId: string) =>
  post<{ requested: boolean; alreadyAllowed: boolean }>(`/api/conversations/${encodeURIComponent(conversationId)}/call-request`, {})

const callUrl = (callId: string, tail = '') => `/api/calls/${encodeURIComponent(callId)}${tail}`
export const getCallDetails = (callId: string) => call<CallDetails>(callUrl(callId))
export const acceptCallRequest = (callId: string, body: { v: number; tabId: string; nonce: string; capabilities: unknown }) =>
  post<{ relay: RelayGrant; conversationId: string; media: CallMedia }>(callUrl(callId, '/accept'), body)
export const declineCallRequest = (callId: string, reason: 'declined' | 'media' = 'declined') =>
  post<{ ended: boolean }>(callUrl(callId, '/decline'), { reason })
export const revealRequest = (callId: string, nonce: string) => post<{ stored: boolean }>(callUrl(callId, '/reveal'), { tabId: TAB_ID, nonce })
export const heartbeatRequest = (callId: string, body: { connected: boolean; telemetry?: unknown }) =>
  post<{ state: string; capInMs: number | null }>(callUrl(callId, '/heartbeat'), { tabId: TAB_ID, ...body })

/** The resync snapshot, parsed by the protocol's own schema — null when unreadable (the reducer then waits). */
export async function fetchSnapshot(callId: string): Promise<ResyncSnapshot | null> {
  try {
    const raw = await call<unknown>(callUrl(callId, '/state'))
    const parsed = parseSnapshot(raw)
    return parsed.ok ? parsed.value : null
  } catch {
    return null
  }
}

/**
 * One reducer `send` effect: POST the SAME event (same key) until the box acknowledges it or refuses it for good. A
 * retried POST is deduplicated by the box (calls-ddl.mjs call_signal_key), so retrying is always safe. Gives up on a
 * definitive refusal (4xx other than 429) — the reducer's own timers decide what that means.
 */
export async function sendSignal(callId: string, event: ClientEvent, isLive: () => boolean): Promise<'ok' | 'gone' | 'refused'> {
  for (let attempt = 0; attempt < 6 && isLive(); attempt++) {
    try {
      await post(callUrl(callId, '/signal'), event)
      return 'ok'
    } catch (e) {
      if (e instanceof CallApiError) {
        if (e.code === 'call_gone') return 'gone'
        if (e.status >= 400 && e.status < 500 && e.status !== 429) return 'refused'
      }
      await new Promise((r) => setTimeout(r, Math.min(4_000, 300 * 2 ** attempt)))
    }
  }
  return 'refused'
}

/**
 * The hang-up that must survive the page going away (§3.2 step 7). sendBeacon carries the cookie and needs no
 * response; when it is unavailable, a keepalive fetch does the same job.
 */
export function endBeacon(callId: string, reason: string): void {
  const body = JSON.stringify({ tabId: TAB_ID, reason })
  const url = callUrl(callId, '/end')
  try {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return
  } catch { /* fall through */ }
  void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' }).catch((e) => logError(e, { op: 'calls.endBeacon' }))
}

/** Is someone ringing me right now? (GET /api/calls/ringing — the box's answer when a ring broadcast was missed.) */
export async function getRingingCall(): Promise<string | null> {
  try {
    return (await call<{ callId: string | null }>('/api/calls/ringing')).callId
  } catch {
    return null
  }
}

/**
 * Give up one start that never heard back (DELETE /api/conversations/:id/call): its call ends if the box made it, and a
 * start still on its way never rings. Keepalive, so it outlives the screen that gives up.
 */
export function abandonStart(conversationId: string, startId: string): void {
  void fetch(`/api/conversations/${encodeURIComponent(conversationId)}/call`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startId }),
    keepalive: true, credentials: 'same-origin',
  }).catch((e) => logError(e, { op: 'calls.abandonStart' }))
}

/**
 * Did the box clearly answer? Not when nothing came back (a timeout, the network), nor for a proxy's 5xx or a page
 * that is not ours (client review: a 502 during a deploy swap read as "nothing was made"). Unknown outcomes are
 * treated as "it may have happened".
 */
export function outcomeUnknown(e: unknown): boolean {
  return !(e instanceof CallApiError) || e.status >= 500 || e.code === 'network_error'
}

export function telemetryBeacon(callId: string, summary: unknown): void {
  const body = JSON.stringify(summary)
  const url = callUrl(callId, '/telemetry')
  try {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return
  } catch { /* fall through */ }
  void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' }).catch((e) => logError(e, { op: 'calls.telemetryBeacon' }))
}
