/**
 * Native photo capture for the post wizard (Capacitor Camera).
 *
 * ## Why this exists
 * The wizard gets its photos from a plain `<input type="file" accept="image/*" multiple>`.
 * That input reaches the GALLERY on both platforms, but it does NOT reach the CAMERA on
 * Android: Capacitor's `BridgeWebChromeClient.onShowFileChooser` only launches
 * `MediaStore.ACTION_IMAGE_CAPTURE` when `fileChooserParams.isCaptureEnabled()` — i.e. when the
 * input carries the `capture` attribute — and ours deliberately doesn't (adding it would make
 * the input capture-ONLY and kill multi-select). So on Android a seller literally cannot
 * photograph the thing they are selling. On iOS the WKWebView file sheet does offer "Take
 * Photo", but it sits two taps behind a generic picker. This module gives both platforms a
 * direct native camera; the gallery keeps using the file input, untouched.
 *
 * ## Why base64 over the bridge, and NOT `webPath` + `fetch`
 * The Capacitor docs' usual recipe is `fetch(photo.webPath)` → blob → File. That works because
 * in a normal Capacitor app the document origin IS the local server (`capacitor://localhost` /
 * `http://localhost`), so the fetch is same-origin. **This app runs in REMOTE-SERVER mode**
 * (`capacitor.config.ts` → `server.url = 'https://eno.vn'`), so the document origin is
 * `https://eno.vn` and `webPath` is a foreign origin:
 *   · Android — `WebViewLocalServer.java` sets NO `Access-Control-Allow-Origin` header at all
 *     (grepped), so a cross-origin fetch to `http://localhost/_capacitor_file_/…` is refused.
 *   · iOS — `WebViewAssetHandler.swift` only emits CORS headers on its "live reload" branch, and
 *     WKWebView is hostile to cross-scheme fetches into a custom scheme handler regardless.
 * `resultType: Base64` sidesteps all of it: the bytes come back inside the bridge message, so
 * there is no URL, no origin and no CORS. That is the only reliable shape here — and it is also
 * why the plugin's MULTI-select (`pickImages` / `chooseFromGallery`) is deliberately not used:
 * it can only hand back `webPath`s, which this app cannot read.
 *
 * The cost of base64 is size, so we bound it at the source: `width`/`height` cap the longest
 * edge (Capacitor's resize is aspect-FIT and downscale-only on both platforms — iOS
 * `UIImage.reformat(to:)`, Android `ImageUtils.resizePreservingAspectRatio`), and `quality` caps
 * the JPEG. A capture therefore crosses the bridge as a few hundred KB, not the 3–8MB a raw
 * 12MP frame would be.
 *
 * ## Contract with the wizard (do not drift)
 * The returned `File` is handed to `usePostMedia.addPhotos`, exactly like a file-input pick, so
 * it must satisfy the same gates:
 *   · `type` starts with `image/` — `addPhotos` filters on that;
 *   · `type` is one of the server's `IMG_ALLOWED` (`image/jpeg` | `image/png` | `image/webp`,
 *     src/lib/core/media.ts — server-only, mirrored here, keep in lockstep);
 *   · `size` ≤ `IMG_MAX_BYTES` (12MB, same file);
 *   · a real filename with an extension, because `compressImageFile` derives the output stem
 *     from it before re-encoding to 1600px WebP.
 * Everything downstream — the 6-photo cap, HEIC/downscale normalisation, batched upload, the
 * server allowlist — is untouched. This module only changes HOW the bytes are obtained.
 *
 * ## Off native
 * Every entry point no-ops (`unavailable`) so the web path is byte-identical. Nothing here is
 * imported statically: `@capacitor/camera` is only `import()`ed inside a native-gated branch,
 * the same discipline as src/components/native/native-bootstrap.tsx and
 * src/lib/native-text-zoom.ts.
 */

/** Mirrors the server's IMG_MAX_BYTES (src/lib/core/media.ts) — keep in lockstep. */
const IMG_MAX_BYTES = 12 * 1024 * 1024
/** Mirrors the server's IMG_ALLOWED (src/lib/core/media.ts) — keep in lockstep. Keyed by the
 *  plugin's `format` field, which reports 'jpeg' on iOS and may report 'jpg' on Android. */
const IMG_ALLOWED: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}
/** Longest edge asked of the plugin. Matches MAX_EDGE in src/lib/normalize-image.ts, which is
 *  itself matched to the server's stored output — so the wizard's own recompress is a no-op
 *  resize rather than a second, visible generation loss. */
const MAX_EDGE = 1600
/** JPEG quality asked of the plugin. The wizard re-encodes to WebP q82 anyway; 85 leaves enough
 *  headroom that the double encode isn't visible while keeping the bridge payload small. */
