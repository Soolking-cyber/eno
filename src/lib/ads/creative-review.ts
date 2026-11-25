import 'server-only'
import crypto from 'crypto'
import { db } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'
import { safeFetch } from '@/lib/ssrf'
import { readCapped, readPrefix } from '@/lib/core/read-capped'
import { measureImage } from '@/lib/import-photo-check'
import { sniffImageType, storeListingImage } from '@/lib/core/media'
import { findBannedWordAccentAware } from '@/lib/publish-guard'
import { moderateListing } from '@/lib/ai-moderation'
import { GEMINI_MODEL } from '@/lib/gemini-model'
import { rateLimit } from '@/lib/ratelimit'
import { detectContentLang, readsAsVietnamese } from '@/lib/detect-lang'
import { warmTranslations } from '@/lib/translate'
import { getSupabaseAdmin, LISTINGS_BUCKET } from '@/lib/supabase-admin'
import { listingObjectKey } from '@/lib/listing-image'
import { logError, logInfo } from '@/lib/log'
import { isReviewReasonCode, reviewReason, type ReviewReason, type ReviewReasonCode } from './review-reasons'
import { adReviewKey, JEV_AD_CALIBRATION, JEV_AD_MODEL, JEV_AD_THRESHOLDS, jevAdQuestions, jevAdState, jevAdVerdict, provisionalReviewAllowed, readJevAnswers, type AdQuestionKey } from './review-jev'

/**
 * ── THE AD REVIEW, BEFORE ANY PAYMENT (owner 2026-11-25: "jev should check before they pay whether ad is appropriate or
 * not"). An advertiser (an eno shop) submits a creative for the ONE standard placement, the feed card: a square picture,
 * a headline (≤ 60) and an optional line (≤ 120) in any language, its name, its legal identity and an https landing
 * page. This decides approved or refused; only an approved creative is ever offered a price (the 402).
 *
 * In order, cheapest first, each step refusing with stable reasons (review-reasons.ts):
 *   1. the fields (lengths, the tax code's shape, https addresses) — nothing fetched yet;
 *   2. the SAME content from the SAME shop within 24 h → that stored verdict (no second paid review);
 *   3. the picture, fetched ONLY through safeFetch (SSRF-guarded, every redirect re-checked), at most 5 MB (readCapped),
 *      really a JPEG/PNG/WebP (sniffImageType before any decoder), at least 600 × 600 and about square (0.8–1.25);
 *   4. the landing page, through safeFetch, its first 256 KB: the <title> and meta description (unreachable → refused);
 *   5. the banned-word list (publish-guard findBannedWordAccentAware) over every word;
 *   6. the shop's daily review budget, then ONE Jev call over the words (review-jev.ts: banned classes, Art. 8 claims,
 *      permit classes) and Gemini (ai-moderation.ts moderateListing) over the picture AND the words, side by side;
 *   7. approved → the picture re-hosted on eno's storage under `ads/` with no watermark (storeListingImage), so what runs
 *      is exactly what was reviewed, whatever the advertiser's URL serves later.
 * ⛔ EVERYTHING FAILS CLOSED: no Jev key, no Gemini, a timeout, an HTTP error, an answer of the wrong shape, a picture the
 *    model was not shown, a storage failure → `review_unavailable` and nothing to pay. Such an outcome is never stored, so
 *    the next try reviews again. (The listing guard fails OPEN; an ad is a paid claim on eno's feed, so it does not.)
 * ⛔ A REFUSED PICTURE IS NEVER STORED on eno's storage (imageUrl ''): eno keeps no copy of content it refused.
 * ⛔ PERMIT CLASSES DO NOT REFUSE (owner 2026-11-25): they are recorded in `scores.permitClasses` for admins.
 * ⛔ NOT ON SALE UNTIL CALIBRATED: while JEV_AD_CALIBRATION is null (review-jev.ts — the thresholds were set before any
 *    live measurement) every review answers `review_unavailable`, unless the environment says AD_REVIEW_ALLOW_PROVISIONAL=1
 *    (a local preview). A wrong threshold decides what is lawful, so it is a gate, not a comment (commit gate, opus).
 * ⛔ A REMOVED CREATIVE STAYS REMOVED: the same content from the same shop is answered `removed` at any age.
 * ⚠️ What the review cannot see: the picture is judged for prohibited goods and services (Gemini's list), not for Art. 8
 *    symbols (a flag or a map drawn in it); a landing page that shows the review's request a different page than a
 *    viewer (cloaking) — the request names itself (UA) on purpose. An admin removes any running ad (Admin › Catalogue ›
 *    Ads). An animated picture is judged and stored as its first frame (sharp reads one page): what runs is what was judged.
 */
