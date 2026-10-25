// ── One ask per page view (UX3 J7f, 2026-10-05) ───────────────────────────────────────────────────
//
// The timed "Join eno" prompt (signup-prompt.tsx) and the "Get the eno app" card (install-hint.tsx) both
// arrive on their own timers, so nothing stopped them landing on the same screen — the report counted up
// to four interruptions in a phone visitor's first four minutes (consent bar, join prompt, install card,
// the second join prompt). NN/g lists stacking popups among the most-hated patterns.
//
// THE RULE: an ask may appear only when the OTHER ask is not on screen AND did not appear in this page
// view. A page view is a pathname; every route change starts a new one, and an ask still on screen when
// the route changes counts as appearing in the new view too (the install card persists across client
// navigations until it is dismissed). The ask that loses simply waits for a later page view — nothing
// is dropped and no schedule changes.
//
// ⚠️ MODULE STATE, ONE PAGE LIFE: both asks are mounted once under the root layout (providers.tsx), so a
// plain module is the shared memory. A reload starts it fresh, which is a new page view anyway.
//
// ⛔ A THIRD ASK SINCE UX2 W2 B2-NOTIFY (2026-10-05): 'push', the "turn on notifications" card
// (push-opt-in-card.tsx — the post-success screen and the inbox). The rule is the same rule, read for
// any number of asks: an ask may appear only when no OTHER ask is on screen and none appeared in this
// page view. With 'push' never shown, join and install behave exactly as before (page-asks.test.ts).
// The card is mounted by its pages, not by providers.tsx, so its own unmount reports it hidden.

// ── AND ONE INTERRUPTION PER VISIT (owner, 2026-10-18: "one per visit, no floaters") ───────────────────
// A first visit could still meet three asks inside two minutes, one per page view: the cookie bar (a quarter
// of a phone screen, 4s in), the install card (82px, from the second visit) and the join sheet (more than half
// the screen, 60s in). Measured on 2026-10-18 against marketplaces that show the feed with one prompt at most.
// THE SESSION RULE: of the cookie bar, the install card and the join prompt, a browsing session — this tab's
// sessionStorage — shows ONE. The first to appear takes the session; the other two stand down until a later
// session (one exception since 2026-10-22, below: the cookie bar never holds "Join eno" back). ⚠️ THE COOKIE BAR IS NEVER THE ONE HELD BACK: it is the law's, not ours (cookie-consent.tsx only
// RECORDS that it appeared), and it is due on every session until it is answered — so the install card also
// waits for an answer before it may ask at all (install-hint.tsx), and the join prompt's clock already did
// (signup-prompt.tsx, UX3 J7a). The push card is not an interruption (it answers the visitor's own post or
// message) and keeps only the page-view rule.
// ⚠️ STORAGE CAN THROW (private windows, blocked site data, a full quota): the session record falls back to module
// memory, which lasts this page life — a reload then forgets it, and the cookie bar is still the law's either way.
// ⛔ ONCE A WRITE HAS FAILED, MEMORY IS THE RECORD FOR THE REST OF THE PAGE LIFE, READS INCLUDED (codex + opus, gate
// 2026-10-18): a quota-full storage still READS, so a read that consulted memory only when IT threw found nothing
// after a refused write — and the install card and the join prompt both asked in one visit.
// ⛔ A VISIT ENDS AFTER 30 MINUTES AWAY, NOT WITH THE TAB (opus, gate 2026-10-18). sessionStorage lives as long as
// the tab, and a phone keeps a tab for days: "one per visit" would have become "one per tab, ever". So the record
// carries `t`, the moment the visit was last seen in use — stamped when the visitor leaves (the tab goes to the
// background, the page is left: visibilitychange → hidden, pagehide) and on every page view. The FIRST LOOK after
// they are back — the first read in a new page life, or after the tab returns to the front — finds 30 minutes or
// more since `t` and drops the record: a new visit (the analytics definition of a session, GA4's default timeout).
// ⛔ ONLY TIME AWAY COUNTS (codex + opus, gate round 3): a first cut timed out 30 minutes after the last ROUTE CHANGE,
// so half an hour of scrolling one feed — the heaviest browsers — ended the "visit" mid-scroll and let a second ask
// in. While the page stays in front, the visit goes on however long it lasts.
// ⚠️ "Join eno" also counts its own asks per TAB (signup-prompt.ts MAX_PER_TAB = 1) — stricter than this rule,
// never looser: after a new visit starts in an old tab, the install card may ask again, the join prompt may not.
// ⛔ EXCEPT THAT THE COOKIE BAR NO LONGER HOLDS THE JOIN PROMPT BACK (owner, 2026-10-22, choosing the sign-up fixes: "Join
// prompt on first visits — let “Join eno” show after the cookie bar is answered"). Measured: every first visit shows the
// cookie bar, so from 10-18 no first visit was ever asked to join — the prompt fell from 12.8 shows a day to 2.2. The bar
// still takes the visit (the install card still waits for a later one), and the join prompt's clock only starts once the
// bar is answered (signup-prompt.tsx, UX3 J7a), so the two are never on screen together; the join prompt is still one
// per tab (MAX_PER_TAB).