const CAPTURE_QUALITY = 85

type PluginHeader = {
  readonly name: string
  readonly methods: readonly { readonly name: string }[]
}
type CapacitorBridge = {
  isNativePlatform?: () => boolean
  PluginHeaders?: readonly PluginHeader[]
}

const bridge = (): CapacitorBridge | undefined =>
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor

/**
 * True only when we're on-device AND the Camera plugin's native half is actually installed in
 * this shell. The web bundle ships independently of the native shells (remote-server mode), so
 * an older installed app can be running today's JS: without the `PluginHeaders` probe we'd
 * render a camera button that fires a bridge message nothing answers — a dead button. Same
 * guard as src/lib/native-text-zoom.ts.
 */
export function nativePhotoCaptureAvailable(): boolean {
  const cap = bridge()
  if (!cap?.isNativePlatform?.()) return false
  return !!cap.PluginHeaders?.some(
    (h) => h.name === 'Camera' && h.methods.some((m) => m.name === 'getPhoto'),
  )
}

export type NativePhotoOutcome =
  /** A photo was captured and is ready to hand to `addPhotos`. */
  | { status: 'ok'; file: File }
  /** The seller backed out of the camera. Say nothing. */
  | { status: 'cancelled' }
  /** Camera access was refused. The caller should explain how to re-enable it. */
  | { status: 'denied' }
  /** Something genuinely broke — no camera hardware, unreadable frame, bridge error. */
  | { status: 'failed' }
  /** Not native, or the plugin isn't in this shell. The caller keeps its file input. */
  | { status: 'unavailable' }

/** Both platforms' legacy camera flow rejects with these exact English messages
 *  (iOS CameraPlugin.swift, Android LegacyCameraFlow.java), and Capacitor 8 additionally stamps
 *  an `OS-PLUG-CAMR-…` code on some rejections. Match on both, so a message-wording change on
 *  one platform can't silently turn "denied" into "failed". */
function classifyError(err: unknown): 'cancelled' | 'denied' | 'failed' {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const code =
    err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : ''
  const hay = `${code} ${message}`.toLowerCase()
  if (hay.includes('cancel')) return 'cancelled'
  // OS-PLUG-CAMR-0003 = camera denied, OS-PLUG-CAMR-0005 = gallery denied.
  if (hay.includes('denied') || hay.includes('camr-0003') || hay.includes('camr-0005')) return 'denied'
  return 'failed'
}

/** base64 → File without a data: URL round trip. `atob` is universally available in both
 *  WebViews; `fetch('data:…')` is not universally permitted inside a WKWebView, and this stays
 *  synchronous and allocation-predictable for the few hundred KB we actually receive. */
function base64ToFile(base64: string, mime: string, name: string): File {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], name, { type: mime })
}

/**
 * Open the device camera and return the frame as a `File` the wizard can ingest unchanged.
 *
 * Never throws: every failure comes back as an outcome so the caller can always say something
 * true to the seller (and the gallery tile beside it is always still there, so a refused
 * permission is never a dead end). `unavailable` off native.
 */
export async function captureNativePhoto(): Promise<NativePhotoOutcome> {
  if (!nativePhotoCaptureAvailable()) return { status: 'unavailable' }
  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
    // `getPhoto` is marked deprecated in v8 in favour of `takePhoto`, but `takePhoto` returns
    // only a `uri`/`webPath` plus a base64 THUMBNAIL — and a webPath is exactly what
    // remote-server mode cannot read (see the header). `getPhoto` is still implemented natively
    // on both platforms (CameraPlugin.swift / CameraPlugin.kt) and is the only API that returns
    // the full image as base64. Revisit only if a future major actually removes it.
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Base64,
      quality: CAPTURE_QUALITY,
      width: MAX_EDGE,
      height: MAX_EDGE,
      correctOrientation: true, // bake in the sensor orientation — EXIF is dropped downstream
      allowEditing: false,
      saveToGallery: false, // a listing photo is not a memory; don't litter the camera roll
    })
    const base64 = photo.base64String
    if (!base64) return { status: 'failed' }
    // iOS always encodes jpeg here; Android reports whatever it wrote. Anything outside the
    // server's allowlist is refused rather than guessed at — a mislabelled File would sail past
    // the client checks and then fail at /api/upload with no explanation.
    const mime = IMG_ALLOWED[(photo.format || 'jpeg').toLowerCase()]
    if (!mime) return { status: 'failed' }
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
    const file = base64ToFile(base64, mime, `photo-${Date.now()}.${ext}`)
    if (file.size === 0 || file.size > IMG_MAX_BYTES) return { status: 'failed' }
    return { status: 'ok', file }
  } catch (err) {
    return { status: classifyError(err) }
  }
}
