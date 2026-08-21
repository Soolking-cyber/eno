import { isNativeApp } from '@/lib/native-auth'

/**
 * BRANDED GOOGLE SIGN-IN — Google Identity Services (GIS) → `supabase.auth.signInWithIdToken`.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * `supabase.auth.signInWithOAuth({ provider: 'google' })` sends the visitor to Google via
 * SUPABASE'S hosted callback, so Google's consent screen reads
 * "continue to xihiryllwmjoouipkyhw.supabase.co" — our Supabase project ref, in front of every
 * new user, on the highest-intent screen in the funnel. There is no way to rename it: Google
 * derives that line from the OAuth client's redirect host, and that host belongs to Supabase.
 *
 * The fix is to do the Google half against OUR OWN OAuth client, in the browser, via GIS. The
 * consent screen is then branded by OUR OAuth consent screen config (app name + logo), and the
 * ID token Google mints is handed to Supabase, which verifies it and issues its normal session.
 *
 * ── WHAT THIS DOES *NOT* CHANGE ──────────────────────────────────────────────────────────────
 * Nothing about how sessions work. Supabase still owns the session, the cookies, the refresh
 * loop and the identity row — `signInWithIdToken` lands in the same `@supabase/ssr` browser
 * client, writing the same cookies as the phone-OTP and email-code paths already do. This
 * module only changes WHERE the Google credential is obtained. It issues no session of its own
 * and stores nothing.
 *
 * ── INERT UNTIL CONFIGURED ───────────────────────────────────────────────────────────────────
 * Everything here is gated on `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Unset (which is the state in
 * production until the owner does the Console work) ⇒ `requestGoogleIdToken()` returns null
 * before touching the network, the GIS script is never injected, and the sign-in form runs the
 * byte-identical `signInWithOAuth` flow it ran before this file existed. That is what makes the
 * change safe to merge ahead of the Console setup.
 * ⚠️ `NEXT_PUBLIC_*` is INLINED AT BUILD TIME — setting it only in the Cloud Run runtime env
 * does nothing. It has to be in the Secret Manager build env (`eno-root-env`) so the Docker
 * build sees it, and the CSP additions in next.config.ts are gated on the same build-time read.
 *
 * ── THE FALLBACK CHAIN (constraint #1 of an auth path: never dead-end) ───────────────────────
 * Every failure resolves `null` and the caller runs the OLD `signInWithOAuth`. Nothing here
 * throws, nothing here hangs, nothing here surfaces an error to the visitor:
 *   · env unset, SSR, or native shell            → null, no network at all
 *   · GIS script blocked (ad-blockers and privacy browsers block accounts.google.com/gsi/client),
 *     404s, or the request black-holes            → null after SCRIPT_TIMEOUT_MS
 *   · One Tap not displayed / skipped / dismissed → null the moment GIS says so
 *   · GIS tells us nothing at all                 → null after PROMPT_TIMEOUT_MS
 *   · `signInWithIdToken` rejects the token       → the CALLER falls through (see sign-in-form)
 * An unbranded consent screen is a cosmetic loss. A visitor who cannot sign in is not.
 *
 * ⚠️ THE TIMEOUT IS ALLOWED TO BE BLUNT *BECAUSE OF WHERE THE FALLBACK GOES.* The worst case is
 * that the browser's account chooser is open, the visitor is still deciding, we time out, and
 * the page redirects — to Google's own full-page account chooser. They finish the exact same
 * task on the next screen, unbranded. That is why a bounded timeout is acceptable here and would
 * not be if the fallback were an error message.
 *
 * ── THE NATIVE CARVE-OUT ─────────────────────────────────────────────────────────────────────
 * The Capacitor shell must NEVER reach this code. Google rejects OAuth in embedded WebViews
 * (`disallowed_useragent`) and GIS/FedCM does not work in one either, so `src/lib/native-auth.ts`
 * runs a deliberate dance instead: a REAL in-app browser tab → Supabase → `/auth/callback?native=1`
 * → the `enovn://auth-callback` deep link, back into the WebView where the PKCE verifier cookie
 * lives. The sign-in form gates on `isNativeApp()` before it ever gets here; the same guard is
 * repeated below as defence in depth, because a silent regression on that path signs nobody in.
 *
 * ── WHAT THE ID-TOKEN PATH SKIPS, AND WHY THAT IS SAFE ───────────────────────────────────────
 * `signInWithOAuth` round-trips through `/auth/callback`, which calls `finishSignIn()` →
 * `ensureProfile()` (server-side Profile provisioning) and 302s a user with no `accountType` to
 * `/onboard`. This path never visits that route, so it skips BOTH — exactly as the phone-OTP and
 * native email-code paths already do, and they are covered by the same two client-side hooks:
 *   · PROVISIONING — auth-context fetches `/api/me` on every `user` change; `getCurrentProfile()`
 *     lazily calls `ensureProfile(user)` when no Profile row exists (src/lib/admin.ts).
 *   · ONBOARDING  — auth-context's gate redirects a signed-in user with a null `accountType` to
 *     `/onboard?next=…` once `/api/me` has answered (guarded by `mayGateOnboarding`).
 *   · `next`      — the sign-in dialog is opened FROM the page the visitor wants, so staying put
 *     IS the redirect; the /signin page runs its own `router.replace(safeNextPath(next))`.
 * So the end state matches. It is reached client-side instead of by a 302.
 *
 * Docs: https://supabase.com/docs/guides/auth/social-login/auth-google
 *       https://developers.google.com/identity/gsi/web/reference/js-reference
 */

