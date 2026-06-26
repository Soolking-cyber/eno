// First-touch acquisition attribution — so we can measure CAC per channel.
//
// A tiny FIRST-PARTY cookie (`eno_attr`) captured on the visitor's FIRST landing,
// readable by BOTH the client (to enrich GA events) and the server (to persist onto
// the Profile at signup, giving exact CAC-per-channel in our own DB). No third-party
// calls; a few synchronous cookie ops captured in a mount effect, so it never blocks
// first paint. First-touch is sticky (180d) so the channel that ORIGINALLY brought a
// visitor gets the credit even if they sign up days later from a direct visit.

export const ATTR_COOKIE = 'eno_attr'
const MAX_AGE_DAYS = 180

export type Attribution = {
  source: string // 'facebook' | 'google' | 'reddit' | 'direct' | utm_source…
  medium: string // 'social' | 'cpc' | 'organic' | 'referral' | 'none' | utm_medium…
  campaign?: string // utm_campaign
  referrer?: string // referring hostname on first landing
  landingAt?: string // ISO timestamp of first touch
}

// Map a referrer hostname to a coarse channel when there's no utm_source.
function channelFromReferrer(host: string): { source: string; medium: string } | null {
  const h = host.toLowerCase()
  if (!h) return null
  if (h.includes('facebook') || h === 'fb.com' || h.includes('fb.me') || h.includes('lm.facebook')) return { source: 'facebook', medium: 'social' }
  if (h.includes('instagram')) return { source: 'instagram', medium: 'social' }
  if (h.includes('t.co') || h.includes('twitter') || h === 'x.com') return { source: 'twitter', medium: 'social' }
  if (h.includes('t.me') || h.includes('telegram')) return { source: 'telegram', medium: 'social' }
  if (h.includes('reddit')) return { source: 'reddit', medium: 'social' }
  if (h.includes('youtube') || h.includes('youtu.be')) return { source: 'youtube', medium: 'social' }
  if (h.includes('tiktok')) return { source: 'tiktok', medium: 'social' }
  if (h.includes('zalo')) return { source: 'zalo', medium: 'social' }
  if (h.includes('google')) return { source: 'google', medium: 'organic' }
  if (h.includes('bing')) return { source: 'bing', medium: 'organic' }
  if (h.includes('duckduckgo')) return { source: 'duckduckgo', medium: 'organic' }
  return { source: host, medium: 'referral' }
}

function deriveFromLocation(): Attribution | null {
  if (typeof window === 'undefined') return null
  const p = new URLSearchParams(window.location.search)
  const utmSource = p.get('utm_source')?.trim().toLowerCase() || undefined
  const utmMedium = p.get('utm_medium')?.trim().toLowerCase() || undefined
  const utmCampaign = p.get('utm_campaign')?.trim() || undefined
  const gclid = p.get('gclid')
  const fbclid = p.get('fbclid')

  let refHost = ''
  try { refHost = document.referrer ? new URL(document.referrer).hostname : '' } catch { refHost = '' }
  // Ignore self-referrals (internal navigation shouldn't overwrite the real source).
  if (refHost && refHost === window.location.hostname) refHost = ''

  let source = utmSource
  let medium = utmMedium
  if (!source) {
    if (gclid) { source = 'google'; medium = medium || 'cpc' }
    else if (fbclid) { source = 'facebook'; medium = medium || 'paid-social' }
    else {
      const ch = channelFromReferrer(refHost)
      if (ch) { source = ch.source; medium = medium || ch.medium }
      else { source = 'direct'; medium = medium || 'none' }
    }
  }
  return {
    source: (source || 'direct').slice(0, 60),
    medium: (medium || 'none').slice(0, 60),
    campaign: utmCampaign?.slice(0, 100),
    referrer: refHost ? refHost.slice(0, 120) : undefined,
    landingAt: new Date().toISOString(),
  }
}

function readRawCookie(name: string, cookieStr: string): string | undefined {
  const m = cookieStr.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'))
  return m ? decodeURIComponent(m[1]) : undefined
}

// Compact wire form (short keys) so the cookie stays tiny.
function pack(a: Attribution): string {
  return JSON.stringify({ s: a.source, m: a.medium, c: a.campaign, r: a.referrer, t: a.landingAt })
}
function unpack(raw: string): Attribution | null {
  try {
    const o = JSON.parse(raw) as { s?: string; m?: string; c?: string; r?: string; t?: string }
    if (!o || !o.s) return null
    return { source: o.s, medium: o.m || 'none', campaign: o.c, referrer: o.r, landingAt: o.t }
  } catch { return null }
}

/** Client: capture FIRST-touch (only if none stored yet). Idempotent + cheap. */
export function captureFirstTouch(): void {
  if (typeof window === 'undefined') return
  try {
    if (readRawCookie(ATTR_COOKIE, document.cookie)) return // already have first-touch
    const attr = deriveFromLocation()
    if (!attr) return
    const maxAge = MAX_AGE_DAYS * 24 * 60 * 60
    document.cookie = `${ATTR_COOKIE}=${encodeURIComponent(pack(attr))}; path=/; max-age=${maxAge}; SameSite=Lax`
  } catch { /* cookies blocked / never break the page for analytics */ }
}

/** Client: read the stored first-touch (to enrich GA conversion events). */
export function getAttribution(): Attribution | null {
  if (typeof window === 'undefined') return null
  const raw = readRawCookie(ATTR_COOKIE, document.cookie)
  return raw ? unpack(raw) : null
}

/** Server: parse the first-touch cookie from a request's Cookie header. */
export function parseAttributionCookie(cookieHeader: string | null | undefined): Attribution | null {
  if (!cookieHeader) return null
  const raw = readRawCookie(ATTR_COOKIE, cookieHeader)
  return raw ? unpack(raw) : null
}
