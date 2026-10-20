import { after } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { translateBatch, LANGS, type Lang } from '@/lib/translate'
import { rateLimit, kv } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { ApiError, route } from '@/lib/api/handler'
import { getAdmin } from '@/lib/admin'
import { SUPPORT_SELLER_ID } from '@/lib/support-thread'
import { detectChatLang, foreignTo } from '@/lib/chat-lang'
import { restoreViMarks } from '@/lib/vi-restore'
import { phrasebook } from '@/lib/chat-phrasebook'

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
// ⚠️ PER CONVERSATION. Keyed by text alone, a free (cached) answer told anyone that the same words had been translated
// in SOMEONE ELSE's thread within the day — a small window into private chat. The same line in two threads now
// translates twice; that is the whole cost.
const cacheKey = (target: string, conversationId: string, body: string) => `chat-tr:${target}:${conversationId}:${hash(body)}`
const today = () => new Date().toISOString().slice(0, 10)

// `retry`: this one did not translate THIS time and may next time (its server was down or slow, or the box model
// refused it while the paid provider the retry asks first had only failed) — the client asks again later instead of
// banking the original as final. Absent on every other item, a line the box model REFUSED with no paid provider left
// to ask included: that one is answered as its original, final (step 2).
type Item = { id: string; text: string; translated: boolean; retry?: true }

/**
 * What to send the provider for one message — or null: no translation at all.
 *
 * ⛔ THE ROUTE DECIDES THE SOURCE LANGUAGE ITSELF, with the chat detector (src/lib/chat-lang.ts). translateBatch's own
 * guess (detectContentLang) reads unaccented Vietnamese as English, so 'xin chao' for an English reader was "English
 * to English" — skipped, or sent to a dead paid key and failed the whole batch. Here:
 *  · already in the reader's language, a greeting both know ('ok', 'hi'), or too close to call ⇒ null: answered
 *    as the original, unbilled, never retried;
 *  · Vietnamese typed without its marks ⇒ marks restored first (src/lib/vi-restore.ts) — the box model turns raw
 *    unaccented Vietnamese into fluent nonsense even when told the language;
 *  · French or Malay (named by the detector) ⇒ sent as such; any other Latin line ⇒ sent as English;
 *  · one of the commonest short lines ('Bạn khỏe không', 'cảm ơn', 'is it still available?') ⇒ `fixed`: a looked-up
 *    translation, no provider at all (src/lib/chat-phrasebook.ts — the model gets exactly these wrong).
 */
type Plan = { send: string; source: string; fixed?: string }
function chatPlan(body: string, target: Lang): Plan | null {
  const { lang: detected, marks } = detectChatLang(body)
  if (!detected || detected === 'und' || !foreignTo(detected, target)) return null
  // An unnamed Latin line goes out as English — the only Latin source worth assuming here; French and Malay are
  // named by the detector itself.
  const source = detected === 'latin' ? 'en' : detected === 'zh' ? 'zh-Hans' : detected
  if (!LANGS.includes(source as Lang)) return null
  const fixed = phrasebook(body, source, target)
  if (fixed) return { send: body, source, fixed }
  return { send: source === 'vi' && marks !== 'full' ? restoreViMarks(body) : body, source }
}

/**
 * One log line for every refused or failed call. On 2026-10-20 four 403s from this route left no trace but nginx's
 * status code, and the cause had to be inferred. The line carries the reason and counts, never message text.
 */
function trace(reason: string, extra: Record<string, unknown> = {}): void {
  console.warn('[chat-tr]', JSON.stringify({ reason, ...extra }))
}

/** m2m100's Vietnamese habits: a leading list dash, and 'ngươi' — an archaic, condescending "you" — for "you". */
function polishVi(text: string): string {
  return text.replace(/^\s*[-–—]\s+/, '').replace(/\b(N|n)gươi\b/gu, (_m, n: string) => (n === 'N' ? 'Bạn' : 'bạn'))
}

// "Hi" for "hi" is not a translation: compare without case, punctuation or spacing.
const sameText = (a: string, b: string) =>
  a.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '') === b.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')

/** Store the real translations from a finished provider call. Passthroughs are skipped —
 *  re-deriving "unchanged" costs nothing, and caching it would hide a later fix. */
async function cacheFresh(lang: Lang, conversationId: string, sources: string[], results: string[]): Promise<void> {
  const fresh: Array<[string, unknown]> = []
  sources.forEach((src, i) => {
    const value = results[i] ?? src
    if (value !== src) fresh.push([cacheKey(lang, conversationId, src), value])
  })
  if (fresh.length) await kv.mset(fresh, EPHEMERAL_TTL_SEC).catch((e) => logError(e, { op: 'translate.mset' }))
}