/** Unset ⇒ the whole feature is off. No hardcoded fallback, deliberately: see the same note in
 *  turnstile.tsx — a key that CANNOT work turns "not configured" into "mysteriously broken". */
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || null
const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

/** Machine time: a script that has not loaded by now is blocked, not slow. */
const SCRIPT_TIMEOUT_MS = 4_000
/** Machine time: how long we wait when GIS reports NOTHING — no display, no skip, no dismissal.
 *  Only a backstop; every outcome GIS actually reports settles immediately. */
const PROMPT_TIMEOUT_MS = 8_000
/** Human time: re-based once GIS confirms a prompt is on screen, so we stop counting like a
 *  machine against a person who has to read an account chooser and pick. Mirrors the
 *  `before-interactive-callback` re-base in turnstile.tsx, for the same reason.
 *  ⚠️ Display moments are NOT reported under FedCM (see the prompt() comment), so on modern
 *  Chrome this re-base never happens and PROMPT_TIMEOUT_MS is the real budget. */
const PROMPT_HUMAN_MS = 120_000

/** Only the members we use. GIS's surface is much larger; typing it fully invites drift. */
type PromptMomentNotification = {
  isDisplayed?: () => boolean
  isNotDisplayed?: () => boolean
  isSkippedMoment?: () => boolean
  isDismissedMoment?: () => boolean
  getDismissedReason?: () => string
}
type CredentialResponse = { credential?: string; select_by?: string }
type GoogleIdApi = {
  initialize: (config: Record<string, unknown>) => void
  prompt: (listener?: (n: PromptMomentNotification) => void) => void
  cancel: () => void
  // ⚠️ OPTIONAL, because this is a hand-written shape for a script we do not control. An older
  // cached gsi/client without renderButton must degrade to "no button, keep ours" rather than
  // throwing a TypeError inside a sign-in path — see the `?.` at the call site.
  renderButton?: (parent: HTMLElement, options: Record<string, unknown>) => void
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } }
  }
}

/**
 * True when the branded path is configured AND usable on this client. The sign-in form calls
 * this to decide whether to try at all, so an unconfigured build never even pays the branch.
 */
export function googleIdentityEnabled(): boolean {
  if (!CLIENT_ID) return false
  if (typeof window === 'undefined') return false
  // ⚠️ Native NEVER reaches GIS — see "THE NATIVE CARVE-OUT" above.
  if (isNativeApp()) return false
  return true
}

/** Memoized script load. Resolves false instead of rejecting: a blocked script is an expected
 *  outcome here, not an exception. Re-armed on failure so a later retry can succeed (a visitor
 *  who disables their blocker and taps again). */
let scriptPromise: Promise<boolean> | null = null
function loadGis(): Promise<boolean> {
  if (window.google?.accounts?.id) return Promise.resolve(true)
  if (scriptPromise) return scriptPromise
  // ⚠️ RETURN THE LOCAL `p`, NOT `scriptPromise`. A Promise executor runs SYNCHRONOUSLY, and
  // `finish(false)` re-arms by setting the module-level `scriptPromise = null` — so a synchronous
  // failure would make `return scriptPromise` hand the caller a literal `null`. TypeScript cannot
  // see that (it narrows on the assignment), so `Promise<boolean>` would be a lie the compiler
  // signs off on, and `await null` resolves to `null` rather than throwing — the caller would
  // silently take the fallback and nobody would find out. Nothing here fails synchronously today
  // (onerror and the timer are both async), so this is a latent-only fix; it costs one binding.
  const p = new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      // Let a future attempt re-try from scratch; keep a success memoized.
      if (!ok) scriptPromise = null
      resolve(ok)
    }
    // A blocked host usually fires onerror, but a DNS black-hole or a proxy that never answers
    // fires neither — hence the timer. Without it the button spins until the visitor gives up.
    const timer = setTimeout(() => finish(false), SCRIPT_TIMEOUT_MS)
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => {
      clearTimeout(timer)
      // Loaded ≠ usable: confirm the API actually attached before promising it.
      finish(!!window.google?.accounts?.id)
    }
    s.onerror = () => {
      clearTimeout(timer)
      finish(false)
    }
    document.head.appendChild(s)
  })
  scriptPromise = p
  return p
}

