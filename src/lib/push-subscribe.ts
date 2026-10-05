// ── Web Push on this browser: can it, may it, and the one subscribe call (UX2 W2 B2-NOTIFY) ─────────────
//
// Two surfaces subscribe a browser: the Settings row (reminder-settings.tsx) and the opt-in card
// (push-opt-in-card.tsx — the post-success screen and the inbox). The rules live here, as pure functions
// over a snapshot of the browser (PushEnv), so every branch is a table test rather than a stubbed window.
//
// ⚠️ WHAT THE SERVER ACTUALLY PUSHES is the copy's contract, not this file's — every sendPushToProfile
// caller: a listing's first-ever conversation (api/conversations), offers and counter-offers and their
// accept/decline (lib/messages.ts — plain chat messages deliberately do NOT push), the daily availability
// reminder, saved-search matches, price drops, dispute updates, moderation notices and verification
// results. Copy that promises "new messages" would be false.

import { isNativeShell } from './native-browser'
import { inAppHost, isIOS } from './in-app-browser'
import { NATIVE_UA_RE } from './consent-value'
import { logError } from './log'

export const PUSH_SW_URL = '/sw.js'
export const PUSH_SUBSCRIBE_URL = '/api/push/subscribe'

/** How long a subscribe waits for the service worker before giving up ('failed'). */
export const SW_READY_TIMEOUT_MS = 10_000

/** The VAPID public key this build was given (inlined at build time) — '' when push is not configured. */
export function vapidPublicKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
}

/** VAPID public key (base64url) → Uint8Array for pushManager.subscribe. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Was the existing subscription made with THIS key? A rotated key must be dropped before re-subscribing. */
export function sameApplicationServerKey(current: ArrayBuffer | null | undefined, wanted: Uint8Array): boolean {
  const cur = new Uint8Array(current || new ArrayBuffer(0))
  return cur.length === wanted.length && cur.every((b, i) => b === wanted[i])
}

export type PushPermission = 'default' | 'granted' | 'denied'

/** A snapshot of everything the push rules read off the browser. Built by readPushEnv(); tests build their own. */
export type PushEnv = {
  /** Inside the Capacitor shell — the house check (native-browser.ts isNativeShell). Native push is separate there. */
  capacitor: boolean
  /** The eno apps' own UA tokens (EnoNativeApp = the Capacitor shell, EnoNativeTabs = the iOS app's web tabs). */
  nativeUa: boolean
  /** Another app's built-in browser (Facebook, Zalo, TikTok…): no web push there, and no Add to Home Screen. */
  inAppBrowser: boolean
  serviceWorker: boolean
  pushManager: boolean
  notification: boolean
  vapidKey: string
  /** Notification.permission, or null where there is no Notification API. */
  permission: PushPermission | null
  /** Does this browser hold a push subscription right now? null = not checked / could not tell. */
  subscribed: boolean | null
  /** iPhone, iPod or iPad — including an iPad that asks for desktop pages (in-app-browser.ts isIOS). */
  ios: boolean
  /** [major, minor] of iOS read off the UA; null when the UA does not say. */
  iosVersion: readonly [number, number] | null
  /** Running as an installed home-screen web app. */
  standalone: boolean
}

/**
 * iOS's version from the UA: ` OS 17_5` on iPhone / iPad-mobile UAs (Safari, Chrome, Firefox alike), else the
 * Safari `Version/17.5` an iPad sends with its desktop (Macintosh) UA. ⚠️ ` OS (\d` never matches a Mac's
 * `Mac OS X 10_15_7` — there is an `X ` between.
 */
export function iosVersionFromUa(ua: string): readonly [number, number] | null {
  const m = / OS (\d+)_(\d+)/.exec(ua) ?? /Version\/(\d+)\.(\d+)/.exec(ua)
  return m ? [Number(m[1]), Number(m[2])] : null
}

