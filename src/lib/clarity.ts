// ── Microsoft Clarity: heatmaps and session replays, under the Analytics purpose (`a`) ─────────────────────────────
//
// Loaded by src/components/marketplace/analytics-tags.tsx, never before the visitor's Analytics "yes", never inside the
// native apps (consent-value.ts forces `a` off there), and only on public pages (`clarityPathAllowed`).
//
// ⛔ MICROSOFT IS AN INDEPENDENT CONTROLLER, NOT OUR PROCESSOR (Clarity Terms of Use §4.4(c), read 2026-11-25): it "may
// use the Personal Data it collects … for any purpose in accordance with the Microsoft Privacy Statement". So /privacy
// names it as a recipient with that statement's link (§4.4(b) requires the link), and the consent card names it beside
// Google Analytics. The Terms also forbid use "in connection with content which may contain sensitive user materials,
// such as … financial services or government-related information" (§1(b)(ii)) — the identity check, wallet and payout
// pages live under /dashboard, which is on the private list below.
//
// ⛔ ALL TEXT IS MASKED, IN CODE: `data-clarity-mask` on <body> (src/app/[lang]/layout.tsx) hides every page's text —
// copy, portaled dialogs, chosen values, OTP slots — whatever the dashboard's masking mode says (the attribute overrides
// it). Clarity keeps the layout, clicks, taps, scrolling and the address. The section masks below predate it and stay as
// belt and braces. To show some text again, mark a SPECIFIC public element `data-clarity-unmask` — never a container
// that can hold user data.
//
// ⛔ `ad_Storage` IS ALWAYS 'denied'. Granted, Clarity shares the data with Microsoft Advertising; eno runs no Microsoft
// ads, so — like GA's ad signals (analytics-tags.tsx GA_CONFIG) — only less is ever sent, whatever the Advertising answer.
// The tag's own cookie-sync pixel (c.clarity.ms/c.gif) is refused by the CSP for the same reason (next.config.ts).
//
// ⚠️ ONE PROJECT, eno.vn's. eno.forum no longer runs this codebase (it serves Reach since 2026-11-04), so the services
// edition is not gated here; if it is ever redeployed it must get its own Clarity project — its visa and itinerary desks
// must never land in the licensed company's account (they are also on the private list below).
//
// Facts below are from Microsoft's docs (learn.microsoft.com/clarity: setup, consent API v2, CSP, masking) and from the
// script itself (scripts.clarity.ms/0.8.77/clarity.js — the open-source clarity-js): `window.clarity(cmd, …)` dispatches
// to its exported API, which includes `consentv2`, `start` and `stop`.

/** The eno.vn project (clarity.microsoft.com/projects/view/yoo09onx53). Public — it is in every page that loads the tag. */
export const CLARITY_PROJECT_ID = 'yoo09onx53'

/**
 * The consent card's copy version that first NAMED Microsoft Clarity under Analytics (CONSENT_COPY_VERSION,
 * src/lib/consent-value.ts). ⛔ Clarity runs only for an Analytics "yes" given to words that name it: an answer given to
 * a card that read "analytics (Google Analytics)" keeps Google Analytics and never starts Clarity — the TikTok rule
 * (src/lib/tiktok-consent.ts), held on the device because Clarity is a browser tag. Nobody is asked again.
 * Versions are dates with an optional letter, so they compare as strings.
 */
export const CLARITY_COPY_VERSION = '2026-11-25'

/**
 * localStorage, this origin: `<answer ts>.<copy version>` — the card version the visitor's CURRENT answer was given to,
 * written by setConsent() (src/lib/consent.ts) beside the answer itself. ⛔ Keyed by the answer's own `ts`, so an answer
 * written anywhere else (a storefront subdomain shares the cookie, not this origin's storage; an older bundle that does
 * not write this key) never matches — Clarity stays off until the visitor answers here, on a card that names it.
 * Not personal data: two numbers that say which words were on the screen.
 */
