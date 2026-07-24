import { NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { translateBatch, LANGS, type Lang } from '@/lib/translate'
import { rateLimit, kv } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── Live chat translation — the SERVER half ──────────────────────────────────────────
//
// Owner ask (2026-07-24): when buyer and seller run the app in different languages, a tick
// box live-translates the OTHER party's messages into the viewer's language.
//
// ⚠️ THIS ENDPOINT IS BY-ID, NEVER BY-TEXT — that is the whole security design (codex, plan
// review). The obvious shape, `{ texts, target }`, is an authenticated translation proxy:
// any signed-in user could pour arbitrary text through the paid provider, and the server
// could not prove the text was chat they are allowed to read. Instead the client sends
// `{ conversationId, messageIds }`, and the server:
//   · proves the caller is a PARTICIPANT of that conversation,
//   · loads the rows ITSELF, scoped to that conversation id,
//   · keeps only INCOMING (`senderProfileId != me`) `kind:'text'` messages — offer and visa
//     cards render their own derived copy and must never be translated,
// so the only text that can ever reach the provider is a message this user is already
// reading on their screen. Ids that are theirs, structured, or from another thread simply
// return nothing.
//
// ⚠️ PRIVATE TEXT NEVER ENTERS THE SHARED CACHE. `translateBatch` normally upserts every
// result into the `Translation` table, which is keyed by sha1(source), has no owner column,
// is read by every page for every user, and outlives the message. Chat goes through with
// `skipWrite: true` — reads from it (free, harmless) but writes nothing to it.
//
// Instead we keep a 24h EPHEMERAL cache in the KV store, read and written only here. It is
// what makes the endpoint affordable: without it every reload of a thread re-bills the whole
// visible history, and a replay of the same ids bills again forever (both external reviewers
// independently flagged this as the binding cost constraint). With it, a replay is free, so
// spend tracks NOVEL text — which is bounded by people actually writing messages.

// Never translate more than one screenful of history per call; the client already chunks.
const MAX_IDS = 50
// Bound the raw payload of one request. ~5k chars is a long thread of chat lines.
const MAX_CHARS_PER_REQ = 5_000
// Paid-provider ceilings, in characters (Google bills $20/M). Deliberately SEPARATE keys
// from the UI-dictionary budget in /api/translate: a chat spike must not be able to blank
// the app's own interface translations, and vice versa.
const DAILY_CHAR_BUDGET = 300_000      // everyone, per day (~$6 worst case)
const USER_DAILY_CHARS = 60_000        // one account, per day (~$0.0012)
// Ephemeral cache lifetime. Long enough that reloading a thread through a working day is
// free; short enough that a translated copy of a private message is not lying around.
const EPHEMERAL_TTL_SEC = 24 * 60 * 60
// Hard wall on the provider round trip. translateBatch retries 4× with backoff sleeps, so
// it can legitimately run ~20s — fine for a background warm, far too long for a live chat
// request. On expiry we return 503, NOT a degraded 200 (codex, plan review): the client
// marks every id in a 200 response permanently attempted, so answering a slow provider with
// "here are your originals" would silently kill translation for those messages for the rest
// of the session. 503 is retryable and self-heals.
const PROVIDER_TIMEOUT_MS = 8_000

const hash = (text: string) => crypto.createHash('sha1').update(text).digest('hex')
const cacheKey = (target: string, body: string) => `chat-tr:${target}:${hash(body)}`
const today = () => new Date().toISOString().slice(0, 10)

type Item = { id: string; text: string; translated: boolean }

/** Store the real translations from a finished provider call. Passthroughs are skipped —
 *  re-deriving "unchanged" costs nothing, and caching it would hide a later fix. */
async function cacheFresh(lang: Lang, sources: string[], results: string[]): Promise<void> {
  const fresh: Array<[string, unknown]> = []
  sources.forEach((src, i) => {
    const value = results[i] ?? src
    if (value !== src) fresh.push([cacheKey(lang, src), value])
  })
  if (fresh.length) await kv.mset(fresh, EPHEMERAL_TTL_SEC).catch(() => {})
}

export async function POST(req: Request) {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  let body: { conversationId?: unknown; messageIds?: unknown; target?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
  const target = typeof body.target === 'string' ? body.target : ''
  const ids = Array.isArray(body.messageIds)
    ? Array.from(new Set(body.messageIds.filter((x): x is string => typeof x === 'string' && !!x)))
    : []
  if (!conversationId || !LANGS.includes(target as Lang) || !ids.length || ids.length > MAX_IDS) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  const lang = target as Lang

  // ── Membership gate ────────────────────────────────────────────────────────────────
  // Deliberately NOT filtered by buyerDeletedAt/sellerDeletedAt: DELETE on a conversation
  // is a per-user HIDE from the inbox, not a revocation — the thread reappears when the
  // other party replies and the user can still open it. Treating it as a permission would
  // break translation on a legitimately re-opened thread.
  const convo = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { buyerProfileId: true, sellerProfileId: true },
  })
  if (!convo) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (meId !== convo.buyerProfileId && meId !== convo.sellerProfileId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // The server chooses what is translatable — the client's own filter is a courtesy, not
  // the gate. `kind: 'text'` excludes offer/visa_step/visa_checkout/visa_result/visa_picker
  // cards; `senderProfileId: not me` excludes the caller's own words.
  const rows = await db.message.findMany({
    where: { id: { in: ids }, conversationId, kind: 'text', senderProfileId: { not: meId } },
    select: { id: true, body: true },
  })
  const eligible = rows.filter((r) => r.body.trim().length > 0)
  if (!eligible.length) return NextResponse.json({ items: [] as Item[] })

  const totalChars = eligible.reduce((n, r) => n + r.body.length, 0)
  if (totalChars > MAX_CHARS_PER_REQ) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
  }

  // ── 1) Ephemeral cache: one round trip, and every hit is free ──────────────────────
  const uniqueBodies = Array.from(new Set(eligible.map((r) => r.body)))
  const translatedByBody = new Map<string, string>()
  let cached = new Map<string, string>()
  let cacheReadFailed = false
  try {
    cached = await kv.mget<string>(uniqueBodies.map((b) => cacheKey(lang, b)))
  } catch {
    // Cache unavailable → treat everything as a miss. Fails OPEN on purpose: this is a
    // cost optimisation, not a control. The budget below is the actual spend ceiling.
    cacheReadFailed = true
  }
  const misses: string[] = []
  for (const b of uniqueBodies) {
    const hit = cached.get(cacheKey(lang, b))
    if (typeof hit === 'string') translatedByBody.set(b, hit)
    else misses.push(b)
  }

  // ── 2) Pay for the misses only ─────────────────────────────────────────────────────
  //
  // ⚠️ THE FAILURE CONTRACT IS THE SUBTLE PART (both external reviewers refuted the first
  // draft on it). A 200 makes the client mark every id in the batch permanently attempted,
  // so answering a TRANSIENT problem with "here are your originals" silently kills
  // translation for those messages for the rest of the session. So:
  //   · transient (limiter, accounting down, provider down, provider slow) ⇒ 429/503, which
  //     the client leaves un-attempted and retries;
  //   · the one DELIBERATE 200-with-originals is a genuinely exhausted daily budget — see
  //     the note at that branch for why retrying is the wrong behaviour there.
  const overBudget = { day: false, user: false }
  if (misses.length) {
    const billable = misses.reduce((n, b) => n + b.length, 0)
    // strict = FAIL CLOSED: a limiter outage must not reopen the paid path.
    const rl = await rateLimit('chat-translate', meId, 20, '1 m', { strict: true })
    if (!rl.success) {
      // Transient and per-minute — the client leaves these ids un-attempted and retries.
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }
    try {
      const day = today()
      // Charged BEFORE the call and never refunded on failure. That is the right direction
      // for a spend ceiling: an outage that burned quota costs us nothing, whereas refunding
      // on error would let a caller who can force errors translate for free. If one incrby
      // lands and the other throws, a retry re-charges the one that landed — over-counting,
      // which errs toward spending less than the ceiling (codex).
      const [dayTotal, userTotal] = await Promise.all([
        kv.incrby(`chat-tr:chars:${day}`, billable, 2 * 24 * 60 * 60),
        kv.incrby(`chat-tr:u:${meId}:${day}`, billable, 2 * 24 * 60 * 60),
      ])
      overBudget.day = dayTotal > DAILY_CHAR_BUDGET
      overBudget.user = userTotal > USER_DAILY_CHARS
    } catch {
      // No accounting ⇒ no paid call (same stance as /api/translate). But this is a BLIP,
      // not a ceiling, so it must not be answered with a cacheable 200.
      return NextResponse.json({ error: 'budget_unavailable' }, { status: 503 })
    }

    if (!overBudget.day && !overBudget.user) {
      const stats = { providerFailed: false }
      const work = translateBatch(misses, lang, { skipWrite: true, stats, source: 'chat' }).catch(() => null)
      let timer: ReturnType<typeof setTimeout> | undefined
      const timed = await Promise.race([
        work,
        new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), PROVIDER_TIMEOUT_MS) }),
      ])
      if (timer) clearTimeout(timer)

      if (timed === 'timeout') {
        // Do NOT throw the slow work away — it is already paid for. Let it land in the
        // ephemeral cache after the response, so the client's retry is a free cache hit
        // instead of a second charge for the same text (codex).
        after(async () => {
          const late = await work
          if (late && late.length === misses.length) await cacheFresh(lang, misses, late)
        })
        return NextResponse.json({ error: 'translate_timeout' }, { status: 503 })
      }
      if (!timed || timed.length !== misses.length || stats.providerFailed) {
        // The provider is DOWN (or misaligned): `timed` is source fallback, not translation.
        // `stats.providerFailed` is why translateBatch grew an out-param — output===input is
        // otherwise indistinguishable from text that legitimately translates to itself, and
        // guessing would 503-loop every same-language thread.
        return NextResponse.json({ error: 'translate_unavailable' }, { status: 503 })
      }
      misses.forEach((src, i) => translatedByBody.set(src, timed[i] ?? src))
      await cacheFresh(lang, misses, timed)
    }
    // Over budget AND we could not even read the cache ⇒ we know nothing about these
    // messages: the originals we would return are not "no translation available", they are
    // "we failed to look". Answering 200 there would permanently bank that ignorance on the
    // client, so this narrow combination stays retryable (codex, confirm round).
    if ((overBudget.day || overBudget.user) && cacheReadFailed) {
      return NextResponse.json({ error: 'translate_unavailable' }, { status: 503 })
    }
    // Over budget ⇒ no provider call at all. This is the ONE deliberate degrade-to-200: the
    // ceiling is DAILY, so a 503 here would make every client retry on every message append
    // for the rest of the day against the very database the budget exists to protect. The
    // free cache hits still serve, so the feature thins out rather than dying, and it clears
    // on the next UTC day (or immediately on a reload, which starts a fresh attempted-set).
  }

  // ── 3) Answer, one item per eligible id ────────────────────────────────────────────
  // `translated` is claimed only when the text actually CHANGED. A correct translation that
  // equals its source (a URL, "OK", an emoji line) therefore reports false — the safe
  // direction: the viewer sees identical text either way, and we never label somebody's own
  // words a translation.
  const items: Item[] = eligible.map((r) => {
    const value = translatedByBody.get(r.body) ?? r.body
    return { id: r.id, text: value, translated: value !== r.body }
  })
  return NextResponse.json({ items })
}