/**
 * ⚠️⚠️ THE NONCE PAIRING — THE SINGLE MOST COMMON WAY THIS INTEGRATION FAILS. ⚠️⚠️
 *
 * GOOGLE GETS THE SHA-256 HEX. SUPABASE GETS THE RAW STRING. Backwards produces
 * "Passed nonce and nonce in id_token should either both exist or not." or "Nonces mismatch".
 *
 * Established from two primary sources, not from memory:
 *  1. supabase.com/docs/guides/auth/social-login/auth-google — "because Supabase Auth expects the
 *     provider to hash it (SHA-256, hexadecimal representation), you need to provide a hashed
 *     version to Google and a non-hashed version to `signInWithIdToken`."
 *  2. supabase/auth `internal/api/token_oidc.go`, `IdTokenGrant` — verified verbatim:
 *         hash := fmt.Sprintf("%x", sha256.Sum256([]byte(params.Nonce)))
 *         if hash != idToken.Nonce { … "Nonces mismatch" }
 *     i.e. GoTrue hashes what WE send and compares it to the token's claim. Google copies the
 *     nonce it was given into the claim verbatim (it does not hash), so the claim must already
 *     BE the hash — which is why Google is the side that gets the digest.
 *
 * The nonce is OPTIONAL ("recommended for extra security, but optional" — same doc), and the two
 * sides must agree: both present, or both absent. `crypto.subtle` needs a secure context, so on a
 * plain-http origin (LAN dev) we omit the nonce on BOTH sides rather than sending a half-pair.
 *
 * Returns null when no nonce should be used at all.
 *
 * EXPORTED ONLY FOR google-identity.test.ts, which pins `hashed === sha256hex(raw)` — the exact
 * invariant whose inversion produces the two errors above. It is the one part of this file a unit
 * test can reach (the rest needs a real browser + a Google session), and it is the part that
 * breaks silently: with the pairing backwards every sign-in still WORKS, it just always falls
 * back, so the branded consent screen quietly never appears and nothing looks wrong.
 */
export async function makeNoncePair(): Promise<{ raw: string; hashed: string } | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle || !globalThis.crypto?.getRandomValues) return null
  try {
    const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(raw))
    const hashed = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return { raw, hashed }
  } catch {
    return null // no nonce anywhere beats a mismatched pair
  }
}

/**
 * Ask Google for an ID token for this visitor.
 *
 * Resolves `{ token, nonce }` on success — `nonce` is the RAW value and MUST be forwarded to
 * `signInWithIdToken` unchanged (undefined when no nonce was used; forward undefined, do not
 * substitute one). Resolves `null` on every failure, and never throws or hangs.
 */
