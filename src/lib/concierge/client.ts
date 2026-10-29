'use client'

import { useSyncExternalStore } from 'react'
import { isClassroomPath } from '@/lib/classroom/host'
import { isPostFlowPath } from '@/lib/post-flow-path'
import { explorerFallbackUrl } from '@/lib/explorer-presence'
import { hereVariant } from '@/lib/lang-pinned'
import { publicPathname } from '@/lib/lang-variant'
import { aiConsentAskFirst, aiConsentCanAsk, askAiConsentAnswer, readAiConsent } from '@/lib/ai-consent'
import { isNativeAppClient, isNativeVoiceClient } from '@/lib/app-review-gates'

/**
 * The voice concierge on the PAGE side — what the ✨ "Ask eno AI" buttons and the floating window's host share. The window
 * itself is a same-origin frame (/concierge — src/components/concierge/concierge-frame.tsx); this module is tiny and ships
 * with every page.
 */

/** The frame's own page. */
export const CONCIERGE_FRAME_PATH = '/concierge'
export const isConciergeFramePath = (pathname: string | null | undefined): boolean =>
  !!pathname && (pathname === CONCIERGE_FRAME_PATH || pathname.startsWith(`${CONCIERGE_FRAME_PATH}/`))

/**
 * Pages the window never floats over — they own the screen or the microphone: the classroom (its own app and its own face:
 * AvatarKit's session token is page-global), sign-in, the messenger (its composer owns the bottom-right corner), the post
 * flow, the admin, and the frame itself. Reaching one closes a live window (it never hides a running microphone).
 */
export function isConciergeHiddenPath(pathname: string | null | undefined): boolean {
  if (!pathname) return true
  return isConciergeFramePath(pathname) || isClassroomPath(pathname) || isPostFlowPath(pathname)
    || /^\/(?:signin|auth|messages|admin|teachers\/join|teachers\/edit)(?:\/|$)/.test(pathname)
}

/** May this account open the window now (GET /api/concierge/config, read by the host)? */
let available = false
/** Has the host decided, for this page's account (asked, or nobody signed in)? */
let known = false
const subs = new Set<() => void>()
const knownWaiters = new Set<() => void>()
export function setConciergeAvailable(v: boolean): void {
  known = true
  const waiting = [...knownWaiters]
  knownWaiters.clear()
  waiting.forEach((f) => f())
  if (available === v) return
  available = v
  subs.forEach((f) => f())
}
export const conciergeAvailable = (): boolean => available
/**
 * The host is about to ask for THIS account (a sign-in, an account change): not known again until it answers (commit
 * review, codex + opus — a signed-out page, or the moment auth loads, had marked it known for good, so a ✨ tapped in the
 * second before the real answer went to the text chat).
 */
export function resetConciergeKnown(): void {
  known = false
  pendingOpen = null
}
export function useConciergeAvailable(): boolean {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f) } },
    () => available,
    () => false,
  )
}

/**
 * ⛔ MAY THE GUIDE LISTEN HERE, NOW? Always on the website (its tap-to-start). In the apps (owner, 2026-10-29: "Apps only")
 * only in a binary built for the guide, with the apps' AI notice machinery on (`app-ai-notice` — the notice that asks, and
 * the Settings switch that takes the answer back: without it a stored "yes" could never be withdrawn — commit review round
 * 2, codex + opus), AND with the person's own "yes" to the voice guide's notice on this device (ai-consent.ts
 * `voice_guide`). The host (concierge-host.tsx) asks THIS at every open and closes the window the moment it stops holding
 * — the one place the apps' "yes" is enforced; the window itself only runs inside the host (frame-head.ts framedByHost).
 */
export function voiceAgreedHere(userId: string | null | undefined): boolean {
  if (!isNativeAppClient()) return true
  return isNativeVoiceClient() && aiConsentAskFirst() && readAiConsent('voice_guide', userId) === 'on'
}

