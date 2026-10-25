import 'server-only'
import { LIMITS } from './constants'

/**
 * SPATIUS — the 3D face (docs.spatius.ai). It animates audio we give it and nothing else: no AI, no speech recognition, no
 * voice (plan "What research changed"). The browser drives it in Direct Mode with a SESSION TOKEN this server mints;
 * the API key never leaves the server.
 *
 *   POST https://console.<region>.spatius.ai/v1/console/session-tokens   X-API-Key   { expireAt: unix SECONDS, < now+24h }
 *   → { sessionToken }
 *
 * ⛔ ONE TOKEN PER SESSION, SHORT-LIVED (plan review, codex): it expires LIMITS.tokenGraceSeconds after the session's own
 * end, and sessions.ts counts every mint (re-mints only while live, LIMITS.tokenMintsPerSession in all). Spatius bills
 * every CONNECTED minute, idle included — a token that outlived its session could keep billing.
 * Region: ap-northeast (Tokyo) is the closest to Vietnam; the client is told the same region (SPATIUS_REGION).
 */
const REGIONS: Readonly<Record<string, string>> = {
  'us-west': 'https://console.us-west.spatius.ai',
  'ap-northeast': 'https://console.ap-northeast.spatius.ai',
}

export type SpatiusConfig = { apiKey: string; appId: string; region: string; console: string }

/** The configured account, or null — then every session runs voice-only (the teacher's photo), never an error. */
export function spatiusConfig(): SpatiusConfig | null {
  const apiKey = process.env.SPATIUS_API_KEY?.trim()
  const appId = process.env.SPATIUS_APP_ID?.trim()
  const region = process.env.SPATIUS_REGION?.trim() || 'ap-northeast'
  const console_ = REGIONS[region]
  if (!apiKey || !appId || !console_) return null
  return { apiKey, appId, region, console: console_ }
}

/** The token's expiry: the session's hard end plus the grace, never past Spatius's 24 h ceiling. Pure. */
export function tokenExpireAt(endsAt: Date, now: Date): number {
  const want = Math.floor(endsAt.getTime() / 1000) + LIMITS.tokenGraceSeconds
  const ceiling = Math.floor(now.getTime() / 1000) + 24 * 3600 - 60
  return Math.min(want, ceiling)
}

export class SpatiusError extends Error {
  constructor(readonly status: number) { super(`spatius_${status}`) }
}

/** Mint one session token. Throws SpatiusError on any non-2xx or a malformed answer (the caller falls back to voice). */
export async function mintSessionToken(cfg: SpatiusConfig, expireAt: number, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${cfg.console}/v1/console/session-tokens`, {
    method: 'POST',
    headers: { 'X-API-Key': cfg.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expireAt }),
    signal: AbortSignal.timeout(6_000),
  })
  if (!res.ok) throw new SpatiusError(res.status)
  const body = (await res.json().catch(() => null)) as { sessionToken?: unknown } | null
  if (!body || typeof body.sessionToken !== 'string' || !body.sessionToken) throw new SpatiusError(502)
  return body.sessionToken
}