export const CONSENT_COPY_KEY = 'eno-consent-copy'

const COPY_RECORD_RE = /^(\d{1,12})\.(\d{4}-\d{2}-\d{2}[a-z]?)$/

export function serializeConsentCopy(ts: number, copyVersion: string): string {
  return `${Math.floor(ts)}.${copyVersion}`
}

/**
 * Does the stored copy record show that THIS answer (`answerTs`, the consent cookie's own time) was given to a card that
 * names Clarity? ⛔ FAILS CLOSED: no record, a malformed one, another answer's, or an older card → false.
 * `currentCopyVersion` caps it: a record naming a version this build has never shown is not one the visitor read.
 */
export function copyRecordNamesClarity(raw: string | null | undefined, answerTs: number | null, currentCopyVersion: string): boolean {
  if (!raw || answerTs === null) return false
  const m = COPY_RECORD_RE.exec(raw.trim())
  if (!m || Number(m[1]) !== answerTs) return false
  return m[2] >= CLARITY_COPY_VERSION && m[2] <= currentCopyVersion
}

/**
 * Where Clarity must not record at all: it is stopped there (before the address changes — guardNavigation below) and
 * never started on a page that opens on one. A section, or one page of a section (`teachers/edit`), matched as a path
 * prefix after the /en|/vi rewrite:
 *   · private by nature — messages, the dashboard (identity check, wallet, payout), account and its deletion, checkout,
 *     disputes, moderation reports and appeals, the AI concierge chat, a teacher's own editor, job messages, check-in and
 *     cover pages (the public profiles and the /teachers/join sign-up are NOT private: that funnel is what Clarity is for);
 *   · a secret in the address — sign-in and OAuth callbacks, unsubscribe links, classroom join codes;
 *   · staff only (/admin); lessons that may include minors (/classroom — Clarity's FAQ: not for sites aimed at under-18s);
 *   · the forum edition's visa and itinerary desks — government-related information (Terms §1(b)(ii)), and never data
 *     for eno.vn's project.
 * ⚠️ DEFENCE IN DEPTH ONLY WHERE A SHARED ROOT EXISTS: the admin, classroom, dashboard and messages layouts also carry
 * `data-clarity-mask` (everything under them is masked even if a stop came late). The other sections are forms, whose
 * fields Clarity masks in every mode, and rely on the stop.
 * ⚠️ A DENYLIST: a new private section must be added here (and its test in clarity.test.ts).
 */
const PRIVATE_PREFIXES = [
  'account', 'account-deletion', 'admin', 'appeal', 'auth', 'checkout', 'classroom', 'concierge', 'dashboard', 'disputes',
  'itinerary', 'messages', 'oauth', 'onboard', 'reports', 'signin', 'unsubscribe', 'visa',
  'teachers/check-in', 'teachers/cover', 'teachers/cover-zalo', 'teachers/edit', 'teachers/job-messages',
] as const

const underAny = (pathname: string, prefixes: readonly string[]): boolean => {
  const path = pathname.replace(/^\/(?:en|vi)(?=\/|$)/, '').toLowerCase().replace(/\/+$/, '')
  return prefixes.some((p) => path === `/${p}` || path.startsWith(`/${p}/`))
}

/** May Clarity record this page? `pathname` as the browser shows it (the /en|/vi rewrite is internal; a /vi twin is public). */
export function clarityPathAllowed(pathname: string): boolean {
  return !underAny(pathname, PRIVATE_PREFIXES)
}

/**
 * Sections whose ADDRESS can carry a secret: a classroom join code in the path, sign-in and OAuth codes, an unsubscribe
 * token. ⛔ ONCE A TAB HAS SHOWN ONE, CLARITY NEVER RUNS AGAIN IN THAT TAB (until a full page load, which starts a new
 * document with no such entry to go Back to). The reason is the one gap guardNavigation cannot close: on Back/Forward the
 * address changes before any script runs, so clarity.js's last upload of the page before is stamped with it (review,
 * 2026-11-25: join page → public page → Back would upload the join code). With the tab sealed at the first sight of
 * such an address, Clarity is never running when that Back happens.
 */