/** The ✨ buttons open the window through this event (the header is rendered per page; the host lives in providers). */
export const CONCIERGE_OPEN_EVENT = 'eno:concierge-open'
export function openConcierge(): void {
  window.dispatchEvent(new Event(CONCIERGE_OPEN_EVENT))
}
/** "Ask now": a tap that came before the host's first look (it waits for the page to settle) — the host asks at once. */
export const CONCIERGE_ASK_EVENT = 'eno:concierge-ask'
/** Resolves once the host knows whether this account may open the window, or after `ms` (then: as unknown, the text). */
function whenKnown(ms: number): Promise<void> {
  if (known) return Promise.resolve()
  window.dispatchEvent(new Event(CONCIERGE_ASK_EVENT))
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); knownWaiters.delete(done); resolve() }
    const t = setTimeout(done, ms)
    knownWaiters.add(done)
  })
}

/**
 * Pages the window never floats over that the person can LEAVE for it without losing anything — the messenger: asking for
 * help there opens the explorer with the guide over it. Every other such page (the post flow, sign-in, the classroom, the
 * admin, a teacher's profile form) keeps the text assistant: leaving would drop what is being filled in, or the page owns
 * the microphone.
 */
const GUIDE_VIA_EXPLORER = /^\/messages(?:\/|$)/
/**
 * An open asked for on such a page — FOR THE PAGE IT MOVED TO, within PENDING_OPEN_MS (commit review, codex + opus: bound to
 * nothing, a move that failed or was superseded opened the guide on a later page). The host takes it there, available or
 * not, and opens the window only if this account may use it.
 */
let pendingOpen: { at: number; path: string; from: string } | null = null
const PENDING_OPEN_MS = 15_000
export function takePendingOpen(path: string): boolean {
  const p = pendingOpen
  if (!p) return false
  if (p.path !== path) {
    // Still on the page it was asked from (the move has not landed yet): kept. Anywhere else, the move was abandoned or
    // superseded (commit review round 3, codex: /messages → /post → / opened the guide unasked) — dropped.
    if (path !== p.from || Date.now() - p.at >= PENDING_OPEN_MS) pendingOpen = null
    return false
  }
  pendingOpen = null
  return Date.now() - p.at < PENDING_OPEN_MS
}

/**
 * ASKING FOR HELP — every "Ask eno AI" in the app (owner, 2026-10-28: "make sure it opens avatar ai all across the app when
 * asked for assistance the message one is fallback"): the header's ✨ and its phone row, the inbox's eno AI row, and the
 * text assistant's own "Talk instead". The VOICE GUIDE when this account may use it — in place, or on the explorer from the
 * messenger (above); eno AI's TEXT chat otherwise, the fallback (`voiceOnly`: a caller already in that chat stays there).
 * Waits briefly for the host's answer, so a tap before it never falls to the text by mistake (plan review, opus).
 * `variant`: the language the page is rendered in (the explorer twin it opens).
 */
let helping = false
export async function askForHelp(nav: { push: (href: string) => void }, variant: string, opts: { voiceOnly?: boolean } = {}): Promise<void> {
  // One at a time: a second tap while the first waits for the host's answer is the same request (commit review, opus).
  if (helping) return
  helping = true
  try {
    const asked = window.location.pathname
    await whenKnown(2_000)
    // ⛔ The person moved on while it waited (commit review, codex: a ✨ tap, then into the post flow — never pull them out).
    if (window.location.pathname !== asked) return
    const path = publicPathname(window.location.pathname)
    if (available) {
      /**
       * ⛔ IN THE APPS THE PERSON AGREES FIRST (owner, 2026-10-29: "Apps only"; App Store 5.1.2(i), Play's prominent
       * disclosure) — before the window opens, and so before its microphone: who hears the voice and who reads the words
       * (ai-consent.ts `voice_guide`, asked in either app whatever `app-ai-notice` says). "Not now" is eno AI's text chat;
       * no answer (Escape, a page change) is nothing at all. The website keeps its tap-to-start.
       */
      if (isNativeAppClient()) {
        // A build without the apps' AI notice (`app-ai-notice`), or no notice host mounted: no voice guide in the app at all —
        // the text chat, as before; never a dead ✨, and never a stored "yes" that Settings could not take back (commit review,
        // codex + opus, rounds 1 and 2).
        if (!aiConsentAskFirst() || !aiConsentCanAsk()) {
          if (!opts.voiceOnly) nav.push('/messages/ai')
          return
        }
        const answer = await askAiConsentAnswer('voice_guide')
        if (window.location.pathname !== asked) return
        if (answer !== 'on') {
          if (answer === 'off' && !opts.voiceOnly) nav.push('/messages/ai')
          return
        }
      }
      if (!isConciergeHiddenPath(path)) { openConcierge(); return }
      if (GUIDE_VIA_EXPLORER.test(path)) {
        const to = explorerFallbackUrl(null, {}, hereVariant(variant))
        pendingOpen = { at: Date.now(), path: publicPathname(new URL(to, window.location.origin).pathname), from: path }
        nav.push(to)
        return
      }
    }
    if (!opts.voiceOnly) nav.push('/messages/ai')
  } finally {
    helping = false
  }
}

