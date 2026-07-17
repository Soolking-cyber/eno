'use client'

import React, { createContext, useContext, useState, useMemo, useEffect, useSyncExternalStore } from 'react'
import { detectContentLang } from '@/lib/detect-lang'

// djb2 hash of the UI string set → cache-busts the localStorage UI dictionary when
// copy changes. A function (not a top-level const over a static import) so the large
// UI_STRINGS dictionary can be loaded LAZILY — it's only needed when prefetching a
// third language's machine translations, never for the en/vi audience — keeping
// ~19KB out of first-load JS on every page.
function hashStrings(strings: string[]): string {
  let h = 5381
  const s = strings.join('')
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) | 0)
  return (h >>> 0).toString(36)
}

// English (default/source) + Vietnamese (home market) + the top inbound-tourist
// languages to Vietnam by 2025 arrivals (GSO): China→Simplified (single Chinese
// option, covers the #1 market; Taiwan/HK visitors are routed here too), then
// Korea, Japan, Russia, Cambodia, Malaysia, Thailand, France, with Hindi held
// for India (which otherwise skews English).
export type Language =
  | 'en' | 'vi' | 'zh-Hans' | 'ko' | 'ja' | 'ru' | 'km' | 'ms' | 'th' | 'fr' | 'hi'

export const LANGUAGES: { code: Language; label: string; native: string }[] = [
  { code: 'en', label: 'EN', native: 'English' },
  { code: 'vi', label: 'VI', native: 'Tiếng Việt' },
  { code: 'zh-Hans', label: 'ZH', native: '中文' },
  { code: 'ko', label: 'KO', native: '한국어' },
  { code: 'ja', label: 'JA', native: '日本語' },
  { code: 'ru', label: 'RU', native: 'Русский' },
  { code: 'km', label: 'KM', native: 'ភាសាខ្មែរ' },
  { code: 'ms', label: 'MS', native: 'Bahasa Melayu' },
  { code: 'th', label: 'TH', native: 'ไทย' },
  { code: 'fr', label: 'FR', native: 'Français' },
  { code: 'hi', label: 'HI', native: 'हिन्दी' },
]

