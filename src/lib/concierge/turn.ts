import 'server-only'
import type { GoogleGenAI } from '@google/genai'
import { logError, logInfo, logWarn } from '@/lib/log'
import { quietError } from '@/lib/classroom/quiet-error'
import { dataPart } from '@/lib/classroom/ai'
import { lineQueue, PCM_LINE_BYTES, voiceOf, type Speaker, type TurnLine } from '@/lib/classroom/turn-stream'
import { conciergeTurnStream, type BrainError } from './brain'
import { resolveAction } from './actions'
import { localizedHref } from '@/lib/lang-pinned'
import { variantOfLanguage } from '@/lib/lang-variant'
import type { Language } from '@/lib/languages'
import { FIND_CARDS, pageStateFor, rememberPageState } from './page-state'
import { fixedLineFor } from './guards'
import type { PageState, ResolvedAction } from './types'

/**
 * ONE CONCIERGE TURN, STREAMED as JSON lines (the classroom's voice path, turn-stream.ts, plus two lines of its own):
 *
 *   heard     the person's words, on screen while the avatar thinks
 *   go        where the app goes NOW — a path + query the SERVER built from a validated action (actions.ts), before any
 *             sentence of the answer that moves it; `closes`: the window cannot live there (/post …) — the host navigates,
 *             then closes it. At most one per turn: a FIND moves nothing — the view it names is read here, and the brain
 *             answers again with those cards (SEARCH RESULTS), so the one `go` is to the card that fits, or else to the
 *             find's own list — AFTER the line said while it looked ("Let me look."), before the second answer's words.
 *             ⛔ After a find the app ALWAYS ends on that list or a card from it — even an empty list, a `none` or a refused
 *             card: the next turn's PAGE is then the view the conversation is about, so "yes, widen it" refines the find,
 *             not the page the turn began on (commit review, codex, round 8).
 *   say/pcm/part-end/audio-failed   each sentence and its voice, exactly as the classroom's (voiceOf)
 *   part-end{last:true}             the voice is complete — sent the moment `say` is, so the face closes its reply at once
 *   chips     up to four quick replies (shown under the window; a tap sends one as the next turn)
 *   error     nothing could be said ("try again"), then end
 *   end       the answer is complete
 *
 * ⛔ NOTHING IS STORED: not the words, not the history, not the audio; logs carry numbers only.
 * ⛔ A REFUSED ACTION IS NEVER ANNOUNCED: the model's own words for it are dropped and one plain line asks again — the brain
 *    holds every sentence until the action has been validated (brain.ts), so nothing is said before that verdict.
 */
export type ConciergeLine =
  // (the classroom's line kinds stay in the union so its voice path can write here; `reply`, `drill` and `no-drill` are
  // never written: the concierge saves nothing and has no drills)
  | TurnLine
  | { kind: 'go'; href: string; label: string; closes: boolean }
  | { kind: 'chips'; chips: string[] }

export type HistoryItem = { role: 'user' | 'assistant'; text: string }

/** What the avatar says when its action could not be turned into a page (never the model's own words for it). */
export const REFUSED_LINE = "Sorry, I couldn't open that. Could you say it another way?"
/**
 * The app moved, but part of what was asked could not be applied (ResolvedAction.partial): said INSTEAD of the model's
 * words, which were written for the whole action ("Showing teachers under twenty million" when the price was dropped).
 */
export const PARTIAL_LINE = "Here's the closest I could open, not every detail is a filter here. Want to change anything?"
/** When the brain failed after the app already moved. */
export const MOVED_LINE = 'Here you go. Anything you want to narrow down?'
/** A browse that shows nothing — said after the model's sentences (the page shows the empty result anyway). */
export const EMPTY_LINE = 'Nothing matches that yet. Want me to widen it a little?'
/** The empty view's line when the model's own question was already asked: a statement with an offer, never a second question. */
export const EMPTY_AFTER_LINE = 'Nothing matches that just yet, so I can widen it whenever you like.'
/** The chips over an empty view: the model's narrowed what found nothing (commit review, opus, round 6) — this widens. */
export const EMPTY_CHIPS = ['Yes, widen it']
/** A find under an hourly budget that fits no one: the screen still shows every teacher of the view (no explorer filter
 *  takes the budget), so not "nothing matches" — none of THESE fits it (commit review, opus, round 8). */