/**
 * The language of the page the window guides — its `<html lang>`, which language-context.tsx keeps in sync with the
 * reader's language (the nine machine-translated ones included). ⛔ The guide speaks THAT, not the frame's own guess: a frame
 * works its language out on its own and can land elsewhere (measured 2026-10-28: a Vietnamese page, the frame in English).
 * Same origin, so readable; `fallback` when it is not (no parent, a browser that refuses).
 */
export function guidedPageLang(fallback: string): string {
  try {
    return (window.parent !== window && window.parent.document.documentElement.lang) || fallback
  } catch {
    return fallback
  }
}

/** The frame → host messages (postMessage, same origin; the host checks the sender is ITS frame). */
export type ConciergeMessage =
  | { type: 'eno-concierge:go'; href: string; closes: boolean }
  | { type: 'eno-concierge:close' }
  /**
   * The voice guide cannot help here — closed for this account, its day used up, no microphone, no ears — and the person
   * chose the text assistant: the window closes and eno AI's chat opens (owner, 2026-10-28: "fallback old verion eno ai in
   * chat").
   */
  | { type: 'eno-concierge:chat' }

/**
 * The paths a `go` may open — the explorer (`/`, `/vi`) with any query, a listing, or one of the fixed pages
 * (actions.ts CONCIERGE_PAGES — client.test.ts keeps the two lists equal). The server built the path; the host checks it
 * again because a message is only data: a relative same-origin path, nothing else. Null = ignore the message.
 */
const PAGE_PATHS = ['/post', '/teachers/join', '/messages', '/help', '/safety', '/trust', '/hcmc-rent-index', '/teach-in-vietnam', '/schools', '/saved']
const LISTING_PATH = /^\/listings\/c[a-z0-9]{20,30}$/
export function safeConciergeHref(href: unknown): string | null {
  if (typeof href !== 'string' || href.length > 2_000 || !href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return null
  let u: URL
  try { u = new URL(href, 'https://eno.invalid') } catch { return null }
  if (u.origin !== 'https://eno.invalid' || u.hash) return null
  const p = u.pathname
  const explorer = p === '/' || p === '/vi'
  if (!explorer && u.search) return null
  if (!explorer && !LISTING_PATH.test(p) && !PAGE_PATHS.includes(p)) return null
  return `${p}${u.search}`
}
/** For the test that keeps the two lists equal. */
export const CONCIERGE_PAGE_PATHS: readonly string[] = PAGE_PATHS

/**
 * The area a `go` sets on the explorer (`eno:set-area`), as codes — or null to leave the person's own alone (review,
 * opus: the host cleared it on every `go`, so "cheaper ones" lost a picked ward and "near you", which no URL carries).
 * A href that names a place replaces the area with exactly that place; a page that named one the href dropped ("anywhere")
 * clears it; a href and a page that name none keep it.
 */
const PLACE_KEYS = ['province', 'district', 'ward'] as const
export function areaForGo(next: URLSearchParams, current: URLSearchParams): { province: string | null; ward: string | null } | null {
  const names = (q: URLSearchParams) => PLACE_KEYS.some((k) => q.has(k))
  if (!names(next) && !names(current)) return null
  const province = next.get('province')
  return { province, ward: province ? next.get('ward') : null }
}