/** Web push exists on iOS from 16.4, and only in a web app added to the Home Screen. An unknown version is allowed. */
export function iosSupportsWebPush(v: readonly [number, number] | null): boolean {
  return !v || v[0] > 16 || (v[0] === 16 && v[1] >= 4)
}

function normalisePermission(p: unknown): PushPermission | null {
  return p === 'granted' || p === 'denied' || p === 'default' ? p : null
}

/** The live browser, read once. SSR-safe (every probe guarded); call it from an effect or a handler. */
export function readPushEnv(): PushEnv {
  const w = typeof window === 'undefined' ? undefined : window
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const ua = nav?.userAgent || ''
  let permission: PushPermission | null = null
  try { if (typeof Notification !== 'undefined') permission = normalisePermission(Notification.permission) } catch { permission = null }
  let standalone = false
  try {
    standalone = (nav as (Navigator & { standalone?: boolean }) | undefined)?.standalone === true
      || !!w?.matchMedia?.('(display-mode: standalone)').matches
  } catch { standalone = false }
  let inAppBrowser = false
  try { inAppBrowser = inAppHost() !== null } catch { inAppBrowser = false }
  let capacitor = false
  try { capacitor = isNativeShell() } catch { capacitor = false }
  return {
    capacitor,
    nativeUa: NATIVE_UA_RE.test(ua),
    inAppBrowser,
    serviceWorker: !!nav && 'serviceWorker' in nav,
    pushManager: !!w && 'PushManager' in w,
    notification: !!w && 'Notification' in w,
    vapidKey: vapidPublicKey(),
    permission,
    subscribed: null,
    ios: isIOS(),
    iosVersion: iosVersionFromUa(ua),
    standalone,
  }
}

export type PushSupport = 'native' | 'unsupported' | PushPermission

/**
 * THE SETTINGS ROW'S RULE — exactly what reminder-settings.tsx computed inline before the extraction
 * (no behaviour change there): the Capacitor shell hides the row; no service worker, no PushManager or no
 * VAPID key reads "unsupported" (that copy already tells iPhone users to add eno to the Home Screen);
 * otherwise the browser's permission.
 */
export function pushSupport(env: PushEnv): PushSupport {
  if (env.capacitor) return 'native'
  if (!env.serviceWorker || !env.pushManager || !env.vapidKey) return 'unsupported'
  return env.permission === 'granted' ? 'granted' : env.permission === 'denied' ? 'denied' : 'default'
}

export type OptInState = 'hidden' | 'ask' | 'ios-install'

/**
 * THE OPT-IN CARD'S RULE. A card that asks must never be a dead button, so it is stricter than the row:
 *   · inside the eno apps (Capacitor or the iOS app's web tabs) — hidden: native push is its own thing;
 *   · inside another app's browser — hidden: no push there, and Add to Home Screen needs a real browser;
 *   · no VAPID key on this build — hidden;
 *   · iOS/iPadOS outside a Home Screen web app — 'ios-install' (the "Add to Home Screen" hint, no button),
 *     but only from iOS 16.4, where an installed web app can receive push at all;
 *   · no service worker / PushManager / Notification — hidden;
 *   · permission 'denied' — hidden; 'default' — 'ask';
 *   · permission 'granted' — hidden while this browser HOLDS a subscription. ⚠️ GRANTED WITHOUT ONE IS
 *     ASKED AGAIN: sign-out tears the subscription down (auth-context.tsx) and the browser keeps the
 *     permission, so the next sign-in on this device would otherwise get no pushes and no way back — the
 *     tap then re-subscribes with no browser prompt. Unknown (null) stays hidden.
 */
export function optInState(env: PushEnv): OptInState {
  if (env.capacitor || env.nativeUa) return 'hidden'
  if (env.inAppBrowser) return 'hidden'
  if (!env.vapidKey) return 'hidden'
  if (env.ios && !env.standalone) return iosSupportsWebPush(env.iosVersion) ? 'ios-install' : 'hidden'
  if (!env.serviceWorker || !env.pushManager || !env.notification) return 'hidden'
  if (env.permission === 'default') return 'ask'
  if (env.permission === 'granted' && env.subscribed === false) return 'ask'
  return 'hidden'
}