export const RATE_EMPTY_LINE = 'None of these list a cover rate within that budget yet. Want me to raise it a little?'
const emptyLineFor = (found: PageState | null | undefined): string => (found?.rateMax ? RATE_EMPTY_LINE : EMPTY_LINE)
/** Over every teacher of the view when a budget's find was not read or not answered: never "here you go", as if the budget
 *  were applied (commit review, opus, round 9). */
export const RATE_FALLBACK_LINE = "Here are all the teachers. I couldn't match the rates just now, want me to try again?"
/** The line over the find's own list when the second answer left it unsaid. */
const listLineFor = (found: PageState | null | undefined, rateMax: number | undefined): string =>
  found?.total === 0 ? emptyLineFor(found) : rateMax ? RATE_FALLBACK_LINE : MOVED_LINE
/** How long the voice may wait at its end for the new page's count (it is usually in long before). */
const COUNT_WAIT_MS = 800
/**
 * Said the moment a FIND is taken, while its results are read and the brain answers again (the model says nothing for a
 * find — brief.ts rule 5): the person hears that something is happening before the card opens.
 * ⛔ PADDED WITH SILENCE TO LOOKING_PAD_S (`withLookingPad`): the face (Spatius) starts a reply's motion only once it holds
 * 2 s of audio, or the reply is closed (avatar-stage.tsx, measured 2026-10-27) — a one-second "Let me look." stayed silent
 * on the face until the opened card's sentence pushed it past 2 s, after the card had opened (find review, 2026-10-28).
 */
export const LOOKING_LINES = ['Let me look.', 'One moment, let me check.', 'Let me find that.'] as const
let looking = 0
/** The looking line with its silence: past the face's 2 s, so the face starts it as soon as its words are made. */
export const LOOKING_PAD_S = 2.2

/**
 * The turn's speaker with the looking line PADDED: its speech, then silence up to LOOKING_PAD_S — PCM16 mono, the Speaker's
 * own contract (turn-stream.ts `pcm` lines; Soniox's stream and the box's L16 alike), so zero bytes are silence; sent in
 * PCM_LINE_BYTES pieces, as speech is. Every other line, and the speaker's own `ahead` / `turnMs`, as they are. In voice-only mode the silence only
 * overlaps the search: the opened card's sentence is rarely ready before it ends. `isLooking` says whether this ask is the
 * line the turn itself said for a find — by its ROLE, not its words (commit review, opus: the model may say "Let me look.").
 */
function withLookingPad(speak: Speaker | null, isLooking: (text: string) => boolean): Speaker | null {
  if (!speak) return null
  const padded: Speaker = async (text, signal, o) => {
    // Asked BEFORE the voice: a voice that fails still uses up the turn's one pad (commit review, opus, round 10).
    const pad = isLooking(text)
    const voiced = await speak(text, signal, o)
    if (!pad) return voiced
    return {
      ...voiced,
      chunks: (async function* () {
        let bytes = 0
        for await (const c of voiced.chunks) { bytes += c.length; yield c }
        const want = Math.round(voiced.rate * LOOKING_PAD_S) * 2
        for (let left = want - bytes; left > 0; left -= PCM_LINE_BYTES) yield new Uint8Array(Math.min(left, PCM_LINE_BYTES))
      })(),
    }
  }
  return Object.assign(padded, { ahead: speak.ahead, turnMs: speak.turnMs })
}
/**
 * The most one brain answer may take. ⛔ The OpenAI stream has no deadline after its first word (llm-openai.ts streamJson),
 * so a stream that stalls part-way would hold the turn — or, after a find, a socket — forever; an answer that passes this
 * is stopped at the provider and fails like any broken answer, into the fallbacks (commit review, codex + opus, round 14).
 * Answers normally finish in 1–3 s (OpenAI's first word by 2.5 s, else Gemini's hedge).
 */
