'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Check, Lock, Sparkles, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { SerializedCategory } from '@/lib/types'
import { hasRealCoords } from '@/lib/geo'
import { CategoryIcon } from './category-icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FieldControl } from '@/components/ui/field'
import { RadioGroup, Radio } from '@/components/ui/radio-group'
import { haptic } from '@/lib/haptics'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { containsPhoneNumber } from '@/lib/phone'
import { containsContactInfo, findBannedWord, minPhotosFor, publicSafeName } from '@/lib/publish-guard'
import type { ClientPublishOutcome } from '@/lib/publish-funnel-codes'
import { trackPostListing } from '@/lib/analytics'
import { AreaFilter, findUnit, type Geo, type Nearby } from './area-filter'
import { subcategoriesFor, typesFor, askableFacetsFor, rangeFacetsFor, categoryHasBrand, isRequiredFacet, LISTING_TYPES } from '@/lib/taxonomy'
import { RangeSpecInput } from './range-spec-input'
import { usePostMedia } from '@/hooks/use-post-media'
import { PublishButton, Section, Field, Chips, Preview } from './post-wizard-parts'
import { MediaSection, PriceSection, LocationSection, ContactSection, PostSuccess } from './post-wizard-sections'

const TITLE_MAX = 140
const DESC_MAX = 5000

// Rentable items live in a sale category (Vehicles/Property) OR the dedicated Rentals
// category. Choosing "For rent" moves a sale item into Rentals (and back), mapping the
// subcategory across — so AI's default-to-sale classification is one tap from rental.
const RENTABLE_SALE_CATS = new Set(['vehicles', 'property'])
const SALE_TO_RENT: Record<string, Record<string, string>> = {
  vehicles: { motorbike: 'motorbike-rental', car: 'car-rental', bicycle: 'bicycle-rental', 'ebike-scooter': 'ebike-rental' },
  property: { apartment: 'apartment-rental', house: 'house-rental', 'room-shared': 'room-rental' },
}
const RENT_TO_SALE: Record<string, { category: string; sub: string }> = {
  'motorbike-rental': { category: 'vehicles', sub: 'motorbike' },
  'car-rental': { category: 'vehicles', sub: 'car' },
  'bicycle-rental': { category: 'vehicles', sub: 'bicycle' },
  'ebike-rental': { category: 'vehicles', sub: 'ebike-scooter' },
  'apartment-rental': { category: 'property', sub: 'apartment' },
  'house-rental': { category: 'property', sub: 'house' },
  'room-rental': { category: 'property', sub: 'room-shared' },
}

// Data to PREFILL the wizard for editing an existing listing (Manage listings → Edit).
// Same shape the wizard collects, so editing is literally "post again" with values set.
export type ListingEditData = {
  id: string
  title: string
  description: string
  price: number
  negotiable: boolean
  urgent: boolean
  categorySlug: string
  subcategorySlug: string | null
  listingType: string
  condition: string | null
  brand: string | null
  model: string | null
  attributes: Record<string, string>
  year: number | null
  mileageKm: number | null
  engineL: number | null
  engineCc: number | null
  district: string | null
  city: string | null
  lat: number | null
  lng: number | null
  images: string[]
  video: string | null
}

// Seed the range-facet state (keyed by facet key) from the listing's dedicated columns.
function initRangesFromEdit(edit?: ListingEditData): Record<string, number | null> {
  if (!edit) return {}
  const out: Record<string, number | null> = {}
  for (const f of rangeFacetsFor(edit.categorySlug, edit.subcategorySlug)) {
    const v = (edit as unknown as Record<string, unknown>)[f.range.column]
    if (typeof v === 'number') out[f.key] = v
  }
  return out
}

