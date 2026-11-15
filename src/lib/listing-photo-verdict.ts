import 'server-only'
import { createHash } from 'node:crypto'
import type { GoogleGenAI } from '@google/genai'
import { db } from '@/lib/db'
import { getGemini } from '@/lib/gemini'
import { chargeAiPhotoCheck, photoLaneOpen, type PhotoCheckLane } from '@/lib/ai-guard'
import { kv } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { getSharp } from '@/lib/sharp-lazy'
import { getSupabaseAdmin, LISTINGS_BUCKET } from '@/lib/supabase-admin'
import {
  PHOTO_MODELS, decideReads, hedgedRead, isBudgetRefused, otherModel, photoForCheck, photoRule, readPhoto,
  type Charge, type PhotoDecision, type PhotoRead,
} from '@/lib/listing-photo-check'

/**
 * A LISTING PHOTO'S VERDICT (src/lib/listing-photo-check.ts says what is checked): an admin's "Photo is fine" for this
 * listing first, then the cached FACTS (by sha256, or object key → sha256), then the budget, then the model.
 * ⛔ FACTS ARE CACHED, NEVER VERDICTS: the decision is re-made with each listing's own flyer rule, so a client that says
 * "jobs" cannot carry a flyer past another category. An override is per listing and never enters the shared cache.
 * ⛔ ANY FAILURE IS 'unavailable' (kv, db, download, decode, model, deadline), a spent lane 'budget' (the sweep stops on
 * it) — nothing throws to a caller.
 * ⚠️ getGemini() (API key first, Vertex fallback), not the teacher check's Vertex-only client: a listing photo is content
 * its seller chose to publish — publish-time moderation, which ai-consent.ts exempts — not a teacher's CV or portrait.
 * ⚠️ The kv table is UNLOGGED: a crash empties the cache and the next pass pays again. Objects are never overwritten
 * (core/media.ts), so a key → sha pointer never goes stale.
 */

/** Bump to forget every cached read (a change of the prompt or the facts). */
const VERSION = 'v1'
/** /privacy says "up to 180 days". */
const CACHE_TTL_S = 180 * 24 * 3600
const shaCacheKey = (sha: string) => `listing-photo:${VERSION}:sha:${sha}`
const objectCacheKey = (key: string) => `listing-photo:${VERSION}:key:${key}`

type StoredRead = PhotoRead & { at: string }
type Cached = { reads: StoredRead[] }

/** What a caller knows about the photo — its bytes (an upload), its object key (a stored photo), its sha256 — any of them. */
export type PhotoSource = { sha?: string; key?: string; bytes?: Buffer }
export type ListingPhotoVerdict = (PhotoDecision & { sha: string | null; overridden?: true }) | 'unavailable' | 'budget'
export type VerdictOptions = {
  lane: PhotoCheckLane
  /** flyerRuleFor(the listing's own category). */
  flyerRule: boolean
  /** The listing the photo is on: its "Photo is fine" overrides count. */
  listingId?: string
  /**
   * A refusal needs the other model's read too: 'after' takes it only when the first read refuses (the pass); 'parallel'
   * asks both at once (Publish, inside its deadline); 'both' (a photo that held its listing) needs both models' reads and
   * is ok only when both say ok. Without it a lone refusal comes back unconfirmed.
   */
  confirm?: 'after' | 'parallel' | 'both'
  /** Past it the answer is 'unavailable'; the calls still finish and fill the cache. */
  deadlineMs?: number
  /** The cache only: no download, no model call (a guest's upload, the save-time screen). */
  cacheOnly?: boolean
  /** Asked once, before the first paid read (a member's own cap); false → the cache only. */
  beforeRead?: () => Promise<boolean>
}

export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** An admin said this photo is fine on this listing (audit `listing.photo.override`, detail.key). */
export async function photoOverridden(listingId: string, key: string): Promise<boolean> {
  const row = await db.complianceAudit.findFirst({
    where: { action: 'listing.photo.override', subjectType: 'listing', subjectId: listingId, detail: { path: ['key'], equals: key } },
    select: { id: true },
  })
  return !!row
}

/** The stored object `key` holds the bytes hashed `sha` (e.g. an upload checked before it was stored). Best effort. */
export async function rememberPhotoKey(key: string, sha: string): Promise<void> {
  await kv.set(objectCacheKey(key), { sha }, { ex: CACHE_TTL_S }).catch((e) => logError(e, { op: 'listing-photo.key' }))
}

/** A kv error is a miss: the check then runs, never a guess. */
async function cachedSha(key: string): Promise<string | null> {
  try {
    const c = await kv.get<{ sha?: unknown }>(objectCacheKey(key))
    return c && typeof c.sha === 'string' ? c.sha : null
  } catch { return null }
}

async function cachedReads(sha: string): Promise<StoredRead[]> {
  try {
    const c = await kv.get<Cached>(shaCacheKey(sha))
    return c && Array.isArray(c.reads) ? c.reads : []
  } catch { return [] }
}