export const AD_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const AD_IMAGE_MIN_EDGE = 600
export const AD_IMAGE_ASPECT = { min: 0.8, max: 1.25 } as const
export const AD_LANDING_MAX_BYTES = 256 * 1024
export const AD_FIELD_LIMITS = { legalName: 120, advertiserName: 40, headline: 60, body: 120, permitRef: 80, url: 2048 } as const
/** Gemini's verdict on the picture and words refuses from this confidence (the listing hold needs 0.85; an ad is stricter). */
export const AD_MODERATION_THRESHOLD = 0.5
export const AD_REVIEW_REUSE_MS = 24 * 3_600_000
/** New (paid) reviews a shop may ask for per day; a reused verdict costs nothing and is not counted. */
export const AD_REVIEWS_PER_DAY = 30
/** Fetches of an advertiser's picture and page per shop per hour (before the paid budget, so no credential can make eno
 *  fetch public URLs without bound). */
export const AD_REVIEW_FETCHES_PER_HOUR = 60
/** Bigger than this is refused before any decoder works on it (Gemini's own input cap is 50 MP). */
export const AD_IMAGE_MAX_PIXELS = 40_000_000
const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
const JEV_DEADLINE_MS = 8_000
/**
 * ⛔ THE PICTURE IS JUDGED AS AN AD, NOT AS A LISTING (commit gate, opus): Jev reads only the words, so what may be SOLD on
 * eno but never ADVERTISED (strong alcohol, infant formula), and what the Advertising Law's Art. 8 forbids in an ad, must be
 * judged in the picture too. Appended to Gemini's prohibited list for the ad review only; listings are untouched.
 */
export const AD_IMAGE_RULES = `
These apply because this is an ADVERTISEMENT (judge the PHOTO on its own: words calling an item a replica, prop, toy or sample do not make it acceptable):
- ad_alcohol: a drink of 15% alcohol or more (spirits, liquor, whisky, vodka, strong rice wine) shown or promoted; beer and ordinary wine are fine
- ad_infant_formula: infant formula, breast-milk substitutes, feeding bottles or teats, or food for babies under 24 months
- ad_gambling: casinos, betting, lotteries, slot machines, or betting or casino sites
- ad_claims: text in the image claiming "best", "number 1", "#1", "nhất", "số 1" or a guaranteed result, cure or profit
- ad_symbols: Vietnam's national flag or emblem, a portrait of a national leader, or a map of Vietnam`
/** Gemini as this review uses it — the model, its threshold and the ad rules' own hash — so a change to any of them is a new
 *  review key (adReviewKey) and no verdict given under the old one is reused. */
const GEMINI_REVIEW = `${GEMINI_MODEL}#${AD_MODERATION_THRESHOLD}:${crypto.createHash('sha256').update(AD_IMAGE_RULES).digest('hex').slice(0, 8)}`
/** Gemini's whole call (the picture and the words). Past it the review is not judged: unavailable, never approved. */
const GEMINI_DEADLINE_MS = 20_000
const FETCH_TIMEOUT_MS = 8_000
const UA = 'eno.vn ad review (+https://eno.vn/advertising-policy)'

export type CreativeFields = {
  legalName: string; taxCode: string; advertiserName: string; headline: string; body: string | null; permitRef: string | null
  imageUrl: string; clickUrl: string
}

/** One line of the advertiser's words: NFC, no control, bidi-override or zero-width-space characters, whitespace collapsed.
 *  ZWJ / ZWNJ stay: Persian, Indic scripts and emoji need them ("any language"). */