export async function requestGoogleIdToken(): Promise<{ token: string; nonce?: string } | null> {
  if (!googleIdentityEnabled()) return null
  try {
    if (!(await loadGis())) return null
    const api = window.google?.accounts?.id
    if (!api) return null

    const noncePair = await makeNoncePair()

    return await new Promise<{ token: string; nonce?: string } | null>((resolve) => {
      let settled = false
      let timer = setTimeout(() => finish(null), PROMPT_TIMEOUT_MS)

      function finish(value: { token: string; nonce?: string } | null) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // Close any prompt still on screen before the caller navigates away — a One Tap card
        // left hanging over a full-page redirect looks like the app broke. Guarded because
        // cancel() itself emits a moment notification (`cancel_called`), which re-enters the
        // listener below; `settled` makes that a no-op.
        if (!value) { try { api!.cancel() } catch { /* nothing open */ } }
        resolve(value)
      }

      // Re-initialized on EVERY attempt, not once per page: the nonce is single-use, and the
      // callback closes over this attempt's resolver. GIS treats a later initialize() as a
      // config replacement, so this is the supported way to rotate both.
      api.initialize({
        client_id: CLIENT_ID,
        callback: (response: CredentialResponse) => {
          const token = response?.credential
          finish(token ? { token, nonce: noncePair?.raw } : null)
        },
        // ⚠️ THE HASH GOES HERE. See makeNoncePair. Omitted entirely when we have no pair.
        ...(noncePair ? { nonce: noncePair.hashed } : {}),
        // The visitor TAPPED "Continue with Google", so they get to choose an account: never
        // sign them into a remembered one behind their back.
        auto_select: false,
        // A stray tap elsewhere on the page must not silently cancel a prompt the visitor asked
        // for — that would read as "the button did nothing" and then redirect them.
        cancel_on_tap_outside: false,
        // Upgraded One Tap UX on ITP browsers (Safari, Firefox), where third-party storage is
        // partitioned and the default flow cannot render.
        itp_support: true,
        context: 'signin',
        // NOT passing `use_fedcm_for_prompt`: Google's current JS reference marks it deprecated
        // and ignored — FedCM is the only prompt implementation now. Passing it is noise that
        // reads as load-bearing.
      })

      // ⚠️ THE MOMENT LISTENER IS ADVISORY, NOT AUTHORITATIVE, and that is a documented FedCM
      // behaviour change rather than a quirk. VERIFIED against Google's FedCM migration guide
      // (developers.google.com/identity/gsi/web/guides/fedcm-migration), because an earlier draft
      // of this comment had it wrong in a way that would have invited deleting live handlers:
      //   · DISPLAY moments are GONE — "the prompt callback no longer returns any display moment
      //     notification"; isDisplayMoment/isDisplayed/isNotDisplayed/getNotDisplayedReason are
      //     unsupported. The isDisplayed() re-base below therefore only ever fires on legacy
      //     non-FedCM One Tap, and PROMPT_TIMEOUT_MS is the real budget on modern Chrome.
      //   · SKIPPED moments ARE still reported, but WITHOUT a reason — "detailed reason wouldn't
      //     be provided… remove any code that depends on getSkippedReason()". We depend on the
      //     boolean only, never the reason. This is the one that catches "no Google session".
      //   · DISMISSED moments are "unchanged when FedCM is enabled", reason included — which is
      //     why the credential_returned check below is still load-bearing.
      // So the two branches that actually settle us are skipped + dismissed, both live under
      // FedCM; PROMPT_TIMEOUT_MS is a backstop for the residual silent case, not the main path.
      // Every accessor is still optional-called inside its own try/catch (an unsupported one may
      // be absent or throw). Any outcome that is not a returned credential falls back — including
      // an explicit cancel, because "Continue with Google" then lands on Google's own account
      // chooser, which is where the visitor was already heading.
      api.prompt((n) => {
        if (settled) return
        try {
          if (n.isDismissedMoment?.()) {
            // `credential_returned` means the callback above has fired or is about to — do NOT
            // settle null here or we would race a successful sign-in into the fallback.
            if (n.getDismissedReason?.() !== 'credential_returned') finish(null)
            return
          }
        } catch { /* accessor unsupported under FedCM */ }
        try { if (n.isSkippedMoment?.()) { finish(null); return } } catch { /* unsupported */ }
        try { if (n.isNotDisplayed?.()) { finish(null); return } } catch { /* unsupported */ }
        // Confirmed on screen (legacy, non-FedCM One Tap only) → stop counting in machine time.
        try {
          if (n.isDisplayed?.()) {
            clearTimeout(timer)
            timer = setTimeout(() => finish(null), PROMPT_HUMAN_MS)
          }
        } catch { /* unsupported */ }
      })
    })
  } catch {
    // Belt and braces: this function is on the auth path and must never reject.
    return null
  }
}

// ── THE RENDERED BUTTON ─────────────────────────────────────────────────────────────────────────
//
// ⛔ WHY THIS EXISTS AND prompt() WAS NOT ENOUGH. One Tap is the only branded path this module had,
// and One Tap DECLINES to appear for entirely ordinary reasons: a previous dismissal (Google then
// suppresses it for a cooldown), no Google session in that browser, ITP partitioning, FedCM
// unavailable. Every one of those arrives as a SKIPPED moment, which requestGoogleIdToken maps to
// null, which sends the caller to signInWithOAuth — the redirect flow. Measured on prod
// 2026-08-21: `momentType: 'skipped'` on a first visit, so the branded path essentially never ran
// and the consent screen still read `xihiryllwmjoouipkyhw.supabase.co`.
//
// ⛔ THE BUTTON IS A DIFFERENT FLOW, NOT A DIFFERENT SKIN — and this is the whole point, measured
// rather than assumed. Clicking the rendered button opens Google with:
//     response_type=id_token   redirect_uri=gis_transform   app_domain=https://www.eno.forum
// where the REDIRECT path carries `app_domain=https://xihiryllwmjoouipkyhw.supabase.co` and renders
// exactly that string as `data-app-name`. There is no redirect_uri to a Supabase host here at all,
// so the host cannot be displayed. That is why this fixes the branding and a CSS change never could.
//
// ⚠️ NEVER MOUNT THIS WHILE requestGoogleIdToken() IS ALSO IN USE. Both call
// `google.accounts.id.initialize()`, and GIS treats a later initialize() as a CONFIG REPLACEMENT —
// the second one silently overwrites the first's callback AND its nonce, so the first attempt's
// credential resolves against a nonce Supabase will reject. An external reviewer refuted the first
// version of this design on exactly that. The call site avoids it structurally: when the button
// mounts it HIDES the custom button, so the prompt() path is unreachable while the button is live.