// Curated glossary for short, ambiguous UI terms that machine translation gets
// wrong out of context (e.g. the bare verb "Post" → 後 "after", "Property" → ru
// "Свойства" object-attributes instead of real estate). Checked by tr() AND
// useTr()/<Tr> before the MT cache. Entries are PARTIAL — any language not listed
// falls through to machine translation. Values are native-marketplace-reviewed
// (2026-07-06 i18n audit, 3 language review panels): category tiles + top-nav
// terms — the highest-visibility strings, where a wrong sense is most jarring.
// The same values are seeded into the Translation DB (scripts/seed-glossary.mjs)
// so server-embedded paths agree; this client copy guarantees them even if a DB
// row is later re-translated. Keep the two in sync.
const TR_OVERRIDES: Record<string, Partial<Record<Language, string>>> = {
  Post: { 'zh-Hans': '发布', ko: '등록', ja: '投稿', ru: 'Разместить', fr: 'Publier' },
  // Saved-listings nav: marketplaces use "favorites", not generic "saved" (Avito
  // Избранное, Leboncoin Favoris, 闲鱼 收藏, Karrot 찜 목록, ジモティー お気に入り).
  Saved: { 'zh-Hans': '收藏', ko: '찜 목록', ja: 'お気に入り', ru: 'Избранное', km: 'បានរក្សាទុក', ms: 'Disimpan', th: 'บันทึกไว้', fr: 'Favoris', hi: 'सेव किए गए' },
  'Recently viewed': { 'zh-Hans': '最近浏览', ko: '최근 본 상품', ja: '閲覧履歴', ru: 'Вы недавно смотрели', km: 'បានមើលថ្មីៗនេះ', ms: 'Dilihat baru-baru ini', th: 'ดูล่าสุด', fr: 'Vus récemment', hi: 'हाल ही में देखे गए' },
  // ── Category tiles (DB Category.name → <Tr>) — bare words MT reliably mis-senses ──
  Vehicles: { 'zh-Hans': '交通工具', ko: '차량', ja: '乗り物', ru: 'Транспорт', km: 'យានយន្ត', ms: 'Kenderaan', th: 'ยานพาหนะ', fr: 'Véhicules', hi: 'वाहन' },
  Rentals: { 'zh-Hans': '租赁', ko: '렌탈·임대', ja: 'レンタル・賃貸', ru: 'Аренда', km: 'ជួល', ms: 'Sewaan', th: 'ให้เช่า', fr: 'Locations', hi: 'किराये पर' },
  // Real estate — NOT object attributes (the ru "Свойства" bug).
  Property: { 'zh-Hans': '房产', ko: '부동산', ja: '不動産', ru: 'Недвижимость', km: 'អចលនទ្រព្យ', ms: 'Hartanah', th: 'อสังหาริมทรัพย์', fr: 'Immobilier', hi: 'प्रॉपर्टी' },
  // Moving SALE — not relocation services.
  Moving: { 'zh-Hans': '搬家转让', ko: '이사 정리', ja: '引っ越しセール', ru: 'Распродажа при переезде', km: 'លក់ឥវ៉ាន់ផ្លាស់ផ្ទះ', ms: 'Jualan Pindah Rumah', th: 'ขายย้ายบ้าน', fr: 'Déménagement', hi: 'शिफ्टिंग सेल' },
  // Furniture & household goods — not a house.
  Home: { 'zh-Hans': '家居', ko: '가구·인테리어', ja: '家具・インテリア', ru: 'Для дома', km: 'គ្រឿងសង្ហារឹម', ms: 'Perabot & Barangan Rumah', th: 'ของใช้ในบ้าน', fr: 'Maison & Déco', hi: 'घरेलू सामान' },
  Electronics: { 'zh-Hans': '电子产品', ko: '디지털 기기', ja: '家電・スマホ・カメラ', ru: 'Электроника', km: 'គ្រឿងអេឡិចត្រូនិក', ms: 'Elektronik', th: 'อิเล็กทรอนิกส์', fr: 'Électronique', hi: 'इलेक्ट्रॉनिक्स' },
  Fashion: { 'zh-Hans': '服饰', ko: '패션', ja: 'ファッション', ru: 'Одежда и обувь', km: 'សម្លៀកបំពាក់', ms: 'Fesyen', th: 'แฟชั่น', fr: 'Mode', hi: 'फैशन' },
  // Children's GOODS — not "children".
  Kids: { 'zh-Hans': '母婴用品', ko: '유아동', ja: 'ベビー・キッズ', ru: 'Детские товары', km: 'សម្ភារៈកុមារ', ms: 'Bayi & Kanak-kanak', th: 'แม่และเด็ก', fr: 'Enfants & bébés', hi: 'बच्चों का सामान' },
  Hobbies: { 'zh-Hans': '兴趣爱好', ko: '취미', ja: '趣味', ru: 'Хобби и отдых', km: 'ចំណង់ចំណូលចិត្ត', ms: 'Hobi', th: 'กีฬาและงานอดิเรก', fr: 'Loisirs', hi: 'शौक' },
  Pets: { 'zh-Hans': '宠物', ko: '반려동물', ja: 'ペット', ru: 'Животные', km: 'សត្វចិញ្ចឹម', ms: 'Haiwan Peliharaan', th: 'สัตว์เลี้ยง', fr: 'Animaux', hi: 'पालतू जानवर' },
  Jobs: { 'zh-Hans': '招聘', ko: '구인구직', ja: '求人', ru: 'Работа', km: 'ការងារ', ms: 'Kerja Kosong', th: 'งาน', fr: 'Emploi', hi: 'नौकरियां' },
  Services: { 'zh-Hans': '生活服务', ko: '생활서비스', ja: 'サービス', ru: 'Услуги', km: 'សេវាកម្ម', ms: 'Perkhidmatan', th: 'บริการ', fr: 'Services', hi: 'सेवाएं' },
  Community: { 'zh-Hans': '社区', ko: '커뮤니티', ja: 'コミュニティ', ru: 'Сообщество', km: 'សហគមន៍', ms: 'Komuniti', th: 'ชุมชน', fr: 'Communauté', hi: 'समुदाय' },
  Travel: { 'zh-Hans': '旅游', ko: '여행', ja: '旅行', ru: 'Путешествия', km: 'ទេសចរណ៍', ms: 'Pelancongan', th: 'ท่องเที่ยว', fr: 'Voyages', hi: 'यात्रा' },
  Food: { 'zh-Hans': '美食', ko: '식품', ja: '食品', ru: 'Продукты', km: 'អាហារ', ms: 'Makanan & Minuman', th: 'อาหารและเครื่องดื่ม', fr: 'Alimentation', hi: 'खान-पान' },
  // Intent shortcut tiles.
  'Free & Giveaways': { 'zh-Hans': '免费赠送', ko: '무료나눔', ja: '無料・あげます', ru: 'Отдам даром', km: 'ចែកជូនឥតគិតថ្លៃ', ms: 'Barang Percuma', th: 'แจกฟรี', fr: 'À donner', hi: 'मुफ़्त सामान' },
  'Wanted / ISO': { 'zh-Hans': '求购', ko: '삽니다', ja: '買います', ru: 'Куплю', km: 'ចង់ទិញ', ms: 'Dicari', th: 'รับซื้อ', fr: 'Demandes', hi: 'ज़रूरत है' },
}

