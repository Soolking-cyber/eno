import 'server-only'
import { logError } from '@/lib/log'
import { quietError } from './quiet-error'
import { SonioxError, type SonioxConfig } from './soniox'

/**
 * A TEACHER'S OWN VOICE AT SONIOX (owner, 2026-11-09: "they can create their own avatar … voice creation"). Soniox clones a
 * voice from one reference clip and its TTS speaks with it when the clone's uuid is the `voice` (docs.soniox.com
 * tts/concepts/voice-cloning, read 2026-11-09):
 *   POST   /v1/voices            multipart name (unique in the project) + file  → 201 Voice
 *   GET    /v1/voices[?cursor]   { voices: Voice[], next_page_cursor }
 *   GET    /v1/voices/{id}       Voice
 *   DELETE /v1/voices/{id}       204 — "Permanently deletes the specified voice and its embeddings"
 *   Voice = { id, name, created_at, models: [{ model, status: not_computed|processing|ready|failed, error_type }] }
 * The key needs the "Cloned voices" Write permission (403 permission_denied without it). 20 voices per ORGANISATION (429
 * limit_exceeded). ⛔ The clip and the words are never logged; an error carries its status only.
 */

/**
 * Every voice this app makes is named `eno-cv-<ClassroomVoice row id>` — a row id is a cuid, so a name points at exactly one
 * row of one database, and the sweep's reconcile (own-voice.ts) judges a voice only by a row of its own database that the
 * name names; nothing else at Soniox is touched.
 */
export const VOICE_PREFIX = 'eno-cv-'
export const voiceName = (rowId: string) => `${VOICE_PREFIX}${rowId}`

export type VoiceModelStatus = 'not_computed' | 'processing' | 'ready' | 'failed'
export type SonioxVoice = { id: string; name: string; createdAt: Date; status: VoiceModelStatus | null; errorType: string | null }

const STATUSES: ReadonlySet<string> = new Set(['not_computed', 'processing', 'ready', 'failed'])

/** Soniox's answer → a SonioxVoice for `model`, or null when it is not one. Pure; exported for tests. */
export function voiceOf(raw: unknown, model: string): SonioxVoice | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as { id?: unknown; name?: unknown; created_at?: unknown; models?: unknown }
  if (typeof v.id !== 'string' || !v.id || typeof v.name !== 'string') return null
  const createdAt = new Date(typeof v.created_at === 'string' ? v.created_at : NaN)
  if (Number.isNaN(createdAt.getTime())) return null
  const m = Array.isArray(v.models) ? (v.models as { model?: unknown; status?: unknown; error_type?: unknown }[]).find((x) => x?.model === model) : undefined
  const status = typeof m?.status === 'string' && STATUSES.has(m.status) ? (m.status as VoiceModelStatus) : null
  return { id: v.id, name: v.name, createdAt, status, errorType: typeof m?.error_type === 'string' ? m.error_type.slice(0, 60) : null }
}

async function call(cfg: SonioxConfig, path: string, init: RequestInit & { timeoutMs?: number }, fetchImpl: typeof fetch): Promise<Response> {
  try {
    return await fetchImpl(`${cfg.rest}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${cfg.key}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
      redirect: 'error',
    })
  } catch (e) {
    // No answer at all — a timeout, a reset, a refused connection: say which (owner, 2026-11-10: a bare 502 told us nothing).
    const err = e as { name?: string; cause?: { code?: string; name?: string } }
    throw new SonioxError(502, `${err?.name ?? 'Error'}${err?.cause?.code ? `:${err.cause.code}` : err?.cause?.name ? `:${err.cause.name}` : ''}`.slice(0, 60))
  }
}

async function fail(res: Response): Promise<never> {
  await res.body?.cancel().catch((e) => logError(quietError(e), { op: 'classroom.soniox-voices.cancel' }))
  throw new SonioxError(res.status)
}

/** Clone a voice from one WAV clip. Throws SonioxError (429 = the organisation's voices are all used). */
export async function createVoice(cfg: SonioxConfig, name: string, wav: Uint8Array, fetchImpl: typeof fetch = fetch): Promise<SonioxVoice> {
  const form = new FormData()
  form.set('name', name)
  form.set('file', new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }), 'voice.wav')
  // Soniox may hold the request open while it builds the voice (2026-11-10: a 30 s limit cut the owner's first voice off):
  // two minutes, run in the background of the page's request (own-voice.ts), so no browser waits on it.
  const res = await call(cfg, '/v1/voices', { method: 'POST', body: form, timeoutMs: 120_000 }, fetchImpl)
  if (!res.ok) return fail(res)
  const v = voiceOf(await res.json().catch(() => null), cfg.ttsModel)
  if (!v) throw new SonioxError(502)
  return v
}

/** One voice, or null when Soniox has none by that id. */
export async function getVoice(cfg: SonioxConfig, id: string, fetchImpl: typeof fetch = fetch): Promise<SonioxVoice | null> {
  const res = await call(cfg, `/v1/voices/${encodeURIComponent(id)}`, { method: 'GET' }, fetchImpl)
  if (res.status === 404) { await res.body?.cancel().catch((e) => logError(quietError(e), { op: 'classroom.soniox-voices.cancel' })); return null }
  if (!res.ok) return fail(res)
  const v = voiceOf(await res.json().catch(() => null), cfg.ttsModel)
  if (!v) throw new SonioxError(502)
  return v
}

/** Every voice of the project named with `prefix` (all pages). */
export async function listOurVoices(cfg: SonioxConfig, prefix: string, fetchImpl: typeof fetch = fetch): Promise<SonioxVoice[]> {
  const out: SonioxVoice[] = []
  let cursor: string | null = null
  for (let page = 0; page < 20; page++) {
    const q: string = cursor ? `?limit=1000&cursor=${encodeURIComponent(cursor)}` : '?limit=1000'
    const res = await call(cfg, `/v1/voices${q}`, { method: 'GET' }, fetchImpl)
    if (!res.ok) return fail(res)
    const body = (await res.json().catch(() => null)) as { voices?: unknown; next_page_cursor?: unknown } | null
    if (!body || !Array.isArray(body.voices)) throw new SonioxError(502)
    for (const raw of body.voices) {
      const v = voiceOf(raw, cfg.ttsModel)
      if (v && v.name.startsWith(prefix)) out.push(v)
    }
    cursor = typeof body.next_page_cursor === 'string' && body.next_page_cursor ? body.next_page_cursor : null
    if (!cursor) return out
  }
  throw new SonioxError(502) // a cursor that never ends is not a list we act on
}

/** Prepare a voice for the models it is not ready for yet (a new TTS model). */
export async function recomputeVoice(cfg: SonioxConfig, id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await call(cfg, `/v1/voices/${encodeURIComponent(id)}/recompute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: cfg.ttsModel }) }, fetchImpl)
  if (!res.ok) return fail(res)
  await res.body?.cancel().catch((e) => logError(quietError(e), { op: 'classroom.soniox-voices.cancel' }))
}

/** Delete a voice and its embeddings. True when it is gone (deleted now, or already gone). */
export async function deleteVoice(cfg: SonioxConfig, id: string, fetchImpl: typeof fetch = fetch): Promise<true> {
  const res = await call(cfg, `/v1/voices/${encodeURIComponent(id)}`, { method: 'DELETE' }, fetchImpl)
  await res.body?.cancel().catch((e) => logError(quietError(e), { op: 'classroom.soniox-voices.cancel' }))
  if (res.ok || res.status === 404) return true
  throw new SonioxError(res.status)
}