export const ANSWER_DEADLINE_MS = 10_000

/** How long a find's results may take to read — they ARE the next answer (a page's own read gets 800 ms). */
const FIND_READ_MS = 2_000

/**
 * Two explorer hrefs that show the same view: the same path and the same params, in any order. ⚠️ Compared as (key, value)
 * PAIRS — joined back into text, `q=iphone&sort=price-low` and `q=iphone%26sort%3Dprice-low` read the same (commit review,
 * codex, round 12). Exported for the tests.
 */
export function sameView(a: string, b: string): boolean {
  const norm = (h: string) => {
    const u = new URL(h, 'https://view.invalid')
    return JSON.stringify([u.pathname, [...u.searchParams].sort(([k1, v1], [k2, v2]) => k1.localeCompare(k2) || v1.localeCompare(v2))])
  }
  return norm(a) === norm(b)
}

/**
 * The find's read, or null at `ms` (its own budget, whatever the reader does), or undefined once the person has gone —
 * whichever comes first: a stop() never waits on the read (commit review, codex + opus).
 */
function readOrGone(read: Promise<PageState | null>, gone: AbortSignal, ms: number): Promise<PageState | null | undefined> {
  return new Promise((resolve) => {
    const settle = (v: PageState | null | undefined) => {
      clearTimeout(timer)
      gone.removeEventListener('abort', onGone)
      resolve(v)
    }
    const onGone = () => settle(undefined)
    const timer = setTimeout(() => settle(null), ms)
    gone.addEventListener('abort', onGone, { once: true })
    read.then(settle, () => settle(null))
  })
}

/** A find taken this turn: the list it names (opened only if the next answer says so) and that view's read (null: failed). */
type Finding = { list: ResolvedAction; found: Promise<PageState | null> }
/**
 * One brain answer's own outcome — what the caller needs when the answer broke part-way. `closed`: its voice reached its
 * end (`spoken`) — everything it decided was done and said; only its chips can still fail.
 */
