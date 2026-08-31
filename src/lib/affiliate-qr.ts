import 'server-only'
import { qrSvg } from './qr-svg'

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

export function affiliateQrSvg(url: string, opts: { size?: number; title?: string } = {}): string | null {
  // ⚠️ A THIN WRAPPER SINCE THE PAYMENTS WORK NEEDED THE SAME ENCODER. The QR-to-SVG logic moved to
  // `qr-svg.ts` unchanged; what stays here is the affiliate-specific default label. A second copy
  // of the module-painting loop would be two things to keep right, and a wrong QR still scans.
  return qrSvg(url, { size: opts.size, title: opts.title ?? 'QR code linking to the partner booking page' })
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