const SECRET_ADDRESS_PREFIXES = ['auth', 'classroom', 'oauth', 'unsubscribe'] as const

/** Note the page now shown; seal the tab (and stop Clarity) when its address may carry a secret. */
export function noteClarityPath(pathname: string): void {
  if (typeof window === 'undefined' || !underAny(pathname, SECRET_ADDRESS_PREFIXES)) return
  window.__enoClaritySealed = true
  syncClarity(false, true)
}

export const claritySealed = (): boolean => typeof window !== 'undefined' && window.__enoClaritySealed === true

/** Clarity's Consent API v2 argument: Analytics as answered, advertising never (header). */
export function clarityConsent(analytics: boolean): { ad_Storage: 'denied'; analytics_Storage: 'granted' | 'denied' } {
  return { ad_Storage: 'denied', analytics_Storage: analytics ? 'granted' : 'denied' }
}

/**
 * Queue and load Clarity, once per page: the official install snippet (Clarity › Settings › Setup › Install manually) as
 * code, with ONE addition the Consent API v2 page asks for — "call the consent API immediately after the Clarity script
 * loads and before any cookies are set": `consentv2` is queued on the stub BEFORE the tag is inserted, and the tag moves
 * its own `start` to the front of the queue, so consent is the first command the started script reads.
 * ⚠️ Called from an effect at the moment the consent and the page allow it — never from a deferred inline <Script>, which
 * could run after a client-side move to a private page and start Clarity there.
 */
export function loadClarity(projectId: string = CLARITY_PROJECT_ID): void {
  if (typeof window === 'undefined' || window.__enoClarity) return
  // ⛔ A document REACHED FROM a secret-bearing page starts sealed: clarity.js uploads `document.referrer`, and a
  // same-origin referrer is the full previous address (Referrer-Policy strict-origin-when-cross-origin) — a join code.
  try {
    const ref = document.referrer ? new URL(document.referrer) : null
    if (ref && ref.origin === location.origin) noteClarityPath(ref.pathname)
  } catch { /* an unparsable referrer is not a secret one */ }
  if (claritySealed()) return
  window.__enoClarity = 'run'
  const w = window as unknown as { clarity?: ClarityFn }
  // ⚠️ A classic function pushing its ARGUMENTS object, exactly as the official stub does: clarity.js replays the queue
  // with `apply`, and the tag reorders it by index.
  w.clarity = w.clarity || function () {
    // eslint-disable-next-line prefer-rest-params -- the stub queues the Arguments object itself, like Microsoft's snippet
    ;(w.clarity!.q = w.clarity!.q || []).push(arguments)
  }
  w.clarity('consentv2', clarityConsent(true))
  guardNavigation()
  const t = document.createElement('script')
  t.async = true
  t.src = `https://www.clarity.ms/tag/${encodeURIComponent(projectId)}`
  const y = document.getElementsByTagName('script')[0]
  if (y?.parentNode) y.parentNode.insertBefore(t, y)
  else document.head.appendChild(t)
}

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[] }

declare global {
  interface Window {
    clarity?: ClarityFn
    /** What this tab last told Clarity: 'run' (started, Analytics granted) or 'stopped'. Unset until the tag is queued. */
    __enoClarity?: 'run' | 'stopped'
    /** Set once this document has shown an address that may carry a secret (noteClarityPath): Clarity never runs again. */
    __enoClaritySealed?: boolean
  }
}