// Map a browser BCP-47 tag (navigator.language) to a supported Language, or null.
function matchLanguage(raw: string): Language | null {
  if (!raw) return null
  const lc = raw.toLowerCase()
  // All Chinese variants (Simplified, Traditional, Taiwan/HK/Macau) → Simplified,
  // the single supported Chinese option.
  if (lc.startsWith('zh')) return 'zh-Hans'
  const primary = lc.split('-')[0]
  const hit = LANGUAGES.find((l) => !l.code.startsWith('zh') && l.code === primary)
  return hit ? hit.code : null
}

// Mirror the active language into a cookie so the server can read it for SSR
// translation / <html lang> / hreflang (a later phase). Purely additive today.
function writeLangCookie(lang: Language) {
  if (typeof document === 'undefined') return
  document.cookie = `lang=${lang};path=/;max-age=31536000;samesite=lax`
}

// Pick the device language: walk the user's ordered preference list, first match
// wins; English if none of the supported languages appear.
function detectDeviceLanguage(): Language {
  if (typeof navigator === 'undefined') return 'en'
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const p of prefs) {
    const m = matchLanguage(p)
    if (m) return m
  }
  return 'en'
}

// True inside the Capacitor native shell (iOS/Android WebView). There, navigator.language can lag
// the real DEVICE language (WKWebView especially), so we confirm the locale via @capacitor/device.
function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return !!cap?.isNativePlatform?.()
}

interface LanguageContextProps {
  lang: Language
  setLang: (lang: Language) => void
  t: (key: string) => string
  // Inline UI-string helper: tr('English', 'Tiếng Việt?'). Returns the English
  // source for en, the hand-authored Vietnamese for vi (if given), and a cached
  // machine translation for every other language (and for vi when no hand
  // translation is supplied). Safe to call anywhere tr is in scope.
  tr: (en: string, vi?: string) => string
}