const clean = (v: unknown): string | null => (typeof v === 'string' ? v.normalize('NFC').replace(/[\p{Cc}\p{Zl}\p{Zp}\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu, ' ').replace(/\s+/g, ' ').trim() : null)

/** The MST: 10 digits, or 13 written 10-3 (a branch). 13 digits without the dash are accepted and written 10-3. */
export function normalizeTaxCode(v: unknown): string | null {
  const s = typeof v === 'string' ? v.replace(/[\s.]/g, '') : ''
  // Shape only (as the shop profile checks it, core/seller.ts) — but never one digit repeated (0000000000).
  const out = /^\d{10}$/.test(s) || /^\d{10}-\d{3}$/.test(s) ? s : /^\d{13}$/.test(s) ? `${s.slice(0, 10)}-${s.slice(10)}` : null
  return out && !/^(\d)\1{9}/.test(out) ? out : null
}

/** An https address on a named public host (no credentials, no IP literal, no bare name); null otherwise. The address
 *  is only ever FETCHED through safeFetch, which also refuses private networks at every hop. */
export function publicHttpsUrl(v: unknown): URL | null {
  const s = clean(v)
  if (!s || s.length > AD_FIELD_LIMITS.url) return null
  let u: URL
  try { u = new URL(s) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password) return null
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.endsWith('.local') || host.endsWith('.internal')) return null
  return u
}

export type ParsedCreative = { ok: true; fields: CreativeFields; landingHost: string } | { ok: false; reasons: ReviewReason[] }

/** Step 1: the fields. Every problem at once, so the advertiser fixes them in one go. */
export function parseCreative(raw: unknown): ParsedCreative {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reasons: [reviewReason('creative_invalid')] }
  const r = raw as Record<string, unknown>
  const bad: ReviewReasonCode[] = []
  const within = (v: string | null, min: number, max: number) => v !== null && v.length >= min && v.length <= max
  const legalName = clean(r.legalName)
  if (!within(legalName, 2, AD_FIELD_LIMITS.legalName)) bad.push('legal_name_invalid')
  const taxCode = normalizeTaxCode(r.taxCode)
  if (!taxCode) bad.push('tax_code_invalid')
  const advertiserName = clean(r.advertiserName)
  if (!within(advertiserName, 2, AD_FIELD_LIMITS.advertiserName)) bad.push('advertiser_name_invalid')
  const headline = clean(r.headline)
  if (!within(headline, 2, AD_FIELD_LIMITS.headline)) bad.push('headline_invalid')
  const body = r.body == null ? '' : clean(r.body)
  if (body === null || body.length > AD_FIELD_LIMITS.body) bad.push('body_invalid')
  const permitRef = r.permitRef == null ? '' : clean(r.permitRef)
  if (permitRef === null || permitRef.length > AD_FIELD_LIMITS.permitRef) bad.push('permit_ref_invalid')
  const image = publicHttpsUrl(r.imageUrl)
  if (!image) bad.push('image_url_invalid')
  const click = publicHttpsUrl(r.clickUrl)
  if (!click) bad.push('click_url_invalid')
  if (bad.length) return { ok: false, reasons: bad.map(reviewReason) }
  return {
    ok: true,
    fields: { legalName: legalName!, taxCode: taxCode!, advertiserName: advertiserName!, headline: headline!, body: body || null, permitRef: permitRef || null, imageUrl: image!.toString(), clickUrl: click!.toString() },
    landingHost: click!.hostname.toLowerCase(),
  }
}

/** Same fields, same hash: the picture counts by its submitted address (what runs is eno's reviewed copy, see step 7). */
export function creativeHash(f: CreativeFields): string {
  return crypto.createHash('sha256').update(JSON.stringify(['ad-v1', f.legalName, f.taxCode, f.advertiserName, f.headline, f.body, f.permitRef, f.imageUrl, f.clickUrl])).digest('hex')
}