/**
 * Bring an ALREADY-QUEUED Clarity in line: `run` = the consent AND the page allow it; `consent` = the consent alone.
 * Idempotent — it acts only on a change, because every `start` begins a new page view in Clarity.
 *   · run → stopped for a PRIVATE PAGE (consent still on): `stop` alone. It keeps the session cookies, so coming back
 *     continues the visit, and — unlike a consent change — schedules no restart.
 *   · run → stopped for a WITHDRAWAL: `consentv2` denied (the documented signal: Clarity deletes `_clck`/`_clsk` and ends
 *     the session), then `stop`. ⛔ The `stop` is NOT redundant: on a denial clarity.js restarts itself 250 ms later in
 *     "no-consent mode" (a cookieless id per page view, still uploading); the queued `stop` runs as that restart drains
 *     the queue. Measured on the preview (2026-11-25): no request to clarity.ms after a withdrawal.
 *   · stopped → run: `start` (with an empty config — see below), then `consentv2` granted.
 * Before loadClarity() (`__enoClarity` unset) this does nothing: the loader queues the consent itself.
 */
export function syncClarity(run: boolean, consent: boolean = run): void {
  if (typeof window === 'undefined' || !window.__enoClarity || typeof window.clarity !== 'function') return
  if (run && claritySealed()) run = false
  const want = run ? 'run' : 'stopped'
  if (window.__enoClarity === want) return
  window.__enoClarity = want
  try {
    if (run) {
      // `{}`, not nothing: a bare `start` re-enters clarity.js's own queue drain (its start ends `null === config && drain()`)
      // and logs "Error CL001: Multiple Clarity tags detected" — measured on the preview, 2026-11-25. An empty config
      // changes no setting.
      window.clarity('start', {})
      window.clarity('consentv2', clarityConsent(true))
    } else {
      if (!consent) window.clarity('consentv2', clarityConsent(false))
      window.clarity('stop')
    }
  } catch { /* a dropped command never breaks the page */ }
}

/**
 * ⛔ STOP BEFORE THE ADDRESS CHANGES, NOT AFTER THE NEW PAGE RENDERS (review, 2026-11-25). clarity.js wraps
 * `history.pushState`/`replaceState` and listens to `popstate`: on a new URL it stops — its final upload stamped with
 * `location.href`, by then the NEW address — and restarts itself 250 ms later on the new page. An effect that stops it
 * after React commits the private page is too late for both: a join code or a conversation id would already be in an
 * upload, and on a slow route the restart would record the private page.
 * So, installed BEFORE the tag (clarity.js wraps whatever `pushState` it finds, so ours runs inside its wrapper, before
 * the browser's; and our `popstate` listener is registered before its own):
 *   · pushState / replaceState to a private path → `stop` while the address is still the public one; clarity.js's
 *     wrapper then sees it stopped and neither uploads nor restarts.
 *   · popstate (Back / Forward) onto a private path → `stop`, which also removes clarity.js's own `popstate` listener
 *     before it runs (a listener removed during dispatch is not called), so no restart. ⚠️ The address has already
 *     changed when popstate fires, so that last upload of the PREVIOUS page carries the private path — never its content;
 *     an address that may carry a SECRET never gets there, because the tab is sealed at its first sight (noteClarityPath).
 * Coming back to a public page is the effect's job (AnalyticsTags → syncClarity(true)).
 */
function guardNavigation(): void {
  const h = window.history
  for (const m of ['pushState', 'replaceState'] as const) {
    const orig = h[m]
    h[m] = function (this: History, ...args: Parameters<History['pushState']>) {
      try {
        const url = args[2]
        if (url != null) {
          const next = new URL(String(url), location.href).pathname
          noteClarityPath(next)
          if (!clarityPathAllowed(next)) syncClarity(false, true)
        }
      } catch { /* never block a navigation */ }
      return orig.apply(this, args)
    }
  }
  window.addEventListener('popstate', () => {
    noteClarityPath(location.pathname)
    if (!clarityPathAllowed(location.pathname)) syncClarity(false, true)
  })
}
