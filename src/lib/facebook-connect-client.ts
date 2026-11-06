import { FACEBOOK_DIALOG, facebookIosApp } from '@/lib/facebook-signin'

const DIALOG_PREFIX = `${FACEBOOK_DIALOG}?`

/**
 * Start Connect Facebook, or Import from Facebook (`forImport`), from the button the person pressed.
 *
 * A browser goes to /auth/facebook/connect/start, which redirects to Facebook. THE iOS APP (owner, 2026-11-06) can't: Facebook's dialog must not run in its
 * WebView, and the app lets only eno's own pages in. So it asks the same route for `{ to }` (`native=1`), which also sets the state cookie in the app's own
 * jar, and opens Facebook in the app's in-app browser sheet. Facebook returns there; the callback hands code and state back by `enovn://fb-connect`, and
 * native-bootstrap closes the sheet and finishes the callback in the WebView (native-auth.ts fbConnectPathFromDeepLink).
 *
 * Resolves 'failed' when nothing could start (the button says so), 'page' when this document is leaving, 'sheet' once Facebook is open in the app's
 * sheet. The buttons come back in every case: a person can close the sheet, or come back by Back. The sheet only opens Facebook's own dialog;
 * any other answer is an eno page (sign in, or Settings with a reason) and opens in place, on this origin only.
 */
export async function startFacebookConnect(forImport: boolean): Promise<'failed' | 'page' | 'sheet'> {
  const path = `/auth/facebook/connect/start${forImport ? '?for=import' : ''}`
  if (!facebookIosApp()) {
    window.location.assign(path)
    return 'page'
  }
  const res = await fetch(`${path}${forImport ? '&' : '?'}native=1`, { cache: 'no-store', credentials: 'same-origin' }).catch(() => null)
  const body = (res?.ok ? await res.json().catch(() => null) : null) as { to?: unknown } | null
  const to = typeof body?.to === 'string' ? body.to : null
  if (!to) return 'failed'
  if (to.startsWith(DIALOG_PREFIX)) {
    // The module load inside the try too: a chunk that fails to load must not leave the button spinning (commit gate, codex).
    try {
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url: to })
    } catch {
      return 'failed'
    }
    return 'sheet'
  }
  let here: URL
  try { here = new URL(to, window.location.origin) } catch { return 'failed' }
  if (here.origin !== window.location.origin) return 'failed'
  window.location.assign(here.pathname + here.search)
  return 'page'
}
