import { NextResponse, type NextRequest } from 'next/server'
import { ANDROID_APP_URL, IOS_APP_URL } from '@/lib/app-store-links'

/**
 * `/app` — ONE SHORT URL THAT SENDS EACH DEVICE TO ITS OWN STORE. The header's Download panel paints a
 * QR of this path (owner, 2026-09-16: "something like this qr and it redirects to relevant device store
 * to download"), so the phone that scans it never has to choose a store.
 *
 * ⚠️ THE QR ENCODES THIS URL, NOT A STORE URL, AND THAT IS THE WHOLE POINT. A QR of the Play link would
 * take an iPhone to a page it cannot install from; a QR of this path is read on the device that will do
 * the installing, so the User-Agent here is the honest signal. The encoded link also never changes when
 * a store URL does.
 *
 * ⛔ AN UNRECOGNISED AGENT GETS A CHOICE, NOT A GUESS. The first cut redirected everything that was not
 * an iPhone to Google Play — and iPadOS 13+ Safari sends a MACINTOSH user agent by default, so every
 * iPad scanning this code would have been shipped to the Play Store (astra, agy, independently). Desktop
 * browsers land here too. Both now get a page that names both stores and lets the human decide.
 *
 * ⛔ NO iOS LISTING YET → NO REDIRECT TO NOWHERE. Apple's id is assigned at submission; until
 * NEXT_PUBLIC_IOS_APP_URL is set the iOS answer is a page that says so (src/lib/app-store-links.ts).
 *
 * ⛔ AND NOTHING HERE IS SHARED-CACHEABLE — THE REDIRECTS INCLUDED. The response depends on the
 * User-Agent, so a shared cache holding one device's answer would serve it to the next device: an Android
 * visitor getting the iPhone page, or an iPhone getting a Play redirect (astra, twice — the second time
 * because the first fix put the header on the PAGES only and left both redirects bare). `Vary: User-Agent`
 * would technically do it; `private, no-store` is the honest version for a three-branch device switch, and
 * this route is one redirect, not a hot path.
 *
 * ⚠️ AND THE PAGES SPEAK THE READER'S LANGUAGE. The panel that sends people here is bilingual, so an
 * English-only "coming soon" would be the one screen in the flow that is not (astra). The `lang` cookie is
 * what language-context.tsx writes on every switch; Accept-Language is the fallback for a first visit.
 */
export const dynamic = 'force-dynamic'

const IOS_UA = /iPhone|iPad|iPod/i
const ANDROID_UA = /Android/i
/**
 * ⛔ noindex ON EVERY BRANCH. This is a 200 HTML page on a licensed domain whose install target renders
 * the services edition, and CLAUDE.md's leak class includes "indexes" (opus). A crawlable "Get the eno
 * app" page is a surface nobody approved — the owner approved a HEADER CONTROL. It is also pointless to
 * index: the page is a device switch, not content. Googlebot-smartphone's UA contains `Android`, so the
 * crawler takes the redirect branch; the header goes on that too.
 */
const NOINDEX = 'noindex, nofollow'
const NO_STORE = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'private, no-store',
  'x-robots-tag': NOINDEX,
}

/** vi when the reader has chosen it, or when their browser asks for it first. */
function isVi(req: NextRequest): boolean {
  const cookie = req.cookies.get('lang')?.value
  if (cookie) return cookie === 'vi'
  return /^\s*vi\b/i.test(req.headers.get('accept-language') || '')
}

/** A minimal, dependency-free page — this runs before any app shell and must render on a cold tab. */
function page(lang: 'en' | 'vi', title: string, body: string) {
  return new NextResponse(
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="${NOINDEX}"><title>${title}</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;
font:400 17px/1.55 system-ui,-apple-system,sans-serif;color:#0f172a;background:#f8fafc;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{margin:8px 0}a{color:#0e65bc;font-weight:700}
.row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:16px}
.btn{display:inline-block;padding:10px 18px;border-radius:12px;background:#0e65bc;color:#fff;text-decoration:none}
.btn.ghost{background:#e2e8f0;color:#0f172a}</style></head><body><div>${body}</div></body></html>`,
    { status: 200, headers: NO_STORE },
  )
}

/** A redirect that cannot be cached for the next device. */
function sendTo(url: string) {
  const res = NextResponse.redirect(url, 302)
  res.headers.set('cache-control', 'private, no-store')
  res.headers.set('x-robots-tag', NOINDEX)
  return res
}

export function GET(req: NextRequest) {
  const ua = req.headers.get('user-agent') || ''
  const vi = isVi(req)
  const lang = vi ? 'vi' : 'en'

  if (ANDROID_UA.test(ua)) return sendTo(ANDROID_APP_URL)

  if (IOS_UA.test(ua)) {
    if (IOS_APP_URL) return sendTo(IOS_APP_URL)
    // Deliberately a page, not a redirect home: someone who just scanned a code expects an answer about
    // the app, and silently landing on the marketplace reads as a broken code.
    return page(
      lang,
      vi ? 'eno cho iPhone' : 'eno for iPhone',
      vi
        ? `<h1>Ứng dụng eno cho iPhone sắp có.</h1>
<p>Hiện chưa có trên App Store. Trong lúc chờ, eno hoạt động tốt trên Safari.</p>
<div class="row"><a class="btn" href="/">Mở eno</a></div>`
        : `<h1>The eno iPhone app is coming soon.</h1>
<p>It is not on the App Store yet. Until then, eno works in Safari.</p>
<div class="row"><a class="btn" href="/">Open eno</a></div>`,
    )
  }

  // Desktop, iPadOS-in-desktop-mode, and anything else unrecognised.
  const ios = IOS_APP_URL
    ? `<a class="btn ghost" href="${IOS_APP_URL}">App Store</a>`
    : `<span class="btn ghost">${vi ? 'App Store — sắp có' : 'App Store — coming soon'}</span>`
  return page(
    lang,
    vi ? 'Tải ứng dụng eno' : 'Get the eno app',
    vi
      ? `<h1>Tải ứng dụng eno</h1>
<p>Mở trang này trên điện thoại, hoặc chọn cửa hàng:</p>
<div class="row"><a class="btn" href="${ANDROID_APP_URL}">Google Play</a>${ios}</div>`
      : `<h1>Get the eno app</h1>
<p>Open this page on your phone, or pick your store:</p>
<div class="row"><a class="btn" href="${ANDROID_APP_URL}">Google Play</a>${ios}</div>`,
  )
}