/** The words' language: a script's code or 'vi' (detect-lang.ts), else 'und' — Latin text it cannot name. */
export function sourceLangOf(text: string): string {
  return detectContentLang(text) ?? (readsAsVietnamese(text) ? 'vi' : 'und')
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' '
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** The page's <title> and description (meta name=description, else og:description; og:title when there is no <title>). */
export function landingHead(html: string): { title: string | null; description: string | null } {
  const head = html.slice(0, AD_LANDING_MAX_BYTES)
  // A real attribute (after whitespace), never `data-name=` or `data-content=` (commit gate, opus: a decoy meta tag).
  const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  const metaContent = (key: string): string | null => {
    for (const m of head.matchAll(/<meta\b[^>]{0,2000}>/gi)) {
      const tag = m[0]
      const k = attr(tag, 'name') ?? attr(tag, 'property')
      if ((k?.[2] ?? k?.[3] ?? '').toLowerCase() !== key) continue
      const c = attr(tag, 'content')
      if (c) return c[2] ?? c[3] ?? null
    }
    return null
  }
  const tidy = (s: string | null | undefined, n: number) => {
    const t = s == null ? '' : clean(decodeEntities(s.replace(/<[^>]*>/g, ' '))) ?? ''
    return t ? t.slice(0, n) : null
  }
  const title = /<title\b[^>]{0,200}>([\s\S]{0,1000}?)<\/title>/i.exec(head)?.[1]
  return { title: tidy(title ?? metaContent('og:title'), 200), description: tidy(metaContent('description') ?? metaContent('og:description'), 300) }
}

type ImageCheck = { ok: true; buf: Buffer; width: number; height: number } | { ok: false; code: ReviewReasonCode }

/** Step 3. Only through safeFetch; the body counted against the cap as it streams. */
export async function fetchAdImage(url: string): Promise<ImageCheck> {
  let res: Response
  try {
    res = await safeFetch(url, { timeoutMs: FETCH_TIMEOUT_MS, headers: { accept: 'image/jpeg,image/png,image/webp', 'user-agent': UA } })
  } catch {
    return { ok: false, code: 'image_unreachable' }
  }
  if (!res.ok || !res.body) { await res.body?.cancel().catch((e: unknown) => logError(e, { op: 'ads.review.image.cancel' })); return { ok: false, code: 'image_unreachable' } }
  let buf: Buffer | null
  try { buf = await readCapped(res, AD_IMAGE_MAX_BYTES, 'ads.review.image') } catch { return { ok: false, code: 'image_unreachable' } }
  if (!buf) return { ok: false, code: 'image_too_large' }
  if (!sniffImageType(buf.subarray(0, 16))) return { ok: false, code: 'image_type' }
  const m = await measureImage(buf)
  const w = m?.width, h = m?.height
  if (!w || !h) return { ok: false, code: 'image_type' }
  if (w * h > AD_IMAGE_MAX_PIXELS) return { ok: false, code: 'image_too_large' }
  if (Math.min(w, h) < AD_IMAGE_MIN_EDGE) return { ok: false, code: 'image_too_small' }
  const aspect = w / h
  if (aspect < AD_IMAGE_ASPECT.min || aspect > AD_IMAGE_ASPECT.max) return { ok: false, code: 'image_aspect' }
  return { ok: true, buf, width: w, height: h }
}

/** The page's character set: the Content-Type's, else a <meta charset> in its first 2 KB, else UTF-8. */
function charsetOf(type: string, head: Buffer): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(type)?.[1]
  const fromMeta = /<meta[^>]{0,200}charset=["']?([\w-]+)/i.exec(head.subarray(0, 2048).toString('latin1'))?.[1]
  return (fromHeader || fromMeta || 'utf-8').toLowerCase()
}
function decodePage(buf: Buffer, type: string): string {
  try { return new TextDecoder(charsetOf(type, buf), { fatal: false }).decode(buf) } catch { return new TextDecoder('utf-8', { fatal: false }).decode(buf) }
}

export type Landing = { ok: true; finalHost: string; title: string | null; description: string | null } | { ok: false; code: 'landing_unreachable' | 'landing_not_page' }

/** Step 4. Reachable (2xx through safeFetch's redirects) and a web page, or refused; its head read from the first
 *  256 KB. `finalHost` is where the redirects ended — what Jev is told the ad leads to, beside the address given. */
export async function fetchLanding(url: string): Promise<Landing> {
  let res: Response
  try {
    res = await safeFetch(url, { timeoutMs: FETCH_TIMEOUT_MS, headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': UA } })
  } catch {
    return { ok: false, code: 'landing_unreachable' }
  }
  if (!res.ok) { await res.body?.cancel().catch((e: unknown) => logError(e, { op: 'ads.review.landing.cancel' })); return { ok: false, code: 'landing_unreachable' } }
  const type = res.headers.get('content-type') || ''
  // ⛔ A web page, never a download (an .apk behind an ad is a known scam shape here): nothing else is reviewable.
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) { await res.body?.cancel().catch((e: unknown) => logError(e, { op: 'ads.review.landing.cancel' })); return { ok: false, code: 'landing_not_page' } }
  let finalHost = new URL(url).hostname.toLowerCase()
  try { if (res.url) finalHost = new URL(res.url).hostname.toLowerCase() } catch { /* keep the given host */ }
  // A body that breaks off is not a page that was read: unreachable, never judged on its address alone. (An empty head —
  // a page drawn by script — is a page: Jev reads the ad and the address.)
  let head: Buffer | null
  try { head = await readPrefix(res, AD_LANDING_MAX_BYTES, 'ads.review.landing') } catch { return { ok: false, code: 'landing_unreachable' } }
  return { ok: true, finalHost, ...landingHead(head ? decodePage(head, type) : '') }
}

/** Delete one of the review's own pictures (`listings/ads/…`) — a picture stored for a creative whose row could not be
 *  written, or one eno removed. Only an `ads/` key of eno's own bucket is ever touched. Never throws. */
export async function removeAdImage(url: string): Promise<boolean> {
  const obj = listingObjectKey(url)
  if (!obj || obj.bucket !== LISTINGS_BUCKET || !obj.key.startsWith('ads/')) return false
  try {
    const { error } = await getSupabaseAdmin().storage.from(LISTINGS_BUCKET).remove([obj.key])
    if (error) { logError(new Error(error.message), { op: 'ads.image.remove' }); return false }
    return true
  } catch (e) {
    logError(e, { op: 'ads.image.remove' })
    return false
  }
}

/** Step 6a. One Jev call, every class. null = not judged (no key, deadline, HTTP or shape error): the caller fails closed. */
export async function askJev(state: string): Promise<{ scores: Record<AdQuestionKey, number>; tokens: number } | null> {
  const key = process.env.TYPESAFE_API_KEY?.trim()
  if (!key) return null
  try {
    const res = await fetch(JEV_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(JEV_DEADLINE_MS),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: JEV_AD_MODEL, state, questions: jevAdQuestions() }),
    })
    if (!res.ok) { logInfo('ad_review_jev_http', { status: res.status }); return null }
    const j = (await res.json()) as { answers?: unknown; usage?: { input_tokens?: unknown } }
    const scores = readJevAnswers(j.answers)
    if (!scores) { logInfo('ad_review_jev_shape', {}); return null }
    return { scores, tokens: Number(j.usage?.input_tokens) || 0 }
  } catch (e) {
    if ((e as { name?: string })?.name === 'TimeoutError') logInfo('ad_review_jev_timeout', { ms: JEV_DEADLINE_MS })
    else logError(e, { op: 'ads.review.jev' })
    return null
  }
}

