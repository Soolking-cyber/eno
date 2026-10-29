import { z } from 'zod'
import { ApiError, route } from '@/lib/api/handler'
import { conciergeOpenFor, liveSession, rememberOffer, takeOffer } from '@/lib/concierge/config'
import { conciergeTurn, type ConciergeLine, type HistoryItem } from '@/lib/concierge/turn'
import { pageStateFor } from '@/lib/concierge/page-state'
import { conciergeSpeaker } from '@/lib/concierge/start'
import { isI18nYes, spokenLanguage } from '@/lib/concierge/i18n'
import { quietError } from '@/lib/classroom/quiet-error'
import { getGeminiVertex } from '@/lib/gemini'
import { isLanguage } from '@/lib/languages'
import { logError } from '@/lib/log'
import { hiddenSellerIdsFor } from '@/lib/user-blocks'
import { appReviewGate, isIosAppUserAgent } from '@/lib/app-review-gates'
import type { PageState } from '@/lib/concierge/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 40

const HISTORY_ITEMS = 12
const HISTORY_ITEM_CHARS = 600
const HISTORY_CHARS = 4_000

const body = z.object({
  session: z.string().max(40),
  /** What the person said (Soniox's live transcript). */
  transcript: z.string().trim().min(1).max(1_000),
  /** The page under the window: its public path + query (validated again by pageStateFor). */
  href: z.string().max(2_000),
  lang: z.string().max(12),
  /** The conversation so far as the window holds it — data for the model, never instructions; capped. */
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(HISTORY_ITEM_CHARS) })).max(HISTORY_ITEMS),
})

/**
 * A plain "yes" to the fixed line's offer, in English or Vietnamese — the WHOLE short answer, never a word inside a longer
 * one (test review: "Please don't." matched `please`, and `\b` never ends a Vietnamese word like "có" in JS).
 */
const YES = new Set(['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'please', 'yes please', 'please do', 'go ahead',
  'open it', 'yes open it', 'yes open', 'do it', 'có', 'vâng', 'dạ', 'ừ', 'ừ có', 'được', 'có ạ', 'vâng ạ', 'dạ có', 'ok luôn', 'đồng ý'])
const NO = /\b(?:no|not|don'?t|do not|never|nope|nah)\b|không|đừng|thôi/i
function isPlainYes(transcript: string): boolean {
  const t = transcript.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim()
  // …or in one of the other nine languages, the offer's own chip included (i18n/index.ts — whole short answers only).
  return (!NO.test(t) && YES.has(t)) || isI18nYes(transcript)
}

/**
 * POST /api/concierge/turn — one thing the person said, answered as JSON LINES (application/x-ndjson; the contract is in
 * src/lib/concierge/turn.ts): `heard`, then `go` (where the app goes) before any sentence, each sentence with its voice,
 * `chips`, `end`. Refusals decided before the answer starts are the usual `{ error }` with a status.
 * ⛔ Nothing is stored — not the words, not the page, not the history.
 */
export const POST = route({ auth: 'profile', body, rateLimit: { bucket: 'concierge-turn', limit: 240, window: '1 h', strict: true } }, async ({ profile, body: b, req }) => {
  const s = await liveSession(b.session, profile.id)
  if (!s) throw new ApiError('session_over', 409)
  if (!(await conciergeOpenFor(profile.id, { ua: req.headers.get('user-agent') }))) throw new ApiError('forbidden', 403)
  // The NEWEST turns are kept (test review): the model must see its own last question above all.
  let total = 0
  const history: HistoryItem[] = []
  for (const h of b.history.slice(-HISTORY_ITEMS).reverse()) {
    total += h.text.length
    if (total > HISTORY_CHARS) break
    history.unshift(h)
  }
  const lang = isLanguage(b.lang) ? b.lang : 'en'
  /**
   * ⛔ The account's blocked shops, read FRESH on every turn, never cached here (App Store 1.2): a block made a second ago
   * already holds for every read and action of this answer — a listing opens only by an id this turn's own (filtered)
   * PAGE or SEARCH RESULTS carried (actions.ts). Words the guide said in earlier turns, which the window sends back as
   * history, are not rewritten. FAIL CLOSED (commit review, opus): without them no read may run, so the turn is refused,
   * logged and retried by the person. Read BEFORE the offer is taken (commit review, codex): a failed read never spends
   * the person's pending "yes".
   */
  const hidden = await hiddenSellerIdsFor(profile.id).catch((e: unknown) => {
    logError(quietError(e), { op: 'concierge.blocks' })
    throw new ApiError('guide_busy', 503)
  })
  // An offer is answered by the very next turn or not at all.
  const offer = await takeOffer(s.id)
  const page: PageState = await pageStateFor(b.href, { lang, hidden }).catch((e) => {
    logError(quietError(e), { op: 'concierge.page' })
    return { href: b.href, kind: 'other', category: null, subcategory: null, filters: {}, search: '', total: null, cards: [], summary: 'Page: unknown' } satisfies PageState
  })
  const turn = conciergeTurn({
    transcript: b.transcript,
    history,
    page,
    lang,
    ai: getGeminiVertex(),
    speak: conciergeSpeaker(spokenLanguage(lang)),
    acceptedOffer: offer === 'evisa' && isPlainYes(b.transcript),
    hidden,
    kycHidden: appReviewGate('ios-hide-kyc') && isIosAppUserAgent(req.headers.get('user-agent')),
    onOffer: () => { void rememberOffer(s.id, 'evisa') },
  })
  return new Response(answerLines(turn.lines, turn.stop), {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'private, no-store',
      // nginx (the VN origin) holds a proxied answer in its buffers by default — each line must leave when it is written.
      'x-accel-buffering': 'no',
    },
  })
})

/** The lines, each ended by "\n", one per pull; a client that goes away cancels the turn (the classroom's answerLines). */
function answerLines(lines: AsyncGenerator<ConciergeLine, void, undefined>, stop: () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let over = false
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      let next: IteratorResult<ConciergeLine, void>
      try {
        next = await lines.next()
      } catch (e) {
        if (over) return
        over = true
        logError(quietError(e), { op: 'concierge.turn.lines' })
        c.close()
        return
      }
      if (over) return
      if (next.done) {
        over = true
        c.close()
        return
      }
      c.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`))
    },
    cancel() {
      over = true
      stop()
    },
  })
}