/** Does this browser hold a push subscription? null when it cannot tell (no service worker, or a probe threw). */
export async function hasPushSubscription(): Promise<boolean | null> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return false
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return false
    // ⚠️ A subscription made with a ROTATED VAPID key cannot receive our pushes: count it as none, so the card and
    // the Settings row offer the button, and subscribeToPush replaces it (gate, 2026-10-05).
    const key = vapidPublicKey()
    return !key || sameApplicationServerKey(sub.options?.applicationServerKey ?? null, urlBase64ToUint8Array(key))
  } catch {
    return null
  }
}

/**
 * 'granted'  subscribed, and the server stored it.
 * 'unsaved'  subscribed in the browser, but POST /api/push/subscribe did not answer OK (a 401, a 5xx).
 * 'denied' / 'default'  the browser prompt was refused / closed without an answer.
 * 'failed'   something threw (service worker refused, push service error, network).
 */
export type SubscribeOutcome = PushPermission | 'unsaved' | 'failed'

/**
 * THE ONE SUBSCRIBE CALL. Default order is the Settings row's original one: register /sw.js → wait for it →
 * ask permission → reuse a subscription made with this VAPID key (a rotated key is dropped first — subscribing
 * with a mismatched applicationServerKey throws) → POST it.
 *
 * `permissionFirst` asks BEFORE touching the service worker, so `requestPermission()` runs first inside the
 * tap's handler. Safari ties the prompt to the user's activation, and a first service-worker install can
 * outlast it; the card — which sends iPhone users through Add to Home Screen into exactly this call — passes
 * it, and so does the Settings row (since 2026-10-05: the old register-first order could lose the activation).
 *
 * ⚠️ A SUBSCRIPTION THE SERVER DID NOT CONFIRM ('unsaved', or a POST that threw) STAYS IN THE BROWSER — the
 * contract this row has always had. A "drop it again" option was built during review and deleted: each round
 * found a new way it removed a subscription someone else had stored (another tab's, an overlapping
 * subscribe() that returns the same subscription). What bounds the case instead: the card keeps itself up so
 * the tap can be retried (a retry reuses the subscription and POSTs it again), and sign-out tears the
 * subscription down (auth-context.tsx), after which the card asks again.
 */
export async function subscribeToPush(opts: { permissionFirst?: boolean; vapidKey?: string } = {}): Promise<SubscribeOutcome> {
  const vapid = opts.vapidKey ?? vapidPublicKey()
  const ask = async (): Promise<PushPermission> => {
    const p = await Notification.requestPermission()
    return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'default'
  }
  try {
    let perm: PushPermission | null = null
    if (opts.permissionFirst) {
      perm = await ask()
      if (perm !== 'granted') return perm
    }
    const reg = await navigator.serviceWorker.register(PUSH_SW_URL)
    // ⚠️ BOUNDED: `ready` never settles when /sw.js registers but fails to install (a precache fetch or a quota
    // error), which would leave the card's spinner and its disabled ✕ up for good (gate, 2026-10-05).
    await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('sw-ready-timeout')), SW_READY_TIMEOUT_MS))])
    if (perm === null) {
      perm = await ask()
      if (perm !== 'granted') return perm
    }
    const wanted = urlBase64ToUint8Array(vapid)
    let sub = await reg.pushManager.getSubscription()
    if (sub && !sameApplicationServerKey(sub.options.applicationServerKey, wanted)) {
      await sub.unsubscribe().catch((e) => logError(e, { op: 'push.unsubscribeRotatedKey' }))
      sub = null
    }
    sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted as BufferSource })
    const res = await fetch(PUSH_SUBSCRIBE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })
    return res.ok ? 'granted' : 'unsaved'
  } catch {
    return 'failed'
  }
}
