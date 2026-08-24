import 'server-only'
import qr from 'qrcode-generator'

/**
 * A QR code for a partner affiliate URL, rendered as INLINE SVG.
 *
 * ⛔ GENERATED FROM THE LINK, NEVER UPLOADED ALONGSIDE IT. A QR image stored next to the URL is a
 * second copy of the same fact, and the two drift the first time a link is re-issued — silently,
 * because a wrong QR still scans, just to the wrong place. Deriving it means the printed code and
 * the button can never disagree.
 *
 * ⚠️ INLINE SVG, NOT AN <img> OR A THIRD-PARTY CHART URL. The CSP has no external image host for a
 * QR service, `img-src` is pinned to our own Supabase origin, and a data: URI would still cost a
 * base64 round-trip. Inline paths also stay crisp at print size, which is the point of a QR.
 *
 * ⚠️ SERVER-ONLY. The encoder is ~30KB and the payload is a fixed URL known at render time, so
 * there is nothing for the browser to compute — shipping it to the client would be pure cost.
 */

/** Error-correction level M: ~15% recovery, the usual choice when a logo is not overlaid. */
const EC_LEVEL = 'M' as const

export function affiliateQrSvg(url: string, opts: { size?: number; title?: string } = {}): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  // typeNumber 0 = "pick the smallest version that fits", so a longer tracking URL simply produces
  // a denser code rather than throwing.
  const code = qr(0, EC_LEVEL)
  code.addData(trimmed)
  try {
    code.make()
  } catch {
    // Over capacity for even the largest version. Fail soft: the button still works, the page just
    // does not offer a QR — better than a 500 on a product page.
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
    `aria-label="${escapeAttr(opts.title ?? 'QR code linking to the partner booking page')}">` +
    `<rect width="${total}" height="${total}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/>` +
    `</svg>`
  )
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * The ONLY affiliate URLs allowed to reach an href or a QR.
 *
 * ⛔ https ONLY, AND THIS IS A SECURITY BOUNDARY, NOT TIDINESS. The value arrives from a database
 * column and is rendered straight into `<a href>`, so a stored `javascript:alert(1)` would be
 * stored XSS one click wide. `http:` is refused too: this link leads to a payment page, and
 * stripping transport security on the way there is exactly the hop an attacker wants.
 *
 * Returns null rather than throwing — a bad value should cost the booking button, not the page.
 */
export function safeAffiliateUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