// ⚠️ WS6 MIGRATION — THE AUTH PREAMBLE ONLY, AND BOTH OMISSIONS ARE FORCED BY ORDER.
//
// `auth: 'userId'` because the old code called getCurrentProfileId() verbatim and the handler only
// compares the returned id against buyerProfileId/sellerProfileId and `senderProfileId: { not: meId }`.
// No Profile field is read, so 'profile' would add a getUser() round trip and a Profile row read to a
// call that fires on every thread open — the hot-path regression handler.ts's `userId` mode exists to
// prevent.
//
// ⚠️ THE LIMITER DOES NOT MOVE INTO `rateLimit:`, for two independent reasons. (a) It runs only
// `if (misses.length)` — a request served entirely from the ephemeral cache costs nothing and MUST
// always serve, which is the whole affordability design above; the wrapper's option is unconditional.
// (b) It runs AFTER the membership gate, so hoisting it would let a non-participant who currently
// always gets 403 start seeing 429, and would spend a participant's per-minute budget on 404/403/413
// requests that never reach the provider. `strict: true` is preserved exactly where it was.
//
// ⚠️ NO `body:` SCHEMA. The hand-coercion is deliberately TOLERANT in a way zod is not: a non-string
// `conversationId`/`target` is coerced to '' and falls into the same 400, and `messageIds` is
// FILTERED (non-strings and empties dropped, then deduped) rather than rejected — so today
// `{messageIds:['a',1,'a']}` translates message `a`, where a zod array-of-string would 400. Adding a
// schema would tighten validation, which is a wire change.
//
// Branches held, unchanged: guest → 401 `auth_required` · malformed JSON → 400 `bad_request` ·
// missing/blank conversationId, unknown target lang, empty or >50 ids → 400 `bad_request` · unknown
// thread → 404 `not_found` · non-participant → 403 `forbidden` · no eligible rows → 200 `{"items":[]}` ·
// >5k chars → 413 `payload_too_large` · over the per-minute paid limit → 429 `rate_limited` ·
// accounting down → 503 `budget_unavailable` · provider slow → 503 `translate_timeout` · provider
// down, or over budget with a dead cache → 503 `translate_unavailable` · over budget with a live
// cache → 200 with originals · success → 200 `{"items":[…]}`.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL: ANY unhandled throw in this handler used to reach Next's
// default 500 HTML, and route() now catches it, logs with an `op`, and returns
// `{"error":"internal_error"}` 500 — an improvement, but a wire change on that failure path.
//
// Stated as a shape rather than an inventory, deliberately. The first draft named
// `db.conversation.findUnique` / `db.message.findMany` as the causes; the review pointed out a
// third that needs no DB at all — a body of literal `null` parses fine, so the tolerant parse
// below does not fire, and the `typeof body.conversationId` coercion TypeErrors on null.
export const POST = route({ auth: 'userId' }, async ({ req, userId: meId }) => {
  let body: { conversationId?: unknown; messageIds?: unknown; target?: unknown; v?: unknown }
  try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }
  // A body of literal `null` (or any non-object) parses fine and then TypeErrored below into a 500.
  if (!body || typeof body !== 'object') throw new ApiError('bad_request', 400)

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
  const target = typeof body.target === 'string' ? body.target : ''
  const ids = Array.isArray(body.messageIds)
    ? Array.from(new Set(body.messageIds.filter((x): x is string => typeof x === 'string' && !!x)))
    : []
  if (!conversationId || !LANGS.includes(target as Lang) || !ids.length || ids.length > MAX_IDS) {
    throw new ApiError('bad_request', 400)
  }
  const lang = target as Lang

  // ── Membership gate ────────────────────────────────────────────────────────────────
  // Deliberately NOT filtered by buyerDeletedAt/sellerDeletedAt: DELETE on a conversation
  // is a per-user HIDE from the inbox, not a revocation — the thread reappears when the
  // other party replies and the user can still open it. Treating it as a permission would
  // break translation on a legitimately re-opened thread.
  const convo = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { buyerProfileId: true, sellerProfileId: true, sellerId: true },
  })
  if (!convo) throw new ApiError('not_found', 404)
  // ⛔ THE SUPPORT DESK TRANSLATES THE SUPPORT THREADS IT CAN READ — the same grant as
  // GET /api/conversations/[id] (`iAmSupport`), which checks the same one id: SUPPORT_SELLER_ID, one row per edition.
  // Both rows are unowned, so
  // `sellerProfileId` is null and an operator is neither party: before this, every operator's
  // request was a 403 the client banks as "attempted", so a Vietnamese writer's message to
  // support was never translated (owner test, 2026-10-20). getAdmin() asks the auth server, so it
  // runs only on this branch, never for an ordinary participant.
  const party = meId === convo.buyerProfileId || meId === convo.sellerProfileId
  if (!party && !(convo.sellerId === SUPPORT_SELLER_ID && !!(await getAdmin()))) {
    trace('forbidden', { who: meId.slice(0, 8), support: convo.sellerId === SUPPORT_SELLER_ID })
    throw new ApiError('forbidden', 403)
  }

  // The server chooses what is translatable — the client's own filter is a courtesy, not
  // the gate. `kind: 'text'` excludes offer/visa_step/visa_checkout/visa_result/visa_picker
  // cards; `senderProfileId: not me` excludes the caller's own words.
  const rows = await db.message.findMany({
    // ⛔ `deletedAt: null` — a message its writer took back must not come back as a translation. The bubble
    // shows "Message removed", but the row keeps its text, and by id this route used to translate it anyway.
    where: { id: { in: ids }, conversationId, kind: 'text', senderProfileId: { not: meId }, deletedAt: null },
    select: { id: true, body: true },
  })
  const eligible = rows.filter((r) => r.body.trim().length > 0)
  if (!eligible.length) return { items: [] as Item[] }

  const totalChars = eligible.reduce((n, r) => n + r.body.length, 0)
  if (totalChars > MAX_CHARS_PER_REQ) {
    trace('payload_too_large', { chars: totalChars, ids: eligible.length })
    throw new ApiError('payload_too_large', 413)
  }

  // ── 0) What each message needs: nothing (same language, undecided) or a planned send ──
  const translatedByBody = new Map<string, string>()
  const planByBody = new Map<string, { send: string; source: string }>()
  for (const b of new Set(eligible.map((r) => r.body))) {
    const plan = chatPlan(b, lang)
    if (!plan) translatedByBody.set(b, b) // answered as the original: free, final
    else if (plan.fixed) translatedByBody.set(b, plan.fixed) // the phrasebook: free, final
    else planByBody.set(b, plan)
  }

  // The last step for a model translation: refuse an echo; tidy the model's Vietnamese habits. null = refused.
  const finish = (body: string, value: string): string | null => {
    // What was sent coming back unchanged is no translation — for unaccented Vietnamese the sent text is the
    // mark-restored line, which differs from the body and would otherwise be shown (and cached) as the English.
    const sent = planByBody.get(body)?.send
    if (sent !== undefined && sameText(value, sent)) return null // case, punctuation and spacing do not make it a translation
    // No contact check here, deliberately: the tappable chips are built from the ORIGINAL message, never from a
    // translation (MessageBubble `chipsFrom`) — so a translation cannot put a number to tap in front of anyone.
    return lang === 'vi' ? polishVi(value) : value
  }

  // ── 1) Ephemeral cache: one round trip, and every hit is free ──────────────────────
  const uniqueBodies = Array.from(planByBody.keys())
  let cached = new Map<string, string>()
  let cacheReadFailed = false
  try {
    if (uniqueBodies.length) cached = await kv.mget<string>(uniqueBodies.map((b) => cacheKey(lang, conversationId, b)))
  } catch {
    // Cache unavailable → treat everything as a miss. Fails OPEN on purpose: this is a
    // cost optimisation, not a control. The budget below is the actual spend ceiling.
    cacheReadFailed = true
  }
  const misses: string[] = []
  for (const b of uniqueBodies) {
    const hit = cached.get(cacheKey(lang, conversationId, b))
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
  //     the note at that branch for why retrying is the wrong behaviour there;
  //   · a line the box model REFUSED with no paid provider left to ask is not a provider problem at all: the same
  //     model refuses it again, so it is answered as its original, final — like an echo (see `refused` below).
  const overBudget = { day: false, user: false }
  // Bodies whose translation failed on THIS call while others in the batch succeeded (see below).
  let retryBodies = new Set<string>()
  if (misses.length) {
    const billable = misses.reduce((n, b) => n + b.length, 0)
    // strict = FAIL CLOSED: a limiter outage must not reopen the paid path.
    const rl = await rateLimit('chat-translate', meId, 20, '1 m', { strict: true })
    if (!rl.success) {
      // Transient and per-minute — the client leaves these ids un-attempted and retries.
      trace('rate_limited', { who: meId.slice(0, 8) })
      throw new ApiError('rate_limited', 429)
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
      // ⚠️ Thrown from the CATCH block, not the try — an ApiError raised here propagates to
      // route()'s own catch, which turns it back into the same 503, rather than being swallowed
      // and re-classified by the accounting catch it is reporting.
      trace('budget_unavailable')
      throw new ApiError('budget_unavailable', 503)
    }

    if (!overBudget.day && !overBudget.user) {
      const stats = { providerFailed: false, failedTexts: new Set<string>(), refusedTexts: new Set<string>() }
      // What actually goes out: the planned text (marks restored where needed) with its decided source language.
      const sends = misses.map((b) => planByBody.get(b)!.send)
      const sourceHint = new Map(misses.map((b) => [planByBody.get(b)!.send, planByBody.get(b)!.source]))
      const work = translateBatch(sends, lang, { skipWrite: true, stats, source: 'chat', sourceHint }).catch(() => null)
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
          if (!late || late.length !== misses.length) return
          // Only what really translated is banked. A failed string comes back as what was SENT — for unaccented
          // Vietnamese that is the mark-restored text, which differs from the body and would otherwise be cached
          // as if it were the English. A refused one is skipped too: translateBatch names it in failedTexts as well.
          const done: Array<[string, string]> = []
          misses.forEach((b, i) => {
            if (stats.failedTexts.has(sends[i])) return
            const value = finish(b, late[i] ?? b)
            if (value !== null) done.push([b, value])
          })
          await cacheFresh(lang, conversationId, done.map(([b]) => b), done.map(([, v]) => v))
        })
        trace('timeout', { strings: misses.length })
        throw new ApiError('translate_timeout', 503)
      }
      // ⚠️ A FAILURE IS PER STRING, NOT PER BATCH. `failedTexts` names each source that came back as
      // fallback. Every one DOWN (or the provider failed without saying which) ⇒ the provider is down:
      // 503, exactly as before. SOME down ⇒ answer the others and mark those `retry` — this used to be a 503 for the
      // whole batch, so one string that did not translate (or an unaccented Vietnamese line sent to a dead paid key)
      // threw away every good translation beside it and re-billed all of them on each retry.
      // failedTexts names what was SENT; map it back to the message bodies.
      const failed = new Set(misses.filter((_, i) => stats.failedTexts.has(sends[i])))
      // ⛔ A REFUSAL IS AN ANSWER, NOT AN OUTAGE. `refused` — the box model answered, its gate refused the output, and
      // no paid provider is left to ask (no key, or a benched one; translateBatch names nothing else) — fails the same
      // way on every retry (greedy decoding, a pure gate), so only `down` is retried or worth a 503. A refusal beside a
      // paid key that merely FAILED is `down`: the retry asks that key first (2026-10-21 review probe).
      // Measured 2026-10-21: the owner's "hey" came back "hhhhhhhhhhhhhhhhhhhhhhhhhh", was refused, and — counted as
      // down — was answered 503 and asked for six times in 90s, each one re-running the model; it never showed.
      const refused = new Set(misses.filter((_, i) => stats.refusedTexts.has(sends[i])))
      const down = new Set([...failed].filter((b) => !refused.has(b)))
      // An older client (no `v: 2`) banks every id in a 200 as final, so it only ever gets the whole-batch answer.
      // A refused line is final either way, so it never needs v: 2.
      const partialOk = body.v === 2
      const allFailed = (stats.providerFailed && failed.size === 0)
        || (down.size > 0 && (!partialOk || misses.every((m) => down.has(m))))
      if (!timed || timed.length !== misses.length || allFailed) {
        trace('unavailable', { strings: misses.length, failed: failed.size, refused: refused.size })
        // The provider is DOWN (or misaligned): `timed` is source fallback, not translation.
        // `stats.providerFailed` is why translateBatch grew an out-param — output===input is
        // otherwise indistinguishable from text that legitimately translates to itself, and
        // guessing would 503-loop every same-language thread.
        throw new ApiError('translate_unavailable', 503)
      }
      retryBodies = down // only an outage is asked for again
      if (down.size) trace('partial', { strings: misses.length, failed: down.size })
      if (refused.size) trace('refused', { strings: misses.length, refused: refused.size })
      const good: Array<[string, string]> = []
      misses.forEach((src, i) => {
        if (down.has(src)) return
        // Refused: the original, final, never cached — what an echo gets below; asking again meets the same model and
        // no paid provider, so it gets the same refusal.
        if (refused.has(src)) { translatedByBody.set(src, src); return }
        const value = finish(src, timed[i] ?? src)
        if (value === null) translatedByBody.set(src, src) // an echo: the original, final
        else good.push([src, value])
      })
      for (const [src, value] of good) translatedByBody.set(src, value)
      await cacheFresh(lang, conversationId, good.map(([src]) => src), good.map(([, value]) => value))
    }
    // Over budget AND we could not even read the cache ⇒ we know nothing about these
    // messages: the originals we would return are not "no translation available", they are
    // "we failed to look". Answering 200 there would permanently bank that ignorance on the
    // client, so this narrow combination stays retryable (codex, confirm round).
    if ((overBudget.day || overBudget.user) && cacheReadFailed) {
      trace('over_budget_no_cache')
      throw new ApiError('translate_unavailable', 503)
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
    if (retryBodies.has(r.body)) return { id: r.id, text: r.body, translated: false, retry: true }
    const value = translatedByBody.get(r.body) ?? r.body
    return { id: r.id, text: value, translated: !sameText(value, r.body) }
  })
  return { items }
})
