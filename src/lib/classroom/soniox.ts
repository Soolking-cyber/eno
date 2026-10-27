import 'server-only'
import { logError, logWarn } from '@/lib/log'
import { quietError } from './quiet-error'
import type { AgeBand } from './limits'

/**
 * SONIOX — THE CLASSROOM'S EARS, LIVE (owner, 2026-10-26: "its too slow no feel like live speech … make it instant
 * conversation"). Measured on the owner's own session: the turn waited 1.2 s of silence, then for eno's speech server to
 * transcribe the WHOLE clip after the learner stopped (0.5 s for 4 s of speech, 5.5 s for 45 s). Soniox stt-rt-v5 writes
 * the words down WHILE the learner speaks and ends the turn on meaning, pauses and intonation (semantic endpointing), so
 * the text exists ~0.2 s after they stop. Picked 2026-10-26 by a research workflow checked against vendor pages: never
 * trains on audio, does not store it, ~$0.10 per practice-hour, the tightest latency tail measured (260/305/313 ms).
 *
 * The browser streams to Soniox DIRECTLY with a temporary key this server mints per connection — the account key never
 * leaves the server (Soniox: "Do not … expose it in the browser"):
 *   POST https://api.soniox.com/v1/auth/temporary-api-key   Bearer <account key>
 *        { usage_type: 'transcribe_websocket', expires_in_seconds, single_use, max_session_duration_seconds }  → { api_key }
 *   then wss://stt-rt.soniox.com/transcribe-websocket with the WebSocket protocols ['soniox-api-key', <temporary key>].
 * ⛔ SINGLE USE AND SHORT: the key only has to be valid when the socket opens; the stream itself is cut at the session's
 * end (max_session_duration_seconds). Region: the project's — United States today; Japan (~3x nearer Vietnam) is granted
 * on request and gets its own hosts here once it is.
 * ⛔ The audio and the words are never logged; an error carries its status only.
 */
const HOSTS: Readonly<Record<string, { rest: string; ws: string }>> = {
  us: { rest: 'https://api.soniox.com', ws: 'wss://stt-rt.soniox.com/transcribe-websocket' },
}

export type SonioxConfig = { key: string; rest: string; ws: string; model: string }

/** SONIOX_API_KEY (+ SONIOX_REGION, default us; CLASSROOM_STT_MODEL, default stt-rt-v5), or null — then the classroom
 *  listens the old way: the learner's clip, sent whole to eno's own speech server when they stop. */
export function sonioxConfig(): SonioxConfig | null {
  const key = process.env.SONIOX_API_KEY?.trim()
  if (!key || key.length < 20 || /\s/.test(key)) return null
  const region = (process.env.SONIOX_REGION?.trim() || 'us').toLowerCase()
  const hosts = HOSTS[region]
  if (!hosts) {
    if (refusedRegion !== region) { refusedRegion = region; logWarn('[classroom] SONIOX_REGION is not a known region — live listening is off', { region: region.slice(0, 20) }) }
    return null
  }
  return { key, ...hosts, model: process.env.CLASSROOM_STT_MODEL?.trim() || 'stt-rt-v5' }
}
let refusedRegion = ''

export class SonioxError extends Error {
  constructor(readonly status: number) { super(`soniox_${status}`) }
}

/** One single-use temporary key for ONE WebSocket, valid to open it for `expiresInSeconds` (1–3600); the stream it opens
 *  is cut after `maxSessionSeconds` (1–18000). */
export async function mintSttKey(cfg: SonioxConfig, opts: { expiresInSeconds: number; maxSessionSeconds: number }, fetchImpl: typeof fetch = fetch): Promise<string> {
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)))
  let res: Response
  try {
    res = await fetchImpl(`${cfg.rest}/v1/auth/temporary-api-key`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        usage_type: 'transcribe_websocket',
        expires_in_seconds: clamp(opts.expiresInSeconds, 1, 3600),
        single_use: true,
        max_session_duration_seconds: clamp(opts.maxSessionSeconds, 1, 18_000),
      }),
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
    })
  } catch {
    throw new SonioxError(502)
  }
  if (!res.ok) {
    await res.body?.cancel().catch((e) => logError(quietError(e), { op: 'classroom.soniox.cancel' }))
    throw new SonioxError(res.status)
  }
  const body = (await res.json().catch(() => null)) as { api_key?: unknown } | null
  if (!body || typeof body.api_key !== 'string' || body.api_key.length < 10) throw new SonioxError(502)
  return body.api_key
}

/**
 * When a turn ends, by age (the page sends these in the stream's first message). ⛔ SONIOX ALONE DECIDES (owner,
 * 2026-10-27: "let the stt decide itself"): it ends an utterance on its MEANING as well as its pauses, never later than
 * max_endpoint_delay_ms after the speech stops, and the page sends the turn on its `<end>` — no silence timer of ours
 * competes. Adults take Soniox's own starting point for voice agents (level 2, sensitivity 0.3, 1500 ms —
 * soniox.com/docs/stt/rt/endpoint-detection); the young pause longest to find a word, so they get the most patience.
 * ⛔ A negative sensitivity only with level 0 (Soniox: the two fight).
 */
export type SttSettings = { endpoint_sensitivity: number; endpoint_latency_adjustment_level: number; max_endpoint_delay_ms: number }
export function sttSettingsFor(band: AgeBand): SttSettings {
  switch (band) {
    case 'adult': return { endpoint_sensitivity: 0.3, endpoint_latency_adjustment_level: 2, max_endpoint_delay_ms: 1500 }
    case 'teen': return { endpoint_sensitivity: 0.2, endpoint_latency_adjustment_level: 2, max_endpoint_delay_ms: 1500 }
    case 'child': return { endpoint_sensitivity: 0, endpoint_latency_adjustment_level: 1, max_endpoint_delay_ms: 2000 }
    case 'child-young': return { endpoint_sensitivity: -0.2, endpoint_latency_adjustment_level: 0, max_endpoint_delay_ms: 2500 }
  }
}
