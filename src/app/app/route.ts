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

/**
 * The reader's language: their chosen `lang` cookie, else the first supported Accept-Language tag
 * (any Chinese → zh-Hans), else English. All eleven, not just en/vi: this page runs before the app
 * shell and its translation layer exist, so its seven sentences are written out below for each.
 */
function pageLang(req: NextRequest): AppLang {
  // Own keys only — `in` would also accept "toString" / "constructor" off the prototype.
  const has = (k: string): k is AppLang => Object.prototype.hasOwnProperty.call(COPY, k)
  const cookie = req.cookies.get('lang')?.value
  if (cookie && has(cookie)) return cookie
  // Accept-Language by its q weights (highest first, listed order breaking ties); q=0 means "not this
  // one". Every Chinese tag maps to Simplified, the only Chinese the site has — closer than English.
  const ranked = (req.headers.get('accept-language') || '')
    .split(',')
    .map((part, i) => {
      const [rawTag, ...params] = part.split(';')
      // A q that is present but not a valid weight (0–1, ≤3 decimals: "bogus", "9") disqualifies the tag
      // rather than promoting it to the default 1.
      const qParam = params.find((p) => /^\s*q\s*=/i.test(p))
      const qVal = qParam?.split('=')[1]?.trim() ?? ''
      const q = qParam == null ? 1 : /^(0(\.\d{0,3})?|1(\.0{0,3})?)$/.test(qVal) ? Number(qVal) : 0
      return { tag: rawTag.trim().toLowerCase(), q, i }
    })
    .filter((x) => x.tag && Number.isFinite(x.q) && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
  for (const { tag } of ranked) {
    if (tag.startsWith('zh')) return 'zh-Hans'
    const primary = tag.split('-')[0]
    if (has(primary)) return primary
  }
  return 'en'
}

type AppCopy = { iosTitle: string; iosHeading: string; iosBody: string; open: string; soon: string; title: string; body: string }
type AppLang = 'en' | 'vi' | 'zh-Hans' | 'ko' | 'ja' | 'ru' | 'km' | 'ms' | 'th' | 'fr' | 'hi'
/** ⚠️ en and vi are the authored originals; the other nine are hand-written, not machine output. */
const COPY: Record<AppLang, AppCopy> = {
  en: { iosTitle: 'eno for iPhone', iosHeading: 'The eno iPhone app is coming soon.', iosBody: 'It is not on the App Store yet. Until then, eno works in Safari.', open: 'Open eno', soon: 'App Store — coming soon', title: 'Get the eno app', body: 'Open this page on your phone, or pick your store:' },
  vi: { iosTitle: 'eno cho iPhone', iosHeading: 'Ứng dụng eno cho iPhone sắp có.', iosBody: 'Hiện chưa có trên App Store. Trong lúc chờ, eno hoạt động tốt trên Safari.', open: 'Mở eno', soon: 'App Store — sắp có', title: 'Tải ứng dụng eno', body: 'Mở trang này trên điện thoại, hoặc chọn cửa hàng:' },
  'zh-Hans': { iosTitle: '适用于 iPhone 的 eno', iosHeading: 'eno iPhone 应用即将推出。', iosBody: '目前尚未在 App Store 上架。在此之前，可以在 Safari 中使用 eno。', open: '打开 eno', soon: 'App Store — 即将推出', title: '下载 eno 应用', body: '请在手机上打开此页面，或选择应用商店：' },
  ko: { iosTitle: 'iPhone용 eno', iosHeading: 'eno iPhone 앱이 곧 출시됩니다.', iosBody: '아직 App Store에는 없습니다. 그동안 Safari에서 eno를 이용하실 수 있습니다.', open: 'eno 열기', soon: 'App Store — 출시 예정', title: 'eno 앱 받기', body: '휴대폰에서 이 페이지를 열거나 스토어를 선택하세요:' },
  ja: { iosTitle: 'iPhone版 eno', iosHeading: 'eno の iPhone アプリはまもなく公開予定です。', iosBody: 'まだ App Store にはありません。それまでは Safari で eno をご利用いただけます。', open: 'eno を開く', soon: 'App Store — 近日公開', title: 'eno アプリを入手', body: 'スマートフォンでこのページを開くか、ストアを選んでください：' },
  ru: { iosTitle: 'eno для iPhone', iosHeading: 'Приложение eno для iPhone скоро появится.', iosBody: 'Его пока нет в App Store. А до тех пор eno работает в Safari.', open: 'Открыть eno', soon: 'App Store — скоро', title: 'Скачайте приложение eno', body: 'Откройте эту страницу на телефоне или выберите магазин:' },
  km: { iosTitle: 'eno សម្រាប់ iPhone', iosHeading: 'កម្មវិធី eno សម្រាប់ iPhone នឹងមកដល់ឆាប់ៗនេះ។', iosBody: 'វាមិនទាន់មាននៅលើ App Store នៅឡើយទេ។ ក្នុងពេលនេះ eno ដំណើរការនៅលើ Safari។', open: 'បើក eno', soon: 'App Store — ឆាប់ៗនេះ', title: 'ទាញយកកម្មវិធី eno', body: 'បើកទំព័រនេះនៅលើទូរស័ព្ទរបស់អ្នក ឬជ្រើសរើសហាង៖' },
  ms: { iosTitle: 'eno untuk iPhone', iosHeading: 'Aplikasi eno untuk iPhone akan tiba tidak lama lagi.', iosBody: 'Ia belum ada di App Store. Sementara itu, eno berfungsi dalam Safari.', open: 'Buka eno', soon: 'App Store — akan datang', title: 'Dapatkan aplikasi eno', body: 'Buka halaman ini pada telefon anda, atau pilih kedai anda:' },
  th: { iosTitle: 'eno สำหรับ iPhone', iosHeading: 'แอป eno สำหรับ iPhone กำลังจะมาเร็ว ๆ นี้', iosBody: 'ยังไม่มีใน App Store ระหว่างนี้ใช้งาน eno บน Safari ได้', open: 'เปิด eno', soon: 'App Store — เร็ว ๆ นี้', title: 'ดาวน์โหลดแอป eno', body: 'เปิดหน้านี้บนโทรศัพท์ของคุณ หรือเลือกสโตร์:' },
  fr: { iosTitle: 'eno pour iPhone', iosHeading: 'L’application eno pour iPhone arrive bientôt.', iosBody: 'Elle n’est pas encore sur l’App Store. En attendant, eno fonctionne dans Safari.', open: 'Ouvrir eno', soon: 'App Store — bientôt', title: 'Télécharger l’application eno', body: 'Ouvrez cette page sur votre téléphone ou choisissez votre boutique :' },
  hi: { iosTitle: 'iPhone के लिए eno', iosHeading: 'eno का iPhone ऐप जल्द आ रहा है।', iosBody: 'यह अभी App Store पर उपलब्ध नहीं है। तब तक, eno Safari में काम करता है।', open: 'eno खोलें', soon: 'App Store — जल्द आ रहा है', title: 'eno ऐप पाएं', body: 'इस पेज को अपने फ़ोन पर खोलें, या अपना स्टोर चुनें:' },
}

/** A minimal, dependency-free page — this runs before any app shell and must render on a cold tab. */
function page(lang: AppLang, title: string, body: string) {
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
  const lang = pageLang(req)
  const c = COPY[lang]

  if (ANDROID_UA.test(ua)) return sendTo(ANDROID_APP_URL)

  if (IOS_UA.test(ua)) {
    if (IOS_APP_URL) return sendTo(IOS_APP_URL)
    // Deliberately a page, not a redirect home: someone who just scanned a code expects an answer about
    // the app, and silently landing on the marketplace reads as a broken code.
    return page(
      lang,
      c.iosTitle,
      `<h1>${c.iosHeading}</h1>
<p>${c.iosBody}</p>
<div class="row"><a class="btn" href="/">${c.open}</a></div>`,
    )
  }

  // Desktop, iPadOS-in-desktop-mode, and anything else unrecognised.
  const ios = IOS_APP_URL
    ? `<a class="btn ghost" href="${IOS_APP_URL}">App Store</a>`
    : `<span class="btn ghost">${c.soon}</span>`
  return page(
    lang,
    c.title,
    `<h1>${c.title}</h1>
<p>${c.body}</p>
<div class="row"><a class="btn" href="${ANDROID_APP_URL}">Google Play</a>${ios}</div>`,
  )
}