async function download(key: string): Promise<Buffer> {
  const { data, error } = await getSupabaseAdmin().storage.from(LISTINGS_BUCKET).download(key)
  if (error || !data) throw error ?? new Error('listing_photo_download')
  return Buffer.from(await data.arrayBuffer())
}

/** Enough reads to answer: one, both models' for 'both', or — when a confirmation is asked for — no lone refusal left. */
const enough = (reads: PhotoRead[], o: VerdictOptions) => {
  if (!reads.length) return false
  if (o.confirm === 'both') return PHOTO_MODELS.every((m) => reads.some((r) => r.model === m))
  const d = decideReads(reads, o)
  return !o.confirm || d.rule === 'ok' || d.confirmed
}

async function settled(ps: Promise<PhotoRead>[]): Promise<PhotoRead[]> {
  const out: PhotoRead[] = []
  for (const r of await Promise.allSettled(ps)) {
    if (r.status === 'fulfilled') out.push(r.value)
    // A spent lane is expected on a big sweep day; anything else is worth a line.
    else if (!isBudgetRefused(r.reason)) logError(r.reason, { op: 'listing-photo.read' })
  }
  return out
}

/** The reads still missing. Never throws. */
async function newReads(ai: GoogleGenAI, jpeg: Buffer, have: PhotoRead[], o: VerdictOptions, charge: Charge): Promise<PhotoRead[]> {
  if (have.length) return settled([readPhoto(ai, jpeg, otherModel(have[0].model), charge)])
  if (o.confirm === 'parallel') return settled(PHOTO_MODELS.map((m) => readPhoto(ai, jpeg, m, charge)))
  const got = await hedgedRead(ai, jpeg, charge).catch((e): PhotoRead[] => { if (!isBudgetRefused(e)) logError(e, { op: 'listing-photo.read' }); return [] })
  const more = got.length === 1 && (o.confirm === 'both' || (o.confirm === 'after' && photoRule(got[0].facts, o) !== 'ok'))
  return more ? [...got, ...(await settled([readPhoto(ai, jpeg, otherModel(got[0].model), charge)]))] : got
}

/** 'both': ok only when every read says ok; else the first refusal, confirmed — a photo that held its listing stays refused. */
const decide = (reads: PhotoRead[], o: VerdictOptions): PhotoDecision => {
  if (o.confirm !== 'both') return decideReads(reads, o)
  const bad = reads.map((r) => photoRule(r.facts, o)).find((r) => r !== 'ok')
  return bad ? { rule: bad, confirmed: true } : { rule: 'ok' }
}

async function verdictNow(src: PhotoSource, o: VerdictOptions): Promise<ListingPhotoVerdict> {
  if (o.listingId && src.key && (await photoOverridden(o.listingId, src.key))) return { rule: 'ok', sha: src.sha ?? null, overridden: true }
  const pointed = !src.sha && src.key ? await cachedSha(src.key) : null
  let sha = src.sha ?? pointed
  let reads: StoredRead[] = sha ? await cachedReads(sha) : []
  let spent = false
  if (!enough(reads, o) && !o.cacheOnly) {
    // A spent lane costs no download: the sweep stops here.
    if (!(await photoLaneOpen(o.lane))) return 'budget'
    const bytes = src.bytes ?? (src.key ? await download(src.key) : null)
    if (!bytes) return 'unavailable'
    if (!sha) {
      // Another object with the same bytes (a re-host of the same source) may have been read already.
      sha = sha256(bytes)
      reads = await cachedReads(sha)
    }
    const ai = getGemini()
    if (!enough(reads, o) && ai && (!o.beforeRead || (await o.beforeRead()))) {
      const charge = async () => { const ok = await chargeAiPhotoCheck(o.lane); spent ||= !ok; return ok }
      const fresh = await newReads(ai, await photoForCheck(await getSharp(), bytes), reads, o, charge)
      const at = new Date().toISOString()
      const added = fresh.filter((r) => !reads.some((h) => h.model === r.model)).map((r) => ({ ...r, at }))
      if (added.length) {
        reads = [...reads, ...added]
        await kv.set(shaCacheKey(sha), { reads } satisfies Cached, { ex: CACHE_TTL_S }).catch((e) => logError(e, { op: 'listing-photo.cache' }))
      }
    }
  }
  if (src.key && sha && !pointed) await rememberPhotoKey(src.key, sha)
  if (spent && !enough(reads, o)) return 'budget'
  return reads.length && (o.confirm !== 'both' || enough(reads, o)) ? { ...decide(reads, o), sha } : 'unavailable'
}

/**
 * The verdict for one photo: ok / flyer / contact — a refusal `confirmed` when two models agree — or 'unavailable'.
 * Callers refuse, hold or strip only on a confirmed refusal.
 */
export async function listingPhotoVerdict(src: PhotoSource, o: VerdictOptions): Promise<ListingPhotoVerdict> {
  const work = verdictNow(src, o).catch((e): 'unavailable' => { logError(e, { op: 'listing-photo.verdict' }); return 'unavailable' })
  if (!o.deadlineMs) return work
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<'unavailable'>((resolve) => { timer = setTimeout(() => resolve('unavailable'), o.deadlineMs) })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}