// ── The stored creative and the answer every surface gives ───────────────────────────────────────────────────────────

export type CreativeRow = Prisma.AdCreativeGetPayload<object>

/** The review as the HTTP 422 / the MCP result / the dashboard state it. */
export type ReviewView = {
  status: 'approved' | 'refused' | 'removed' | 'unavailable' | 'limited'
  creative_id: string | null
  reasons: ReviewReason[]
  permit_classes: string[]
  reused: boolean
  reviewed_at: string | null
}

export function storedReasons(json: unknown): ReviewReason[] {
  return Array.isArray(json) ? json.flatMap((r) => (r && typeof r === 'object' && isReviewReasonCode((r as { code?: unknown }).code) ? [reviewReason((r as { code: ReviewReasonCode }).code)] : [])) : []
}
export function storedPermitClasses(scores: unknown): string[] {
  const p = (scores as { permitClasses?: unknown } | null)?.permitClasses
  return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : []
}

export function reviewViewOf(c: CreativeRow, reused: boolean): ReviewView {
  const status = c.status === 'approved' ? 'approved' : c.status === 'removed' ? 'removed' : 'refused'
  return {
    status,
    creative_id: c.id,
    reasons: status === 'removed' ? [reviewReason('creative_removed')] : storedReasons(c.reasons),
    permit_classes: storedPermitClasses(c.scores),
    reused,
    reviewed_at: c.reviewedAt.toISOString(),
  }
}

export type ReviewOutcome =
  | { kind: 'approved'; creative: CreativeRow; view: ReviewView }
  | { kind: 'refused'; creative: CreativeRow | null; view: ReviewView }
  /** Not a verdict: nothing was decided, nothing stored — the caller answers 503 (unavailable) or 429 (limited). */
  | { kind: 'unavailable' | 'limited'; view: ReviewView }

