'use client'

import React, { createContext, useContext, useState, useEffect, useSyncExternalStore } from 'react'

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
// wrong out of context (e.g. the bare verb "Post" → 後 "after"). Checked by tr()
// before falling back to MT. Entries are PARTIAL — any language not listed for a
// term falls through to machine translation. Add native-verified terms here.
const TR_OVERRIDES: Record<string, Partial<Record<Language, string>>> = {
  Post: { 'zh-Hans': '发布', ko: '등록', ja: '投稿', ru: 'Разместить', fr: 'Publier' },
  Saved: { 'zh-Hans': '已保存', ko: '저장됨', ja: '保存済み', ru: 'Сохранённое', fr: 'Enregistrés' },
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
  'header.toastDesc': 'New listings are reviewed by an ENO agent before going live.',
  'hero.title': 'ENO — Your Trusted Vietnam Network.',
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
  'detail.verifiedListingDesc': 'This listing has been physically verified by an ENO agent. Photos, location, and price are 100% accurate.',
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
  'header.toastDesc': 'Tin đăng mới được kiểm duyệt thực tế bởi quản trị viên ENO trước khi hiển thị.',
  'hero.title': 'ENO — Mạng lưới kết nối tin cậy tại Việt Nam',
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
  'detail.verifiedListingDesc': 'Tin đăng này đã được xác thực thực tế bởi kiểm duyệt viên ENO. Hình ảnh, vị trí và giá cả chính xác 100%.',
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
      return
    }
    const detected = detectDeviceLanguage()
    if (detected !== 'en') setLangState(detected)
  }, [])

  // Lazily machine-translate the UI dictionary for ko/ru/zh from English.
  useEffect(() => {
    if (dicts[lang]) return
    const cacheKey = `ui-i18n:v2:${lang}`
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem(cacheKey) : null
    if (cached) {
      try { setDicts((d) => ({ ...d, [lang]: JSON.parse(cached) })); return } catch { /* refetch */ }
    }
    const keys = Object.keys(EN)
    fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: keys.map((k) => EN[k]), target: lang }),
    })
      .then((r) => r.json())
      .then(({ translations }) => {
        if (!Array.isArray(translations)) return
        const dict: Record<string, string> = {}
        keys.forEach((k, i) => { dict[k] = translations[i] ?? EN[k] })
        setDicts((d) => ({ ...d, [lang]: dict }))
        // Persist only a real translation, never an English passthrough (which
        // happens if the translation API is momentarily unconfigured).
        if (keys.some((k) => dict[k] !== EN[k])) {
          try { localStorage.setItem(cacheKey, JSON.stringify(dict)) } catch { /* ignore */ }
        }
      })
      .catch(() => { /* keep English fallback */ })
  }, [lang, dicts])

  // Keep <html lang> in sync so screen readers use the right voice (WCAG 3.1.1).
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = (newLang: Language) => {
    setLangState(newLang)
    localStorage.setItem('lang', newLang)
  }

  const t = (key: string): string => dicts[lang]?.[key] ?? EN[key] ?? key

  // Inline UI-string translation (see interface). English source is the cache
  // key; results are shared with <Tr>/useTr via the same module cache.
  const tr = (en: string, vi?: string): string => {
    if (!en) return en
    if (lang === 'en') return en
    if (lang === 'vi' && vi != null) return vi
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

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, tr }}>
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

const trCache = new Map<string, string>() // `${lang} ${text}` -> translated
const trInflight = new Set<string>() // `${lang} ${text}` currently being fetched (de-dupes tr() calls)
const pending: Partial<Record<Language, { text: string; resolve: (s: string) => void }[]>> = {}
let scheduled = false

// External store: any useLanguage() consumer subscribes so it repaints the
// moment a batch of inline tr() translations lands in trCache. Reliable across
// the whole tree — unlike bumping provider state.
let trVersion = 0
const trListeners = new Set<() => void>()
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
      .then((r) => r.json())
      .then(({ translations }) => {
        items.forEach((it, i) => {
          const value = translations?.[i] ?? it.text
          trCache.set(`${key} ${it.text}`, value)
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
  const cacheKey = `${lang} ${safe}`
  const [val, setVal] = useState<string>(() =>
    lang === 'en' || !safe ? safe : trCache.get(cacheKey) ?? safe,
  )

  useEffect(() => {
    if (!safe || lang === 'en') { setVal(safe); return }
    const ck = `${lang} ${safe}`
    const hit = trCache.get(ck)
    if (hit != null) { setVal(hit); return }
    let cancelled = false
    translateText(safe, lang).then((tr) => { if (!cancelled) setVal(tr) })
    return () => { cancelled = true }
  }, [safe, lang])

  return val
}

/** Renders a string translated to the active language (safe to use inside .map()). */
export function Tr({ text }: { text?: string | null }) {
  return <>{useTr(text)}</>
}
