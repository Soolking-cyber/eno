import 'server-only'
import qr from 'qrcode-generator'

/**
 * ANY PAYLOAD, RENDERED AS INLINE SVG.
 *
 * ⛔ EXTRACTED FROM affiliate-qr.ts WHEN THE VIETQR CHECKOUT NEEDED THE SAME THING. The alternative
 * was a second copy of the module-painting loop, the quiet zone and the crispEdges rule — and a QR
 * that is subtly wrong still SCANS, just to the wrong place, so two copies drifting is a failure
 * nobody notices until money has moved.
 *
 * ⚠️ INLINE SVG, NOT AN <img> OR A CHART SERVICE. The CSP has no external image host — and for the
 * payment code specifically, posting a seller's bank details to a third party to have a picture
 * drawn would defeat the reason the payload is built locally at all.
 *
 * ⚠️ SERVER-ONLY. The encoder is ~30KB and the payload is known at render time, so there is nothing
 * for the browser to compute.
 */

/** Error-correction level M: ~15% recovery, the usual choice when no logo is overlaid. */
const EC_LEVEL = 'M' as const

export function qrSvg(payload: string, opts: { size?: number; title?: string } = {}): string | null {
  const trimmed = payload.trim()
  if (!trimmed) return null

  // typeNumber 0 = "pick the smallest version that fits", so a longer payload produces a denser
  // code rather than throwing.
  const code = qr(0, EC_LEVEL)
  code.addData(trimmed)
  try {
    code.make()
  } catch {
    // Over capacity for even the largest version. Fail soft — the caller decides what to show.
    return null
  }

  const count = code.getModuleCount()
  // A 4-module quiet zone is required by the spec; scanners fail intermittently without it, which
  // reads as "our QR is flaky" rather than "our QR is wrong".
  const quiet = 4
  const total = count + quiet * 2
  const size = opts.size ?? 160

  let path = ''
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (code.isDark(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`
    }
  }

  // `shape-rendering: crispEdges` stops the browser antialiasing module edges into grey, which is
  // what makes a small on-screen QR scan slowly.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
    `width="${size}" height="${size}" role="img" shape-rendering="crispEdges" ` +
    `aria-label="${escapeAttr(opts.title ?? 'QR code')}">` +
    `<rect width="${total}" height="${total}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/>` +
    `</svg>`
  )
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
