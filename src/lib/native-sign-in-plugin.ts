import { SIGN_IN_PLUGIN } from '@/lib/apple-signin'

/**
 * THE JS SIDE OF THE IN-REPO `EnoSignIn` CAPACITOR PLUGIN (ios/App/App/EnoSignInPlugin.swift, iOS build 3 of
 * 1.0.3 on — registered by MainViewController.capacitorDidLoad). Two methods, and these types ARE the contract
 * the Swift side implements:
 *
 *   signInWithApple({ nonce })   ASAuthorizationController, scopes .fullName + .email. `nonce` must be 64 hex
 *                                characters — the SHA-256 of the raw nonce /api/auth/apple/nonce keeps in an
 *                                HttpOnly cookie (GoTrue compares the token's claim with `%x` of sha256(raw)).
 *                                Resolves AppleCredential; rejects with code `canceled` (ASAuthorizationError
 *                                1001), `unavailable` (1000 — no Apple Account on the device), `busy` (a sheet is
 *                                already up) or `failed` (anything else).
 *   webAuth({ url, ephemeral })  ASWebAuthenticationSession for Google (D13: ephemeral — no "wants to use
 *                                sb.eno.vn" alert, a Google login each time). https only; callback scheme
 *                                `enovn`; resolves ONLY with an `enovn://auth-callback…` URL. Rejects with
 *                                `canceled` when the user closes the sheet, `busy`, or `failed`.
 *
 * ⛔ THE PROXY IS NEVER PASSED THROUGH A PROMISE, AND THAT IS NOT STYLE. registerPlugin() returns a Proxy that
 * answers EVERY property with a method wrapper — `then` included — so a Promise that resolves to it (an async
 * function returning it, `await import(…).then(() => registerPlugin(…))`) treats it as a thenable, calls
 * `proxy.then(resolve, reject)`, gets "EnoSignIn.then() is not implemented" as an unhandled rejection, and NEVER
 * settles. Measured against @capacitor/core 8.4.2 (scratch check, 2026-10-08). So the proxy lives in a module
 * variable and only its METHODS' promises (plain result objects) ever cross an await.
 * (src/lib/haptics.ts `enoHapticsProxy` caches exactly such a promise — reported, not changed here.)
 */
export type AppleCredential = {
  /** Apple's identity token (a JWT) — what /api/auth/apple/native hands to GoTrue's id_token grant. */
  identityToken: string
  /** Single-use, ~5 minutes: exchanged server-side for the refresh token kept for revocation (TN3194). */
  authorizationCode?: string | null
  /** Apple's stable user id for this team (the token's `sub`). */
  user?: string | null
  /** Present only on the FIRST authorization (and only if the user shares it — or a relay address). */
  email?: string | null
  givenName?: string | null
  familyName?: string | null
  /** PersonNameComponentsFormatter's rendering of the two above, in the device's locale order. */
  fullName?: string | null
}

export type WebAuthResult = { url: string }

export interface EnoSignInPlugin {
  signInWithApple(options: { nonce: string }): Promise<AppleCredential>
  webAuth(options: { url: string; ephemeral?: boolean }): Promise<WebAuthResult>
}

/** The plugin's rejection codes (Capacitor `call.reject(message, code)` → `error.code`). */
export type SignInPluginErrorCode = 'canceled' | 'unavailable' | 'busy' | 'failed'

type CapGlobal = { getPlatform?: () => string; isPluginAvailable?: (name: string) => boolean }
const capacitor = (): CapGlobal | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { Capacitor?: CapGlobal }).Capacitor

/** Client: this is the iOS app and its binary carries `EnoSignIn`. */
export function signInPluginAvailable(): boolean {
  const c = capacitor()
  if (c?.getPlatform?.() !== 'ios') return false
  try { return !!c.isPluginAvailable?.(SIGN_IN_PLUGIN) } catch { return false }
}

let proxy: EnoSignInPlugin | null = null

/** The plugin proxy, built once. Synchronous after the first import — see the ⛔ above for why. */
async function plugin(): Promise<{ p: EnoSignInPlugin }> {
  if (!proxy) {
    const { registerPlugin } = await import('@capacitor/core')
    proxy = registerPlugin<EnoSignInPlugin>(SIGN_IN_PLUGIN)
  }
  // Wrapped in an object on purpose: resolving the promise with the bare proxy is the thenable trap.
  return { p: proxy }
}

/** Run the native Apple sheet. Callers check `signInPluginAvailable()` first. */
export async function appleCredential(nonce: string): Promise<AppleCredential> {
  const { p } = await plugin()
  return p.signInWithApple({ nonce })
}

/** Run ASWebAuthenticationSession on `url`; resolves with the `enovn://auth-callback…` URL it captured. */
export async function webAuthSession(url: string, ephemeral = true): Promise<WebAuthResult> {
  const { p } = await plugin()
  return p.webAuth({ url, ephemeral })
}

/** The plugin's rejection code, or null for anything that is not one of ours. */
export function signInPluginErrorCode(e: unknown): SignInPluginErrorCode | null {
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined
  return code === 'canceled' || code === 'unavailable' || code === 'busy' || code === 'failed' ? code : null
}

/** Test seam: forget the cached proxy. */
export function __resetSignInPluginForTests(): void {
  proxy = null
}