// Authored UI strings. en is the source of truth; vi is hand-authored.
// ko / ru / zh are machine-translated on demand from `en` (cached).
const EN: Record<string, string> = {
  'header.verified': 'Verified Classifieds',
  'header.browse': 'Browse',
  'header.listings': 'Listings',
  'header.postBtn': 'Post a listing',
  'header.toastTitle': 'Post a listing',
  'header.toastDesc': 'Your listing is live. We run automated checks on every post.',
  'hero.title': 'eno.vn — Your Trusted Vietnam Network.',
  'hero.desc': 'Search and list furniture sales, motorbike & room rentals, jobs, and services. Guaranteed real prices and real photos.',
  'hero.searchPlaceholder': 'Search motorbikes, apartments, sofa sales, visa help in Hanoi, HCM, Da Nang...',
  'hero.searchBtn': 'Search',
  'categories.title': 'Browse by Category',
  'categories.desc': 'Find verified listings across key categories',
  'categories.all': 'All Categories',
  'explorer.title': 'Listings',
  'explorer.allVietnam': 'All Vietnam',
  'explorer.hanoi': 'Hanoi',
  'explorer.hcm': 'Ho Chi Minh City',
  'explorer.danang': 'Da Nang',
  'explorer.searchPlaceholder': 'Search in this category...',
  'explorer.listingsCount': 'listings',
  'explorer.noListings': 'No listings found. Try adjusting your filters or search query.',
  'explorer.fabFilter': 'Filters',
  'filter.status': 'Status',
  'filter.all': 'All',
  'filter.verifiedOnly': 'Verified Only',
  'filter.city': 'City',
  'filter.condition': 'Condition',
  'filter.new': 'New',
  'filter.likeNew': 'Like New',
  'filter.good': 'Good',
  'filter.fair': 'Fair',
  'filter.na': 'N/A',
  'filter.sortBy': 'Sort By',
  'filter.newest': 'Newest First',
  'filter.priceAsc': 'Price: Low to High',
  'filter.priceDesc': 'Price: High to Low',
  'filter.apply': 'Apply Filters',
  'filter.reset': 'Reset',
  'card.featured': 'Featured',
  'card.verified': 'Verified',
  'card.calling': 'Calling...',
  'card.copyPhone': 'Copy Phone',
  'detail.close': 'Close',
  'detail.postedOn': 'Posted on',
  'detail.location': 'Location',
  'detail.condition': 'Condition',
  'detail.verificationStatus': 'Verification Status',
  'detail.verifiedListing': 'Verified Listing',
  'detail.verifiedListingDesc': 'Every seller has a public trust score, and buyers can report problems — so listings stay honest.',
  'detail.sellerInfo': 'Seller Info',
  'detail.verifiedSeller': 'Verified Seller',
  'detail.memberSince': 'Member since',
  'detail.responseRate': 'Response rate',
  'detail.responseTime': 'Response time',
  'detail.callSeller': 'Call Seller',
  'detail.msgWhatsAppZalo': 'WhatsApp / Zalo',
  'detail.copySuccess': 'Copied to clipboard!',
  'footer.about': 'About Us',
  'footer.terms': 'Terms of Use',
  'footer.contact': 'Contact',
  'footer.subtitle': '— Your Trusted Vietnam Network.',
  'footer.rights': 'All rights reserved.',
  'footer.builtWith': 'Built with',
  'footer.inSaigon': 'in Saigon',
}