export type PageAsk = 'join' | 'install' | 'push'
const ASKS: readonly PageAsk[] = ['join', 'install', 'push']

/** The asks the one-per-visit rule counts. The cookie bar is one of them, though never a page-view ask. */
export type SessionAsk = 'consent' | 'install' | 'join'
const SESSION_ASKS: readonly SessionAsk[] = ['consent', 'install', 'join']
/** sessionStorage — which of the three took this browsing session, and when the visit last moved: `{"k":…,"t":ms}`. */
export const SESSION_ASK_KEY = 'eno:session-ask'
/** A visitor away this long comes back to a new visit (see "A VISIT ENDS" above). */
export const VISIT_IDLE_MS = 30 * 60 * 1000
const isSessionAsk = (v: unknown): v is SessionAsk => typeof v === 'string' && (SESSION_ASKS as readonly string[]).includes(v)
type SessionRecord = { k: SessionAsk; t: number }

let view = 0
let lastPath: string | null = null
const visible = new Set<PageAsk>()
const appearedIn = new Map<PageAsk, number>()
/** The session record's copy in memory — every write and every good read lands here too, so a storage that starts
 *  refusing later in this page life (or never accepted the write) still answers. Memory lasts this page life only. */
let sessionMemo: SessionRecord | null = null
/** Storage refused a read or a write in this page life: memory is the record from here on, reads included. */
let memoryOnly = false
/** The visitor is here and this page life has had its FIRST LOOK at the stored visit (see "A VISIT ENDS" above). */
let visitChecked = false

function readRecord(): SessionRecord | null {
  if (typeof window === 'undefined') return null // a server render has no visitor (and must not flip `memoryOnly`)
  if (memoryOnly) return sessionMemo
  try {
    const raw = window.sessionStorage.getItem(SESSION_ASK_KEY)
    if (raw === null) return null
    const rec: unknown = JSON.parse(raw)
    if (rec && typeof rec === 'object' && isSessionAsk((rec as SessionRecord).k) && Number.isFinite((rec as SessionRecord).t)) {
      sessionMemo = rec as SessionRecord // a record the last page life wrote survives a storage that stops answering
      return sessionMemo
    }
    return null // not ours (an older or hand-edited value): the visit is unclaimed
  } catch (e) {
    if (e instanceof SyntaxError) return null // unparseable — unclaimed, as above
    memoryOnly = true // blocked storage: this page life's memory
    return sessionMemo
  }
}

function writeRecord(rec: SessionRecord | null): void {
  if (typeof window === 'undefined') return
  sessionMemo = rec
  if (memoryOnly) return
  try {
    if (rec) window.sessionStorage.setItem(SESSION_ASK_KEY, JSON.stringify(rec))
    else window.sessionStorage.removeItem(SESSION_ASK_KEY)
  } catch {
    memoryOnly = true // a full quota, blocked data: the copy above is the record now
  }
}

/** The page is in front of the visitor (or there is no document to ask). */
const inFront = (): boolean => typeof document === 'undefined' || document.visibilityState !== 'hidden'

