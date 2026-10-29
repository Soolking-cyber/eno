/**
 * The guide's window keeps the apps' native bridge out (owner, 2026-10-29: "also ios android apps add the live concierge to
 * them too"). Dependency-free: [lang]/layout.tsx inlines the script below into every page's head.
 */

/** The attribute the host puts on the guide's window (concierge-host.tsx) — what the head script below recognises. */
export const CONCIERGE_FRAME_ATTR = 'data-concierge-window'

/**
 * The pre-paint half, for layout.tsx's inline head script. ⛔ THE GUIDE'S WINDOW HIDES `window.Capacitor` FROM ITSELF, for
 * good — the page sheet's rule (app-sheet.ts APP_SHEET_HEAD_JS), for the same reason: Android injects the bridge into EVERY
 * frame of the allowed origin, so the window would run the head script's native branch and mount NativeBootstrap a second
 * time (a second hardware-back listener, deep-link handler, push registration), and any plugin call it awaited would hang
 * (a sub-frame's calls are dropped — Capacitor's MessageHandler). Unlike the sheet it copies NO native class: the window is
 * no page of the app, and `native` there would show the splash. The microphone is the WebView's own permission
 * (WKUIDelegate / WebChromeClient), never the bridge's. Its own try block, before the native branch and any bundle.
 */
export const CONCIERGE_FRAME_HEAD_JS =
  "try{var cf=window.frameElement;if(cf&&cf.hasAttribute('" + CONCIERGE_FRAME_ATTR + "')){" +
  "try{Object.defineProperty(window,'Capacitor',{configurable:false,get:function(){return undefined},set:function(){}})}catch(e){}}}catch(e){}"

/**
 * Client: is this document the host's own window (concierge-host.tsx's iframe)? ⛔ IN THE APPS THE WINDOW RUNS THERE ONLY:
 * the host alone asks for the person's "yes" before it opens the window (client.ts askForHelp) and closes it when the answer
 * is taken back, the account changes or the app leaves the foreground — so a window reached any other way (a link straight
 * to /concierge) never starts there (commit review, rounds 1-4: each check repeated inside the window grew its own edge —
 * its sign-in still loading, an account switch — while the host already holds all of them).
 */
export function framedByHost(w: { frameElement?: { hasAttribute: (n: string) => boolean } | null } = window as never): boolean {
  try {
    return !!w.frameElement?.hasAttribute(CONCIERGE_FRAME_ATTR)
  } catch {
    return false // a frame of another origin: not the host's
  }
}