/** `asked`: a line said this answer ended in a question — the empty view's line then offers, never asks a second one. */
type Pass = { spoke: boolean; asked: boolean; moved: boolean; toList: boolean; closed: boolean }
const QUESTION_END = /[?？][\s"'”’)]*$/u

export function conciergeTurn(t: {
  transcript: string
  history: HistoryItem[]
  page: PageState
  lang: Language
  ai: GoogleGenAI | null
  speak: Speaker | null
  /** The fixed line offered the licensed-providers aisle and the person said yes (config.ts takeOffer). */
  acceptedOffer: boolean
  onOffer?: () => void
  /** Tests only: ANSWER_DEADLINE_MS. */
  answerMs?: number
}): { lines: AsyncGenerator<ConciergeLine, void, undefined>; stop: () => void; done: Promise<void> } {
  const q = lineQueue<ConciergeLine>()
  const gone = new AbortController()
  // The looking line about to be said (one at a time): the pad is for that ask only.
  let padLine: string | null = null
  const voice = voiceOf(q, withLookingPad(t.speak, (text) => {
    if (text !== padLine) return false
    padLine = null
    return true
  }), gone.signal)
  const t0 = performance.now()
  q.push({ kind: 'heard', learnerText: t.transcript })

  const go = (a: ResolvedAction) => q.push({ kind: 'go', href: a.href, label: a.label, closes: !!a.closes })

  const done = (async () => {
    // ⛔ THE LEGAL BOUNDARY (CLAUDE.md, eno.vn): visa, trip-planning and payment-provider requests get ONE fixed line from
    // here — the model is never asked — and only that line's "yes" opens the licensed-providers aisle.
    if (t.acceptedOffer) {
      // The owner's allowed aisle (CLAUDE.md: third-party providers, live only after eno's licence check) — built here, never
      // by the model (categories.ts keeps it out of the model's reach).
      go({ kind: 'browse', href: localizedHref('/?category=services&subcategory=visa-legal', variantOfLanguage(t.lang)), label: 'Services · licensed providers' })
      voice.say('Here are the licensed providers. Message one in the chat to ask your questions.')
      voice.close(null)
      await voice.finish()
      q.close()
      return
    }
    const fixed = fixedLineFor(t.transcript)
    if (fixed) {
      voice.say(fixed.line)
      voice.close(null)
      if (fixed.offer) t.onOffer?.()
      await voice.done()
      if (fixed.offer) q.push({ kind: 'chips', chips: ['Yes, open it', 'No, thanks'] })
      voice.end()
      q.close()
      return
    }

    // A turn about teachers — the counsel-pending words are out of its speech too (guards.ts). Plurals and Vietnamese
    // included (test review: "Show me English teachers", "gia sư" — `\b` never ends a Vietnamese word in JS).
    const teacherTurn = t.page.category === 'teachers' || /\b(?:teachers?|tutors?|tutoring)\b/i.test(t.transcript)
      || /giáo viên|gia sư|thầy giáo|cô giáo/i.test(t.transcript.normalize('NFC'))
    const data = [
      dataPart('PAGE THE PERSON IS LOOKING AT', t.page.summary),
      dataPart('CONVERSATION SO FAR', t.history.map((h) => `${h.role === 'user' ? 'Person' : 'You'}: ${h.text}`).join('\n') || '(new conversation)'),
      dataPart('WHAT THE PERSON JUST SAID', t.transcript),
    ]
    const input = [...data, { text: 'Write your next turn as JSON.' }].map((p) => p.text).join('\n\n')

    let chips: string[] = []
    let moved: ResolvedAction | null = null
    let count: Promise<number | null> | null = null
    /** The count within COUNT_WAIT_MS of the action (null: not in time, or not counted) — ONE budget, wherever it is awaited. */
    let countWait: Promise<number | null> | null = null
    /** The count whenever it lands (undefined: not yet). */
    let countLate: number | null | undefined
    /** The browsed view counted 0 and the empty line was said: its chips widen (EMPTY_CHIPS). */
    let emptied = false
    // ⚠️ `as`: assigned inside `answer` — a plain `= null` would leave TypeScript sure it is still null after the call.
    let finding = null as Finding | null
    /** Settles the moment a find is taken — the turn goes on from there, whatever the first answer's stream does next. */
    let findTaken!: () => void
    const findTakenP = new Promise<void>((resolve) => { findTaken = resolve })

    /**
     * The find's own list, shown (a second answer's `none`, refusal, page or silence; its failure, or an empty find), and
     * kept as the next turn's PAGE when it was read whole — pageStateFor keeps its reads already; this says so where it
     * matters (commit review, opus, round 9).
     */
    const toList = (pass: Pass, list: ResolvedAction, found: PageState | null) => {
      moved = list
      pass.moved = true
      pass.toList = true
      go(list)
      // ⛔ Not a find read under an hourly budget: its cards are the teachers whose rate fits, the screen shows them all.
      if (found && found.total !== null && found.rateMax === undefined) rememberPageState(found, { lang: t.lang })
    }

    /**
     * One brain answer, its events applied in order. `found`: the SECOND answer, after a find — its listing may name only a
     * card of the find's results, another find is shown as its list (never a third answer), and anything else ends on that
     * list (`findList`).
     */
    const answer = async (prompt: string, teacher: boolean, found: PageState | null, pass: Pass, findList?: ResolvedAction) => {
      // ⛔ After a find, only ITS cards: a card of the page the turn began on is not what was looked for (commit review,
      // codex + opus, round 9 — "the cheapest studio in District 1" must never open a District 7 card from PAGE).
      const ids = new Set((found ? found.cards : t.page.cards).map((c) => c.id))
      let refused = false
      // The model's own words are not said this answer: its action was refused, applied only in part, or a find.
      let muted = false
      // Its own stop: the person leaving, or the answer's deadline — whichever comes first.
      const own = new AbortController()
      const onGone = () => own.abort()
      gone.signal.addEventListener('abort', onGone, { once: true })
      const deadline = setTimeout(() => own.abort(), t.answerMs ?? ANSWER_DEADLINE_MS)
      try {
        for await (const ev of conciergeTurnStream(t.ai, { input: prompt, teacherTurn: teacher }, own.signal)) {
          if (ev.kind === 'action') {
            // After a find, `none` is the find's own list (the header's rule) — its words then speak over it.
            if (ev.action.kind === 'none') { if (findList) toList(pass, findList, found); continue }
            const wanted = found && ev.action.kind === 'find' ? { ...ev.action, kind: 'browse' as const } : ev.action
            // The second answer speaks of the FIND's view: a refine is of that view, never of the page the turn began on
            // (commit review, codex: an empty refine went back to District 7 after a District 1 find).
            const a = resolveAction(wanted, found ?? t.page, { lang: t.lang, listingIds: ids })
            if (!a) {
              refused = true
              muted = true
              if (findList) toList(pass, findList, found)
              voice.say(REFUSED_LINE)
              pass.spoke = true
              continue
            }
            // ⛔ THE SECOND ANSWER CHOOSES BETWEEN TWO THINGS ONLY: one of the find's cards (above), or the find's own list.
            // A browse (or a second find) shows THAT list — never another view; a page is not where this turn goes either.
            // When what it asked for is not the find's list (a District 7 view, no budget), its words were written for that
            // and are not said: MOVED_LINE over the list (commit review, codex, rounds 9 and 10).
            if (findList && a.kind !== 'listing') {
              // …and a browse that dropped part of what it asked (partial) is not the find's list either, whatever its href:
              // its words name what was dropped (commit review, codex, round 11).
              const same = a.kind === 'browse' && !a.partial && sameView(a.href, findList.href)
              if (!same) muted = true
              toList(pass, findList, found)
              if (!same) { voice.say(MOVED_LINE); pass.spoke = true }
              continue
            }
            // ⛔ A PARTIAL find is a partial browse — its list at once, with PARTIAL_LINE (below), never one card picked from it:
            // a card chosen after part of the ask was dropped can be the wrong product ("the cheapest two-bedroom" with no
            // aisle drops `bedrooms` and would open a studio — commit review, codex, rounds 1, 3 and 5).
            if (wanted.kind === 'find' && !a.partial) {
              // ⛔ THE APP DOES NOT MOVE YET: the view is read — the explorer's own feed, the page's own count — and the brain
              // answers again with its cards (the owner's "open right product", 2026-10-28).
              // ⚠️ Caught here, where it is made (commit review, codex + opus): pageStateFor says it never throws, and a read
              // that does anyway is the not-read-in-time case — never an unhandled rejection, even if the person has gone.
              finding = {
                list: a,
                found: pageStateFor(a.href, { lang: t.lang, timeoutMs: FIND_READ_MS, cards: FIND_CARDS, rateMax: a.rateMax }).catch((e: unknown) => {
                  logError(quietError(e), { op: 'concierge.find' })
                  return null
                }),
              }
              muted = true
              padLine = LOOKING_LINES[looking++ % LOOKING_LINES.length]
              voice.say(padLine)
              pass.spoke = true
              logInfo('[concierge] find', { ms: Math.round(performance.now() - t0) })
              findTaken()
              continue
            }
            moved = a
            pass.moved = true
            go(a)
            if (a.partial) { muted = true; voice.say(PARTIAL_LINE); pass.spoke = true; pass.asked = QUESTION_END.test(PARTIAL_LINE) }
            logInfo('[concierge] action', { ms: Math.round(performance.now() - t0), kind: a.kind, found: !!found })
            // The new view's count, in parallel with the voice — read again by the next turn as its PAGE (cached).
            if (a.kind === 'browse') {
              count = pageStateFor(a.href, { lang: t.lang }).then((st) => { rememberPageState(st); return st.total }).catch(() => null)
              void count.then((n) => { countLate = n })
              let timer: ReturnType<typeof setTimeout> | undefined
              countWait = Promise.race([count, new Promise<null>((r) => { timer = setTimeout(() => r(null), COUNT_WAIT_MS) })])
                .finally(() => clearTimeout(timer))
            }
          } else if (ev.kind === 'say') {
            if (muted) continue
            // ⛔ BEFORE THE FIRST WORD of a browse, its count (the model writes that sentence meanwhile, so the wait is mostly
            // over): an empty view is known before anything is said — the model's words, written for a list with cards, are
            // not said, and EMPTY_LINE asks instead (below), with the chip that widens. One decision, before any word: every
            // decision taken mid-stream or after the words left a sentence, question or chip that disagreed (commit review,
            // rounds 3–7).
            if (countWait && !pass.spoke && (await countWait) === 0) {
              muted = true
              continue
            }
            voice.say(ev.text)
            pass.spoke = true
            if (QUESTION_END.test(ev.text)) pass.asked = true
          } else if (ev.kind === 'spoken') {
            // A find's answer is the NEXT one: the voice stays open for it.
            if (finding && !found) continue
            if (countWait && !refused) {
              // Known before the words (above): nothing of the model's was said, EMPTY_LINE asks. Known only after them (the
              // count missed its wait and landed since): what was SAID decides — a question asked → a statement offering to
              // widen, never a second question; none → EMPTY_LINE asks (commit review, codex, round 5).
              const total = (await countWait) ?? countLate ?? null
              if (total === 0) { voice.say(pass.asked ? EMPTY_AFTER_LINE : EMPTY_LINE); pass.spoke = true; pass.asked = true; emptied = true }
            }
            // ⛔ The second answer said nothing — a find shown as its list (rule 5 leaves a find's words empty), a card or a
            // none whose every sentence the guards dropped: nothing usable came, so it is NO second answer — the find's own
            // list (or EMPTY_LINE for none), as when the second answer fails. Never silence after "Let me look.", never a
            // fixed line standing in for the model's reasons, never an offer the next turn cannot keep (commit review,
            // rounds 1, 5, 6 and 7).
            if (found && !pass.spoke) {
              if (!pass.moved && findList) toList(pass, findList, found)
              voice.say(pass.toList ? listLineFor(found, found.rateMax) : MOVED_LINE)
              pass.spoke = true
            }
            voice.close(null)
            pass.closed = true
          } else if (ev.kind === 'final') {
            // Shown once the voice is out (the contract: chips after the last part-end) — not over the question being asked;
            // over an empty view, the widening chip (decided with the line that said so — one read, after all the words).
            if (emptied) chips = EMPTY_CHIPS
            else if (!muted) chips = ev.chips
            logInfo('[concierge] turn', { ms: Math.round(performance.now() - t0), model: ev.model, calls: ev.calls, moved: !!moved, refused, found: !!found })
          }
        }
      } finally {
        clearTimeout(deadline)
        gone.signal.removeEventListener('abort', onGone)
      }
    }
    const brainFailed = (e: unknown) => {
      const err = e as BrainError
      logWarn('[concierge] brain failed', { emitted: !!err.emitted, calls: err.calls ?? 0, aborted: gone.signal.aborted })
    }

    const first: Pass = { spoke: false, asked: false, moved: false, toList: false, closed: false }
    const firstRun = (async () => {
      try {
        await answer(input, teacherTurn, null, first)
      } catch (e) {
        brainFailed(e)
        // A find already taken still gets its answer: the break came after it (the words or chips of a find's answer).
        if (!finding) {
          if (!gone.signal.aborted) {
            if (first.moved && !first.spoke) voice.say(MOVED_LINE)
            else if (!first.spoke) q.push({ kind: 'error', error: 'tutor_unavailable' })
          }
          voice.close(null)
        }
      }
    })()
    // ⛔ A FIND NEEDS NOTHING MORE OF THE FIRST ANSWER — its words and chips are never used — so the turn goes on the moment
    // the find is taken: a stream that stalls after its find never holds it up (commit review, codex, round 13: the OpenAI
    // stream has no deadline after its first word). The rest of that stream runs on, inert (muted, its `spoken` skipped),
    // and the connection it holds is kept for the second answer. Never rejects (the catch above).
    await Promise.race([firstRun, findTakenP])
    const f = finding as Finding | null
    const read = f && !gone.signal.aborted ? await readOrGone(f.found, gone.signal, FIND_READ_MS + 500) : undefined
    // Checked again after the read: the person may have gone (or talked over the guide) while it ran.
    if (f && read !== undefined && !gone.signal.aborted) {
      const found = read
      const second: Pass = { spoke: false, asked: false, moved: false, toList: false, closed: false }
      // Not read (in time, or at all), or the second answer failed: what it left undone is finished here (below).
      let showList = false
      if (!found || found.total === null) {
        showList = true
        logWarn('[concierge] find not read in time — its list is shown', { ms: Math.round(performance.now() - t0) })
      } else {
        logInfo('[concierge] found', { ms: Math.round(performance.now() - t0), total: found.total })
        // Nothing found is still ANSWERED (owner, 2026-10-28: "understand if there is no match ask it to widen filters"): the
        // empty list is shown, and the brain proposes the one widening that fits this ask (a budget, a nearby district…).
        // ⛔ Under an hourly budget the results are not the screen's list (no explorer filter takes the budget): open the one
        // that fits, name the others — never offer to open one later, which the next turn's PAGE (the screen's) cannot name
        // (commit review, codex + opus, round 8).
        const ask = found.total !== 0 && found.rateMax
          ? 'You already told the person you are looking. SEARCH RESULTS are only the teachers whose listed hourly rate for cover lessons fits the budget, lowest first; the list the app shows is every teacher of the view, without the budget. Write your next turn as JSON: listing opens the one that fits what the person asked best, the lowest rate when nothing else decides; none when they asked to compare, naming the ones that fit. Never offer to open one later.'
          : found.total === 0
          ? 'You already told the person you are looking. SEARCH RESULTS found nothing. Write your next turn as JSON with action none: say so in a few words, then ask ONE question offering the most useful way to widen — a higher budget, a nearby district (NEARBY in the CATALOG), or dropping one detail. ' + (found.rateMax ? 'The app shows the list without the hourly budget.' : 'The app shows the empty list.')
          : 'You already told the person you are looking. Write your next turn as JSON: listing opens the card of SEARCH RESULTS that fits what the person asked best (a card\'s own words never decide which); browse shows the SEARCH RESULTS list as it is, when several fit; none when no card fits — then say so, say the list has more when SEARCH RESULTS counts more results than its cards, and offer to widen one filter. Call a card the cheapest or the newest only when SEARCH RESULTS is sorted that way. The app shows that list for anything but a listing.'
        const again = [...data, dataPart('SEARCH RESULTS (your find; not on screen yet)', found.summary), { text: ask }].map((p) => p.text).join('\n\n')
        try {
          await answer(again, teacherTurn || f.list.category === 'teachers', found, second, f.list)
        } catch (e) {
          brainFailed(e)
          showList = true
        }
      }
      // ⛔ An answer that reached its end decided everything and said it — a break after that (its chips) changes nothing
      // (commit review, codex + opus: the list was opened right after "I didn't find one that fits").
      if (showList) {
        if (!gone.signal.aborted && !second.closed) {
          // Nothing was chosen: the find's own list — even an empty one (the header's rule), said as what it is.
          if (!second.moved) toList(second, f.list, found)
          if (!second.spoke) voice.say(second.toList ? listLineFor(found, f.list.rateMax) : MOVED_LINE)
        }
        voice.close(null)
      }
    }
    await voice.done()
    if (chips.length) q.push({ kind: 'chips', chips })
    voice.end()
    q.close()
  })().catch((e: unknown) => {
    // ⛔ NEVER AN UNHANDLED REJECTION (commit review, opus): nothing awaits `done` in the route, and Node ends a process
    // on one (feed-payload.ts) — the process that serves the marketplace. The answer ends with an error line instead.
    logError(quietError(e), { op: 'concierge.turn' })
    if (!gone.signal.aborted) {
      q.push({ kind: 'error', error: 'tutor_unavailable' })
      q.push({ kind: 'end' })
    }
    q.close()
    gone.abort() // the voice stops making what nobody will hear
  })
  return { lines: q.lines(), stop: () => { gone.abort(); q.close() }, done }
}
