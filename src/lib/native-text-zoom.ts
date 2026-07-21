/**
 * Native text enlargement — the app's ONLY text-size accessibility path.
 *
 * ## Why this exists
 * The Capacitor WebView pins the viewport with `maximum-scale=1` on iOS (see
 * `src/components/marketplace/keyboard-viewport-sync.tsx`) so focusing a field never
 * auto-zooms the page. In mobile Safari that lock is benign — Safari ignores maximum-scale
 * for user pinch gestures — but a WKWebView has no such override, so inside the app pinch
 * zoom really is gone. Without a compensating mechanism the app would be the worst possible
 * quadrant: no pinch AND no Dynamic Type, i.e. text that CANNOT be enlarged at all. This
 * module is that compensating mechanism. The two are a pair — never remove one alone.
 *
 * ## Why text-zoom and NOT a root font-size scale (do not "improve" this later)
 * The tempting fix — scaling `html { font-size }` (or a `--font-scale` var feeding it) — is a
 * SHIP-BLOCKER here. Tailwind v4 derives ALL spacing from rem (`--spacing: 0.25rem`), so
 * scaling the root scales the LAYOUT, not just the text, while everything px-based stays put:
 * 1px borders, and this app's keyboard geometry vars (`--vvh` / `--vvt` / `--footer-h`, see
 * `use-virtual-keyboard`). Mixed units inside the same box = clipped rows and mid-word
 * truncation app-wide. That exact failure is what killed the hand-built native apps.
 *
 * `-webkit-text-size-adjust: <percentage>` is the correct tool: WebKit applies it as a
 * multiplier on TEXT ONLY and re-wraps, leaving every rem-derived box and the keyboard math
 * byte-identical.
 *
 * ## How it talks to the plugin
 * The native half comes from the official `@capacitor/text-zoom` plugin (declared in
 * package.json — it must be present for `npx cap sync ios` to install the pod). We call its
 * native `getPreferred()` over Capacitor's own bridge (`Capacitor.nativePromise`) instead of
 * importing the npm ESM wrapper, for two reasons:
 *   1. The web bundle must build whether or not the package has been installed yet — a static
 *      `import('@capacitor/text-zoom')` is a hard build-time module resolution, and this is a
 *      remote-server app whose JS is built and deployed independently of the native shells.
 *   2. On iOS the plugin's `set()` is NOT native anyway: `src/ios.ts` in the plugin is a JS
 *      shim that does exactly `document.body.style.webkitTextSizeAdjust = '<n>%'`. Only
 *      `getPreferred()` has a Swift implementation
 *      (`UIFont.preferredFont(forTextStyle: .body).pointSize / 17`). So the write below is the
 *      plugin's own iOS implementation, inlined — not a reimplementation of native behaviour.
 * `PluginHeaders` (published by the native bridge) gates the call: if the pod isn't installed,
 * `getPreferred` simply isn't listed and we no-op instead of firing a bridge message that
 * would never be answered.
 *
 * ## Cascade check (verified against the actual stylesheets, 2026-07-21)
 * Tailwind preflight emits `html { -webkit-text-size-adjust: 100% }` and `globals.css` adds
 * `html.native { -webkit-text-size-adjust: 100%; text-size-adjust: 100% }`. Both target
 * `html`. `text-size-adjust` is an INHERITED property, and an element's own declaration always
 * beats an inherited value — so the inline declaration we put on `<body>` wins for `<body>`
 * and every descendant, which is all rendered content. Nothing in the codebase declares
 * text-size-adjust on `body` or `*` (grepped). We write BOTH spellings inline because
 * `html.native` declares both, so whichever name WebKit honours, body's own value wins.
 *
 * ## Android
 * Deliberately NOT applied. Android WebView already tracks the OS font-size setting
 * (Settings › Display › Font size) on its own, and its mechanism (`WebSettings.setTextZoom`)
 * is likewise text-only. Pushing our clamped value there would fight the OS and would shrink
 * an accessibility user's chosen 2.0 scale down to our 1.5 ceiling — a regression, not a fix.
 */

type PluginHeader = {
  readonly name: string
  readonly methods: readonly { readonly name: string }[]
}
type CapacitorBridge = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  PluginHeaders?: readonly PluginHeader[]
  nativePromise?: <O, R>(pluginName: string, methodName: string, options?: O) => Promise<R>
}

const bridge = (): CapacitorBridge | undefined =>
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor

/** Clamp: an unclamped Dynamic Type value runs from ~0.82 (xSmall) past 3.1 (AX5). Below the
 *  floor the UI stops being readable at all; above the ceiling even text-only scaling starts
 *  to overflow fixed-height chrome (the bottom nav, the sticky buy box). 1.5 is the largest
 *  step the app's densest surfaces survive intact. */
const MIN_ZOOM = 0.85
const MAX_ZOOM = 1.5

/** A bridge call for a plugin that isn't installed natively is never answered, so it would
 *  hang forever. PluginHeaders already guards that; this is the belt-and-braces backstop so a
 *  caller that awaits us can never stall the native boot sequence. */
const BRIDGE_TIMEOUT_MS = 1500

function hasNativeMethod(cap: CapacitorBridge, plugin: string, method: string): boolean {
  return !!cap.PluginHeaders?.some(
    (h) => h.name === plugin && h.methods.some((m) => m.name === method),
  )
}

/** The OS's preferred text scale, or null when we must not touch anything (web, Android, no
 *  plugin, bad value). Never throws. */
async function readPreferred(): Promise<number | null> {
  const cap = bridge()
  if (!cap?.isNativePlatform?.()) return null
  if (cap.getPlatform?.() !== 'ios') return null // Android: see the header comment
  if (typeof cap.nativePromise !== 'function') return null
  if (!hasNativeMethod(cap, 'TextZoom', 'getPreferred')) return null
  try {
    const res = await Promise.race([
      cap.nativePromise<undefined, { value?: number } | null>('TextZoom', 'getPreferred'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), BRIDGE_TIMEOUT_MS)),
    ])
    const value = res?.value
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null // plugin missing / bridge error — leave the WebView's own text size alone
  }
}

function applyZoom(value: number): void {
  if (typeof document === 'undefined' || !document.body) return
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
  const pct = `${Math.round(clamped * 100)}%`
  const style = document.body.style
  // Idempotent: re-applying the same value on every resume would thrash style recalc.
  if (style.getPropertyValue('-webkit-text-size-adjust') === pct) return
  style.setProperty('-webkit-text-size-adjust', pct)
  style.setProperty('text-size-adjust', pct)
}

async function applyPreferred(): Promise<void> {
  const preferred = await readPreferred()
  if (preferred === null) return
  applyZoom(preferred)
}

/**
 * Read the OS text-size preference once at native boot and apply it to the WebView.
 * No-op off-native (web, PWA, Android) and whenever anything is missing — never throws, so it
 * is safe to call unguarded from the native bootstrap.
 */
export async function initTextZoom(): Promise<void> {
  await applyPreferred()
}

/**
 * Re-read and re-apply the OS text-size preference. Call on app resume: iOS Dynamic Type can
 * be changed in Settings while the app is backgrounded, and the inline style also has to be
 * re-stamped after any full document load (the WebView hops cross-origin to eno.forum and
 * back). Same no-op/never-throw contract as {@link initTextZoom}.
 */
export async function syncTextZoom(): Promise<void> {
  await applyPreferred()
}