const VI: Record<string, string> = {
  'header.verified': 'Chợ rao vặt xác thực',
  'header.browse': 'Danh mục',
  'header.listings': 'Tin đăng',
  'header.postBtn': 'Đăng tin',
  'header.toastTitle': 'Đăng tin mới',
  'header.toastDesc': 'Tin của bạn đã hiển thị. Chúng tôi tự động kiểm tra mọi tin đăng.',
  'hero.title': 'eno.vn — Mạng lưới kết nối tin cậy tại Việt Nam',
  'hero.desc': 'Tìm kiếm và đăng tin thanh lý đồ đạc, thuê phòng, xe máy, việc làm và dịch vụ. Cam kết giá thật, hình ảnh thật.',
  'hero.searchPlaceholder': 'Tìm xe máy, căn hộ, sofa thanh lý, visa ở Hà Nội, HCM, Đà Nẵng...',
  'hero.searchBtn': 'Tìm kiếm',
  'categories.title': 'Duyệt theo danh mục',
  'categories.desc': 'Tìm các tin đăng đã được xác thực theo từng danh mục',
  'categories.all': 'Tất cả danh mục',
  'explorer.title': 'Tin đăng',
  'explorer.allVietnam': 'Toàn quốc',
  'explorer.hanoi': 'Hà Nội',
  'explorer.hcm': 'TP HCM',
  'explorer.danang': 'Đà Nẵng',
  'explorer.searchPlaceholder': 'Tìm trong danh mục này...',
  'explorer.listingsCount': 'tin đăng',
  'explorer.noListings': 'Không tìm thấy tin đăng nào. Vui lòng điều chỉnh bộ lọc hoặc từ khóa tìm kiếm.',
  'explorer.fabFilter': 'Bộ lọc',
  'filter.status': 'Trạng thái',
  'filter.all': 'Tất cả',
  'filter.verifiedOnly': 'Chỉ tin xác thực',
  'filter.city': 'Thành phố',
  'filter.condition': 'Tình trạng',
  'filter.new': 'Mới',
  'filter.likeNew': 'Như mới',
  'filter.good': 'Tốt',
  'filter.fair': 'Chấp nhận được',
  'filter.na': 'Không áp dụng',
  'filter.sortBy': 'Sắp xếp',
  'filter.newest': 'Mới nhất',
  'filter.priceAsc': 'Giá: Thấp đến Cao',
  'filter.priceDesc': 'Giá: Cao đến Thấp',
  'filter.apply': 'Áp dụng bộ lọc',
  'filter.reset': 'Xóa bộ lọc',
  'card.featured': 'Nổi bật',
  'card.verified': 'Xác thực',
  'card.calling': 'Đang gọi...',
  'card.copyPhone': 'Sao chép số',
  'detail.close': 'Đóng',
  'detail.postedOn': 'Đăng ngày',
  'detail.location': 'Địa điểm',
  'detail.condition': 'Tình trạng',
  'detail.verificationStatus': 'Trạng thái kiểm duyệt',
  'detail.verifiedListing': 'Tin đăng đã xác thực',
  'detail.verifiedListingDesc': 'Mỗi người bán có điểm uy tín công khai, và người mua có thể báo cáo vấn đề — giúp tin đăng luôn trung thực.',
  'detail.sellerInfo': 'Thông tin người bán',
  'detail.verifiedSeller': 'Người bán đã xác thực',
  'detail.memberSince': 'Tham gia từ',
  'detail.responseRate': 'Tỷ lệ phản hồi',
  'detail.responseTime': 'Thời gian phản hồi',
  'detail.callSeller': 'Gọi điện',
  'detail.msgWhatsAppZalo': 'Nhắn tin Zalo/WhatsApp',
  'detail.copySuccess': 'Đã sao chép vào bộ nhớ tạm!',
  'footer.about': 'Về chúng tôi',
  'footer.terms': 'Điều khoản sử dụng',
  'footer.contact': 'Liên hệ',
  'footer.subtitle': '— Mạng lưới kết nối tin cậy tại Việt Nam',
  'footer.rights': 'Tất cả quyền được bảo lưu.',
  'footer.builtWith': 'Xây dựng bằng',
  'footer.inSaigon': 'tại Sài Gòn',
}