const notJudged = (kind: 'unavailable' | 'limited'): ReviewOutcome => ({
  kind,
  view: { status: kind, creative_id: null, reasons: [reviewReason(kind === 'limited' ? 'review_limit' : 'review_unavailable')], permit_classes: [], reused: false, reviewed_at: null },
})
const refusedUnstored = (reasons: ReviewReason[]): ReviewOutcome => ({
  kind: 'refused',
  creative: null,
  view: { status: 'refused', creative_id: null, reasons, permit_classes: [], reused: false, reviewed_at: null },
})
const outcomeOf = (c: CreativeRow, reused: boolean): ReviewOutcome =>
  c.status === 'approved' ? { kind: 'approved', creative: c, view: reviewViewOf(c, reused) } : { kind: 'refused', creative: c, view: reviewViewOf(c, reused) }

/** A stored creative's review, as every surface states it (create_ad with a creativeId). */
export async function storedReview(creativeId: string): Promise<ReviewView | null> {
  const c = await db.adCreative.findUnique({ where: { id: creativeId } })
  return c ? reviewViewOf(c, true) : null
}

/**
 * A removal that still binds this shop, at any age: the same content, OR any ad to the same landing host — so a removed ad
 * never comes back by being submitted again with one character changed (commit gate, opus). A new ad to a page eno took an
 * ad down for needs a person at eno (support), not another review.
 */
export async function removedVerdict(sellerId: string, contentHash: string, landingHost: string): Promise<CreativeRow | null> {
  return db.adCreative.findFirst({ where: { sellerId, status: 'removed', OR: [{ contentHash }, { landingHost }] }, orderBy: { createdAt: 'desc' } })
}

/** The verdict given to this shop for this content within 24 h BY THIS REVIEW (the same models, calibration and
 *  thresholds — adReviewKey), if any. */
export async function reusedVerdict(sellerId: string, contentHash: string, reviewModel: string, now = new Date()): Promise<CreativeRow | null> {
  return db.adCreative.findFirst({
    where: { sellerId, contentHash, reviewModel, status: { in: ['approved', 'refused'] }, createdAt: { gte: new Date(now.getTime() - AD_REVIEW_REUSE_MS) } },
    orderBy: { createdAt: 'desc' },
  })
}

function withDeadline<T>(p: Promise<T>, ms: number, op: string): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => { logInfo('ad_review_deadline', { op, ms }); resolve(null) }, ms) })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}

/**
 * Review a submitted creative for `sellerId` (the shop the Bearer credential acts for). Returns the stored creative for a
 * verdict, or a not-judged outcome. Throws only on a database error (the caller answers 503 before any payment).
 */
