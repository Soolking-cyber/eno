import { safeNextPath } from '@/lib/url'

// ── Finish the action after sign-in (UX3 J5, 2026-10-05) ─────────────────────────────────────────
//
// Before this, only the rental availability check and Publish picked up where a guest left off. A
// guest who signed in from "Chat now", an offer or "Save search" landed back on the page (after
// /onboard, after a full Google round trip) and had to find the button and press it again.
//
// ⛔ THIS IS THE RENTAL CHECK'S RESUME PATTERN, SHARED — not a second one (rental-check-view.tsx and
// src/lib/rental-check/store.ts): the same 15-minute window (INTENT_TTL_MS), the same client-minted id
// as the idempotency key, the same "honour it once, only when the user AND their profile are loaded"
// gate (`user && identityLoaded && accountType` — a new account is sent to /onboard first, and acting
// before that decides would race the redirect), and the same fallback: an intent that cannot be trusted
// is never acted on, the visitor gets one tap instead.
// ⚠️ THE WINDOW IS RESTATED HERE, NOT IMPORTED — and pending-intent.test.ts fails if the two ever differ.
// auth-context imports this module on EVERY page, and it lazy-imports the rental store (with its phone
// and rental-places dependencies) precisely to keep that out of the root bundle; a static import here
// would have undone that for one number.
//
// HOW IT IS BOUND, so an abandoned or forged intent never acts:
//   · written by the gate when it opens the sign-in (sessionStorage — this tab only, gone when it
//     closes), with a nonce; dropped when that sign-in is closed without signing in;
//   · the sign-in carries `resume=<kind>` in its `next`, so a page reached by the Google round trip,
//     the in-app hand-off or /onboard knows a resume was asked for;
//   · ACTED ON only when the stored intent is fresh AND either the address says `resume=<its kind>`
//     (a sign-in return in this tab) or the sign-in happened inside the very dialog this intent opened
//     (`armed`, set by auth-context — the in-place code/password case, which has no address to carry);
//   · `resume=` with no stored intent — a crafted link, or a sign-in finished in another browser or a
//     magic link's new tab — NEVER acts: the page offers one confirming tap instead.
// What acting means is the consumer's: save-search saves (use-explorer.ts); an offer reopens the
// composer's offer with the amount; a chat shows the opener ready to send with one tap — NEVER sent by
// itself (auto-send is the owner's open question C26, as for Publish).

/** The rental check's resume window (rental-check/store.ts INTENT_TTL_MS) — held equal by the test. */
export const INTENT_TTL_MS = 15 * 60 * 1000