export function PostWizard({ categories, embedded = false, onPosted, edit }: { categories: SerializedCategory[]; embedded?: boolean; onPosted?: () => void; edit?: ListingEditData }) {
  const router = useRouter()
  const { user, loading: authLoading, openSignIn } = useAuth()
  const { lang, tr } = useLanguage()
  const t = (vi: string, en: string) => tr(en, vi)

  const [submitted, setSubmitted] = useState(false)
  // Success-screen context: link to the live listing + a distinct first-ever moment.
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [firstListing, setFirstListing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // Synchronous latch — `submitting` state only flips after the next render, so a
  // fast double-tap can fire submit() twice before disabled takes effect → two
  // listings + two social cross-posts. This ref blocks the second call immediately.
  const submittingRef = useRef(false)
  // AI assist (Gemini via Vertex — uses the GenAI credit). Gated by a public flag so
  // the ✨ buttons only appear once the server creds are set.
  const aiEnabled = process.env.NEXT_PUBLIC_AI_ASSIST === '1'
  const [aiBusy, setAiBusy] = useState<'photo' | 'desc' | null>(null)

  // ✨ Autofill category/subcategory/type/condition/title from the cover photo.
  const autofillFromPhoto = async () => {
    if (!user) { openSignIn(); return } // AI burns paid credits — members only
    const coverFile = photos[0]?.file
    if (!coverFile || aiBusy) return
    setAiBusy('photo')
    try {
      const fd = new FormData()
      fd.append('file', coverFile)
      fd.append('lang', lang)
      const res = await fetch('/api/ai/classify', { method: 'POST', body: fd })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (['decode_failed', 'no_file', 'empty_file', 'too_big'].includes(body.error)) {
          toast.error(t('Không đọc được ảnh này — thử ảnh JPG/PNG.', "Couldn't read that photo — try a JPG or PNG."))
          return
        }
        toast.error(aiErrMsg(body.error, res.status))
        return
      }
      const d = await res.json()
      if (d.unclear) {
        toast.error(t('Chưa thấy rõ sản phẩm — chụp cận cảnh chỉ riêng món đồ.', "Couldn't spot a clear product — take a close photo of just the item."))
        return
      }
      if (d.categorySlug) {
        setCategorySlug(d.categorySlug)
        setSubcategorySlug(d.subcategorySlug || '')
        setAttrs(d.attributes && typeof d.attributes === 'object' ? d.attributes : {})
        setRanges({})
        if (d.listingType) setListingType(d.listingType)
        if (d.condition) setCondition(d.condition)
        if (d.brand) setBrand(d.brand) // AI auto-selects the brand ONLY when confident
        if (d.model) setModel(d.model)
        if (d.title && !title.trim()) setTitle(d.title)
        // NOTE: intentionally do NOT auto-write the description. Sellers describe the
        // item in their OWN words (what actually matters — condition, quirks, why
        // selling), then optionally "Polish with AI" to tidy their own text.
        // Couldn't confirm the brand → ask for a clearer logo photo rather than
        // filling a wrong guess. Non-blocking; the rest is already filled.
        if (d.brandUncertain) {
          toast(t('Chưa chắc thương hiệu — thêm ảnh rõ logo/nhãn để nhận diện chính xác.', 'Not sure of the brand — add a clear photo of the logo/label so we can identify it.'))
        }
      } else {
        toast.error(t('Không nhận diện được — chọn danh mục thủ công', "Couldn't read the photo — pick a category"))
      }
    } catch {
      toast.error(t('Không thể dùng AI lúc này', 'AI is unavailable right now'))
    } finally {
      setAiBusy(null)
    }
  }

  // ✨ Polish the description into professional copy (keeps the facts, your language).
  const polishDescription = async () => {
    if (!user) { openSignIn(); return } // AI burns paid credits — members only
    if (description.trim().length < 3 || aiBusy) return
    setAiBusy('desc')
    try {
      const res = await fetch('/api/ai/rephrase', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: description, lang }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(aiErrMsg(body.error, res.status))
        return
      }
      const d = await res.json()
      if (d.text) setDescription(d.text)
    } catch {
      toast.error(t('Không thể dùng AI lúc này', 'AI is unavailable right now'))
    } finally {
      setAiBusy(null)
    }
  }
  // Specific AI failure messages — so "AI unavailable" no longer hides the real
  // cause (most often: not signed in on this device, or rate-limited).
  const aiErrMsg = (error?: string, status?: number) => {
    if (error === 'auth_required' || status === 401) return t('Đăng nhập để dùng AI', 'Sign in to use AI')
    if (error === 'rate_limited' || status === 429) return t('Bạn dùng AI hơi nhiều — thử lại sau ít phút', 'Too many AI requests — try again in a few minutes')
    return t('Không thể dùng AI lúc này', 'AI is unavailable right now')
  }
  const [error, setError] = useState('')
  const [categorySlug, setCategorySlug] = useState(edit?.categorySlug ?? '')
  const [subcategorySlug, setSubcategorySlug] = useState(edit?.subcategorySlug ?? '')
  const [listingType, setListingType] = useState(edit?.listingType ?? 'sell')
  const [attrs, setAttrs] = useState<Record<string, string>>(edit?.attributes ?? {})
  // Precise numeric specs (range facets: year/mileage/engine) → keyed by facet key.
  const [ranges, setRanges] = useState<Record<string, number | null>>(() => initRangesFromEdit(edit))
  const [title, setTitle] = useState(edit?.title ?? '')
  const [description, setDescription] = useState(edit?.description ?? '')
  const [price, setPrice] = useState(edit ? String(edit.price) : '')
  // Price is open to offers by default (haggling norm); the seller can switch to a
  // FIXED price so buyers just ask availability + buy (no offer messages).
  const [negotiable, setNegotiable] = useState(edit?.negotiable ?? true)
  // Urgent sale ("Bán gấp") — server-gated (7-day window, re-arm cooldown, 2/seller).
  const [urgent, setUrgent] = useState(edit?.urgent ?? false)
  const [condition, setCondition] = useState(edit?.condition ?? '')
  const [brand, setBrand] = useState(edit?.brand ?? '')
  const [model, setModel] = useState(edit?.model ?? '')
  const [brandOptions, setBrandOptions] = useState<string[]>([])
  const [areaOpen, setAreaOpen] = useState(false)
  const areaBtnRef = useRef<HTMLButtonElement>(null)
  const [province, setProvince] = useState<Geo | null>(edit?.city ? { code: '', name: edit.city, nameEn: edit.city } : null)
  const [ward, setWard] = useState<Geo | null>(edit?.district ? { code: '', name: edit.district, nameEn: edit.district } : null)
  // hasRealCoords, not `!= null`: a listing stored at (0,0) would otherwise reopen the
  // editor with its pin dropped in the Atlantic, and re-saving would persist that.
  const [nearby, setNearby] = useState<Nearby | null>(hasRealCoords(edit?.lat, edit?.lng) ? { lat: edit!.lat as number, lng: edit!.lng as number, radiusKm: 5 } : null)
  const [locating, setLocating] = useState(false)
  // Quick "use my current location": geolocate → reverse-geocode → set the precise pin
  // (lat/lng) + the province/ward for display + submit. No dropdown needed.
  const locReq = useRef(0) // generation guard: only the LATEST locate (or a manual pick) applies.
  const useMyLocation = () => {
    if (!('geolocation' in navigator)) { toast.error(t('Thiết bị không hỗ trợ định vị.', 'Location not available on this device.')); return }
    setLocating(true)
    const reqId = ++locReq.current
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude
        setNearby({ lat, lng, radiusKm: 5 }) // pin first — kept even if the address lookup fails
        try {
          const r = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}&lang=${lang}`)
          const d = r.ok ? await r.json().catch(() => ({})) : {}
          if (!d.province) return
          // Resolve the geocoder's display NAMES to REAL /api/geo codes so the picked province/ward
          // carry a truthy `code`. With `code:''` (the old behaviour) AreaFilter re-syncs to
          // `province?.code || HCMC` when reopened — an empty code falls back to Ho Chi Minh City and
          // "Apply" then silently OVERWRITES the geolocated area. Ward is matched from `wardCandidates`
          // (the precise top result often omits the official ward) against the 2025 ward list.
          const cands: string[] = Array.isArray(d.wardCandidates) && d.wardCandidates.length ? d.wardCandidates : (d.ward ? [d.ward] : [])
          const provs = await fetch('/api/geo?type=provinces').then((res) => res.json()).then((j) => j.provinces || []).catch(() => [])
          const p = findUnit(provs, d.province)
          let prov: Geo
          let ward: Geo | null
          if (p) {
            prov = { code: p.code, name: p.name, nameEn: p.nameEn }
            const wl = await fetch(`/api/geo?type=wards&province=${p.code}`).then((res) => res.json()).then((j) => j.wards || []).catch(() => [])
            let picked: Geo | null = null
            for (const c of cands) { const w = findUnit(wl, c); if (w) { picked = { code: w.code, name: w.name, nameEn: w.nameEn }; break } }
            // No dataset match (or the wards fetch failed) → keep the raw ward NAME rather than
            // dropping it, so the listing still records the precise ward for display + submit.
            ward = picked || (d.ward ? { code: '', name: d.ward, nameEn: d.ward } : null)
          } else {
            // Province name not in our dataset (rare, e.g. a non-standard geocoder label) — keep the
            // raw names as a display/submit fallback rather than dropping the result entirely.
            prov = { code: '', name: d.province, nameEn: d.province }
            ward = d.ward ? { code: '', name: d.ward, nameEn: d.ward } : null
          }
          // Apply only if still the latest request — a second locate OR a manual pick in the picker
          // (its onApply bumps locReq) supersedes these seconds-long awaits and must not be clobbered.
          if (reqId !== locReq.current) return
          setProvince(prov); setWard(ward)
        } catch {
          /* pin already set above; the address lookup failed — leave province/ward untouched */
        } finally {
          if (reqId === locReq.current) setLocating(false)
        }
      },
      () => {
        // Gen-guarded like the success path: an OLD locate's error must not clear the
        // spinner (or toast) over a NEWER locate that is still running.
        if (reqId !== locReq.current) return
        setLocating(false); toast.error(t('Không lấy được vị trí. Hãy cho phép truy cập vị trí và thử lại.', 'Could not get your location. Allow location access and try again.'))
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }
  // Photos + video — state, add/remove/reorder, blob-URL lifecycle, and the
  // submit-time upload + transcode-poll resolvers, all moved VERBATIM into
  // usePostMedia (src/hooks/use-post-media.ts). The wizard reads `photos` (cover
  // for AI autofill + preview, count for the publish checks) and calls the two
  // resolvers in submit(); everything else feeds <MediaSection> as one bundle.
  const media = usePostMedia({ edit, t })
  const { photos, uploadPhotos, resolveVideoUrl } = media
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [postingAs, setPostingAs] = useState<string | null>(null)
  const [meLoaded, setMeLoaded] = useState(false)

  // ── Draft autosave (new listings only; photos aren't persisted). Crash
  // insurance, not a drafts feature: restores only within a short window
  // (industry norm — protect against accidental close, don't resurrect stale
  // intent), and only when real typing happened. A category tap alone is not a
  // draft; anything older than the TTL is silently deleted. ──
  const DRAFT_TTL_MS = 15 * 60_000
  const draftHydrated = useRef(false)
  useEffect(() => {
    if (edit) { draftHydrated.current = true; return }
    try {
      const d = JSON.parse(localStorage.getItem('eno-listing-draft') || 'null')
      const meaningful = d && (d.title?.trim() || d.description?.trim() || d.price)
      const fresh = d && Date.now() - (d.savedAt || 0) < DRAFT_TTL_MS
      if (d && !(meaningful && fresh)) localStorage.removeItem('eno-listing-draft')
      if (d && meaningful && fresh) {
        if (d.categorySlug != null) setCategorySlug(d.categorySlug)
        if (d.subcategorySlug != null) setSubcategorySlug(d.subcategorySlug)
        if (d.listingType) setListingType(d.listingType)
        if (d.attrs) setAttrs(d.attrs)
        if (d.ranges) setRanges(d.ranges)
        if (d.title) setTitle(d.title)
        if (d.description) setDescription(d.description)
        if (d.price) setPrice(d.price)
        if (typeof d.negotiable === 'boolean') setNegotiable(d.negotiable)
        if (typeof d.urgent === 'boolean') setUrgent(d.urgent)
        if (d.condition) setCondition(d.condition)
        if (d.brand) setBrand(d.brand)
        if (d.model) setModel(d.model)
        if (d.province) setProvince(d.province)
        if (d.ward) setWard(d.ward)
        if (d.nearby) setNearby(d.nearby)
        toast.success(t('Đã khôi phục bản nháp — thêm lại ảnh nhé', 'Draft restored — re-add your photos'))
      }
    } catch {}
    draftHydrated.current = true
  }, [edit])
  useEffect(() => {
    if (edit || !draftHydrated.current) return
    try {
      // Only typed work is worth keeping — clicking around the form isn't.
      if (!title.trim() && !description.trim() && !price) {
        localStorage.removeItem('eno-listing-draft')
        return
      }
      localStorage.setItem('eno-listing-draft', JSON.stringify({ savedAt: Date.now(), categorySlug, subcategorySlug, listingType, attrs, ranges, title, description, price, negotiable, urgent, condition, brand, model, province, ward, nearby }))
    } catch {}
  }, [edit, categorySlug, subcategorySlug, listingType, attrs, ranges, title, description, price, negotiable, urgent, condition, brand, model, province, ward, nearby])

  // Contact name + phone come from the ACCOUNT (not re-typed per post — a number is
  // unique per account). If the account is missing either, we prompt them to add it
  // in Settings first and block publishing.
  useEffect(() => {
    // Wait for auth to settle — firing during authLoading meant a throwaway fetch
    // (once while loading, again when `user` resolved) racing the real one.
    if (authLoading) return
    const ctrl = new AbortController()
    fetch('/api/me', { signal: ctrl.signal }).then((r) => r.json()).then((d) => {
      const u = d.user
      if (u) {
        // publicSafeName masks an account name that IS contact info (an email typed into
        // the display-name field — /api/profile used to allow it because it only screened
        // for phone numbers). Seeding the raw value made the account unpublishable: the
        // publish gate rejected the name, but the error named the listing, which was clean.
        setContactName(publicSafeName(u.seller?.name || u.displayName || ''))
        setContactPhone(u.seller?.phone || u.phone || '')
        if (u.accountType === 'business') setPostingAs(u.businessName || u.seller?.name || null)
      }
      setMeLoaded(true)
    }).catch(() => { if (!ctrl.signal.aborted) setMeLoaded(true) })
    // re-runs when a guest signs in mid-wizard (draft-first posting) so the
    // account's name/phone land without a reload.
    return () => ctrl.abort()
  }, [user, authLoading])

  // Top brands for the datalist (suggestions only — free text creates new brands).
  // Fetched once when the user lands on a brand-relevant category.
  useEffect(() => {
    if (!categoryHasBrand(categorySlug) || brandOptions.length) return
    fetch('/api/brands?limit=120')
      .then((r) => r.json())
      .then((d) => setBrandOptions((d.brands || []).map((b: { name: string }) => b.name)))
      .catch(() => {})
  }, [categorySlug, brandOptions.length])

  // Market-price guidance for the price step — the same PriceStat band the PDP's
  // "Market price" module shows (n≥5 + spread suppression live server-side).
  // Debounced + stale-cancelled; best-effort: any miss/error just hides the box.
  const [priceBand, setPriceBand] = useState<{ n: number; p25: number; median: number; p75: number } | null>(null)
  const bandYear = ranges['year'] ?? null
  useEffect(() => {
    // rentals price per MONTH — the PriceStat bands are sale prices, so guidance
    // there would coach sellers against the wrong market. Skip entirely.
    if (!categoryHasBrand(categorySlug) || categorySlug === 'rentals' || brand.trim().length < 2 || !model.trim()) { setPriceBand(null); return }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({ brand: brand.trim(), model: model.trim() })
      if (condition) qs.set('condition', condition)
      if (bandYear != null) qs.set('year', String(bandYear))
      fetch(`/api/price-guidance?${qs}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setPriceBand(d && d.n >= 5 ? d : null))
        .catch(() => { if (!ctrl.signal.aborted) setPriceBand(null) })
    }, 400)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [categorySlug, brand, model, condition, bandYear])

  const cat = categories.find((c) => c.slug === categorySlug)
  const subOptions = subcategoriesFor(categorySlug)
  const typeOptions = typesFor(categorySlug)
  // askableFacetsFor, not facetsFor: a DERIVED facet (providerType) is computed from the
  // account server-side, so asking would be redundant — and lets a seller contradict their
  // own registration by ticking "Individual" on a business account. Browse still filters on it.
  const catFacets = askableFacetsFor(categorySlug, subcategorySlug)
  const hasCondition = catFacets.some((f) => f.key === 'condition')
  const attrFacets = catFacets.filter((f) => f.key !== 'condition')
  const showBrand = categoryHasBrand(categorySlug)

  // Sale-vs-rent quick switch for rentable items (Vehicles/Property ↔ Rentals). AI
  // defaults rentable items to a sale category; one tap flips the WHOLE category to
  // Rentals (mapping the subcategory), so "this is actually a rental" just works.
  const intent: 'sell' | 'rent' = categorySlug === 'rentals' ? 'rent' : 'sell'
  const showRentToggle = !edit && (categorySlug === 'rentals' || RENTABLE_SALE_CATS.has(categorySlug))
  const switchIntent = (to: 'sell' | 'rent') => {
    if (to === intent) return
    if (to === 'rent') {
      setSubcategorySlug(SALE_TO_RENT[categorySlug]?.[subcategorySlug] ?? '')
      setCategorySlug('rentals')
      setListingType('rent')
    } else {
      const map = RENT_TO_SALE[subcategorySlug]
      setCategorySlug(map?.category ?? 'property') // stays/homestays w/o a sale twin → Property
      setSubcategorySlug(map?.sub ?? '')
      setListingType('sell')
    }
    // Facets differ across sale ↔ rentals → reset attribute/range/condition state.
    setAttrs({}); setRanges({}); setCondition('')
  }

  const chooseCategory = (slug: string) => {
    setCategorySlug(slug)
    setSubcategorySlug('')
    setAttrs({})
    setRanges({})
    setCondition('')
    if (!categoryHasBrand(slug)) { setBrand(''); setModel('') }
    setListingType(typesFor(slug)[0] ?? 'sell')
  }

  const phoneOk = contactPhone.replace(/\D/g, '').length >= 9
  // Draft-first posting: anyone can fill the wizard; auth is asked at Publish
  // (and for the AI buttons, which burn paid credits).
  const isGuest = !authLoading && !user
  const district = ward?.name || province?.name || ''
  const areaLabel = ward ? `${ward.name}${province ? `, ${province.name}` : ''}` : province ? province.name : (nearby ? t('Vị trí của bạn', 'Your location') : '')
  const hasLocation = !!(province || ward || nearby)
  const minPhotos = minPhotosFor(categorySlug)
  // Display suffix beside the amount. The STORED unit is the server's business
  // (listingMoneyFor in @/lib/taxonomy); this is only its translated shorthand.
  // Currency is not a variable here — every listing is composed and stored in ₫.
  const priceUnit = listingType === 'rent' || listingType === 'job' ? t('/ tháng', '/ month') : listingType === 'service' ? t('/ dịch vụ', '/ service') : ''

  // Required-field checklist (drives the Publish button + the "what's left" hint).
  const checks = [
    // Services sell WORK, not an object, so one photo is the bar there (owner
    // 2026-07-21). minPhotosFor is the same function the server gate uses, so the
    // checklist can never promise a listing the API will then reject.
    // ⚠️ Both labels are LITERAL on purpose. scripts/gen-ui-strings.mjs harvests
    // `t('…','…')` literals to pre-warm the 9 machine-translated languages and cannot
    // read a template literal — writing `t(\`Add ${minPhotos} photos\`)` silently dropped
    // "Add 3 photos" from the batch and turned CI red. minPhotos is only ever
    // 1 or MIN_IMAGE_ANGLES (3), so two literal branches cover it exactly.
    { key: 'photo', ok: photos.length >= minPhotos, label: minPhotos === 1 ? t('Thêm 1 ảnh', 'Add 1 photo') : t('Thêm 3 ảnh', 'Add 3 photos') },
    { key: 'category', ok: !!categorySlug, label: t('Chọn danh mục', 'Pick a category') },
    { key: 'title', ok: title.trim().length >= 3, label: t('Nhập tiêu đề', 'Add a title') },
    // Details are REQUIRED (user decision 2026-07-14): listings without a real
    // description or specifics read as low-effort/scammy and stall in chat with
    // "is it new? what year?" — make sellers answer once, up front.
    { key: 'description', ok: description.trim().length >= 20, label: t('Viết mô tả (ít nhất 20 ký tự)', 'Write a description (at least 20 characters)') },
    ...(hasCondition ? [{ key: 'condition', ok: !!condition, label: t('Chọn tình trạng', 'Pick the condition') }] : []),
    // isRequiredFacet (taxonomy) is the ONE definition of "this chip blocks publish":
    // range facets never did, and a facet the taxonomy declares `optional` opts out —
    // that is how services/visa-legal can carry e-visa product chips without stopping an
    // ordinary work-permit or tax listing from publishing. Same predicate below in the
    // red-flagging and on the field itself, so the checklist and the errors agree.
    ...(attrFacets.some(isRequiredFacet)
      ? [{ key: 'details', ok: attrFacets.filter(isRequiredFacet).every((f) => !!attrs[f.key]), label: t('Điền thông số', 'Fill in the specifics') }]
      : []),
    { key: 'price', ok: price.trim().length > 0, label: t('Nhập giá', 'Set a price') },
    { key: 'location', ok: hasLocation, label: t('Chọn khu vực', 'Set the area') },
    // Guests (draft-first posting): contact comes from the account AFTER the
    // sign-in that submit() triggers — don't block the button on it here.
    isGuest
      ? { key: 'signin', ok: true, label: t('Đăng nhập để đăng tin', 'Sign in to publish') }
      : { key: 'contact', ok: contactName.trim().length >= 2 && phoneOk, label: t('Thêm tên & SĐT của bạn', 'Add your name & phone') },
  ]
  const missing = checks.filter((c) => !c.ok)
  const canSubmit = missing.length === 0 && !submitting

  // On-blur inline validation for the high-traffic fields — errors surface as the
  // user leaves a field, not only on submit (says what's wrong + how to fix).
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const touch = (k: string) => setTouched((p) => (p[k] ? p : { ...p, [k]: true }))
  // "Attempted": the user pressed Publish while something was missing → flag EVERY
  // unfilled required field in red at once so they can be spotted at a glance
  // (GOV.UK/Nielsen: don't disable submit — validate on submit + highlight). Per-
  // field flags clear the instant a field is filled, so the red recedes as they go.
  const [attempted, setAttempted] = useState(false)
  const err = {
    photo: attempted && photos.length < 3,
    category: attempted && !categorySlug,
    title: (touched.title || attempted) && title.trim().length < 3,
    // The 20-char minimum BLOCKS publish (see `checks`) but used to render no message at
    // all — the seller was bounced by a rule the form never stated.
    description: (touched.description || attempted) && description.trim().length < 20,
    price: (touched.price || attempted) && price.trim().length === 0,
    // Condition + specifics BLOCK publish (see `checks`) — flag them red on a failed
    // attempt like every other required field, not silently.
    condition: attempted && hasCondition && !condition,
    details: attempted && attrFacets.some((f) => isRequiredFacet(f) && !attrs[f.key]),
    location: attempted && !hasLocation,
    // Name and phone are TWO fields. One shared `contact` flag lit both of them red when
    // only one was wrong — and pointed the screen reader at the wrong one.
    contactName: attempted && !isGuest && contactName.trim().length < 2,
    contactPhone: attempted && !isGuest && !phoneOk,
  }
  const titleErr = err.title
    ? (title.trim().length === 0 ? t('Hãy nhập tiêu đề', 'Add a title') : t('Tiêu đề cần tối thiểu 3 ký tự', 'Title needs at least 3 characters'))
    : undefined
  const descErr = err.description
    ? (description.trim().length === 0 ? t('Hãy viết mô tả — ít nhất 20 ký tự', 'Add a description — at least 20 characters') : t('Mô tả cần tối thiểu 20 ký tự', 'Description needs at least 20 characters'))
    : undefined
  const priceErr = err.price ? t('Hãy nhập giá', 'Set a price') : undefined
  // Jump to (and focus) the first still-missing field when a publish attempt fails.
  const scrollToMissing = () => {
    const first = missing[0]
    if (!first) return
    const el = document.getElementById(`pw-${first.key}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus({ preventScroll: true })
  }

  // ⚠️ EVERY EARLY RETURN BELOW IS A PUBLISH THAT NEVER REACHES THE SERVER, so /api/listings'
  // own counter cannot see it and the funnel would read "0 refused" no matter how many sellers
  // gave up here. Fire-and-forget, never awaited, errors swallowed: counting an abandonment must
  // not be able to delay or break the publish it is counting.
  const countAttempt = (outcome: ClientPublishOutcome) => {
    // ⚠️ NEW LISTINGS ONLY. This same submit() also serves the EDIT flow — it PATCHes
    // /api/listings/<id> when `edit` is set — and that asymmetry would have quietly corrupted
    // every number on the funnel page: an edit bounced by client validation would file a REFUSAL,
    // while an edit that succeeds is a PATCH that /api/listings' POST wrapper never sees, so it
    // could never file the matching success. Edits would have contributed only failures, dragging
    // the success rate down by an amount nobody could account for. Two reviewers found this
    // independently, which is a fair signal it was not obvious.
    if (edit) return
    try {
      void fetch('/api/listings/publish-attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
        // keepalive so the count survives a navigation started moments later. ⚠️ openSignIn()
        // itself only opens a DIALOG — a reviewer was right that the old comment overstated this —
        // but choosing Google inside that dialog IS a full-page redirect, which is exactly the
        // branch client_signin_required marks.
        keepalive: true,
      }).catch(() => {})
    } catch { /* a counter must never break a publish */ }
  }

  const submit = async () => {
    if (submittingRef.current || submitting) return
    // Missing required fields → don't silently no-op: flag them all in red and jump
    // to the first so the user sees exactly what's left.
    if (missing.length > 0) {
      // ⚠️ DO NOT COUNT THE /api/me LOADING RACE. Right after in-dialog sign-in `isGuest` flips
      // false, which swaps the checklist's `signin` row for a `contact` row — but contactName and
      // contactPhone are still '' until the /api/me effect lands. A tap in that window is a real
      // bounce, yet it is OUR round trip, not a seller who forgot something, and counting it would
      // inflate client_missing_fields at exactly the moment we most want the sign-in numbers to be
      // trustworthy. Only the narrow case is excluded: contact is the SOLE missing item and the
      // profile has not arrived.
      //
      // ⚠️ THE CHECK ITSELF IS DELIBERATELY LEFT ALONE. Gating `ok` on meLoaded would let submit()
      // proceed with an empty phone and be rejected by the server for invalid_input — a round trip
      // and a worse message, in exchange for nothing. Blocking here is correct; only the counting
      // was wrong. (The pre-existing wart that the scroll lands on a still-shimmering Contact
      // section with no error text is untouched by this diff and worth fixing separately.)
      const contactStillLoading = !meLoaded && missing.length === 1 && missing[0].key === 'contact'
      if (!contactStillLoading) countAttempt('client_missing_fields')
      setAttempted(true); scrollToMissing(); return
    }
    // Catch fixable issues client-side so they're noted BEFORE submitting (the server
    // enforces the same rules). Contact info / addresses stay off the public listing —
    // buyers reach sellers in-app.
    // Screen the contact NAME on its own and FIRST. It was previously concatenated into
    // one blob with the title and description, so an email in the account's name produced
    // "remove it from your listing" on a listing that was already clean — an unfixable
    // dead end, because the name isn't editable from this screen.
    if (containsPhoneNumber(contactName) || containsContactInfo(contactName)) {
      countAttempt('client_contact_in_name')
      setError(t('Tên liên hệ của bạn không được là email hay số điện thoại. Hãy đổi tên hiển thị trong Cài đặt rồi đăng lại.', "Your contact name can't be an email address or phone number. Change your display name in Settings, then post again."))
      return
    }
    const listingText = `${title} ${description}`
    if (containsPhoneNumber(title) || containsPhoneNumber(description) || containsContactInfo(listingText)) {
      countAttempt('client_contact_in_text')
      setError(t('Không ghi số điện thoại, email, link hay địa chỉ nhà trong tin — người mua sẽ nhắn tin cho bạn trong ứng dụng. Hãy bỏ ra để đăng.', "Don't put a phone number, email, link or street address in your listing — buyers message you in the app. Remove it to post."))
      return
    }
    const blob = `${title} ${description} ${contactName}`
    if (findBannedWord(blob)) {
      countAttempt('client_banned_words')
      setError(t('Tin của bạn có từ ngữ không được phép. Vui lòng chỉnh sửa rồi đăng lại.', "Your listing contains a word that isn't allowed. Please edit it and try again."))
      return
    }
    // Draft-first: the listing is ready — NOW ask for the account. The text draft
    // is already in localStorage (survives an OAuth redirect); in-dialog OTP/email
    // keeps photos too. After sign-in the /api/me effect fills contact info.
    if (!user) {
      // ⚠️ THE MOST VALUABLE ONE. The form was complete and VALID and we asked for an
      // account — so this separates "could not fill the form" from "would not make an
      // account", opposite problems with opposite fixes. It is also the exact point where the
      // onboarding bounce used to destroy photos (1298c088), and nothing else can tell us
      // whether that fix helped.
      countAttempt('client_signin_required')
      openSignIn()
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    try {
      // Photo upload + the video sign→PUT→complete→transcode-poll pipeline moved
      // VERBATIM into usePostMedia (use-post-media.ts) — same order, same thrown
      // codes ('upload' / 'video' / 'video_hevc') that the catch below maps to copy.
      const imageUrls = await uploadPhotos()
      const videoUrl = await resolveVideoUrl()

      const payload = {
        categorySlug,
        subcategorySlug: subcategorySlug || null,
        listingType,
        attributes: Object.fromEntries(Object.entries(attrs).filter(([, v]) => v)),
        // Precise numeric specs → dedicated columns (year/mileageKm/engineL).
        ...Object.fromEntries(
          rangeFacetsFor(categorySlug, subcategorySlug)
            .filter((f) => ranges[f.key] != null)
            .map((f) => [f.range.column, ranges[f.key]]),
        ),
        title: title.trim(),
        description: description.trim(),
        price: Number(price),
        negotiable,
        urgent,
        district: district || null,
        city: province?.name || null,
        location: ward?.name || province?.name || null,
        lat: nearby?.lat ?? null,
        lng: nearby?.lng ?? null,
        condition: hasCondition ? condition || null : null,
        brand: showBrand ? brand.trim() || null : null,
        model: showBrand ? model.trim() || null : null,
        images: imageUrls,
        video: videoUrl,
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
      }
      // Edit → PATCH the existing listing; new post → POST.
      const res = await fetch(edit ? `/api/listings/${edit.id}` : '/api/listings', {
        method: edit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed')
      if (edit) {
        // landing on the updated listing IS the confirmation
        router.push(`/listings/${edit.id}`)
        return
      }
      const created = (await res.json().catch(() => ({}))) as { id?: string }
      trackPostListing({ id: created.id, title: title.trim(), price: Number(price), currency: 'VND', category: cat?.name || categorySlug, district: district || undefined })
      try { localStorage.removeItem('eno-listing-draft') } catch {}
      // First-ever publish gets a distinct celebration moment on the success
      // screen (device-local flag — celebration-grade accuracy is fine).
      try {
        setFirstListing(!localStorage.getItem('eno-posted-before'))
        localStorage.setItem('eno-posted-before', '1')
      } catch {}
      setCreatedId(created.id ?? null)
      haptic(18)
      setSubmitted(true)
      onPosted?.() // embedded in dashboard → refresh listings + switch tab
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(
        msg === 'upload'
          ? t('Không tải được ảnh, vui lòng thử lại.', 'Could not upload your photos — please try again.')
          : msg === 'video'
          ? t('Không tải được video, vui lòng thử lại.', 'Could not upload your video — please try again.')
          : msg === 'video_hevc'
          ? t('Không xử lý được video HEVC này. Hãy xuất lại dạng MP4 (H.264): trên iPhone bật Cài đặt → Camera → Định dạng → Tương thích nhất.', "Couldn't process this HEVC video. Export it as MP4 (H.264) — on iPhone: Settings → Camera → Formats → Most Compatible.")
          : msg === 'contact_in_name'
          ? t('Tên liên hệ của bạn không được là email hay số điện thoại. Hãy đổi tên hiển thị trong Cài đặt rồi đăng lại.', "Your contact name can't be an email address or phone number. Change your display name in Settings, then post again.")
          : msg === 'no_phone_in_listing' || msg === 'contact_in_text'
          ? t('Không ghi số điện thoại, email, link hay địa chỉ nhà trong tin — người mua sẽ nhắn tin cho bạn trong ứng dụng. Hãy bỏ ra để đăng.', "Don't put a phone number, email, link or street address in your listing — buyers message you in the app. Remove it to post.")
          : msg === 'banned_words'
          ? t('Tin của bạn có từ ngữ không được phép. Vui lòng chỉnh sửa rồi đăng lại.', "Your listing contains a word that isn't allowed. Please edit it and try again.")
          : msg === 'urgent_quota'
          ? t('Bạn đã có 2 tin "Bán gấp" đang chạy — chờ một tin hết hạn rồi thử lại.', 'You already have 2 urgent listings running — wait for one to expire and try again.')
          : msg === 'urgent_cooldown'
          ? t('Tin này vừa hết hạn "Bán gấp" — có thể bật lại sau 7 ngày.', 'This listing just finished an urgent run — you can turn it on again after 7 days.')
          : msg === 'duplicate_listing'
          ? t('Bạn đã có tin đang hiển thị cho sản phẩm này. Vào Tin đăng để chỉnh sửa hoặc xác nhận còn hàng thay vì đăng lại.', "You already have a live listing for this item. Open My Listings to edit it or confirm it's still available instead of posting it again.")
          : msg === 'location_required'
          ? t('Hãy chọn vị trí cho tin đăng — người mua cần biết món đồ ở đâu.', 'Pick a location for your listing — buyers need to know where the item is.')
          : msg === 'photo_required'
          ? t('Cần ít nhất một ảnh để đăng tin.', 'You need at least one photo to post.')
          : msg === 'photos_min'
          ? (minPhotos === 1
              ? t('Cần ít nhất 1 ảnh.', 'You need at least 1 photo.')
              : t('Cần ít nhất 3 ảnh từ các góc khác nhau (không phải cùng một ảnh lặp lại).', 'You need at least 3 photos from different angles (not the same photo repeated).'))
          : msg === 'account_restricted'
          ? t('Tài khoản của bạn đang bị hạn chế do điểm uy tín thấp. Bạn có thể đăng lại khi điểm uy tín phục hồi.', "Your account is restricted due to a low trust score. You can post again once your trust score recovers.")
          : msg === 'account_held'
          ? t('Tin đăng của bạn đang tạm dừng trong khi chúng tôi xem xét một báo cáo — xem chi tiết và khiếu nại trong trang quản lý.', 'Your listings are paused while we review a report — see your dashboard for details and to appeal.')
          : msg === 'account_suspended'
          ? t('Tài khoản của bạn đang tạm ngưng nên chưa thể đăng tin — xem chi tiết trong trang quản lý.', 'Your account is suspended, so posting is paused — see your dashboard for details.')
          : msg === 'probation_listing_cap'
          ? t('Tài khoản mới có thể giữ tối đa 8 tin đang đăng — hãy đánh dấu đã bán một tin, hoặc chờ tài khoản đủ 30 ngày.', 'New accounts can keep up to 8 active listings — mark something sold or wait until your account is 30 days old.')
          : msg === 'phone_taken'
          ? t('Số điện thoại này đã được một tài khoản khác sử dụng. Mỗi số chỉ dùng cho một tài khoản.', 'This phone number is already used by another account. Each number belongs to one account.')
          : t('Không gửi được, vui lòng thử lại.', 'Could not submit — please try again.'),
      )
      console.error(e)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (submitted) {
    return <PostSuccess firstListing={firstListing} createdId={createdId} title={title} price={price} t={t} />
  }

  const publishButtonProps = {
    onSubmit: submit,
    canSubmit,
    submitting,
    edit: !!edit,
    missingCount: missing.length,
    t,
  }

  return (
    <div className="pb-[calc(9rem+env(safe-area-inset-bottom))] lg:pb-0">
      {/* Exit is a <Link>, not an <a>: inside the Capacitor WebView a raw anchor is a fresh
          HTTP load of the live site — blank screen, full document teardown. The draft is
          already autosaved to localStorage, so a soft nav loses nothing. */}
      {!embedded && (
        <Link href="/" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-accent-foreground transition-colors cursor-pointer">
          <ChevronLeft className="h-4 w-4" /> {t('Thoát', 'Exit')}
        </Link>
      )}
      {!embedded && <h1 className="mt-3 h-display text-foreground">{t('Tạo tin đăng', 'Create a listing')}</h1>}
      <p className={cn('text-base text-body', !embedded && 'mt-1')}>{t('Điền các mục bên dưới — bản xem trước cập nhật ngay.', 'Fill in the sections below — your preview updates live.')}</p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_19rem]">
        {/* ── FORM ── */}
        <div className="min-w-0 space-y-10">
          {/* Photos (+ optional video) — moved verbatim to post-wizard-sections.tsx */}
          <MediaSection media={media} errPhoto={err.photo} minPhotos={minPhotos} aiEnabled={aiEnabled} aiBusy={aiBusy} autofillFromPhoto={autofillFromPhoto} t={t} />

          {/* Category & type */}
          <Section id="pw-category" title={t('Danh mục', 'Category')} hint={t('Chọn đúng danh mục để người mua dễ tìm thấy.', 'Pick the right category so buyers find you.')}>
            {showRentToggle && (
              <Field group label={t('Bán hay cho thuê?', 'For sale or for rent?')}>
                {/* Single-select and mutually exclusive = a radio group, not two buttons that
                    happen to paint one of themselves blue. The RadioGroup carries its own
                    aria-label because Field's `group` wrapper labels a role="group", which cannot
                    name the radiogroup nested inside it. `switchIntent` already early-returns when
                    `to === intent`, which is exactly the radio contract (re-selecting the checked
                    option fires nothing) — so the swap is behaviour-for-behaviour identical. */}
                <RadioGroup
                  value={intent}
                  onValueChange={(v) => switchIntent(v as 'sell' | 'rent')}
                  aria-label={t('Bán hay cho thuê?', 'For sale or for rent?')}
                  className="inline-flex rounded-xl bg-tint p-1"
                >
                  {(['sell', 'rent'] as const).map((v) => (
                    <Radio
                      key={v}
                      value={v}
                      className={cn('rounded-lg px-4 py-1.5 text-sm font-bold transition-colors', intent === v ? 'bg-primary text-white' : 'text-body hover:text-foreground')}
                    >
                      {v === 'sell' ? t('Bán', 'For sale') : t('Cho thuê', 'For rent')}
                    </Radio>
                  ))}
                </RadioGroup>
              </Field>
            )}
            {edit ? (
              // Category is fixed when editing (changing it would re-derive subcategory/
              // brand/facets). To switch category, delete + repost.
              <div className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3.5 py-2 text-sm font-semibold text-body">
                {cat && <CategoryIcon name={cat.icon} className="h-4 w-4 text-body" />}
                {cat ? tr(cat.name, cat.nameVi) : categorySlug}
                <span className="ml-1 text-xs font-normal text-ink-4">{t('(không đổi khi sửa)', '(fixed when editing)')}</span>
              </div>
            ) : (
              <>
                {/* Chip grid = a RADIO GROUP: pick exactly one category. It used to be a
                    role="group" of <Button>s whose only selected cue was `bg-primary text-white`,
                    so assistive tech was told a category grid existed but never which category was
                    chosen. Base UI now supplies role="radiogroup" + per-chip aria-checked, one tab
                    stop, and arrow keys.
                    Two things this ALSO fixes, quietly: (a) aria-invalid is not allowed on
                    role="group" but IS supported on role="radiogroup", so the error state finally
                    reports legally; (b) re-clicking the ALREADY-selected chip no longer re-runs
                    chooseCategory(), which used to wipe the user's subcategory/brand/attrs.
                    Layout is untouched — RadioGroup renders the same <div> with the same classes. */}
                {/* ⚠️ DELIBERATELY NOT A RadioGroup — do not "upgrade" this to one.
                    It was briefly made a Base UI RadioGroup for the aria-checked win, and that was a
                    DATA-LOSS BUG. Base UI radios use SELECTION-FOLLOWS-FOCUS (RadioGroup.js:190 marks
                    any Arrow key as touched; the newly-focused RadioRoot.js:151 onFocus fires
                    inputRef.click() → onValueChange). And selecting a category here is DESTRUCTIVE:
                    chooseCategory() wipes subcategory, attrs, ranges, condition, brand and model.
                    So a keyboard user who had filled the form, tabbed back to the category chips and
                    pressed ONE arrow key just to look at the options would silently lose all of it,
                    with no undo. Radio semantics assume selecting is cheap. Here it is not.
                    Toggle semantics are the honest model: aria-pressed announces the selected chip,
                    and a chip only fires when you deliberately activate it. facet-bar's segmented
                    chips are aria-pressed for the same reason. */}
                <div
                  role="group"
                  aria-label={t('Danh mục', 'Category')}
                  aria-describedby={err.category ? 'pw-category-error' : undefined}
                  // ⚠️ -mx-2 -mt-2, NOT -m-2. `p-2 -m-2` cancels the padding on all four sides for
                    // LAYOUT while the ring still paints 8px outside the box — so the error message
                    // below flowed straight through the ring's bottom edge and rendered struck out.
                    // Dropping only the negative BOTTOM margin lets that 8px occupy real space, so
                    // the message clears the ring, while the sides and top still avoid a shift when
                    // the error appears.
                    className={cn('flex flex-wrap gap-2 rounded-xl transition-colors', err.category && '-mx-2 -mt-2 p-2 ring-2 ring-destructive/60')}
                >
                  {categories.map((c) => (
                    <Button
                      key={c.id}
                      variant="bare"
                      size="none"
                      type="button"
                      aria-pressed={categorySlug === c.slug}
                      onClick={() => chooseCategory(c.slug)}
                      className={cn('gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors', categorySlug === c.slug ? 'bg-primary text-white' : 'text-body hover:bg-muted')}
                    >
                      <CategoryIcon name={c.icon} className={cn('h-4 w-4', categorySlug === c.slug ? 'text-white' : 'text-body')} />
                      {tr(c.name, c.nameVi)}
                    </Button>
                  ))}
                </div>
                {err.category && <p id="pw-category-error" role="alert" className="mt-2 text-xs font-semibold text-destructive">{t('Chọn một danh mục', 'Pick a category')}</p>}
              </>
            )}

            {categorySlug && typeOptions.length > 1 && (
              <Field group label={t('Loại tin', 'Listing type')}>
                <Chips options={LISTING_TYPES.filter((lt) => typeOptions.includes(lt.value)).map((lt) => ({ value: lt.value, label: tr(lt.label, lt.labelVi) }))} value={listingType} onPick={setListingType} />
              </Field>
            )}
            {categorySlug && subOptions.length > 0 && (
              <Field group label={t('Danh mục con', 'Subcategory')}>
                <Chips options={subOptions.map((s) => ({ value: s.slug, label: tr(s.name, s.nameVi) }))} value={subcategorySlug} onPick={(v) => setSubcategorySlug(v === subcategorySlug ? '' : v)} />
              </Field>
            )}
            {showBrand && (
              <Field label={t('Thương hiệu', 'Brand')} hint={t('Giúp người mua tìm theo hãng. Bỏ trống nếu không có.', 'Helps buyers find you by brand. Leave blank if none.')}>
                <FieldControl
                  render={
                    <Input
                      value={brand}
                      list="brand-options"
                      maxLength={40}
                      onChange={(e) => setBrand(e.target.value)}
                      placeholder={t('VD: Apple, Samsung, Honda', 'e.g. Apple, Samsung, Honda')}
                      className="max-w-md"
                    />
                  }
                />
                <datalist id="brand-options">
                  {brandOptions.map((b) => <option key={b} value={b} />)}
                </datalist>
              </Field>
            )}
            {showBrand && brand.trim() && (
              <Field label={t('Mẫu / Model', 'Model')} hint={t('VD: iPhone 14 Pro, Sorento. Giúp người mua lọc theo mẫu.', 'e.g. iPhone 14 Pro, Sorento. Lets buyers filter by model.')}>
                <FieldControl
                  render={
                    <Input
                      value={model}
                      maxLength={60}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={t('VD: iPhone 14 Pro', 'e.g. iPhone 14 Pro')}
                      className="max-w-md"
                    />
                  }
                />
              </Field>
            )}
          </Section>

          {/* Details */}
          <Section title={t('Chi tiết', 'Details')}>
            <Field label={t('Tiêu đề', 'Title')} counter={`${title.length}/${TITLE_MAX}`} error={titleErr}>
              {/* `id` goes on the CONTROL, not the wrapper: scrollToMissing() does
                  getElementById('pw-title').focus() and that focus() is guarded by
                  `instanceof HTMLInputElement` — on a wrapper <div> it silently no-ops.
                  Passing it to FieldControl also makes it the id the label points at. */}
              <FieldControl
                id="pw-title"
                render={
                  <Input
                    value={title}
                    maxLength={TITLE_MAX}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={() => touch('title')}
                    placeholder={t('VD: iPhone 14 128GB — pin 92%', 'e.g. iPhone 14 128GB — battery 92%')}
                    className={cn('max-w-2xl', err.title && 'ring-2 ring-destructive/60')}
                  />
                }
              />
            </Field>
            {/* `pw-description` stays on the WRAPPER — it is the scroll anchor, and other
                code may look it up. Only the title's id lives on its control. */}
            <Field id="pw-description" label={t('Mô tả', 'Description')} counter={`${description.length}/${DESC_MAX}`} hint={t('Tình trạng, lý do bán, điểm nổi bật. Đừng ghi số điện thoại.', 'Condition, why you’re selling, what stands out. No phone numbers.')} error={descErr}>
              {/* No mb-* on the row below: the Field wrapper is now `flex flex-col gap-1.5`, and a
                  flex GAP does not collapse with a sibling's margin the way the old `space-y-1.5`
                  block flow did — they ADD. An mb-1.5 here would put 12px under the row, not 6px. */}
              {aiEnabled && (
                <div className="flex max-w-2xl justify-end">
                  <Button
                    type="button"
                    variant="bare"
                    size="none"
                    onClick={polishDescription}
                    disabled={!!aiBusy || description.trim().length < 3}
                    title={t('Viết lại chuyên nghiệp bằng AI', 'Rewrite professionally with AI')}
                    // disabled:pointer-events-auto undoes the base's baked
                    // disabled:pointer-events-none — this button is disabled until the
                    // description has 3 chars, and that is exactly when its title=
                    // tooltip explains why. A disabled <button> still fires no click.
                    className="gap-1 rounded-lg px-2 py-1 text-2xs font-bold text-accent-foreground transition-colors hover:bg-muted disabled:pointer-events-auto disabled:opacity-40 cursor-pointer"
                  >
                    {aiBusy === 'desc' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {t('Chỉnh bằng AI', 'Polish with AI')}
                  </Button>
                </div>
              )}
              <FieldControl
                render={
                  <Textarea
                    value={description}
                    maxLength={DESC_MAX}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => touch('description')}
                    rows={5}
                    placeholder={t('Mô tả chi tiết…', 'Describe it in detail…')}
                    className={cn('max-w-2xl resize-none', err.description && 'ring-2 ring-destructive/60')}
                  />
                }
              />
            </Field>
          </Section>

          {/* Specifics (condition + attributes) */}
          {categorySlug && (hasCondition || attrFacets.length > 0) && (
            <Section title={t('Thông số', 'Specifics')}>
              {hasCondition && (
                <Field group id="pw-condition" label={t('Tình trạng', 'Condition')} error={err.condition ? t('Hãy chọn tình trạng', 'Pick the condition') : undefined}>
                  <Chips options={[{ value: 'new', label: t('Mới', 'New') }, { value: 'used', label: t('Đã dùng', 'Used') }]} value={condition} onPick={setCondition} />
                </Field>
              )}
              {attrFacets.map((f, fi) => (
                <Field group key={f.key} id={fi === 0 ? 'pw-details' : undefined} label={tr(f.label, f.labelVi)} error={err.details && isRequiredFacet(f) && !attrs[f.key] ? t('Hãy chọn một mục', 'Pick one') : undefined}>
                  {f.kind === 'range' && f.range ? (
                    <RangeSpecInput range={f.range} value={ranges[f.key] ?? null} onChange={(v) => setRanges((prev) => ({ ...prev, [f.key]: v }))} />
                  ) : (
                    <Chips options={f.options.map((o) => ({ value: o.value, label: tr(o.label, o.labelVi) }))} value={attrs[f.key] || ''} onPick={(v) => setAttrs((prev) => ({ ...prev, [f.key]: prev[f.key] === v ? '' : v }))} />
                  )}
                </Field>
              ))}
            </Section>
          )}

          {/* Price — moved verbatim to post-wizard-sections.tsx */}
          <PriceSection
            price={price}
            setPrice={setPrice}
            touch={touch}
            errPrice={err.price}
            priceErr={priceErr}
            priceBand={priceBand}
            priceUnit={priceUnit}
            negotiable={negotiable}
            setNegotiable={setNegotiable}
            urgent={urgent}
            setUrgent={setUrgent}
            fixedPriceOnly={categorySlug === 'services'}
            t={t}
          />

          {/* Location — moved verbatim to post-wizard-sections.tsx (AreaFilter popover
              itself stays below, anchored to areaBtnRef) */}
          <LocationSection
            errLocation={err.location}
            areaLabel={areaLabel}
            areaBtnRef={areaBtnRef}
            setAreaOpen={setAreaOpen}
            useMyLocation={useMyLocation}
            locating={locating}
            t={t}
          />

          {/* Contact — moved verbatim to post-wizard-sections.tsx */}
          <ContactSection
            meLoaded={meLoaded}
            isGuest={isGuest}
            postingAs={postingAs}
            contactName={contactName}
            setContactName={setContactName}
            contactPhone={contactPhone}
            setContactPhone={setContactPhone}
            phoneOk={phoneOk}
            errContactName={err.contactName}
            errContactPhone={err.contactPhone}
            t={t}
          />

          {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
        </div>

        {/* ── PREVIEW + PUBLISH (desktop) ── */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">
            <div className="space-y-2">
              <span className="text-2xs font-bold uppercase tracking-wider text-ink-4">{t('Xem trước', 'Live preview')}</span>
              <Preview cover={photos[0]?.url} title={title} price={price} priceUnit={priceUnit} area={areaLabel} categoryIcon={cat?.icon} t={t} />
            </div>
            <PublishButton {...publishButtonProps} />
            {missing.length > 0 && (
              <ul className="space-y-1.5 pt-1">
                {checks.map((c) => (
                  <li key={c.key} className={cn('flex items-center gap-2 text-xs', c.ok ? 'text-ink-4 line-through' : 'text-body')}>
                    <span className={cn('flex h-4 w-4 items-center justify-center rounded-full', c.ok ? 'text-success' : 'text-ink-4')}>
                      {c.ok ? <Check className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                    </span>
                    {c.label}
                  </li>
                ))}
              </ul>
            )}
            <p className="flex items-start gap-1.5 pt-1 text-2xs leading-relaxed text-ink-4">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              {t('Tin hiển thị ngay. Số của bạn được giữ kín.', 'Goes live instantly. Your number stays private.')}
            </p>
          </div>
        </aside>
      </div>

      {/* Publish bar (mobile) — sits ABOVE the global fixed bottom-nav. bg runs to
          bottom-0 (so there's no gap when the nav auto-hides) while the button is
          padded up clear of the nav; the form root reserves matching space below so
          the last fields never hide behind it. */}
      <div data-fab-clear className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 pt-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <div className="mx-auto max-w-7xl space-y-2">
          {/* What's still missing — mobile parity with the desktop checklist */}
          {missing.length > 0 && (
            <p className="truncate text-2xs font-semibold text-ink-4">
              {t('Còn thiếu', 'Still needed')}: {missing.map((c) => c.label).join(' · ')}
            </p>
          )}
          <PublishButton {...publishButtonProps} />
        </div>
      </div>

      <AreaFilter
        mode="pick"
        hideLocate
        open={areaOpen}
        anchorRef={areaBtnRef}
        onClose={() => setAreaOpen(false)}
        province={province}
        ward={ward}
        nearby={nearby}
        onApply={({ province: p, ward: w, nearby: nb }) => {
          // Superseding an in-flight locate: its finally() won't touch the spinner once
          // it loses the generation race, so the manual apply clears it here — otherwise
          // "Use my location" spins forever after a hand-pick (same class as the
          // business-editor bug, dual-review catch 2026-07-23).
          locReq.current++; setLocating(false); setProvince(p); setWard(w); setNearby(nb)
        }}
        onReset={() => { setProvince(null); setWard(null); setNearby(null) }}
      />
    </div>
  )
}