const STATIC: Partial<Record<Language, Record<string, string>>> = { en: EN, vi: VI }

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>('en')
  const [dicts, setDicts] = useState<Partial<Record<Language, Record<string, string>>>>(STATIC)

  useEffect(() => {
    // A saved preference always wins; otherwise fall back to the device language
    // (navigator.languages), then English.
    const stored = localStorage.getItem('lang') as Language
    if (stored && LANGUAGES.some((l) => l.code === stored)) {
      setLangState(stored)
      writeLangCookie(stored)
      return
    }
    const detected = detectDeviceLanguage()
    writeLangCookie(detected)
    if (detected !== 'en') setLangState(detected)
    // NATIVE apps: iOS WKWebView's navigator.language can report the app's locale, not the DEVICE
    // language — so confirm via @capacitor/device (the real OS locale) and apply it. The dynamic
    // import keeps the plugin out of the WEB bundle (isNativePlatform gates it). A saved preference
    // already returned above, so this only refines the auto-detected default. NOT persisted
    // (setLangState + cookie, no localStorage), so it keeps following the device on each launch —
    // exactly like the web navigator path.
    if (isNativePlatform()) {
      void (async () => {
        try {
          const { Device } = await import('@capacitor/device')
          const { value } = await Device.getLanguageTag()
          const dev = matchLanguage(value)
          if (dev) { writeLangCookie(dev); setLangState(dev) }
        } catch { /* plugin missing / not synced — the navigator fallback already applied */ }
      })()
    }
  }, [])

  // Persist the chosen language to the signed-in user's Profile so SERVER-sent messages
  // (e.g. moderation notifications, which the recipient can't supply a cookie for) reach
  // them in this language. Debounced so only the settled language is written (the mount
  // effect above may flip en→vi first). GUESTS ARE SKIPPED (no Supabase auth cookie):
  // firing anyway 401s, and although .catch() swallows the JS error the browser still
  // logs the failed request to console — Lighthouse flags that on every guest page load
  // (Best Practices 100→96), and each one burned a function invocation for nothing.
  useEffect(() => {
    if (typeof document === 'undefined' || !/(^|;\s*)sb-[^=]*-auth-token/.test(document.cookie)) return
    const id = setTimeout(() => {
      fetch('/api/profile/locale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: lang }) }).catch(() => {})
    }, 800)
    return () => clearTimeout(id)
  }, [lang])

  // Seed BOTH translation systems (t() dictionary + <Tr>/tr cache) from one map
  // of {englishSource: translation}, then repaint consumers.
  const seedFromMap = (target: Language, map: Record<string, string>) => {
    for (const [en, val] of Object.entries(map)) trCache.set(`${target} ${en}`, val)
    // vi has a hand-authored t() dictionary (STATIC.vi) — never overwrite it with
    // machine translations; only its <Tr> cache (above) gets warmed.
    if (target !== 'vi') {
      const dict: Record<string, string> = {}
      for (const k of Object.keys(EN)) dict[k] = map[EN[k]] ?? EN[k]
      setDicts((d) => ({ ...d, [target]: dict }))
    }
    emitTrChange() // repaint <Tr>/tr consumers now that the cache is warm
  }

  // Warm EVERY static UI string for the active language in ONE batch (then cache
  // to localStorage), so the in-language swap is instant — no per-string lazy
  // /api/translate cascade. Repeat visits seed synchronously from localStorage.
  useEffect(() => {
    if (lang === 'en') return // source language — nothing to translate
    // Vietnamese is hand-authored (the lazily-imported vi-overrides dict in tr()/useTr());
    // skip the machine-translation prefetch entirely. Any string not yet in the
    // overrides falls back to lazy per-string machine translation via tr()/useTr().
    if (lang === 'vi') return
    let cancelled = false
    // Lazy-load the big UI string list ONLY for a third language (en/vi already
    // returned above), so it never ships in the en/vi first-load bundle.
    import('@/generated/ui-strings').then(({ UI_STRINGS }) => {
      if (cancelled) return
      // Key the cache by a hash of the CURRENT string set, so adding/changing any
      // UI copy auto-invalidates stale caches (otherwise new strings stay English).
      // The version segment busts every client's cached UI dictionary when the
      // *translations* change (not the source) — g2: Azure→Google re-translate;
      // g3: 2026-07-06 purge of half-English dictionaries persisted while the prod
      // translate key was dead + the curated category glossary.
      const cacheKey = `ui-dict:g3:${hashStrings(UI_STRINGS)}:${lang}`
      const cached = typeof localStorage !== 'undefined' ? localStorage.getItem(cacheKey) : null
      if (cached) {
        try { seedFromMap(lang, JSON.parse(cached)); return } catch { /* refetch */ }
      }
      // Fetch the dictionary in chunks so a not-yet-warmed language (many cache
      // misses) stays under the endpoint's per-request billable cap; an already
      // cached language just resolves in a few cheap parallel hits.
      const CHUNK = 100
      const chunks: string[][] = []
      for (let i = 0; i < UI_STRINGS.length; i += CHUNK) chunks.push(UI_STRINGS.slice(i, i + CHUNK))
      Promise.all(
        chunks.map((texts) =>
          fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts, target: lang }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => (d && Array.isArray(d.translations) ? (d.translations as string[]) : null))
            .catch(() => null),
        ),
      ).then((results) => {
        if (cancelled) return
        const map: Record<string, string> = {}
        let anyFail = false
        results.forEach((translations, ci) => {
          if (!translations) anyFail = true
          chunks[ci].forEach((s, i) => { map[s] = translations ? (translations[i] ?? s) : s })
        })
        seedFromMap(lang, map)
        // Cache only a COMPLETE, actually-translated dictionary — never persist a
        // partial result. `anyFail` only catches HTTP-level chunk failures; a dead
        // provider 200s with per-string ENGLISH passthroughs, and the old "at least
        // one translated" guard froze half-English dictionaries into localStorage
        // for every visitor (2026-07-06 audit: 573/1051 ru strings were English).
        // Require ≥95% of strings to actually differ from source before persisting
        // (a few legit source-identical strings — brand names, "OK" — always exist).
        const translated = UI_STRINGS.reduce((n, s) => (map[s] !== s ? n + 1 : n), 0)
        if (!anyFail && translated >= UI_STRINGS.length * 0.95) {
          try { localStorage.setItem(cacheKey, JSON.stringify(map)) } catch { /* ignore */ }
        }
      })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  // Keep <html lang> in sync so screen readers use the right voice (WCAG 3.1.1).
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = (newLang: Language) => {
    setLangState(newLang)
    localStorage.setItem('lang', newLang)
    writeLangCookie(newLang)
  }

  const t = (key: string): string => dicts[lang]?.[key] ?? EN[key] ?? key

  // Inline UI-string translation (see interface). English source is the cache
  // key; results are shared with <Tr>/useTr via the same module cache.
  const tr = (en: string, vi?: string): string => {
    if (!en) return en
    if (lang === 'en') return en
    if (lang === 'vi') {
      if (vi != null) return vi
      const hv = viDict[en]
      if (hv != null) return hv
      if (!viLoaded) { void loadViOverrides(); return en } // dict inbound — emitTrChange repaints
    }
    const override = TR_OVERRIDES[en]?.[lang]
    if (override) return override
    const ck = `${lang} ${en}`
    const hit = trCache.get(ck)
    if (hit != null) return hit
    if (!trInflight.has(ck)) {
      trInflight.add(ck)
      // flush() calls emitTrChange() on resolve, which repaints subscribers.
      translateText(en, lang).finally(() => trInflight.delete(ck))
    }
    return en // optimistic source fallback until the translation lands
  }

  // t/tr read module-level caches at call time, so [lang, dicts] deps are enough —
  // async translation arrivals repaint via the external store, not new closures.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => ({ lang, setLang, t, tr }), [lang, dicts])

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  // Subscribe to the inline-translation cache so this consumer repaints when a
  // tr() batch resolves (called before the guard to satisfy rules-of-hooks).
  useSyncExternalStore(subscribeTr, getTrSnapshot, () => 0)
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used within a LanguageProvider')
  return context
}

/* ============================================================
   Dynamic content translation (listing titles, descriptions, …)
   English is the source language, so en is a no-op. Other targets
   hit /api/translate (DB-cached). Calls are batched per language.
   ============================================================ */

const trCache = new Map<string, string>() // `${lang} ${text}` -> translated
const trInflight = new Set<string>() // `${lang} ${text}` currently being fetched (de-dupes tr() calls)
const pending: Partial<Record<Language, { text: string; resolve: (s: string) => void }[]>> = {}
let scheduled = false

// External store: any useLanguage() consumer subscribes so it repaints the
// moment a batch of inline tr() translations lands in trCache. Reliable across
// the whole tree — unlike bumping provider state.
let trVersion = 0
const trListeners = new Set<() => void>()
// Hand-authored VI dictionary — lazily imported so its ~22 KB never ships in the
// first-load bundle of non-Vietnamese sessions (mirrors the UI_STRINGS lazy pattern).
// Sync readers (tr/useTr) see {} until the chunk lands, then emitTrChange repaints.
let viDict: Record<string, string> = {}
let viLoaded = false
let viLoading: Promise<void> | null = null
function loadViOverrides(): Promise<void> {
  if (viLoaded) return Promise.resolve()
  if (!viLoading) {
    viLoading = import('@/generated/vi-overrides').then((m) => {
      viDict = m.VI_OVERRIDES
      viLoaded = true
      emitTrChange()
    })
  }
  return viLoading
}

function emitTrChange() {
  trVersion++
  trListeners.forEach((l) => l())
}
function subscribeTr(cb: () => void) {
  trListeners.add(cb)
  return () => { trListeners.delete(cb) }
}
function getTrSnapshot() { return trVersion }

function flush() {
  scheduled = false
  for (const key of Object.keys(pending) as Language[]) {
    const items = pending[key]!
    delete pending[key]
    const texts = items.map((i) => i.text)
    fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, target: key }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(({ translations }) => {
        items.forEach((it, i) => {
          const value = translations?.[i] ?? it.text
          // Don't PIN an English passthrough: when the provider is down the API
          // 200s with the source text, and caching that froze English into the
          // session until a full reload (2026-07-06 audit). Resolve it (render
          // something now) but leave the cache empty so the next render retries.
          if (value !== it.text) trCache.set(`${key} ${it.text}`, value)
          it.resolve(value)
        })
        emitTrChange() // repaint every component reading trCache via tr()
      })
      .catch(() => items.forEach((it) => it.resolve(it.text)))
  }
}

function translateText(text: string, lang: Language): Promise<string> {
  return new Promise((resolve) => {
    (pending[lang] ||= []).push({ text, resolve })
    if (!scheduled) { scheduled = true; setTimeout(flush, 60) }
  })
}

/**
 * Translate an arbitrary string to the active language. Pass the best source:
 * for fields with a native Vietnamese variant, pass the vi field when lang==='vi'
 * (it will be echoed). English is returned unchanged (it is the source language).
 */
export function useTr(text: string | null | undefined): string {
  const { lang } = useLanguage()
  const safe = text ?? ''
  const cacheKey = `${lang} ${safe}`
  const [val, setVal] = useState<string>(() =>
    lang === 'en' || !safe
      ? safe
      : lang === 'vi' && viDict[safe] != null
      ? viDict[safe]
      // Curated glossary wins over the MT cache — same precedence as tr(). Without
      // this, <Tr>-rendered category tiles kept serving a stale WRONG cache row
      // (ru "Свойства" for Property) that the glossary couldn't override.
      : TR_OVERRIDES[safe]?.[lang] ?? trCache.get(cacheKey) ?? safe,
  )

  useEffect(() => {
    if (!safe || lang === 'en') { setVal(safe); return }
    // Hand-authored Vietnamese wins over machine translation.
    if (lang === 'vi' && !viLoaded) {
      // Dict inbound — wait for it before falling back to machine translation.
      let c = false
      loadViOverrides().then(() => {
        if (c) return
        const hv = viDict[safe]
        if (hv != null) setVal(hv)
        else translateText(safe, lang).then((t2) => { if (!c) setVal(t2) })
      })
      return () => { c = true }
    }
    if (lang === 'vi') { const hv = viDict[safe]; if (hv != null) { setVal(hv); return } }
    // Curated glossary before the MT cache (mirrors tr()).
    const override = TR_OVERRIDES[safe]?.[lang]
    if (override) { setVal(override); return }
    const ck = `${lang} ${safe}`
    const hit = trCache.get(ck)
    if (hit != null) { setVal(hit); return }
    let cancelled = false
    translateText(safe, lang).then((tr) => { if (!cancelled) setVal(tr) })
    return () => { cancelled = true }
  }, [safe, lang])

  return val
}

/** Renders a string translated to the active language (safe to use inside .map()).
 *  When the resolved text is in a DIFFERENT language than the page (e.g. an
 *  untranslated Vietnamese title on an English page), it's wrapped in
 *  `<span lang>` so assistive tech voices it correctly (WCAG 3.1.2). Detection only
 *  fires on unambiguous scripts / VI-exclusive letters, so chrome in the page
 *  language is never wrapped. */
export function Tr({ text }: { text?: string | null }) {
  const { lang } = useLanguage()
  const out = useTr(text)
  const cl = detectContentLang(out)
  return cl && cl !== lang ? <span lang={cl}>{out}</span> : <>{out}</>
}