/** A client-minted id, as the rental check mints its `clientRequestId` (newClientRequestId). */
function newNonce(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* insecure context — fall through */ }
  return `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

export const INTENT_KINDS = ['saveSearch', 'offer', 'chat'] as const
export type IntentKind = (typeof INTENT_KINDS)[number]
export const isIntentKind = (v: unknown): v is IntentKind => typeof v === 'string' && (INTENT_KINDS as readonly string[]).includes(v)

export type IntentPayload = {
  /** The exact `params` object the save function posts to /api/saved-searches. */
  saveSearch: { params: Record<string, unknown> }
  /** The amount chosen on a card's quick offer; null from the PDP's "Sign in to make an offer". */
  offer: { listingId: string; offerAmount: number | null }
  /** The canned opener, in the language it was asked in. */
  chat: { listingId: string; body: string }
}

export type PendingIntent<K extends IntentKind = IntentKind> = {
  kind: K
  payload: IntentPayload[K]
  at: number
  /** The idempotency key — honoured at most once (`takeIntent`). */
  nonce: string
  /** Where the action finishes: a path (+ query) on this site, without `resume`. */
  path: string
  /** The sign-in happened inside the dialog this intent opened (auth-context). */
  armed?: boolean
  /** auth-context already took the visitor to `path` once (a card's chat/offer) — never twice. */
  routed?: boolean
  /**
   * Asked AWAY from where it finishes — a card's or a list row's quick action, whose listing page is
   * elsewhere. Only such an intent is ever routed to; a gate on the listing's own page finishes there.
   */
  away?: boolean
}

/** sessionStorage: this tab only, gone when it closes; listed on /privacy's on-device table. */
export const INTENT_KEY = 'eno:pending-intent'
/** The `next` marker. The post wizard uses the same param for `publish`, which this module never touches. */
export const RESUME_PARAM = 'resume'

// ── storage (a memory copy carries it when storage is blocked) ──────────────────────────────────

let memory: PendingIntent | null = null
/** Nonces already honoured in this page life — the second consumer to ask gets nothing. */
const spent = new Set<string>()
/**
 * A write to sessionStorage failed (quota, a locked-down WebView) while reads still work: from then on
 * the memory copy is the truth for this page life — otherwise a stale stored copy (without `routed`,
 * say) would keep being read back (review, 2026-10-05).
 */
let storageBroken = false

function session(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage } catch { return null }
}

const isListingId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128

/** A stored value as an intent, or null when malformed, expired or from the future. Pure. */
/** The origin a stored path is checked against: this page's, or the marketplace's outside a browser (tests). */
const ownOrigin = (): string => (typeof window !== 'undefined' && window.location?.origin) || 'https://eno.vn'

export function parseIntent(raw: unknown, now: number): PendingIntent | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!isIntentKind(o.kind) || typeof o.at !== 'number' || !Number.isFinite(o.at)) return null
  // ⛔ THE PATH MUST BE THIS SITE'S, AS EVERY POST-AUTH REDIRECT'S IS (codex, gate 2026-10-05): an away intent is
  // router.push'ed after sign-in, and "starts with /" also passes "//evil.example" and "/\\evil.example". What
  // safeNextPath refuses comes back as "/", so anything else that comes back "/" is refused here; what it keeps is
  // kept in its normalised form (a Vietnamese query percent-encoded, as location.search already has it).
  if (typeof o.nonce !== 'string' || !o.nonce || typeof o.path !== 'string') return null
  const path = safeNextPath(o.path, ownOrigin())
  if (path === '/' && o.path !== '/') return null
  const age = now - o.at
  if (age < 0 || age > INTENT_TTL_MS) return null
  const p = o.payload as Record<string, unknown> | null
  if (!p || typeof p !== 'object') return null
  if (o.kind === 'saveSearch' && (!p.params || typeof p.params !== 'object' || Array.isArray(p.params))) return null
  if (o.kind === 'offer' && (!isListingId(p.listingId) || !(p.offerAmount === null || (typeof p.offerAmount === 'number' && p.offerAmount > 0)))) return null
  if (o.kind === 'chat' && (!isListingId(p.listingId) || typeof p.body !== 'string' || !p.body.trim() || p.body.length > 500)) return null
  return {
    kind: o.kind, payload: p as PendingIntent['payload'], at: o.at, nonce: o.nonce, path,
    ...(o.armed === true ? { armed: true } : {}), ...(o.routed === true ? { routed: true } : {}),
    ...(o.away === true ? { away: true } : {}),
  } as PendingIntent
}

function save(it: PendingIntent | null): void {
  memory = it
  const s = session()
  try {
    if (!s) return
    if (it) s.setItem(INTENT_KEY, JSON.stringify(it))
    else s.removeItem(INTENT_KEY)
  } catch {
    // The memory copy holds it for this page life — and is read from now on (storageBroken).
    storageBroken = true
    try { s?.removeItem(INTENT_KEY) } catch { /* nothing more to do */ }
  }
}

function stored(): unknown {
  const s = storageBroken ? null : session()
  if (s) {
    try {
      const raw = s.getItem(INTENT_KEY)
      return raw === null ? null : JSON.parse(raw)
    } catch { /* blocked or corrupt — fall back to memory */ }
  }
  return memory
}

/** Write the intent a gate is about to ask a sign-in for. Replaces any earlier one. */
export function writeIntent<K extends IntentKind>(
  kind: K,
  payload: IntentPayload[K],
  path: string,
  opts: { now?: number; away?: boolean } = {},
): PendingIntent<K> {
  const it: PendingIntent<K> = {
    kind, payload, at: opts.now ?? Date.now(), nonce: newNonce(), path: stripResume(path),
    ...(opts.away ? { away: true } : {}),
  }
  save(it)
  return it
}

/** The pending intent, if one is stored, valid, fresh and not yet honoured. A dead one is removed. */
export function readIntent(now: number = Date.now()): PendingIntent | null {
  const raw = stored()
  const it = parseIntent(raw, now)
  if (!it) {
    if (raw) save(null)
    return null
  }
  return spent.has(it.nonce) ? null : it
}

function patch(nonce: string, change: Partial<Pick<PendingIntent, 'armed' | 'routed'>>, now: number): void {
  const it = readIntent(now)
  if (it && it.nonce === nonce) save({ ...it, ...change })
}

/** The sign-in this intent opened completed IN its own dialog (auth-context) — the in-place proof. */
export const armIntent = (nonce: string, now: number = Date.now()) => patch(nonce, { armed: true }, now)
/** auth-context has taken the visitor to the intent's page once. */
export const markIntentRouted = (nonce: string, now: number = Date.now()) => patch(nonce, { routed: true }, now)

/** Forget the intent — only `nonce`'s when one is given, so a stale close cannot drop a newer ask. */
export function dropIntent(nonce?: string): void {
  if (nonce) {
    const cur = parseIntent(stored(), Date.now())
    if (cur && cur.nonce !== nonce) return
  }
  save(null)
}

/** Spend it: true exactly once per nonce (the idempotency key), and it is gone afterwards. */
export function takeIntent(nonce: string, now: number = Date.now()): boolean {
  if (spent.has(nonce)) return false
  const it = readIntent(now)
  if (!it || it.nonce !== nonce) return false
  spent.add(nonce)
  save(null)
  return true
}

// ── the address ────────────────────────────────────────────────────────────────────────────────

/** The intent kind a page's query string asks to resume, or null (`resume=publish` is the wizard's). */
export function resumeKindFrom(search: string | null | undefined): IntentKind | null {
  try {
    const v = new URLSearchParams(search ?? '').get(RESUME_PARAM)
    return isIntentKind(v) ? v : null
  } catch { return null }
}

function splitPath(path: string): { pathname: string; params: URLSearchParams; hash: string } {
  const hashAt = path.indexOf('#')
  const hash = hashAt >= 0 ? path.slice(hashAt) : ''
  const rest = hashAt >= 0 ? path.slice(0, hashAt) : path
  const q = rest.indexOf('?')
  return { pathname: q >= 0 ? rest.slice(0, q) : rest, params: new URLSearchParams(q >= 0 ? rest.slice(q + 1) : ''), hash }
}
function joinPath(pathname: string, params: URLSearchParams, hash: string): string {
  const qs = params.toString()
  return `${pathname}${qs ? `?${qs}` : ''}${hash}`
}

/** `path` with `resume=<kind>` set (the sign-in's `next`), its other params and hash kept. */
export function withResume(path: string, kind: IntentKind): string {
  const { pathname, params, hash } = splitPath(path)
  params.set(RESUME_PARAM, kind)
  return joinPath(pathname, params, hash)
}

/** `path` without OUR resume marker (a `resume=publish` stays — it is the post wizard's). */
export function stripResume(path: string): string {
  const { pathname, params, hash } = splitPath(path)
  if (!isIntentKind(params.get(RESUME_PARAM))) return path
  params.delete(RESUME_PARAM)
  return joinPath(pathname, params, hash)
}

/**
 * The marker this DOCUMENT was loaded with, captured when this module is first evaluated — before any
 * component effect can rewrite the address (the explorer re-writes its query on mount; it keeps unknown
 * params today, but a sign-in return's only proof should not depend on that). Only for the page it was
 * loaded on, and only until it is read once (stripResumeFromAddress).
 */
let landed: { kind: IntentKind; pathname: string } | null = (() => {
  try {
    if (typeof window === 'undefined') return null
    const kind = resumeKindFrom(window.location.search)
    return kind ? { kind, pathname: window.location.pathname } : null
  } catch { return null }
})()

/** The kind the address asks to resume: the live query first, else what this document landed with. */
export function addressResumeKind(): IntentKind | null {
  try {
    const live = resumeKindFrom(window.location.search)
    if (live) return live
    return landed && landed.pathname === window.location.pathname ? landed.kind : null
  } catch { return null }
}

/** Take our marker out of the address bar once it has been read: a reload is not a sign-in return. */
export function stripResumeFromAddress(): void {
  landed = null
  try {
    const { pathname, search, hash } = window.location
    const here = `${pathname}${search}${hash}`
    const next = stripResume(here)
    // Next's own history state is passed through: the App Router keeps its tree key there.
    if (next !== here) window.history.replaceState(window.history.state, '', next)
  } catch { /* no history API — the param stays, and without a stored intent it only ever asks */ }
}

/** The pathname part of a path, for "is the intent's page this page?". */
export const pathnameOf = (path: string): string => splitPath(path).pathname

// ── the decision ───────────────────────────────────────────────────────────────────────────────

export type ResumeDecision =
  | { action: 'act'; intent: PendingIntent }
  | { action: 'confirm'; kind: IntentKind }
  | { action: 'none' }

/**
 * What a consumer does on a signed-in, onboarded page. Pure.
 * `kinds` — the kinds this consumer finishes; `matches` — is this stored intent its own (its listing, its
 * page)? Act only on a fresh intent that is this consumer's AND proven by the address or the dialog;
 * an address that asks with nothing (trusted) behind it gets the confirming tap.
 */
export function decideResume(o: {
  urlKind: IntentKind | null
  intent: PendingIntent | null
  kinds: readonly IntentKind[]
  matches: (it: PendingIntent) => boolean
}): ResumeDecision {
  const it = o.intent
  if (it && o.kinds.includes(it.kind) && o.matches(it) && (it.armed === true || o.urlKind === it.kind)) {
    return { action: 'act', intent: it }
  }
  if (o.urlKind && o.kinds.includes(o.urlKind)) return { action: 'confirm', kind: o.urlKind }
  return { action: 'none' }
}

/** A card's chosen amount → the PDP composer's discount, clamped to its slider (0–50 %). */
export function discountFor(offerAmount: number | null, price: number | null | undefined, max = 50): number | null {
  if (offerAmount === null || typeof price !== 'number' || !(price > 0) || !(offerAmount > 0)) return null
  const pct = Math.round((1 - offerAmount / price) * 100)
  return Math.min(max, Math.max(0, pct))
}

/** Tests only. */
export function __resetPendingIntentForTests(): void {
  memory = null
  spent.clear()
  landed = null
  storageBroken = false
}