type ButtonTheme = 'outline' | 'filled_blue' | 'filled_black'

export type GoogleButtonHandle = {
  /** False when GIS is unavailable — the caller must keep its own button visible. */
  ok: boolean
  destroy: () => void
}

/**
 * Mount Google's own "Continue with Google" button into `container`.
 *
 * ⚠️ THE NONCE IS ROTATED AFTER EVERY CREDENTIAL, not fixed at mount. It is baked into
 * initialize(), and the click happens inside Google's iframe where we cannot intervene first — so
 * a nonce set once would be replayed by a second click. Re-initializing in the callback means each
 * issued token carries a nonce used exactly once, which is the property the pair exists to provide.
 */
export async function mountGoogleButton(
  container: HTMLElement,
  opts: {
    onCredential: (cred: { token: string; nonce?: string }) => void
    theme?: ButtonTheme
    locale?: string
    width?: number
  },
): Promise<GoogleButtonHandle> {
  const dead: GoogleButtonHandle = { ok: false, destroy: () => {} }
  if (!googleIdentityEnabled()) return dead
  if (!(await loadGis())) return dead
  const api = window.google?.accounts?.id
  if (!api) return dead

  let disposed = false
  let pair = await makeNoncePair()
  // ⛔ SET SYNCHRONOUSLY, CLEARED WHEN THE NEW PAIR LANDS. Rotation is async (makeNoncePair awaits
  // crypto.subtle), so without this a second activation during that window is handed a credential
  // minted against the OLD nonce — which Supabase then rejects. The visitor is already mid-sign-in
  // at that point, so dropping the duplicate is right; letting it through is not.
  let rotating = false

  const draw = () => {
    if (disposed) return
    api.initialize({
      client_id: CLIENT_ID!,
      callback: (response: CredentialResponse) => {
        const token = response?.credential
        if (!token || disposed || rotating) return
        const raw = pair?.raw
        // Rotate BEFORE handing the credential over, so a second click can never reuse this nonce
        // even if the caller keeps the button on screen. `rotating` closes the async gap.
        rotating = true
        void makeNoncePair().then((next) => { pair = next; rotating = false; draw() })
        opts.onCredential({ token, nonce: raw })
      },
      ...(pair ? { nonce: pair.hashed } : {}),
      auto_select: false,
      itp_support: true,
      context: 'signin',
    })
    // renderButton APPENDS; without clearing, a rotation would stack a second button.
    container.replaceChildren()
    api.renderButton?.(container, {
      type: 'standard',
      theme: opts.theme ?? 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      // ⚠️ GIS TAKES PIXELS AND IGNORES PERCENTAGES, and caps at 400. The caller measures its own
      // container; this clamp only stops an unmeasured 0 from rendering an invisible button.
      width: Math.max(200, Math.min(400, Math.round(opts.width ?? 320))),
      ...(opts.locale ? { locale: opts.locale } : {}),
    })
    // ⛔ AFTER EVERY DRAW, NOT ONCE. Rotation calls draw() again, which replaceChildren()s and lets
    // GIS inject FRESH focusable nodes — so a strip that ran only on the initial mount left phantom
    // tab stops inside aria-hidden the moment anyone signed in. Both reviewers caught it.
    for (const node of container.querySelectorAll<HTMLElement>('iframe, [tabindex]')) {
      node.setAttribute('tabindex', '-1')
    }
  }

  try {
    draw()
  } catch {
    return dead
  }
  // ⚠️ RENDERING IS NOT CONFIRMATION. GIS refuses an unregistered JavaScript origin by logging and
  // drawing NOTHING, without throwing — so an empty container is the real failure signal, and
  // reporting ok:true there would hide the button the visitor needs behind one that does not exist.
  if (!container.childElementCount) return dead

  return {
    ok: true,
    destroy: () => {
      disposed = true
      try { api.cancel?.() } catch { /* nothing open */ }
      container.replaceChildren()
    },
  }
}