export async function reviewCreative(sellerId: string, raw: unknown, now = new Date()): Promise<ReviewOutcome> {
  const parsed = parseCreative(raw)
  if (!parsed.ok) return refusedUnstored(parsed.reasons)
  const f = parsed.fields
  const contentHash = creativeHash(f)

  const removed = await removedVerdict(sellerId, contentHash, parsed.landingHost)
  if (removed) return outcomeOf(removed, true)
  // ⛔ Not on sale while the thresholds are unmeasured (see the header), whatever the review would say — checked BEFORE
  // any stored verdict is reused, so a preview's provisional approval is never priced here.
  if (!JEV_AD_CALIBRATION && !provisionalReviewAllowed()) {
    logInfo('ad_review_uncalibrated', { model: JEV_AD_MODEL })
    return notJudged('unavailable')
  }
  const reviewModel = adReviewKey(GEMINI_REVIEW)
  const prior = await reusedVerdict(sellerId, contentHash, reviewModel, now)
  if (prior) return outcomeOf(prior, true)

  // The fetches are free but not unbounded: a shop's hourly budget first (strict, like the paid one below).
  const fetches = await rateLimit('ad-review-fetch', sellerId, AD_REVIEW_FETCHES_PER_HOUR, '1 h', { strict: true }).catch((e: unknown) => { logError(e, { op: 'ads.review.fetch-budget' }); return null })
  if (!fetches?.success) return notJudged(fetches ? 'limited' : 'unavailable')
  const image = await fetchAdImage(f.imageUrl)
  if (!image.ok) return refusedUnstored([reviewReason(image.code)])
  const landing = await fetchLanding(f.clickUrl)
  if (!landing.ok) return refusedUnstored([reviewReason(landing.code)])

  const words = [f.headline, f.body, f.advertiserName, f.legalName, f.permitRef, landing.title, landing.description].filter((w): w is string => !!w)
  if (words.some((w) => findBannedWordAccentAware(w))) return refusedUnstored([reviewReason('banned_word')])

  // The paid part. The budget fails CLOSED (strict): a limiter outage is no way past it.
  const budget = await rateLimit('ad-review', sellerId, AD_REVIEWS_PER_DAY, '1 d', { strict: true }).catch((e: unknown) => { logError(e, { op: 'ads.review.budget' }); return null })
  if (!budget?.success) return notJudged(budget ? 'limited' : 'unavailable')

  const state = jevAdState({ ...f, landingHost: parsed.landingHost, landingFinalHost: landing.finalHost, landingTitle: landing.title, landingDescription: landing.description })
  const [jev, gemini] = await Promise.all([
    askJev(state),
    withDeadline(moderateListing({
      title: f.headline,
      description: [f.body, `Advertiser: ${f.advertiserName} (${f.legalName})`, landing.title, landing.description].filter(Boolean).join('\n'),
      imageUrls: [],
      imageBuffers: [image.buf],
      extraCategories: AD_IMAGE_RULES,
    }).catch((e: unknown) => { logError(e, { op: 'ads.review.gemini' }); return null }), GEMINI_DEADLINE_MS, 'gemini'),
  ])
  // ⛔ Fail closed: either judge missing, or a Gemini verdict that never saw the picture.
  if (!jev || !gemini || gemini.images < 1) {
    logInfo('ad_review_unavailable', { jev: !!jev, gemini: !!gemini, images: gemini?.images ?? 0 })
    return notJudged('unavailable')
  }

  const { refusals, permitClasses } = jevAdVerdict(jev.scores)
  const codes = new Set<ReviewReasonCode>(refusals)
  if (gemini.prohibited && gemini.confidence >= AD_MODERATION_THRESHOLD) codes.add('content_prohibited')
  const approved = codes.size === 0

  let imageUrl = ''
  if (approved) {
    const hosted = await storeListingImage(image.buf, { pathPrefix: 'ads/', watermark: false })
    if (!hosted) return notJudged('unavailable')
    imageUrl = hosted
  }
  const scores = {
    jev: jev.scores,
    thresholds: JEV_AD_THRESHOLDS,
    jevTokens: jev.tokens,
    gemini: { prohibited: gemini.prohibited, category: gemini.category, confidence: gemini.confidence, reason: gemini.reason, threshold: AD_MODERATION_THRESHOLD },
    permitClasses,
    image: { width: image.width, height: image.height },
    landing: { finalHost: landing.finalHost, title: landing.title, description: landing.description },
    calibration: JEV_AD_CALIBRATION,
  }
  const text = [f.headline, f.body].filter(Boolean).join(' ')
  const creative = await db.adCreative.create({
    data: {
      sellerId,
      legalName: f.legalName,
      taxCode: f.taxCode,
      advertiserName: f.advertiserName,
      headline: f.headline,
      body: f.body,
      sourceLang: sourceLangOf(text),
      permitRef: f.permitRef,
      imageUrl,
      clickUrl: f.clickUrl,
      landingHost: parsed.landingHost,
      contentHash,
      status: approved ? 'approved' : 'refused',
      reasons: [...codes].map(reviewReason) as unknown as Prisma.InputJsonValue,
      scores: scores as unknown as Prisma.InputJsonValue,
      reviewModel,
      reviewedAt: now,
    },
  }).catch(async (e: unknown) => {
    // The picture was stored for a row that does not exist: take it back (the purge paths never delete `ads/`).
    if (imageUrl) await removeAdImage(imageUrl)
    throw e
  })
  logInfo('ad_review', { creativeId: creative.id, approved, refusals: [...codes], permitClasses, tokens: jev.tokens })
  // The words in the top visitor languages now, so the feed embeds them from the first view (src/lib/ads/serve.ts);
  // the long tail is translated on first view through /api/translate and cached the same way. Best effort.
  if (approved) void warmTranslations([f.headline, ...(f.body ? [f.body] : [])]).catch((e: unknown) => logError(e, { op: 'ads.review.warm' }))
  return outcomeOf(creative, false)
}