/**
 * THE FIRST LOOK at the stored visit since the visitor arrived or came back: 30 minutes or more since it was last in
 * use means they were away that long, and the record goes. ⛔ ONLY A LOOK WHILE THE PAGE IS IN FRONT COUNTS (codex,
 * gate round 6): a background timer reading the record 75 seconds after the tab was hidden used to take the first
 * look, so a visitor back hours later was still in the old visit. Coming back to the tab looks at once (below).
 */
function firstLook(now: number): void {
  if (visitChecked || !inFront()) return
  visitChecked = true
  const rec = readRecord()
  if (rec && now - rec.t >= VISIT_IDLE_MS) writeRecord(null) // away long enough: the visit it belonged to is over
}

/** The record of the visit in progress. */
function visitRecord(now: number): SessionRecord | null {
  firstLook(now)
  return readRecord()
}

/** The ask that took this visit, if any did. */
export function sessionAsk(now: number = Date.now()): SessionAsk | null {
  return visitRecord(now)?.k ?? null
}

/** `ask` appeared: it takes the visit unless another ask already has it (the first one keeps it). */
export function noteSessionAsk(ask: SessionAsk, now: number = Date.now()): void {
  if (sessionAsk(now) !== null) return
  writeRecord({ k: ask, t: now })
}

/** A page view in front: a claimed visit is in use now. */
function stampVisit(now: number): void {
  if (!inFront()) return
  const rec = visitRecord(now)
  if (rec) writeRecord({ k: rec.k, t: now })
}

/** The visitor left — the tab went to the background or the page is going. If they were here with this visit,
 *  it was last in use now; a record nobody has looked at since they last left keeps that older time, so leaving
 *  again cannot revive a dormant claim. The next look in front decides from the time away. */
function visitorLeft(): void {
  if (visitChecked) {
    const rec = readRecord()
    if (rec) writeRecord({ k: rec.k, t: Date.now() })
  }
  visitChecked = false
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') visitorLeft()
    else firstLook(Date.now()) // back in front: the time away decides now, not at the next ask
  })
  window.addEventListener('pagehide', visitorLeft)
}

/** May `ask` appear in this session? Only while no OTHER ask has had it — the cookie bar never holds "Join eno" back. */
export function maySessionAsk(ask: SessionAsk): boolean {
  const taken = sessionAsk()
  return taken === null || taken === ask || (ask === 'join' && taken === 'consent')
}

const sessionCounted = (ask: PageAsk): ask is SessionAsk & PageAsk => ask === 'join' || ask === 'install'

/** The route this page view is on. A different path than last time is a new page view. */
export function notePageView(path: string | null | undefined): void {
  const p = path ?? ''
  if (p === lastPath) return
  lastPath = p
  view += 1
  // Still on screen across the navigation → it is on screen in this view as well.
  for (const a of visible) appearedIn.set(a, view)
  stampVisit(Date.now())
}

/**
 * May `ask` appear now, on `path`? False while another ask is on screen or already appeared in this view — and,
 * for the join prompt and the install card, once another interruption has had this session (the rule above).
 */
export function mayAsk(ask: PageAsk, path: string | null | undefined): boolean {
  notePageView(path)
  if (sessionCounted(ask) && !maySessionAsk(ask)) return false
  return ASKS.every((o) => o === ask || (!visible.has(o) && appearedIn.get(o) !== view))
}

/** `ask` just appeared. The join prompt and the install card take the session with it, if it is still free. */
export function askShown(ask: PageAsk, path: string | null | undefined): void {
  notePageView(path)
  visible.add(ask)
  appearedIn.set(ask, view)
  if (sessionCounted(ask)) noteSessionAsk(ask)
}

/** `ask` left the screen (dismissed, answered, or its host unmounted). */
export function askHidden(ask: PageAsk): void {
  visible.delete(ask)
}

/** Tests only — the page view AND the session record (memory and storage), as a new tab would start. */
export function __resetPageAsksForTests(): void {
  view = 0
  lastPath = null
  visible.clear()
  appearedIn.clear()
  sessionMemo = null
  memoryOnly = false
  visitChecked = false
  try { window.sessionStorage.removeItem(SESSION_ASK_KEY) } catch { /* nothing stored */ }
}
