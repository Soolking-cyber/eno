import 'server-only'
import type { GoogleGenAI } from '@google/genai'
import { logError, logInfo, logWarn } from '@/lib/log'
import { quietError } from '@/lib/classroom/quiet-error'
import { dataPart } from '@/lib/classroom/ai'
import { lineQueue, voiceOf, type Speaker, type TurnLine } from '@/lib/classroom/turn-stream'
import { conciergeTurnStream, type BrainError } from './brain'
import { resolveAction } from './actions'
import { localizedHref } from '@/lib/lang-pinned'
import { variantOfLanguage } from '@/lib/lang-variant'
import type { Language } from '@/lib/languages'
import { pageStateFor, rememberPageState } from './page-state'
import { fixedLineFor } from './guards'
import type { PageState, ResolvedAction } from './types'

/**
 * ONE CONCIERGE TURN, STREAMED as JSON lines (the classroom's voice path, turn-stream.ts, plus two lines of its own):
 *
 *   heard     the person's words, on screen while the avatar thinks
 *   go        where the app goes NOW — a path + query the SERVER built from a validated action (actions.ts), before any
 *             sentence is spoken; `closes`: the window cannot live there (/post …) — the host navigates, then closes it
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
export const PARTIAL_LINE = "Here's the closest I can show. I couldn't apply all of that, so check the filters on screen."
/** When the brain failed after the app already moved. */
export const MOVED_LINE = 'Here you go. Anything you want to narrow down?'
/** A browse that shows nothing — said after the model's sentences (the page shows the empty result anyway). */
export const EMPTY_LINE = "There's nothing matching all of that right now. Want me to widen the search?"
/** How long the voice may wait at its end for the new page's count (it is usually in long before). */
const COUNT_WAIT_MS = 800

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
}): { lines: AsyncGenerator<ConciergeLine, void, undefined>; stop: () => void; done: Promise<void> } {
  const q = lineQueue<ConciergeLine>()
  const gone = new AbortController()
  const voice = voiceOf(q, t.speak, gone.signal)
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
    const input = [
      dataPart('PAGE THE PERSON IS LOOKING AT', t.page.summary),
      dataPart('CONVERSATION SO FAR', t.history.map((h) => `${h.role === 'user' ? 'Person' : 'You'}: ${h.text}`).join('\n') || '(new conversation)'),
      dataPart('WHAT THE PERSON JUST SAID', t.transcript),
      { text: 'Write your next turn as JSON.' },
    ].map((p) => p.text).join('\n\n')

    let refused = false
    // The model's own words are not said this turn: its action was refused, or applied only in part.
    let muted = false
    let chips: string[] = []
    let moved: ResolvedAction | null = null
    let count: Promise<number | null> | null = null
    let spoke = false
    try {
      for await (const ev of conciergeTurnStream(t.ai, { input, teacherTurn }, gone.signal)) {
        if (ev.kind === 'action') {
          if (ev.action.kind === 'none') continue
          const listingIds = new Set(t.page.cards.map((c) => c.id))
          const a = resolveAction(ev.action, t.page, { lang: t.lang, listingIds })
          if (!a) { refused = true; muted = true; voice.say(REFUSED_LINE); spoke = true; continue }
          moved = a
          go(a)
          if (a.partial) { muted = true; voice.say(PARTIAL_LINE); spoke = true }
          logInfo('[concierge] action', { ms: Math.round(performance.now() - t0), kind: a.kind })
          // The new view's count, in parallel with the voice — read again by the next turn as its PAGE (cached).
          if (a.kind === 'browse') {
            count = pageStateFor(a.href, { lang: t.lang }).then((s) => { rememberPageState(s); return s.total }).catch(() => null)
          }
        } else if (ev.kind === 'say') {
          if (muted) continue
          voice.say(ev.text)
          spoke = true
        } else if (ev.kind === 'spoken') {
          if (count && !refused) {
            let timer: ReturnType<typeof setTimeout> | undefined
            const total = await Promise.race([count, new Promise<null>((r) => { timer = setTimeout(() => r(null), COUNT_WAIT_MS) })])
            clearTimeout(timer)
            if (total === 0) voice.say(EMPTY_LINE)
          }
          voice.close(null)
        } else if (ev.kind === 'final') {
          // Shown once the voice is out (the contract: chips after the last part-end) — not over the question being asked.
          if (!muted) chips = ev.chips
          logInfo('[concierge] turn', { ms: Math.round(performance.now() - t0), model: ev.model, calls: ev.calls, moved: !!moved, refused })
        }
      }
    } catch (e) {
      const err = e as BrainError
      logWarn('[concierge] brain failed', { emitted: !!err.emitted, calls: err.calls ?? 0, aborted: gone.signal.aborted })
      if (!gone.signal.aborted) {
        if (moved && !spoke) voice.say(MOVED_LINE)
        else if (!spoke) q.push({ kind: 'error', error: 'tutor_unavailable' })
      }
      voice.close(null)
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
