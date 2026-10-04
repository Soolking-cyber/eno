'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Check, Sparkles, Loader2, ShieldCheck, User } from "@/components/ui/icons"
import { toast } from 'sonner'
import { subtleToast } from '@/lib/subtle-toast'
import type { SerializedCategory } from '@/lib/types'
import { hasRealCoords } from '@/lib/geo'
import { CategoryIcon } from './category-icons'
// Small-mount CategoryIcon re-tier (icon-language §2): the registry bakes the
// display stroke (1.5) for h-11+ tiles; at the picker's h-4/h-3.5 that scales to
// <1px of ink, so the picker passes the UI weight explicitly.
import { STROKE_UI } from '@/lib/icon-tokens'
import { ENFORCEMENT } from '@/lib/enforcement-machine'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { CloseButton } from '@/components/ui/close-button'
import { Chip } from '@/components/ui/chip'
import { Alert } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FieldControl } from '@/components/ui/field'
import { RadioGroup, Radio } from '@/components/ui/radio-group'
import { StickyActionBar, StickyActionBarSpacer } from '@/components/ui/sticky-action-bar'
import { Combobox, ComboboxClear, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxList, ComboboxTrigger } from '@/components/ui/combobox'
import { haptic, hapticConfirm, hapticError } from '@/lib/haptics'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { containsPhoneNumber } from '@/lib/phone'
import { containsContactInfo, findBannedWord, minPhotosFor, publicSafeName } from '@/lib/publish-guard'
import type { ClientPublishOutcome } from '@/lib/publish-funnel-codes'
import { trackPostListing } from '@/lib/analytics'
import { identityBlockAction, identityBlockMessage, IDENTITY_VERIFY_PATH } from '@/lib/identity-block-copy'
import { isNativeShell } from '@/lib/native-browser'
import { AreaFilter, findUnit, type Geo, type Nearby } from './area-filter'
import { postableSubcategoriesFor, isPostableSubcategory, typesFor, askableFacetsFor, rangeFacetsFor, categoryHasBrand, isRequiredFacet, LISTING_TYPES, paysSalary, salaryPriceFor, rentalPeriodOf, rentalPeriodOfUnit, CONDITION_FACET, suggestSubcategory, VISA_PRODUCT_FACET_KEYS } from '@/lib/taxonomy'
import { RangeSpecInput } from './range-spec-input'
import { usePostMedia } from '@/hooks/use-post-media'
import { PublishButton, PublishLabel, Section, Field, Chips, Preview, DraftNotice } from './post-wizard-parts'
import { MediaSection, PriceSection, SalarySection, LocationSection, ContactSection, PostSuccess } from './post-wizard-sections'
import { publishSteps } from './post-wizard-steps'
import { brandModelPayload, draftHasContent, rangeColumnsPayload } from './post-wizard-payload'
import { categoryChangeLosesAnswers, categoryChangeReset, orderPostCategories, subcategoryChangeReset } from './post-wizard-category'
import { postCopyFor } from '@/lib/post-copy'
import { clearDraftPhotos, draftPhotosEpoch, loadDraftPhotos, saveDraftPhotos } from '@/lib/post-draft-photos'
import { scrollBehavior } from '@/lib/reduced-motion'

const TITLE_MAX = 140
const DESC_MAX = 5000

// ── Resume after sign-in (sell-04) — see `publishIntentAt` in the component. ──
/** How long a Publish that met the sign-in gate may still be resumed. Twice the draft's TTL is moot
 *  (the draft would be gone first); it bounds the case of a draft kept alive by typing. */
const PUBLISH_INTENT_TTL_MS = 30 * 60_000
/** How long the account's contact (/api/me) may take before the form stops waiting for it. */
const ME_TIMEOUT_MS = 10_000
/** `/post?resume=publish` — the `next` the sign-in dialog returns to. The only load that may honour
 *  a stored intent; read once on mount, then removed from the address bar. */
const RESUME_PARAM = 'resume'
const RESUME_PUBLISH = 'publish'
function setResumeParam(on: boolean) {
  try {
    const u = new URL(window.location.href)
    if (u.searchParams.has(RESUME_PARAM) === on) return
    if (on) u.searchParams.set(RESUME_PARAM, RESUME_PUBLISH)
    else u.searchParams.delete(RESUME_PARAM)
    // Next's own history state is passed through: the App Router keeps its tree key there.
    window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`)
  } catch { /* no history API — the draft flag alone cannot publish, so nothing is lost */ }
}
const stripResumeParam = () => setResumeParam(false)
/** Drop the intent from the STORED draft right now — for exits that unmount before autosave runs. */
function dropStoredPublishIntent() {
  try {
    const d = JSON.parse(localStorage.getItem('eno-listing-draft') || 'null')
    if (d && d.publishIntent) { delete d.publishIntent; localStorage.setItem('eno-listing-draft', JSON.stringify(d)) }
  } catch { /* storage refused — the TTL still retires it */ }
}

// Rentable items live in a sale category (Vehicles/Property) OR the dedicated Rentals
// category. Choosing "For rent" moves a sale item into Rentals, mapping the subcategory
// across — so AI's default-to-sale classification is one tap from rental.
// ⚠️ ONE WAY ONLY (sell-07, 2026-10-04). The toggle used to show in Rentals too, where "Bán" re-filed
// the post into Vehicles or Property — two shelves no browse surface links any more
// (retired-categories.ts UNLINKED_CATEGORIES), so a rental tapped into "sale" vanished from view. In
// Rentals the toggle is gone; a seller who meant to SELL changes the category (the "Selling, not
// renting?" line under the summary opens the grid), which is the one obvious step and never a hidden
// shelf.
const RENTABLE_SALE_CATS = new Set(['vehicles', 'property'])
const SALE_TO_RENT: Record<string, Record<string, string>> = {
  vehicles: { motorbike: 'motorbike-rental', car: 'car-rental', bicycle: 'bicycle-rental', 'ebike-scooter': 'ebike-rental' },
  property: { apartment: 'apartment-rental', house: 'house-rental', 'room-shared': 'room-rental' },
}
// The rentals whose brand means something (a Honda, a VinFast). An apartment has no brand, so the
// Brand field stays off for the rest of Rentals.
const VEHICLE_RENTAL_SUBS = new Set(['motorbike-rental', 'car-rental', 'bicycle-rental', 'ebike-rental'])

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
  /** Listing.priceUnit as stored ('VND/day'…) — what buyers see; the rent period chip opens on it. */
  priceUnit?: string | null
  year: number | null
  mileageKm: number | null
  engineL: number | null
  engineCc: number | null
  // ⚠️ EVERY RANGE COLUMN (taxonomy RANGE_COLUMNS) BELONGS HERE: initRangesFromEdit seeds the sliders
  // from these keys, so a column missing from this type opened its edit slider EMPTY — a job's salary
  // read "Negotiable" on the edit screen of a job that states 45 tr/tháng.
  areaM2: number | null
  salaryM: number | null
  district: string | null
  city: string | null
  lat: number | null
  lng: number | null
  images: string[]
  video: string | null
}

// Seed the range-facet state (keyed by facet key) from the listing's dedicated columns.
/**
 * The attribute chips an EDIT opens with. ⚠️ A RENT ROW'S PERIOD CHIP FOLLOWS THE STORED UNIT when the
 * two disagree, because the stored unit is what buyers see: rows posted before the chip counted were
 * stamped 'VND/month' whatever it said, so a "Theo ngày" chip would open the form on "/ ngày" over a
 * price every card prints "/ tháng"; and an imported 'VND/day' row with no chip would open on "/ tháng"
 * and invite a ×30 "correction". Opening on the stored period shows the truth; changing the chip then
 * re-stamps the unit as designed (core/listings.ts updateListingCore). 'long-term' stays as it is — it
 * already reads monthly.
 */
function initAttrsFromEdit(edit?: ListingEditData): Record<string, string> {
  if (!edit) return {}
  const attrs = { ...edit.attributes }
  const stored = edit.listingType === 'rent' ? rentalPeriodOfUnit(edit.priceUnit) : null
  if (stored && stored !== rentalPeriodOf(attrs)) attrs.rentalPeriod = stored
  return attrs
}

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
  // Context notes for the ONE sign-in popup (auth-context's SignInContext.note, rendered under the
  // card's generic title). A bare openSignIn() here told a guest nothing about why the form had
  // stopped. Both tips are true as written: an email code signs in inside THIS tab, so everything in
  // memory survives it, whereas Google redirects the page away and the magic link opens a new tab.
  // (Since the photo draft moved into IndexedDB the redirect brings the photos back too, within the
  // draft's TTL and wherever the browser allows IndexedDB — but never a video, which is not kept.)
  const aiGateNote = t('Trợ giúp AI miễn phí khi có tài khoản. Mẹo: đăng nhập bằng mã qua email để giữ ảnh trên trang này.', 'AI help is free with an account. Tip: sign in with an email code to keep your photos on this page.')
  // sell-14: the email carries a LINK by default and a CODE only when "Use a code" is chosen
  // (api/auth/email-link sends one or the other, never both), so the tip names that choice rather than
  // promising a code that is not in the inbox. Until O-33 ships this is the advice that keeps the tab.
  const publishGateNote = t('Bước cuối: đăng nhập để đăng tin. Mẹo: chọn “Dùng mã qua email” rồi nhập mã ngay tại đây (đừng mở liên kết ở tab khác) để giữ ảnh.', 'Last step: sign in to publish. Tip: choose “Use a code” and type the code right here (do not open a link in another tab) to keep your photos.')

  // ✨ Autofill category/subcategory/type/condition/title from the cover photo.
  const autofillFromPhoto = async () => {
    if (!user) { openSignIn({ note: aiGateNote }); return } // AI burns paid credits — members only
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
        // AI must not pick a subcategory this edition does not offer for new posts (O-34).
        setSubcategorySlug(d.subcategorySlug && isPostableSubcategory(d.categorySlug, d.subcategorySlug) ? d.subcategorySlug : '')
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
          subtleToast(t('Chưa chắc thương hiệu — thêm ảnh rõ logo/nhãn để nhận diện chính xác.', 'Not sure of the brand — add a clear photo of the logo/label so we can identify it.'))
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
    if (!user) { openSignIn({ note: aiGateNote }); return } // AI burns paid credits — members only
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
  // The one next step an identity refusal offers (verify / sign in) — rendered as a button beside
  // the error. Null for every other refusal, which the seller fixes in the form itself.
  const [errorAction, setErrorAction] = useState<'verify' | 'sign_in' | null>(null)
  const [categorySlug, setCategorySlug] = useState(edit?.categorySlug ?? '')
  const [subcategorySlug, setSubcategorySlug] = useState(edit?.subcategorySlug ?? '')
  const [listingType, setListingType] = useState(edit?.listingType ?? 'sell')
  const [attrs, setAttrs] = useState<Record<string, string>>(() => initAttrsFromEdit(edit))
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
  // Brand suggestions: the catalogue's top brands overall, led by the brands that actually have live
  // listings in the chosen subcategory. Slugs are kept so a typed brand can be matched to its models.
  const [globalBrands, setGlobalBrands] = useState<{ name: string; slug: string }[]>([])
  const [scopedBrands, setScopedBrands] = useState<{ name: string; slug: string }[]>([])
  const [modelItems, setModelItems] = useState<string[]>([])
  // Controlled so a model field with nothing to suggest never opens an empty popup (and its scrim).
  const [modelOpen, setModelOpen] = useState(false)
  // Category picker collapse (W-CATWIPE): once chosen, the 16-chip grid folds into a one-line summary
  // with a Change button, so the next question is in view instead of seven rows further down.
  const [catExpanded, setCatExpanded] = useState(false)
  // "More…" in the category grid: the shelves no browse surface links (orderPostCategories) stay postable
  // but wait behind one chip.
  const [moreCatsOpen, setMoreCatsOpen] = useState(false)
  // The subcategory suggestion the seller waved away (×) — not offered again for that slug.
  const [dismissedSuggestion, setDismissedSuggestion] = useState('')
  const changeCatRef = useRef<HTMLButtonElement>(null)
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
  // Whose account the contact fields above were filled for (the /api/me effect). See the note there.
  const contactOwner = useRef<string | null | undefined>(undefined)
  // An official partner (VietKite, GMBR) keeps the e-visa product chips on a new post (O-34).
  const [officialPartner, setOfficialPartner] = useState(false)
  // ⚠️ "LOADED" IS PER USER, NOT ONCE PER MOUNT. A guest's /api/me answers `{ user: null }` and used to
  // flip a plain boolean true for good — so after an in-dialog sign-in the form believed the profile
  // had arrived while name and phone were still '' for a round trip, and a Publish tap in that window
  // jumped onto a shimmering Contact section. Stamped with the user it answered for, it is true only
  // when that answer is about whoever is signed in NOW.
  // `known`: the account actually ANSWERED. False after a timeout or a failed read — the profile then
  // counts as loaded with an UNKNOWN contact (see the /api/me effect).
  const [me, setMe] = useState<{ for: string | null; known: boolean } | undefined>(undefined)
  const meLoaded = me !== undefined && me.for === (user?.id ?? null)
  const meKnown = meLoaded && me?.known === true
  /**
   * RESUME AFTER SIGN-IN (sell-04). Set when Publish meets the guest gate; written into the
   * 'eno-listing-draft' JSON by the autosave below, because a ref cannot survive the full-page Google
   * round trip (/auth/google/start). ⛔ IT NEVER PUBLISHES BY ITSELF: it only offers a one-tap
   * "Publish now" (auto-submit is owner decision C26), and it is honoured only when it is under
   * PUBLISH_INTENT_TTL_MS old AND the page load is a sign-in return (`?resume=publish`, the `next` the
   * gate hands the sign-in dialog) — or, within one mount, an in-dialog sign-in. Cleared on success,
   * Exit, Discard, the moment its banner is used, when the sign-in dialog is CLOSED without signing in
   * (SignInContext.onDismiss), and at PUBLISH_INTENT_TTL_MS within this page load too (a timer below).
   */
  const [publishIntentAt, setPublishIntentAt] = useState<number | null>(null)

  // `data-post-done` on <html> while the SUCCESS screen is up. header.tsx hides its orange Post button
  // on the post flow's own pages from the pathname, at render time, so the server HTML already omits it
  // (an effect-driven hide shifted the header ~105px after hydration — review, 2026-09-29); this lets
  // it back where posting another IS the next step. Written only after a user's Publish, never on load.
  // A subject-position hook rather than a `body:has(…)` selector (see the note in header.tsx).
  useEffect(() => {
    if (!submitted) return
    const root = document.documentElement
    root.setAttribute('data-post-done', '')
    return () => root.removeAttribute('data-post-done')
  }, [submitted])

  // ── Draft autosave (new listings only). Crash insurance, not a drafts feature:
  // restores only within a short window (industry norm — protect against accidental
  // close, don't resurrect stale intent), and only when real typing happened. A
  // category tap alone is not a draft; anything older than the TTL is silently
  // deleted. The TEXT lives in localStorage; the PHOTOS live in IndexedDB
  // (src/lib/post-draft-photos.ts), because a File cannot be serialised into
  // localStorage and the Google sign-in at Publish is a full-page redirect that used
  // to throw every photo away. The video is not kept (up to 50MB). ──
  const DRAFT_TTL_MS = 15 * 60_000
  const draftHydrated = useRef(false)
  // Which text draft the saved photos belong to. The text draft's savedAt is the ONE TTL clock for
  // both halves: it is refreshed on every keystroke, while the photos (the first section) are often
  // not touched again — timed on their own clock they expired under a seller who was still writing.
  // Adopted from a restored draft, minted fresh otherwise. Not a secret, so no crypto.
  const draftId = useRef('')
  // ⚠️ LOAD-BEARING, AND IT IS A SEPARATE FLAG FROM draftHydrated ON PURPOSE. The photo save effect
  // below clears IndexedDB whenever `photos` is empty — which it is on the very first render, before
  // the async load has even resolved. Without this gate that first render deletes the draft it is
  // about to restore. It flips only once the load has settled (or there was nothing to load).
  // STATE, not a ref: flipping it must re-run the save effect, so photos the seller added while the
  // load was in flight (which restorePhotos leaves alone) are saved without waiting for the next edit.
  const [photosHydrated, setPhotosHydrated] = useState(false)
  // Photos the restored draft HAD but the seller has not got back yet. The text save below writes
  // `photoCount: photos.length`, and it runs on the render right after the restore — before the
  // async IndexedDB read lands, and for good when that read comes back empty (IndexedDB refused,
  // quota, a private window). Without this the rewritten draft said 0 photos, so the NEXT reload
  // said "Draft restored" and never asked for them again. Dropped once the seller has any photo.
  // A draft saved before `photoCount` existed carries 0 here: it is asked once, as it always was.
  const lostPhotoCount = useRef(0)
  // The moving-sale description "List another item" carried over (postAnother) — context, not a draft
  // until the seller changes something (draftHasContent).
  const carriedDescription = useRef('')
  // The inline "Draft restored" notice (DraftNotice) — set once the photo half of a restore has settled.
  const [draftNotice, setDraftNotice] = useState<{ photosKept: number; askPhotos: boolean } | null>(null)
  useEffect(() => {
    if (edit) { draftHydrated.current = true; return }
    let restoredId = ''
    let hadPhotos = false
    let restoring = false
    try {
      const d = JSON.parse(localStorage.getItem('eno-listing-draft') || 'null')
      const meaningful = d && (d.title?.trim() || d.description?.trim() || d.price)
      const fresh = d && Date.now() - (d.savedAt || 0) < DRAFT_TTL_MS
      if (d && !(meaningful && fresh)) localStorage.removeItem('eno-listing-draft')
      if (d && meaningful && fresh) {
        restoring = true
        if (typeof d.draftId === 'string') restoredId = d.draftId
        hadPhotos = !(d.photoCount === 0)
        if (typeof d.photoCount === 'number' && d.photoCount > 0) lostPhotoCount.current = d.photoCount
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
        // The resume intent rides with the draft, but only a sign-in RETURN may honour it, and never a
        // stale one. Anything else is dropped (the next autosave writes the draft without it).
        const at = d.publishIntent?.at
        const resuming = new URLSearchParams(window.location.search).get(RESUME_PARAM) === RESUME_PUBLISH
        if (resuming && typeof at === 'number' && Date.now() - at >= 0 && Date.now() - at < PUBLISH_INTENT_TTL_MS) setPublishIntentAt(at)
      }
    } catch {}
    // `?resume=publish` has done its job once read: a later reload of this tab is not a sign-in return.
    stripResumeParam()
    draftId.current = restoredId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    draftHydrated.current = true
    if (!restoring) {
      // No text draft (none, stale, or only clicks) → no photo draft either: photos without the
      // listing they belong to are not a draft, and a stale set must not linger on the device.
      void clearDraftPhotos()
      setPhotosHydrated(true)
      return
    }
    // The notice waits for the photos so it can say which of the two happened, once — and it only
    // asks for photos back when the draft had some (`photoCount`; a draft saved before that field
    // existed is assumed to have had them, which is what the old toast always said).
    let live = true
    const restored = restoredId ? loadDraftPhotos(restoredId) : Promise.resolve(null)
    void restored.then((ph) => {
      if (!live) return
      if (ph?.length) media.restorePhotos(ph)
      setDraftNotice({ photosKept: Math.min(ph?.length ?? 0, 6), askPhotos: !ph?.length && hadPhotos })
    }).finally(() => { if (live) setPhotosHydrated(true) })
    return () => { live = false }
    // `media` and `t` are deliberately not dependencies: this runs once per mount, like the text
    // restore above it, and restorePhotos never overwrites photos the seller added meanwhile.
  }, [edit])
  // Photo half of the autosave. Debounced, because a crop or a reorder re-renders `photos` several
  // times in a row and each save writes every Blob again. Off once published: success clears the
  // draft, and a save still pending must not land after that clear and resurrect it.
  useEffect(() => {
    if (edit || !photosHydrated || submitted) return
    // The epoch is read NOW, not when the timer fires: a clear in between (sign-out elsewhere in the
    // app, publish) voids this save instead of letting it resurrect the photos.
    const since = draftPhotosEpoch()
    const id = setTimeout(() => {
      const fresh = photos.filter((p) => p.file)
      if (!fresh.length) void clearDraftPhotos()
      else void saveDraftPhotos(draftId.current, fresh.map((p) => ({ file: p.file!, original: p.original, square: p.square })), since)
    }, 400)
    return () => clearTimeout(id)
  }, [edit, photos, photosHydrated, submitted])
  useEffect(() => {
    // ⚠️ NOT ONCE PUBLISHED. Success removes the draft and clears `publishIntentAt` in the same pass,
    // and that change re-runs this effect while title/description/price are still in state — without
    // this guard it wrote the published listing straight back as a "draft" (a seller who tapped the
    // ordinary Publish button after a sign-in return got it restored on the next /post).
    if (edit || submitted || !draftHydrated.current) return
    try {
      // Only typed work is worth keeping — clicking around the form isn't, and neither is the moving-sale
      // context "List another item" carried over (post-wizard-payload.ts draftHasContent).
      if (!draftHasContent({ title, description, price }, carriedDescription.current)) {
        localStorage.removeItem('eno-listing-draft')
        return
      }
      if (photos.length) lostPhotoCount.current = 0
      // `publishIntent` is PART OF THE SHAPE, not a one-off write beside it: this effect rewrites the
      // whole draft on every keystroke, and a flag written anywhere else would be gone by the next one.
      localStorage.setItem('eno-listing-draft', JSON.stringify({ savedAt: Date.now(), draftId: draftId.current, photoCount: photos.length || lostPhotoCount.current, categorySlug, subcategorySlug, listingType, attrs, ranges, title, description, price, negotiable, urgent, condition, brand, model, province, ward, nearby, ...(publishIntentAt ? { publishIntent: { at: publishIntentAt } } : {}) }))
    } catch {}
  }, [edit, submitted, photos.length, categorySlug, subcategorySlug, listingType, attrs, ranges, title, description, price, negotiable, urgent, condition, brand, model, province, ward, nearby, publishIntentAt])

  // Contact name + phone come from the ACCOUNT (not re-typed per post — a number is
  // unique per account). If the account is missing either, we prompt them to add it
  // in Settings first and block publishing.
  useEffect(() => {
    // Wait for auth to settle — firing during authLoading meant a throwaway fetch
    // (once while loading, again when `user` resolved) racing the real one.
    if (authLoading) return
    const ctrl = new AbortController()
    const forId = user?.id ?? null
    // ⛔ AN ACCOUNT SWITCH EMPTIES THE CONTACT FIRST (review, 2026-10-04). The fields hold whoever
    // answered last: had A's details loaded and B then signed in (or out), a failed or timed-out read for
    // B left A's name and phone in the form — and Publish would send them under B. They belong to one
    // account (`contactOwner`) and are cleared the moment the signed-in id changes, before B's answer;
    // the profile's "loaded/known" state is already stamped per user (`me`). A re-run for the SAME id
    // (a token refresh) keeps what the seller typed.
    if (contactOwner.current !== forId) {
      contactOwner.current = forId
      setContactName(''); setContactPhone(''); setPostingAs(null); setOfficialPartner(false)
    }
    // ⏱ NEVER WAIT FOREVER (review, 2026-10-04): a hung /api/me kept Publish on "Loading your details…"
    // with no way out. After ME_TIMEOUT_MS the read is abandoned and the profile counts as loaded with an
    // UNKNOWN contact: a new post falls back to the ordinary missing-field path (the seller types name and
    // phone), and an edit is not held up at all (its contact gate waits for a real answer — `checks`).
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ctrl.abort() }, ME_TIMEOUT_MS)
    fetch('/api/me', { signal: ctrl.signal }).then((r) => r.json()).then((d) => {
      // An answer that lands after its read was abandoned, or for an account that is no longer the signed-in
      // one, is about nobody here: it must not fill the next account's contact (commit-gate review 2026-10-04).
      if (ctrl.signal.aborted || contactOwner.current !== forId) return
      const u = d.user
      if (u) {
        // publicSafeName masks an account name that IS contact info (an email typed into
        // the display-name field — /api/profile used to allow it because it only screened
        // for phone numbers). Seeding the raw value made the account unpublishable: the
        // publish gate rejected the name, but the error named the listing, which was clean.
        setContactName(publicSafeName(u.seller?.name || u.displayName || ''))
        setContactPhone(u.seller?.phone || u.phone || '')
        if (u.accountType === 'business') setPostingAs(u.businessName || u.seller?.name || null)
        setOfficialPartner(u.seller?.officialPartner === true)
      }
      setMe({ for: forId, known: true })
    })
      // A failed read, or the timeout's own abort, is "loaded, contact unknown". An abort from the cleanup
      // (the user changed, the form unmounted) is not an answer about anyone, so it records nothing.
      .catch(() => { if (timedOut || !ctrl.signal.aborted) setMe({ for: forId, known: false }) })
      .finally(() => clearTimeout(timer))
    // re-runs when a guest signs in mid-wizard (draft-first posting) so the
    // account's name/phone land without a reload.
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [user, authLoading])

  // Top brands for the Brand combobox (suggestions only — free text creates new brands).
  // Fetched once when the user lands on a brand-relevant category.
  useEffect(() => {
    if (!categoryHasBrand(categorySlug) || globalBrands.length) return
    fetch('/api/brands?limit=120')
      .then((r) => r.json())
      .then((d) => setGlobalBrands((d.brands || []).map((b: { name: string; slug: string }) => ({ name: b.name, slug: b.slug }))))
      .catch(() => {})
  }, [categorySlug, globalBrands.length])
  // ⚠️ THE GLOBAL LIST ALONE OFFERED CANON AND DELL FOR A PHONE. /api/brands already answers per
  // subcategory (live listings there, demand-ranked, edition-scoped), so those lead the list and the
  // global top-120 follows as the long tail — it is what keeps a thin catalogue (eno.forum, a new
  // subcategory) from offering nothing at all. Aborted on change so a slow answer for the previous
  // subcategory cannot land under the new one.
  useEffect(() => {
    setScopedBrands([])
    if (!categoryHasBrand(categorySlug) || !subcategorySlug) return
    const ctrl = new AbortController()
    const qs = new URLSearchParams({ category: categorySlug, subcategory: subcategorySlug, limit: '12' })
    fetch(`/api/brands?${qs}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { brands: [] }))
      .then((d) => setScopedBrands((d.brands || []).map((b: { name: string; slug: string }) => ({ name: b.name, slug: b.slug }))))
      .catch(() => {})
    return () => ctrl.abort()
  }, [categorySlug, subcategorySlug])
  // One list for the combobox: scoped brands first, then the global tail, each name once.
  const brandItems = Array.from(new Set([...scopedBrands, ...globalBrands].map((b) => b.name)))
  // Model suggestions need a KNOWN brand (the models endpoint is keyed by slug): a typed brand that
  // matches a catalogue entry case-insensitively unlocks the models that brand actually has live here.
  const brandKey = brand.trim().toLowerCase()
  const brandSlug = brandKey ? [...scopedBrands, ...globalBrands].find((b) => b.name.toLowerCase() === brandKey)?.slug : undefined
  useEffect(() => {
    setModelItems([])
    if (!brandSlug || !categoryHasBrand(categorySlug)) return
    const ctrl = new AbortController()
    const qs = new URLSearchParams({ category: categorySlug })
    if (subcategorySlug) qs.set('subcategory', subcategorySlug)
    fetch(`/api/brands/${encodeURIComponent(brandSlug)}/models?${qs}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((d) => setModelItems((d.models || []).slice(0, 60).map((m: { model: string }) => m.model)))
      .catch(() => {})
    return () => ctrl.abort()
  }, [brandSlug, categorySlug, subcategorySlug])

  // Market-price guidance for the price step — the same PriceStat band the PDP's
  // "Market price" module shows (n≥5 + spread suppression live server-side).
  // Debounced + stale-cancelled; best-effort: any miss/error just hides the box.
  const [priceBand, setPriceBand] = useState<{ n: number; p25: number; median: number; p75: number } | null>(null)
  const bandYear = ranges['year'] ?? null
  useEffect(() => {
    // rentals price per MONTH — the PriceStat bands are sale prices, so guidance
    // there would coach sellers against the wrong market. Skip entirely.
    // The band is per shelf (category + subcategory), so there is nothing to compare against until a
    // subcategory is picked — the server answers { n: 0 } without one; skipping saves the round trip.
    if (!categoryHasBrand(categorySlug) || categorySlug === 'rentals' || !subcategorySlug || brand.trim().length < 2 || !model.trim()) { setPriceBand(null); return }
    // ⚠️ DROP THE OLD BAND BEFORE ASKING FOR THE NEW ONE. Aborting the in-flight request does not
    // un-render its answer: moving the listing from Phones to Phone cases left the PHONE's guidance
    // on screen for the debounce plus a round trip, under the case's own subcategory (astra).
    setPriceBand(null)
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      // ⚠️ THE LISTING'S OWN TYPE, WHICH IS NOT ALWAYS 'sell' IN A BRANDED CATEGORY. The bands are sale
      // prices; a Wanted ad states a budget and a Free item has no price at all, so coaching either
      // against sale percentiles is the hole the reader's SALE_LISTING_TYPE guard exists to close —
      // and deriving the type from `categorySlug === 'rentals'` was dead code that always said 'sell'
      // (opus). The server refuses anything but a sale, so this just tells it the truth.
      const qs = new URLSearchParams({ brand: brand.trim(), model: model.trim(), category: categorySlug, subcategory: subcategorySlug, type: listingType })
      if (condition) qs.set('condition', condition)
      if (bandYear != null) qs.set('year', String(bandYear))
      fetch(`/api/price-guidance?${qs}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setPriceBand(d && d.n >= 5 ? d : null))
        .catch(() => { if (!ctrl.signal.aborted) setPriceBand(null) })
    }, 400)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [categorySlug, subcategorySlug, listingType, brand, model, condition, bandYear])

  const cat = categories.find((c) => c.slug === categorySlug)
  // Edition-aware (taxonomy.ts POST_HIDDEN_ON_MARKETPLACE); the value already on the form stays listed.
  // A hidden subcategory is kept on screen only when EDITING a listing that already has it — never for a
  // new post or a restored draft (the create route refuses it too).
  const subOptions = postableSubcategoriesFor(categorySlug, edit ? subcategorySlug : undefined)
  // A restored draft or an AI fill can still hold a withheld subcategory (O-34) — drop it so the chips
  // show the truth and the seller picks again, instead of the server silently re-filing it on publish.
  if (!edit && subcategorySlug && categorySlug && !isPostableSubcategory(categorySlug, subcategorySlug)) setSubcategorySlug('')
  const typeOptions = typesFor(categorySlug)
  // askableFacetsFor, not facetsFor: a DERIVED facet (providerType) is computed from the
  // account server-side, so asking would be redundant — and lets a seller contradict their
  // own registration by ticking "Individual" on a business account. Browse still filters on it.
  // On the marketplace edition a non-partner is not asked the e-visa product chips (O-34) — on an edit,
  // only one the listing already carries stays. The server stores by the same rule (visaProductKeyAllowed).
  // `edit.attributes`, not the live `attrs`: what the LISTING has, not what this form has typed.
  const catFacets = askableFacetsFor(categorySlug, subcategorySlug, { newPost: !edit, officialPartner, existing: edit?.attributes })
  const hasCondition = catFacets.some((f) => f.key === 'condition')
  const attrFacets = catFacets.filter((f) => f.key !== 'condition')
  // In Rentals only a vehicle rental has a brand; an apartment asked for one read as a broken form.
  const brandShownFor = (sub: string) => categoryHasBrand(categorySlug) && (categorySlug !== 'rentals' || VEHICLE_RENTAL_SUBS.has(sub))
  const vehicleRental = categorySlug === 'rentals' && VEHICLE_RENTAL_SUBS.has(subcategorySlug)
  const showBrand = brandShownFor(subcategorySlug)
  // ⛔ A JOB IS PAID A SALARY, NOT PRICED (owner, 2026-10-01; taxonomy.ts paysSalary). Its Salary
  // facet leaves Specifics and becomes the pay section in Price's place; there is no price, no
  // ×1,000 chips and no Negotiable/Fixed, the server derives the stored price from the salary and
  // ignores any other, and the copy speaks to candidates, not buyers.
  const salaryPaid = paysSalary(listingType)
  const salaryFacet = salaryPaid ? rangeFacetsFor(categorySlug, subcategorySlug).find((f) => f.range.column === 'salaryM') : undefined
  const salary = salaryFacet ? ranges[salaryFacet.key] ?? null : null
  const salaryAmount = salaryPriceFor(salary)
  const orderedFacets = [...attrFacets].filter((f) => f !== salaryFacet).sort((a, b) => Number(!isRequiredFacet(a)) - Number(!isRequiredFacet(b)))

  // Sale-vs-rent quick switch for rentable items (Vehicles/Property ↔ Rentals). AI
  // defaults rentable items to a sale category; one tap flips the WHOLE category to
  // Rentals (mapping the subcategory), so "this is actually a rental" just works.
  const intent: 'sell' | 'rent' = categorySlug === 'rentals' ? 'rent' : 'sell'
  // Sale categories only — see the note on SALE_TO_RENT: in Rentals "Bán" led to an unlinked shelf.
  const showRentToggle = !edit && RENTABLE_SALE_CATS.has(categorySlug)
  // ⚠️ PICKING A CATEGORY IS DESTRUCTIVE AND COSTS ONE TAP — so it is undoable. Both pickers below
  // wipe the subcategory-specific answers (facets differ per category), and before this a seller who
  // had filled Phones › Used › 128GB and brushed "Home" lost all of it with no way back. The toast
  // restores the whole snapshot. One id, so quick successive changes replace the offer instead of
  // stacking toasts; only the latest snapshot is restorable, which is the one the seller means.
  // `toast` (it carries an action), not subtleToast. No apostrophe in the English half: the
  // gen-ui-strings harvester reads single-quoted literals only.
  const offerCategoryUndo = () => {
    const snap = { categorySlug, subcategorySlug, listingType, attrs, ranges, condition, brand, model }
    toast(t('Đã đổi danh mục — thông số cũ đã được xoá', 'Category changed — the old details were cleared'), {
      id: 'pw-cat-undo',
      duration: 6000,
      action: {
        label: t('Hoàn tác', 'Undo'),
        onClick: () => {
          setCategorySlug(snap.categorySlug)
          setSubcategorySlug(snap.subcategorySlug)
          setListingType(snap.listingType)
          setAttrs(snap.attrs)
          setRanges(snap.ranges)
          setCondition(snap.condition)
          setBrand(snap.brand)
          setModel(snap.model)
          setCatExpanded(false)
        },
      },
    })
  }
  // Answers a category switch would throw away. Only these earn an undo toast: a switch that loses
  // nothing (a first pick, or a change before anything was answered) is not worth interrupting.
  const answeredSpecifics = !!(condition || Object.values(attrs).some(Boolean) || Object.values(ranges).some((v) => v != null))

  const switchIntent = (to: 'sell' | 'rent') => {
    // Only sale → rent exists (the toggle is not shown in Rentals); 'sell' is the state it is already in.
    if (to === intent || to !== 'rent') return
    // The subcategory maps across (motorbike → motorbike-rental); only an unmappable one is lost.
    const mappedSub = SALE_TO_RENT[categorySlug]?.[subcategorySlug]
    if (answeredSpecifics || (subcategorySlug && !mappedSub)) offerCategoryUndo()
    setSubcategorySlug(mappedSub ?? '')
    setCategorySlug('rentals')
    setListingType('rent')
    // Facets differ across sale ↔ rentals → reset attribute/range/condition state.
    setAttrs({}); setRanges({}); setCondition('')
  }

  // After a pick collapses a chip grid, the chip that had focus is gone — put focus on the summary's
  // Change button, the control that now stands where the grid was. preventScroll: the seller's view
  // should follow their tap, not jump to wherever the button landed.
  const focusCategoryChange = () => requestAnimationFrame(() => changeCatRef.current?.focus({ preventScroll: true }))
  // …and the reverse: "Change" unmounts the moment it opens the grid, so focus moves to the chip that
  // is chosen — the one a keyboard user is most likely to keep, and a Tab away from the rest.
  const focusChosenCategory = () => requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-category-grid] [aria-pressed="true"]')?.focus({ preventScroll: true }))

  const chooseCategory = (slug: string) => {
    // ⚠️ RE-TAPPING THE CHOSEN CATEGORY IS A NO-OP. It used to re-run everything below and wipe the
    // subcategory, facets, condition and (for brandless categories) brand — the one guard the
    // short-lived RadioGroup had provided, lost when the chips went back to toggles. It still folds
    // the grid away, since "I meant this one" is exactly what the tap says.
    if (slug === categorySlug) { setCatExpanded(false); focusCategoryChange(); return }
    // Brand + model are cleared on EVERY switch (post-wizard-category.ts): Electronics → Vehicles
    // used to keep "Apple / iPhone". They are in offerCategoryUndo's snapshot, so Undo brings them back.
    if (categoryChangeLosesAnswers({ categorySlug, subcategorySlug, condition, attrs, ranges, brand, model })) offerCategoryUndo()
    const reset = categoryChangeReset(slug)
    setCategorySlug(reset.categorySlug)
    setSubcategorySlug(reset.subcategorySlug)
    setAttrs(reset.attrs)
    setRanges(reset.ranges)
    setCondition(reset.condition)
    setBrand(reset.brand)
    setModel(reset.model)
    setListingType(reset.listingType)
    setCatExpanded(false)
    focusCategoryChange()
  }
  /**
   * THE ONE SUBCATEGORY CHANGE — the subcategory chips and the "Gợi ý: …?" suggestion both come through
   * here, so accepting a suggestion cannot keep answers the picker would have dropped. Answers the new
   * shelf does not ask (or whose value it does not offer) go, with the category change's Undo when one
   * was really given (post-wizard-category.ts subcategoryChangeReset); answers it asks too stay.
   * Un-picking (next = '') drops nothing: the seller is about to pick again, and that pick decides.
   */
  const chooseSubcategory = (next: string) => {
    if (next === subcategorySlug) return
    if (next) {
      const reset = subcategoryChangeReset({ categorySlug, attrs, ranges, condition, brand, model }, next, { brandShown: brandShownFor(next) })
      if (reset.lost) offerCategoryUndo()
      setAttrs(reset.attrs); setRanges(reset.ranges); setCondition(reset.condition); setBrand(reset.brand); setModel(reset.model)
    }
    setSubcategorySlug(next)
  }

  const phoneOk = contactPhone.replace(/\D/g, '').length >= 9
  // Draft-first posting: anyone can fill the wizard; auth is asked at Publish
  // (and for the AI buttons, which burn paid credits).
  const isGuest = !authLoading && !user
  // Signed in, but the account's name/phone have not arrived: Publish waits (see submit()) — at most
  // ME_TIMEOUT_MS. Never on an EDIT: its contact is the storefront's, already on the listing.
  const profileLoading = !edit && !!user && !meLoaded
  const district = ward?.name || province?.name || ''
  const areaLabel = ward ? `${ward.name}${province ? `, ${province.name}` : ''}` : province ? province.name : (nearby ? t('Vị trí của bạn', 'Your location') : '')
  const hasLocation = !!(province || ward || nearby)
  const minPhotos = minPhotosFor(categorySlug)
  // Display suffix beside the amount. The STORED unit is the server's business
  // (listingMoneyFor in @/lib/taxonomy); this is only its translated shorthand.
  // Currency is not a variable here — every listing is composed and stored in ₫.
  // No "/ service" suffix — the published card does not show one either (see price.tsx, 2026-09-13).
  // A RENT price follows the seller's own "Kỳ thuê" chip, normalised exactly as the server stamps it
  // (rentalPeriodOf: 'long-term' and no answer both read monthly), so the field never says "/ tháng"
  // over a price the listing will store per day. Literal t() calls — gen-ui-strings harvests them.
  const rentPeriod = listingType === 'rent' ? rentalPeriodOf(attrs) : null
  const priceUnit = rentPeriod === 'hourly' ? t('/ giờ', '/ hour')
    : rentPeriod === 'daily' ? t('/ ngày', '/ day')
      : rentPeriod === 'weekly' ? t('/ tuần', '/ week')
        : listingType === 'rent' || listingType === 'job' ? t('/ tháng', '/ month') : ''
  /**
   * ⚠️ ON A `wanted` POST THE AMOUNT IS A BUDGET, NOT AN ASK — the poster is the BUYER, which is
   * the one intent that reverses the direction of a listing. Heading it "Price" asks someone what
   * they are charging for a thing they are trying to acquire, which reads as a mistake on the
   * first screen of the flow. `wholesale` keeps "Price" but says what it is priced BY, since a
   * bulk listing is quoted per unit far more often than per lot.
   */
  const priceHeading = listingType === 'wanted' ? t('Ngân sách', 'Budget') : t('Giá', 'Price')
  const priceHint = listingType === 'wanted'
    ? t('Bạn sẵn sàng trả bao nhiêu', 'What you are willing to pay')
    : listingType === 'wholesale'
      ? t('Giá mỗi sản phẩm', 'Price per unit')
      : ''

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
    // A photo-optional category (jobs: minPhotos 0) has no photo row at all — "Add 0 photos" is not a step.
    ...(minPhotos > 0 ? [{ key: 'photo', ok: photos.length >= minPhotos, label: minPhotos === 1 ? t('Thêm 1 ảnh', 'Add 1 photo') : t('Thêm 3 ảnh', 'Add 3 photos') }] : []),
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
    // A job has no price to set — its pay is the optional salary (see salaryPaid).
    ...(salaryPaid ? [] : [{ key: 'price', ok: price.trim().length > 0, label: t('Nhập giá', 'Set a price') }]),
    { key: 'location', ok: hasLocation, label: t('Chọn khu vực', 'Set the area') },
    // Guests (draft-first posting): contact comes from the account AFTER the
    // sign-in that submit() triggers — don't block the button on it here.
    isGuest
      ? { key: 'signin', ok: true, label: t('Đăng nhập để đăng tin', 'Sign in to publish') }
      // ⚠️ AN EDIT IS NEVER HELD BEHIND /api/me: its contact is already the storefront's, and the edit
      // route ignores an empty phone. Only once the account has actually ANSWERED does a missing name
      // or phone block a save, exactly as before.
      : { key: 'contact', ok: (!!edit && !meKnown) || (contactName.trim().length >= 2 && phoneOk), label: t('Thêm tên & SĐT của bạn', 'Add your name & phone') },
  ]
  const missing = checks.filter((c) => !c.ok)
  const canSubmit = missing.length === 0 && !submitting

  // What the seller SEES as progress — a display-only VIEW of `checks` (post-wizard-steps.ts explains
  // why the gate itself made a poor progress bar). It groups, names and hides gate rows but never
  // recomputes one, so the badge cannot call the form done while Publish still refuses it. The
  // contact step appears only once the account is known, and for a guest never.
  const steps = publishSteps({
    checks,
    photos: photos.length,
    minPhotos,
    missingFacetLabels: attrFacets.filter((f) => isRequiredFacet(f) && !attrs[f.key]).map((f) => tr(f.label, f.labelVi)),
    showContact: !authLoading && !isGuest && meLoaded,
    contactMissing: { name: contactName.trim().length < 2, phone: !phoneOk },
    t,
  })
  const pendingSteps = steps.filter((s) => !s.ok)
  // No number until it can be right: while auth (or a signed-in profile) is still loading, the set of
  // steps is not final, and a badge that reads 6 and then 5 looks like the form changed its mind.
  const countReady = !authLoading && (isGuest || meLoaded)
  const badgeCount = countReady ? pendingSteps.length : 0

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
    // minPhotos, NOT 3 — the same minPhotosFor() the checklist and the server gate use. A literal
    // 3 flagged a Services listing (min 1) with "Add at least 1 photo" and a red ring after the
    // seller had added exactly that one photo, while "Still needed" correctly omitted photos.
    photo: attempted && photos.length < minPhotos,
    category: attempted && !categorySlug,
    title: (touched.title || attempted) && title.trim().length < 3,
    // The 20-char minimum BLOCKS publish (see `checks`) but used to render no message at
    // all — the seller was bounced by a rule the form never stated.
    description: (touched.description || attempted) && description.trim().length < 20,
    price: !salaryPaid && (touched.price || attempted) && price.trim().length === 0,
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
  // The client check and the server's code say the same thing — and on a job, candidates write in.
  const contactInTextMsg = salaryPaid
    ? t('Không ghi số điện thoại, email, link hay địa chỉ nhà trong tin — ứng viên sẽ nhắn tin cho bạn trong ứng dụng. Hãy bỏ ra để đăng.', 'Do not put a phone number, email, link or street address in your job post — candidates message you in the app. Remove it to post.')
    : t('Không ghi số điện thoại, email, link hay địa chỉ nhà trong tin — người mua sẽ nhắn tin cho bạn trong ứng dụng. Hãy bỏ ra để đăng.', "Don't put a phone number, email, link or street address in your listing — buyers message you in the app. Remove it to post.")
  // Jump to (and focus) the first still-missing field when a publish attempt fails.
  /**
   * Jump to ONE named field. Extracted from scrollToMissing so the mobile "still needed" list can
   * send the seller to the item they actually tapped instead of always to the first one.
   * ⚠️ THE ID CONVENTION IS `pw-<key>` AND IT IS LOAD-BEARING — the title field's id must stay
   * exactly `pw-title` (see the landmine note in CLAUDE.md). Both callers go through here now, so
   * there is one place that knows the convention rather than two.
   */
  const scrollToField = (key: string) => {
    const el = document.getElementById(`pw-${key}`)
    el?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus({ preventScroll: true })
  }
  // The first step the seller SEES as outstanding, in form order. The gate's own first miss is the
  // fallback for the one case the steps hide on purpose: contact during the auth/profile load, where
  // the gate still blocks (see the note in submit()) and the steps show nothing to finish.
  const scrollToMissing = () => {
    const target = pendingSteps[0]?.target ?? missing[0]?.key
    if (target) scrollToField(target)
  }

  // ── Resume after sign-in: the seller pressed Publish as a guest and is now back, signed in, with
  // the account's details loaded. Ready → a one-tap "Publish now" banner (never an auto-submit, C26).
  // Phone missing → the form goes to the phone field once and says why, instead of a silent stop.
  const resumeReady = !edit && !submitted && publishIntentAt !== null && !!user && meLoaded
  const resumeCanPublish = resumeReady && missing.length === 0 && !submitting
  const resumeNeedsPhone = resumeReady && !phoneOk
  const resumePhoneShown = useRef(false)
  useEffect(() => {
    if (!resumeNeedsPhone || resumePhoneShown.current) return
    resumePhoneShown.current = true
    // After the paint that mounted the phone input (it replaces the Contact shimmer in this render).
    requestAnimationFrame(() => scrollToField('contactPhone'))
  }, [resumeNeedsPhone])
  // ⏱ THE INTENT EXPIRES IN THIS PAGE LOAD TOO, on the clock the restore path uses. A Publish that met
  // the gate here and was followed, much later, by an in-dialog sign-in would otherwise still offer
  // "Publish now"; at PUBLISH_INTENT_TTL_MS the intent is dropped (state, stored draft, address), which
  // is what takes resumeReady false. A timer, not a Date.now() in render: render stays pure, and the
  // banner's own tap re-checks the age, so a timer delayed by a throttled background tab cannot publish
  // a stale one either. Module helpers only, so the effect needs no function dependency.
  useEffect(() => {
    if (publishIntentAt === null) return
    const id = setTimeout(() => {
      setPublishIntentAt(null)
      dropStoredPublishIntent()
      stripResumeParam()
    }, Math.max(0, publishIntentAt + PUBLISH_INTENT_TTL_MS - Date.now()))
    return () => clearTimeout(id)
  }, [publishIntentAt])
  /** Leaving the flow without publishing: the intent goes (state AND the stored draft, since an
   *  unmount can beat the autosave), the draft itself stays for the TTL. */
  const dropPublishIntent = () => { setPublishIntentAt(null); dropStoredPublishIntent(); stripResumeParam() }
  /** "Discard" on the restored-draft notice: an empty form, an empty draft (both halves), no intent. */
  const discardDraft = () => {
    try { localStorage.removeItem('eno-listing-draft') } catch {}
    void clearDraftPhotos()
    dropPublishIntent()
    lostPhotoCount.current = 0
    carriedDescription.current = ''
    draftId.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    for (const p of photos) if (p.url.startsWith('blob:')) URL.revokeObjectURL(p.url)
    media.setPhotos([])
    media.removeVideo()
    setCategorySlug(''); setSubcategorySlug(''); setListingType('sell'); setAttrs({}); setRanges({})
    setTitle(''); setDescription(''); setPrice(''); setNegotiable(true); setUrgent(false)
    setCondition(''); setBrand(''); setModel(''); setProvince(null); setWard(null); setNearby(null)
    setCatExpanded(false); setTouched({}); setAttempted(false); setError(''); setErrorAction(null)
    setDraftNotice(null)
  }
  /**
   * "List another item" on the success screen. KEEPS what belongs to the SELLER — the area (and pin),
   * contact, the price type — and, in a moving sale, the category and its description (the sale's
   * context: pickup window, why everything goes). CLEARS what belongs to the ITEM: photos, video,
   * title, price, specifics, brand, and the category everywhere else.
   */
  const postAnother = () => {
    const movingSale = categorySlug === 'moving-sale'
    for (const p of photos) if (p.url.startsWith('blob:')) URL.revokeObjectURL(p.url)
    media.setPhotos([])
    media.removeVideo()
    lostPhotoCount.current = 0
    draftId.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const reset = categoryChangeReset(movingSale ? categorySlug : '')
    setCategorySlug(reset.categorySlug); setSubcategorySlug(reset.subcategorySlug); setAttrs(reset.attrs); setRanges(reset.ranges)
    setCondition(reset.condition); setBrand(reset.brand); setModel(reset.model); setListingType(movingSale ? reset.listingType : 'sell')
    setTitle(''); setPrice(''); setUrgent(false)
    if (!movingSale) setDescription('')
    // Kept context, not a draft: the autosave waits until the seller changes something.
    carriedDescription.current = movingSale ? description : ''
    setCatExpanded(false); setTouched({}); setAttempted(false); setError(''); setErrorAction(null)
    setCreatedId(null); setFirstListing(false); setPublishIntentAt(null); setDraftNotice(null)
    setSubmitted(false)
    window.scrollTo({ top: 0, behavior: scrollBehavior() })
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
    // Signed in, profile not here yet: the Publish button shows "Loading your details…" and a tap does
    // nothing. It used to fall through to scrollToMissing() and land on a still-shimmering Contact
    // section with no message (the wart the note below describes).
    if (profileLoading) return
    // ⚠️ CLEARED HERE, BEFORE THE CLIENT CHECKS — not only once the request starts. Every early
    // return below calls setError without touching errorAction, so a retry after an identity refusal
    // that then failed a client check (banned words, contact info) showed the new error beside a
    // stale "Verify your identity" button.
    setErrorAction(null)
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
      // was wrong. (The wart where the scroll landed on a still-shimmering Contact section with
      // no error text is fixed above: while the signed-in profile loads, a tap returns before here.)
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
      setError(contactInTextMsg)
      return
    }
    const blob = `${title} ${description} ${contactName}`
    if (findBannedWord(blob)) {
      countAttempt('client_banned_words')
      setError(t('Tin của bạn có từ ngữ không được phép. Vui lòng chỉnh sửa rồi đăng lại.', "Your listing contains a word that isn't allowed. Please edit it and try again."))
      return
    }
    // Draft-first: the listing is ready — NOW ask for the account. The text draft
    // is already in localStorage and the photos in IndexedDB (both survive an OAuth
    // redirect for DRAFT_TTL_MS); in-dialog OTP/email keeps them in memory too. After
    // sign-in the /api/me effect fills contact info.
    if (!user) {
      // ⚠️ THE MOST VALUABLE ONE. The form was complete and VALID and we asked for an
      // account — so this separates "could not fill the form" from "would not make an
      // account", opposite problems with opposite fixes. It is also the exact point where the
      // onboarding bounce used to destroy photos (1298c088), and nothing else can tell us
      // whether that fix helped.
      countAttempt('client_signin_required')
      // Remember that Publish was pressed — in the draft (autosave writes it) and in the address the
      // dialog sends the visitor back to, so a Google round trip comes back to a one-tap "Publish now".
      setPublishIntentAt(Date.now())
      setResumeParam(true)
      // Closed WITHOUT signing in (×, Esc, the backdrop): that Publish is abandoned, so a later and
      // unrelated sign-in — the AI gate, the header — must not come back offering "Publish now".
      openSignIn({ note: publishGateNote, onDismiss: dropPublishIntent })
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
        // An e-visa product chip the form did not ASK (a non-partner's new post on eno.vn, O-34) is not
        // sent either: an AI fill or a draft saved before the rule can still hold one, invisibly.
        attributes: Object.fromEntries(Object.entries(attrs).filter(([k, v]) => v && !(VISA_PRODUCT_FACET_KEYS.has(k) && !catFacets.some((f) => f.key === k)))),
        // Precise numeric specs → dedicated columns (year/mileageKm/engineL/salaryM). A spec cleared on
        // an edit is sent as null, and a JOB'S SALARY is sent on every edit — the rules and why are in
        // post-wizard-payload.ts.
        ...rangeColumnsPayload(
          rangeFacetsFor(categorySlug, subcategorySlug),
          ranges,
          edit as unknown as Record<string, unknown> | undefined,
          salaryFacet?.range.column,
        ),
        title: title.trim(),
        description: description.trim(),
        // ⛔ NO PRICE ON A JOB: the server derives it from salaryM and would ignore one anyway (paysSalary).
        ...(salaryPaid ? {} : { price: Number(price) }),
        negotiable: salaryPaid ? false : negotiable,
        // A NEW rental never goes out urgent — the row is hidden for it, and a restored draft or an AI
        // fill must not carry an invisible "Bán gấp" through. An edit keeps what the listing has.
        urgent: !edit && listingType === 'rent' ? false : urgent,
        district: district || null,
        city: province?.name || null,
        location: ward?.name || province?.name || null,
        lat: nearby?.lat ?? null,
        lng: nearby?.lng ?? null,
        condition: hasCondition ? condition || null : null,
        // ⛔ Never `brand: null` for a field the seller cannot see on an EDIT that kept its subcategory —
        // an apartment rental hides Brand, and a null would clear the brand the listing already has —
        // but an edit that MOVED it to a brandless subcategory clears it (post-wizard-payload.ts).
        ...brandModelPayload({ showBrand, brand, model, edit: !!edit, subcategoryChanged: !!edit && (subcategorySlug || null) !== (edit.subcategorySlug || null) }),
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
      // A job's salary is not a sale value — the post event carries 0 for one (as the server's CAPI Lead does).
      trackPostListing({ id: created.id, title: title.trim(), price: salaryPaid ? 0 : Number(price), currency: 'VND', category: cat?.name || categorySlug, district: district || undefined })
      try { localStorage.removeItem('eno-listing-draft') } catch {}
      void clearDraftPhotos()
      // Published — by the resume banner or the ordinary button alike: the intent is spent, and
      // `?resume=publish` leaves the address (a reload of the success screen is not a sign-in return).
      setPublishIntentAt(null)
      stripResumeParam()
      // First-ever publish gets a distinct celebration moment on the success
      // screen (device-local flag — celebration-grade accuracy is fine).
      try {
        setFirstListing(!localStorage.getItem('eno-posted-before'))
        localStorage.setItem('eno-posted-before', '1')
      } catch {}
      setCreatedId(created.id ?? null)
      // hapticConfirm, NOT haptic(18). haptics.ts names this exact case in its own docblock —
      // "a listing published" — and this line is the moment it describes. It used to fire a plain
      // tap: the screen threw a party (mascot + "Your first listing is live!") while the hand got
      // the same buzz as scrolling a chip. The edit path returns earlier, so this can only fire on
      // a genuine new publish, never on a PATCH.
      hapticConfirm()
      setSubmitted(true)
      onPosted?.() // embedded in dashboard → refresh listings + switch tab
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      // ⚖️ THE SELLER IDENTITY GATE (NĐ 248/2026) — only while it is enforced. A legal block, not a
      // content one: nothing in the form fixes it, so the message names the next step and a button
      // beside it takes them there.
      // ⚠️ THE VERIFY BUTTON OPENS A NEW TAB, AND THE COPY PROMISES NO SAVED DRAFT. The draft (text in
      // localStorage, photos in IndexedDB) expires after DRAFT_TTL_MS — 15 minutes — while a pending
      // review takes up to a working day, so navigating this tab away would lose the photos and the
      // text alike. Keeping this tab open is the only thing that actually keeps the work.
      const identityMsg = identityBlockMessage(msg, tr)
      setErrorAction(identityBlockAction(msg))
      if (identityMsg) { setError(identityMsg); hapticError(); console.error(e); return }
      setError(
        // ⚠️ THE THREE SPECIFIC CAUSES COME FIRST, because "try again" is actively wrong for all
        // of them: a rejected format or an oversized file will fail identically forever, and a
        // rate-limited caller retrying only digs deeper. Only the residual 'upload' — a genuine
        // transient — deserves the retry wording.
        // ⚠️ NO APOSTROPHES IN THESE STRINGS, AND THAT IS NOT A STYLE CHOICE.
        // gen-ui-strings.mjs harvests `t('…', '…')` with a regex that matches SINGLE-quoted
        // arguments only. An English half containing an apostrophe has to be written with
        // double quotes, which the pattern cannot see — so the string silently never reaches
        // the catalogue and the ~11 machine-translated languages fall back to English. Two of
        // these three did exactly that until a reviewer noticed the generated file gained only
        // one pair; verified by grepping ui-strings.ts, not by rereading the regex. Same family
        // as the template-literal trap already documented in set-password-form.tsx.
        msg === 'upload_type'
          ? t('Định dạng ảnh này không được hỗ trợ. Hãy dùng ảnh JPG, PNG hoặc WebP.', 'That photo format is not supported — use a JPG, PNG or WebP.')
          : msg === 'upload_size'
          ? t('Ảnh quá lớn (tối đa 12MB). Hãy chọn ảnh nhỏ hơn.', 'That photo is too large (12MB max) — pick a smaller one.')
          : msg === 'upload_broken'
          ? t('Không đọc được một ảnh trong số này. Hãy bỏ ảnh đó ra rồi đăng lại.', 'One of those photos could not be read — remove it and post again.')
          : msg === 'upload_rate_limited'
          ? t('Bạn đã tải lên quá nhiều ảnh trong một giờ. Hãy đợi một lát rồi thử lại.', 'You have uploaded a lot of photos this hour — wait a little and try again.')
          : msg === 'upload'
          ? t('Không tải được ảnh, vui lòng thử lại.', 'Could not upload your photos — please try again.')
          : msg === 'video'
          ? t('Không tải được video, vui lòng thử lại.', 'Could not upload your video — please try again.')
          : msg === 'video_hevc'
          ? t('Không xử lý được video HEVC này. Hãy xuất lại dạng MP4 (H.264): trên iPhone bật Cài đặt → Camera → Định dạng → Tương thích nhất.', "Couldn't process this HEVC video. Export it as MP4 (H.264) — on iPhone: Settings → Camera → Formats → Most Compatible.")
          : msg === 'contact_in_name'
          ? t('Tên liên hệ của bạn không được là email hay số điện thoại. Hãy đổi tên hiển thị trong Cài đặt rồi đăng lại.', "Your contact name can't be an email address or phone number. Change your display name in Settings, then post again.")
          : msg === 'no_phone_in_listing' || msg === 'contact_in_text'
          ? contactInTextMsg
          : msg === 'banned_words'
          ? t('Tin của bạn có từ ngữ không được phép. Vui lòng chỉnh sửa rồi đăng lại.', "Your listing contains a word that isn't allowed. Please edit it and try again.")
          // The urgent quota is ONE pool per seller across sales and jobs (src/lib/urgent.ts), so a job's
          // copy names its own chip ("Tuyển gấp") while counting the same two slots.
          : msg === 'urgent_quota'
          ? (salaryPaid
              ? t('Bạn đã có 2 tin gấp ("Tuyển gấp" hoặc "Bán gấp") đang chạy — chờ một tin hết hạn rồi thử lại.', 'You already have 2 urgent listings running (urgent hiring or urgent sale) — wait for one to expire and try again.')
              : t('Bạn đã có 2 tin "Bán gấp" đang chạy — chờ một tin hết hạn rồi thử lại.', 'You already have 2 urgent listings running — wait for one to expire and try again.'))
          : msg === 'urgent_cooldown'
          ? (salaryPaid
              ? t('Tin này vừa hết hạn "Tuyển gấp" — có thể bật lại sau 7 ngày.', 'This job just finished an urgent-hiring run — you can turn it on again after 7 days.')
              : t('Tin này vừa hết hạn "Bán gấp" — có thể bật lại sau 7 ngày.', 'This listing just finished an urgent run — you can turn it on again after 7 days.'))
          : msg === 'duplicate_listing'
          ? (salaryPaid
              ? t('Bạn đã có tin tuyển dụng đang hiển thị cho vị trí này. Vào Tin đăng để chỉnh sửa thay vì đăng lại.', 'You already have a live post for this job. Open My Listings to edit it instead of posting it again.')
              : t('Bạn đã có tin đang hiển thị cho sản phẩm này. Vào Tin đăng để chỉnh sửa hoặc xác nhận còn hàng thay vì đăng lại.', "You already have a live listing for this item. Open My Listings to edit it or confirm it's still available instead of posting it again."))
          : msg === 'location_required'
          ? (salaryPaid
              ? t('Hãy chọn vị trí cho tin tuyển dụng — ứng viên cần biết nơi làm việc.', 'Pick a location for your job — candidates need to know where the work is.')
              : t('Hãy chọn vị trí cho tin đăng — người mua cần biết món đồ ở đâu.', 'Pick a location for your listing — buyers need to know where the item is.'))
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
          // ⚠️ THE NUMBER COMES FROM THE CONSTANT, NEVER RETYPED. It said "8" while the server
          // enforced ENFORCEMENT.PROBATION.MAX_ACTIVE_LISTINGS, so raising the cap to 30 would
          // have left every blocked seller reading a limit that had not been true since the
          // change — the same trap `minPhotosFor` exists to prevent on the photo gate.
          // enforcement-machine.ts is the PURE state machine (no DB, no server-only), so the
          // client can import it; enforcement.ts, which cannot, is not what is imported here.
          : msg === 'probation_listing_cap'
          ? `${t('Tài khoản mới có thể giữ tối đa', 'New accounts can keep up to')} ${ENFORCEMENT.PROBATION.MAX_ACTIVE_LISTINGS} ${t('tin đang đăng — hãy đánh dấu đã bán một tin, hoặc chờ tài khoản đủ 30 ngày.', 'active listings — mark something sold or wait until your account is 30 days old.')}`
          // After a scam-hold RELEASE (released-charge-gate.ts): posting is back, capped while the
          // confirmed report stands. Same rule as above — the number from the constant.
          : msg === 'released_charge_listing_cap'
          ? `${t('Tạm dừng đã được gỡ, nhưng báo cáo đã xác nhận vẫn còn trong hồ sơ của bạn, nên bạn chỉ được giữ tối đa', 'Your hold was released, but the confirmed report stays on your record, so you can keep up to')} ${ENFORCEMENT.SCAM_RELEASED.MAX_ACTIVE_LISTINGS} ${t('tin đang đăng. Hãy đánh dấu đã bán hoặc ẩn một tin để đăng tin mới.', 'active listings. Mark one sold or hide one to post a new listing.')}`
          : msg === 'phone_taken'
          ? t('Số điện thoại này đã được một tài khoản khác sử dụng. Mỗi số chỉ dùng cho một tài khoản.', 'This phone number is already used by another account. Each number belongs to one account.')
          : t('Không gửi được, vui lòng thử lại.', 'Could not submit — please try again.'),
      )
      // ⚠️ THE REJECTION HAS TO BE FELT, NOT JUST PRINTED — this is the FIRST call site
      // hapticError has ever had. It shipped finished and documented and never once played,
      // while hapticConfirm fires on success just above. That asymmetry is worse than having
      // neither: the hand learns "buzz = it worked", so silence after a Publish tap reads as
      // success while the screen says the opposite. Every branch above is a submission the
      // app REJECTED, which is exactly the case haptics.ts reserves this texture for — and
      // deliberately NOT the ordinary gates (a sign-in prompt buzzing here would read as
      // punishment, which that same docblock warns against).
      hapticError()
      console.error(e)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }
  /** "Đăng tin ngay" on the resume banner. The intent is consumed first (so the banner cannot fire
   *  twice), and its AGE is checked at the tap — an intent past PUBLISH_INTENT_TTL_MS publishes
   *  nothing, even if the expiry timer has not run yet (a throttled background tab). */
  const publishFromResume = () => {
    const fresh = publishIntentAt !== null && Date.now() - publishIntentAt < PUBLISH_INTENT_TTL_MS
    dropPublishIntent()
    if (fresh) void submit()
  }

  if (submitted) {
    return <PostSuccess firstListing={firstListing} createdId={createdId} title={title} price={salaryPaid ? '' : price} job={salaryPaid} onPostAnother={embedded ? undefined : postAnother} t={t} />
  }

  const publishButtonProps = {
    onSubmit: submit,
    canSubmit,
    submitting,
    loadingProfile: profileLoading,
    edit: !!edit,
    missingCount: badgeCount,
    t,
  }

  // The category grid shows until something is chosen, then folds into a summary row. AI autofill and a
  // restored draft set the category too, so they land folded as well.
  const showCatGrid = !categorySlug || catExpanded
  // Curated order, unlinked shelves behind "More…" (post-wizard-category.ts). A category already chosen
  // from behind it (or by AI / a restored draft) keeps the whole list open, so the chosen chip shows.
  const { primary: primaryCats, more: moreCats } = orderPostCategories(categories)
  const showMoreCats = moreCatsOpen || moreCats.some((c) => c.slug === categorySlug)
  const gridCats = showMoreCats ? [...primaryCats, ...moreCats] : primaryCats
  const chosenSub = subOptions.find((s) => s.slug === subcategorySlug)
  // A string, not JSX: the "›" separator is not translatable copy, and as a variable it is not a
  // JSX literal either (react/jsx-no-literals).
  const categorySummary = cat ? (chosenSub ? `${tr(cat.name, cat.nameVi)} › ${tr(chosenSub.name, chosenSub.nameVi)}` : tr(cat.name, cat.nameVi)) : categorySlug
  const copy = postCopyFor(categorySlug, subcategorySlug)
  // "Suggestion: Phones?" under the title (sell-11): the keyword match the server already uses when a
  // post arrives with no subcategory, offered while the seller can still see it. Only a subcategory the
  // picker offers (subOptions — edition-aware), never the one already chosen, never one dismissed.
  const suggestedSlug = categorySlug && title.trim().length >= 3 ? suggestSubcategory(categorySlug, title) : undefined
  const subSuggestion = suggestedSlug && suggestedSlug !== subcategorySlug && suggestedSlug !== dismissedSuggestion
    ? subOptions.find((s) => s.slug === suggestedSlug)
    : undefined
  // A variable, not a JSX template literal (react/jsx-no-literals) — the name is the taxonomy's own.
  const subSuggestionLabel = subSuggestion ? `${t('Gợi ý', 'Suggestion')}: ${tr(subSuggestion.name, subSuggestion.nameVi)}?` : ''

  // No bottom padding guess on the form root any more. It used to reserve a hardcoded 14rem for the
  // mobile publish bar — "coupled with nothing", in its own words, and re-guessed three times as the
  // bar grew. The bar is now ui/sticky-action-bar, which MEASURES its panel and publishes the height;
  // <StickyActionBarSpacer /> at the end of this tree reserves exactly that, chips or no chips.
  return (
    <div>
      {/* Exit is a <Link>, not an <a>: inside the Capacitor WebView a raw anchor is a fresh
          HTTP load of the live site — blank screen, full document teardown. The draft is
          already autosaved to localStorage, so a soft nav loses nothing. */}
      {!embedded && (
        <Link href="/" onClick={dropPublishIntent} className="relative inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-accent-foreground transition-colors cursor-pointer tap-44">
          <ChevronLeft className="h-4 w-4" /> {t('Thoát', 'Exit')}
        </Link>
      )}
      {!embedded && <h1 className="mt-3 h-display text-foreground">{t('Tạo tin đăng', 'Create a listing')}</h1>}
      {/* ⚠️ THE PREVIEW HALF OF THIS SENTENCE IS DESKTOP-ONLY, BECAUSE THE PREVIEW IS.
          The `<Preview>` aside is `hidden lg:block` (line ~1090), so on a phone this line
          promised a thing the viewport cannot show — the seller reads "your preview updates
          live", looks for it, and there is nothing. A first-run instruction that describes a
          UI the reader does not have is worse than no instruction: it makes them think they
          have missed something.
          Two spans rather than two full sentences so the shared clause is translated once. */}
      {/* ⚠️ THE EM-DASH SEPARATOR IS A LITERAL, NOT PART OF ANY TRANSLATED STRING. The first
          version passed ' — your preview updates live.' with a LEADING SPACE, and
          scripts/gen-ui-strings.mjs trims what it harvests — so the catalogue recorded
          '— your preview…' while the runtime asked for ' — your preview…'. The keys would never
          have matched, so the pre-warmed dictionary and any curated vi-override would silently
          no-op for the ~11 machine-translated languages and fall back to the lazy path. A
          reviewer caught it. Keep translated strings free of leading/trailing whitespace. */}
      <p className={cn('text-base text-body', !embedded && 'mt-1')}>
        {t('Điền các mục bên dưới', 'Fill in the sections below')}
        {' — '}
        <span className="hidden lg:inline">{t('bản xem trước cập nhật ngay.', 'your preview updates live.')}</span>
        <span className="lg:hidden">{t('kiểm tra lại các mục trước khi đăng.', 'check each section before you publish.')}</span>
      </p>
      {draftNotice && (
        <div className="mt-4">
          <DraftNotice photosKept={draftNotice.photosKept} askPhotos={draftNotice.askPhotos} onDiscard={discardDraft} onDismiss={() => setDraftNotice(null)} t={t} />
        </div>
      )}
      {/* Back from sign-in with a complete form: one tap publishes it. ui/alert (the canon's callout),
          role="status" so a screen reader hears it arrive without the urgency of the primitive's default
          role="alert"; the button consumes the intent before it submits. */}
      {resumeCanPublish && (
        <Alert role="status" tone="success" appearance="flat" size="md" icon={<Check className="h-4 w-4" />} title={t('Đã đăng nhập', 'You are signed in')} className="mt-4 max-w-xl">
          <Button variant="cta" size="sm" type="button" className="mt-1.5" onClick={publishFromResume}>
            {t('Đăng tin ngay', 'Publish now')}
          </Button>
        </Alert>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_19rem]">
        {/* ── FORM ── */}
        <div className="min-w-0 space-y-10">
          {/* Photos (+ optional video) — moved verbatim to post-wizard-sections.tsx */}
          <MediaSection media={media} errPhoto={err.photo} minPhotos={minPhotos} aiEnabled={aiEnabled} aiBusy={aiBusy} autofillFromPhoto={autofillFromPhoto} isGuest={isGuest} categorySlug={categorySlug} subcategorySlug={subcategorySlug} t={t} />

          {/* Category & type */}
          <Section id="pw-category" title={t('Danh mục', 'Category')} hint={salaryPaid ? t('Chọn đúng danh mục để ứng viên dễ tìm thấy.', 'Pick the right category so candidates find you.') : t('Chọn đúng danh mục để người mua dễ tìm thấy.', 'Pick the right category so buyers find you.')}>
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
                {/* This pill occupies the picker's slot and shows the category that IS chosen —
                    it is the create flow's selected chip, frozen. So it fills, on the same rule
                    as that chip; a line glyph here would say "nothing picked" about the one
                    category the listing cannot change. Selection is structural (a listing always
                    has a category), not stateful, hence the literal. */}
                {cat && <CategoryIcon name={cat.icon} stroke={STROKE_UI} selected className="h-4 w-4 text-body" />}
                {cat ? tr(cat.name, cat.nameVi) : categorySlug}
                <span className="ml-1 text-xs font-normal text-ink-4">{t('(không đổi khi sửa)', '(fixed when editing)')}</span>
              </div>
            ) : !showCatGrid ? (
              // The chosen category (and subcategory), folded: the same frozen-pill idea as edit mode,
              // plus the one control that reopens the grid. The glyph is FILLED on the same rule as the
              // edit pill — it shows a category that IS chosen.
              <>
              <div className="flex max-w-md items-center gap-2 rounded-xl bg-tint px-3.5 py-2.5">
                {cat && <CategoryIcon name={cat.icon} stroke={STROKE_UI} selected className="h-4 w-4 shrink-0 text-body" />}
                <span id="pw-category-summary" className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{categorySummary}</span>
                <Button
                  ref={changeCatRef}
                  variant="bare"
                  size="none"
                  type="button"
                  onClick={() => { setCatExpanded(true); focusChosenCategory() }}
                  // The visible word stays "Change" (short, and what the eye expects); the summary it
                  // sits in is its description, so a screen reader hears what is being changed.
                  aria-describedby="pw-category-summary"
                  className="relative shrink-0 text-sm font-bold text-accent-foreground hover:underline cursor-pointer tap-44"
                >
                  {t('Đổi', 'Change')}
                </Button>
              </div>
              {/* Rentals has no sale/rent toggle any more (see SALE_TO_RENT), so the way back to SELLING
                  is named, one tap, and lands on the category grid — never on an unlinked shelf. */}
              {categorySlug === 'rentals' && (
                <p className="mt-2 text-xs text-ink-4">
                  {t('Muốn bán thay vì cho thuê?', 'Selling, not renting?')}{' '}
                  <Button
                    variant="bare"
                    size="none"
                    type="button"
                    onClick={() => { setCatExpanded(true); focusChosenCategory() }}
                    className="relative font-bold text-accent-foreground hover:underline cursor-pointer tap-44"
                  >
                    {t('Chọn danh mục khác', 'Pick another category')}
                  </Button>
                </p>
              )}
              </>
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
                  data-category-grid
                  // ⚠️ -mx-2 -mt-2, NOT -m-2. `p-2 -m-2` cancels the padding on all four sides for
                    // LAYOUT while the ring still paints 8px outside the box — so the error message
                    // below flowed straight through the ring's bottom edge and rendered struck out.
                    // Dropping only the negative BOTTOM margin lets that 8px occupy real space, so
                    // the message clears the ring, while the sides and top still avoid a shift when
                    // the error appears.
                    // rounded-2xl, not xl: the chips inside are pills now, and a 12px ring corner
                    // 8px outside a pill's curve clipped visually into the first chip's cap.
                    className={cn('flex flex-wrap gap-2 rounded-2xl transition-colors', err.category && '-mx-2 -mt-2 p-2 ring-2 ring-destructive/60')}
                >
                  {gridCats.map((c) => (
                    <Button
                      key={c.id}
                      variant="bare"
                      size="none"
                      type="button"
                      aria-pressed={categorySlug === c.slug}
                      data-cat-slug={c.slug}
                      onClick={() => chooseCategory(c.slug)}
                      // Same target recipe as <Chips> (post-wizard-parts): py-2.5 draws 40px, tap-44
                      // adds 2px each way — inside the row's 8px gap, so no chip reaches another.
                      // `icon-own-ink`: the selected pill is a solid bg-primary, so its glyph takes the
                      // label's white instead of the global accent recolour — accent on accent measured
                      // rgb(10,102,194) on rgb(10,102,194), an invisible icon (owner, 2026-09-27).
                      // Resting `bg-tint` pill, same states as <Chips> — see the note there.
                      className={cn('icon-own-ink relative gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors tap-44', categorySlug === c.slug ? 'bg-primary text-white' : 'bg-tint text-body hover:bg-accent hover:text-accent-foreground')}
                    >
                      {/* ⚠️ FILL IS THE SELECTION CUE (owner, 2026-08-07: "use icons filling only
                          when selected, not as default"). `selected` is the SAME boolean that
                          paints the pill — one comparison drives pill, aria-pressed and glyph, so
                          they can never disagree.
                          The old `[--color-brand-100:transparent]` override that sat here is GONE
                          and must not come back: it existed because the wash used to be baked in
                          unconditionally, and its whole job was to switch the tint OFF on the
                          selected chip — precisely the state that now has to fill. Re-adding it
                          would silently make this the one picker in the app that never fills. */}
                      <CategoryIcon
                        name={c.icon}
                        stroke={STROKE_UI}
                        selected={categorySlug === c.slug}
                        className={cn('h-4 w-4', categorySlug === c.slug ? 'text-white' : 'text-body')}
                      />
                      {tr(c.name, c.nameVi)}
                    </Button>
                  ))}
                  {!showMoreCats && moreCats.length > 0 && (
                    // Not a category — a disclosure. aria-expanded, not aria-pressed, and no glyph. It
                    // unmounts once used, so focus moves to the first chip it revealed instead of
                    // dropping a keyboard user onto <body>.
                    <Button
                      variant="bare"
                      size="none"
                      type="button"
                      aria-expanded={false}
                      onClick={() => {
                        const first = moreCats[0].slug
                        setMoreCatsOpen(true)
                        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-category-grid] [data-cat-slug="${first}"]`)?.focus({ preventScroll: true }))
                      }}
                      className="relative gap-1.5 rounded-full bg-tint px-4 py-2.5 text-sm font-semibold text-body transition-colors hover:bg-accent hover:text-accent-foreground tap-44"
                    >
                      {t('Khác…', 'More…')}
                    </Button>
                  )}
                </div>
                {err.category && <p id="pw-category-error" role="alert" className="mt-2 text-xs font-semibold text-destructive">{t('Chọn một danh mục', 'Pick a category')}</p>}
              </>
            )}

            {categorySlug && typeOptions.length > 1 && (
              <Field group label={t('Loại tin', 'Listing type')}>
                {/* In Rentals a Wanted post is someone LOOKING TO RENT — "Cần mua" there read as buying the flat. */}
                <Chips options={LISTING_TYPES.filter((lt) => typeOptions.includes(lt.value)).map((lt) => ({ value: lt.value, label: categorySlug === 'rentals' && lt.value === 'wanted' ? t('Cần thuê', 'Looking to rent') : tr(lt.label, lt.labelVi), icon: lt.icon }))} value={listingType} onPick={setListingType} />
              </Field>
            )}
            {/* Once a subcategory is picked it joins the category summary above, and its chips fold
                away with the grid — "Change" reopens both. Not in edit mode: there the category is
                frozen and has no summary row, so these chips are the only place the subcategory
                shows or can be changed. */}
            {categorySlug && subOptions.length > 0 && (!!edit || !subcategorySlug || catExpanded) && (
              <Field group label={t('Danh mục con', 'Subcategory')}>
                <Chips
                  options={subOptions.map((s) => ({ value: s.slug, label: tr(s.name, s.nameVi), icon: s.icon }))}
                  value={subcategorySlug}
                  onPick={(v) => {
                    const next = v === subcategorySlug ? '' : v
                    chooseSubcategory(next)
                    // A pick folds the chips into the summary, so focus follows to its Change button
                    // (the chip that held it is about to unmount). Un-picking keeps the chips open.
                    if (next) { setCatExpanded(false); focusCategoryChange() }
                  }}
                />
              </Field>
            )}
            {/* ⚠️ Base UI COMBOBOX, NOT <input list>. The native datalist drew a different widget in every
                browser (Chrome's ▼, nothing at all on iOS Safari) and could not lead with the brands
                that sell in THIS subcategory. Same creatable pattern as visa-cards' checkpoint field:
                `value` and `inputValue` are both the typed string, so free text is kept as typed and
                the resolver creates a new brand server-side, exactly as before.
                `id` goes on the ROOT: Base UI registers the root's id with the Field (the label's
                htmlFor) and the input inherits it, so the label both names and focuses the field. */}
            {showBrand && (
              <Field label={t('Thương hiệu', 'Brand')} optional hint={t('Giúp người mua tìm theo hãng. Bỏ trống nếu không có.', 'Helps buyers find you by brand. Leave blank if none.')}>
                <Combobox
                  id="pw-brand"
                  items={brandItems}
                  value={brand || null}
                  inputValue={brand}
                  onValueChange={(v) => setBrand(typeof v === 'string' ? v : '')}
                  onInputValueChange={(v) => setBrand(v.slice(0, 40))}
                  autoHighlight
                >
                  {/* The wizard's filled-input idiom (ui/input `filled`): tint, no border, the soft ring. */}
                  <ComboboxInputGroup className="max-w-md border-0 bg-tint">
                    <ComboboxInput
                      autoComplete="off"
                      maxLength={40}
                      placeholder={vehicleRental ? t('VD: Honda, Yamaha, VinFast', 'e.g. Honda, Yamaha, VinFast') : t('VD: Apple, Samsung, Honda', 'e.g. Apple, Samsung, Honda')}
                      className="px-4 placeholder:text-ink-4"
                    />
                    <ComboboxClear aria-label={t('Xoá thương hiệu', 'Clear brand')} />
                    {/* `aria-labelledby={undefined}`: inside a Field, Base UI labels the trigger with the
                        FIELD's label, which wins over aria-label — so this button was a second
                        "Brand (optional)" beside the input (measured). Unset, it is named by what it does. */}
                    <ComboboxTrigger aria-label={t('Mở danh sách thương hiệu', 'Open brand list')} aria-labelledby={undefined} />
                  </ComboboxInputGroup>
                  <ComboboxContent>
                    <ComboboxEmpty>{t('Không có trong danh sách — sẽ dùng đúng tên bạn nhập.', 'Not in the list — we will use the name you typed.')}</ComboboxEmpty>
                    <ComboboxList>
                      {(b: string) => <ComboboxItem key={b} value={b}>{b}</ComboboxItem>}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </Field>
            )}
            {/* Model suggestions exist only for a catalogue brand (they are keyed by its slug). The
                combobox is rendered either way so the input never remounts under a seller who is
                typing when the list arrives; with nothing to suggest, it simply never opens. */}
            {showBrand && brand.trim() && (
              <Field label={t('Mẫu / Model', 'Model')} optional hint={t('Giúp người mua lọc theo mẫu.', 'Lets buyers filter by model.')}>
                <Combobox
                  id="pw-model"
                  items={modelItems}
                  value={model || null}
                  inputValue={model}
                  onValueChange={(v) => setModel(typeof v === 'string' ? v : '')}
                  onInputValueChange={(v) => setModel(v.slice(0, 60))}
                  open={modelOpen && modelItems.length > 0}
                  // Only RECORD an open that has something to show. Recorded while the list was empty,
                  // it outlived the field (Base UI sends no close for a popup it never showed) and the
                  // list sprang open on its own the moment a later brand's models arrived.
                  onOpenChange={(next) => setModelOpen(next && modelItems.length > 0)}
                  autoHighlight
                >
                  <ComboboxInputGroup className="max-w-md border-0 bg-tint">
                    <ComboboxInput
                      autoComplete="off"
                      maxLength={60}
                      placeholder={tr(copy.model, copy.modelVi)}
                      className="px-4 placeholder:text-ink-4"
                    />
                    <ComboboxClear aria-label={t('Xoá mẫu', 'Clear model')} />
                    {modelItems.length > 0 && <ComboboxTrigger aria-label={t('Mở danh sách mẫu', 'Open model list')} aria-labelledby={undefined} />}
                  </ComboboxInputGroup>
                  <ComboboxContent>
                    <ComboboxEmpty>{t('Không có trong danh sách — sẽ dùng đúng tên bạn nhập.', 'Not in the list — we will use the name you typed.')}</ComboboxEmpty>
                    <ComboboxList>
                      {(m: string) => <ComboboxItem key={m} value={m}>{m}</ComboboxItem>}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </Field>
            )}
          </Section>

          {/* Details */}
          <Section title={t('Chi tiết', 'Details')}>
            {/* `className="max-w-2xl"` caps the label row to the control's width, so the counter ends
                at the field's right edge. aria-required, NOT the native `required` attribute: native
                would light up :invalid styling on a pristine form, and this form validates in state. */}
            <Field label={salaryPaid ? t('Chức danh', 'Job title') : t('Tiêu đề', 'Title')} counter={`${title.length}/${TITLE_MAX}`} error={titleErr} className="max-w-2xl">
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
                    aria-required
                    // The example is the category's own (src/lib/post-copy.ts) — a phone title under
                    // Jobs taught sellers the wrong listing.
                    placeholder={tr(copy.title, copy.titleVi)}
                    className={cn('max-w-2xl', err.title && 'ring-2 ring-destructive/60')}
                  />
                }
              />
            </Field>
            {subSuggestion && (
              // gap-3, not gap-1: the ✕ is a 28px button with a 44px hit area (8px past each side), so
              // anything under 8px let a tap meant for "dismiss" land on the suggestion, and the reverse.
              <div className="flex items-center gap-3">
                {/* ui/chip, an ACTION chip (no `pressed`): tapping it applies the suggestion. 28px tall,
                    so `tap-44` (with `relative`, see globals.css) gives it the 44px target. */}
                {/* Accepting takes the picker's own path (chooseSubcategory: stale specifics go, with Undo),
                    and the chip then unmounts — so focus returns to the title it was suggested from. */}
                <Chip
                  size="xs"
                  tone="neutral"
                  className="relative tap-44"
                  onClick={() => {
                    chooseSubcategory(subSuggestion.slug)
                    requestAnimationFrame(() => document.getElementById('pw-title')?.focus({ preventScroll: true }))
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {subSuggestionLabel}
                </Chip>
                <CloseButton size="xs" label={t('Bỏ qua gợi ý', 'Dismiss suggestion')} onClick={() => setDismissedSuggestion(subSuggestion.slug)} />
              </div>
            )}
            {/* `pw-description` stays on the WRAPPER — it is the scroll anchor, and other
                code may look it up. Only the title's id lives on its control. */}
            <Field
              id="pw-description"
              className="max-w-2xl"
              label={t('Mô tả', 'Description')}
              // The 20-character minimum BLOCKS publish, so the counter states it until it is met —
              // a bare "0/5000" told the seller about a ceiling nobody reaches and hid the floor
              // everybody hits. The number sits OUTSIDE t() so the phrase is harvestable.
              counter={description.trim().length < 20 ? `${t('Tối thiểu 20 ký tự', 'Min. 20 characters')} · ${description.trim().length}` : `${description.length}/${DESC_MAX}`}
              hint={tr(copy.hint, copy.hintVi)}
              error={descErr}
              // "Polish with AI" rides in the label row (it had a row of its own between label and
              // field). Its tap-44 reach now spills ~4px past the 6px gap into the textarea's top edge
              // — which is why the textarea stays `relative`: a positioned box later in the DOM wins
              // the hit test for its own pixels, so a tap on the field's edge focuses the field and
              // can never rewrite the description with paid AI.
              labelAction={aiEnabled ? (
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
                  className="relative gap-1 rounded-lg px-2 py-1 text-2xs font-bold text-accent-foreground transition-colors hover:bg-muted disabled:pointer-events-auto disabled:opacity-40 cursor-pointer tap-44"
                >
                  {aiBusy === 'desc' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {t('Chỉnh bằng AI', 'Polish with AI')}
                  {/* The gate, stated before the tap. Desktop only: at 390px the label row holds the
                      label, this button and the counter, and the photo tile's Autofill button above
                      already tells a guest the same thing. */}
                  {isGuest && <span className="hidden font-semibold text-ink-4 sm:inline">{t('· miễn phí khi có tài khoản', '· free with an account')}</span>}
                </Button>
              ) : undefined}
            >
              <FieldControl
                render={
                  <Textarea
                    value={description}
                    maxLength={DESC_MAX}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => touch('description')}
                    aria-required
                    rows={5}
                    placeholder={salaryPaid ? t('Mô tả công việc, yêu cầu và quyền lợi…', 'Describe the role, requirements and benefits…') : t('Mô tả chi tiết…', 'Describe it in detail…')}
                    // `relative` so the field keeps its OWN taps: the "Polish with AI" button in the
                    // label row carries tap-44, whose hit area reaches ~4px past the 6px gap into this
                    // box, and a positioned pseudo paints (and hit-tests) above an unpositioned sibling.
                    // A tap on the field's top edge must focus it, never rewrite the description with AI.
                    className={cn('relative max-w-2xl resize-none', err.description && 'ring-2 ring-destructive/60')}
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
                  {/* The taxonomy's own labels (sell-09): the stored value 'new' covers "like new" too, and
                      browse already names it "Mới / Như mới" — a bare "Mới" here pushed a barely-used item
                      into "Đã dùng". A graded scale is owner decision C6. */}
                  <Chips options={(catFacets.find((f) => f.key === 'condition') ?? CONDITION_FACET).options.map((o) => ({ value: o.value, label: tr(o.label, o.labelVi) }))} value={condition} onPick={setCondition} />
                </Field>
              )}
              {/* REQUIRED FACETS FIRST, then the optional ones marked "(optional)". Taxonomy order put
                  the optional electronics specs (Storage, RAM, Connectivity) ahead of the required
                  Warranty and Colour, so the seller answered three questions nobody asked for before
                  reaching the two that block Publish. The sort is stable, so each group keeps its
                  taxonomy order; `pw-details` (the scroll anchor) now lands on a required facet. */}
              {orderedFacets.map((f, fi) => (
                <Field group key={f.key} id={fi === 0 ? 'pw-details' : undefined} label={tr(f.label, f.labelVi)} optional={!isRequiredFacet(f)} error={err.details && isRequiredFacet(f) && !attrs[f.key] ? t('Hãy chọn một mục', 'Pick one') : undefined}>
                  {f.kind === 'range' && f.range ? (
                    <RangeSpecInput range={f.range} value={ranges[f.key] ?? null} onChange={(v) => setRanges((prev) => ({ ...prev, [f.key]: v }))} />
                  ) : (
                    <Chips options={f.options.map((o) => ({ value: o.value, label: tr(o.label, o.labelVi) }))} value={attrs[f.key] || ''} onPick={(v) => setAttrs((prev) => ({ ...prev, [f.key]: prev[f.key] === v ? '' : v }))} />
                  )}
                </Field>
              ))}
            </Section>
          )}

          {/* Pay. A JOB gets its Salary section here and NO Price section at all (see salaryPaid);
              everything else keeps Price — moved verbatim to post-wizard-sections.tsx. */}
          {salaryPaid ? (
            salaryFacet && <SalarySection
              range={salaryFacet.range}
              salary={salary}
              setSalary={(v) => setRanges((prev) => ({ ...prev, [salaryFacet.key]: v }))}
              urgent={urgent}
              setUrgent={setUrgent}
              t={t}
            />
          ) : (
          <PriceSection
            price={price}
            setPrice={setPrice}
            touch={touch}
            errPrice={err.price}
            priceErr={priceErr}
            priceBand={priceBand}
            priceUnit={priceUnit}
            priceHeading={priceHeading}
            priceHint={priceHint}
            negotiable={negotiable}
            setNegotiable={setNegotiable}
            urgent={urgent}
            setUrgent={setUrgent}
            /**
             * ⛔ AND ON A `wanted` POST, BECAUSE THE OFFER MECHANIC IS SELLER-SIDE AND THIS POSTER
             * IS THE BUYER. "Accept offers" invites strangers to haggle DOWN a budget its author
             * is offering to PAY, and "Bán gấp"/urgent announces a seller in a hurry on a post with
             * nothing to sell. Both are the direction reversal this intent introduces, and both
             * were shipped unhandled in the first cut — the comment beside LISTING_TYPES said
             * anything reading listingType "has to account for that" and then only the price
             * heading did. Two reviewers called that out; this is the rest of it.
             * ⚠️ Reuses the SERVICES lever rather than adding a second one: services already sell
             * at a stated price with no offers and no urgency, which is exactly the shape wanted.
             */
            fixedPriceOnly={categorySlug === 'services' || listingType === 'wanted'}
            // A rental is not a sale in a hurry: no "Bán gấp" row (sell-13). Offers stay open.
            // ⚠️ EXCEPT ON AN EDIT OF A RENTAL THAT IS URGENT NOW (switched on before this rule): hiding
            // the row there left no way to end the run, since the edit resends `urgent` unchanged.
            hideUrgent={listingType === 'rent' && !edit?.urgent}
            // The tỷ (×1.000.000.000) chip only where a price in the billions is plausible — a car,
            // a house, a wholesale lot, or before a category says otherwise. On a phone it was one
            // mistap from a 1,000× price.
            maxFactor={!categorySlug || categorySlug === 'vehicles' || categorySlug === 'property' || listingType === 'wholesale' ? 1_000_000_000 : 1_000_000}
            t={t}
          />
          )}

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
            audience={salaryPaid ? 'candidates' : 'buyers'}
            resumePhonePrompt={resumeNeedsPhone}
            t={t}
          />

          {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
          {error && errorAction === 'verify' && (
            <Button asChild variant="cta" size="sm">
              {/* Web: a NEW TAB, so this form and its photos stay open (see the catch in submit()).
                  Native: a soft nav — a target=_blank anchor inside the Capacitor WebView is not a
                  tab, and the Exit link below explains why a raw anchor there is a full reload. */}
              {isNativeShell()
                ? <Link href={IDENTITY_VERIFY_PATH}>{t('Xác minh danh tính', 'Verify your identity')}</Link>
                : <a href={IDENTITY_VERIFY_PATH} target="_blank" rel="noopener">{t('Xác minh danh tính (mở thẻ mới)', 'Verify your identity (opens a new tab)')}</a>}
            </Button>
          )}
          {error && errorAction === 'sign_in' && (
            <Button variant="cta" size="sm" onClick={() => openSignIn()}>
              {t('Đăng nhập để xác minh', 'Sign in to verify')}
            </Button>
          )}
        </div>

        {/* ── PREVIEW + PUBLISH (desktop) ── */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">
            <div className="space-y-2">
              {/* A heading, not a kicker: eyebrows are retired (owner, wow design pass), and this names
                  the region a screen-reader user would otherwise have to discover by reading it. */}
              <h2 className="text-sm font-semibold text-foreground">{t('Xem trước', 'Preview')}</h2>
              {/* A job previews its SALARY (or the negotiable state), never a price (see salaryPaid). */}
              <Preview
                cover={photos[0]?.url}
                title={title}
                price={salaryPaid ? (salaryAmount > 0 ? String(salaryAmount) : '') : price}
                priceUnit={priceUnit}
                area={areaLabel}
                categoryIcon={cat?.icon}
                // The SAME words the published card prints for a job with no salary (<Price>, linked=false) —
                // the preview promises the line candidates will read (review, 2026-10-01).
                emptyPriceLabel={salaryPaid ? t('Lương: thỏa thuận', 'Salary: negotiable') : undefined}
                t={t}
              />
            </div>
            <PublishButton {...publishButtonProps} />
            {pendingSteps.length > 0 && (
              <ul className="space-y-1.5 pt-1">
                {steps.map((s) => (
                  <li key={s.key} className={cn('flex items-center gap-2 text-xs', s.ok ? 'text-ink-4 line-through' : 'text-body')}>
                    <span className={cn('flex h-4 w-4 items-center justify-center rounded-full', s.ok ? 'text-success' : 'text-ink-4')}>
                      {s.ok ? <Check className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                    </span>
                    {s.ok ? s.name : s.todo}
                  </li>
                ))}
              </ul>
            )}
            {/* Sign-in is not a step a guest can tick, so it is said in words, once — never as a
                struck-through "done" row for a thing the seller has not done. */}
            {isGuest && (
              <p className="flex items-center gap-1.5 text-2xs text-ink-4">
                <User className="h-3.5 w-3.5" />
                {t('Đăng nhập ở bước cuối, khi bạn đăng tin', 'Sign-in comes last, when you publish')}
              </p>
            )}
            {/* First-party protection claim ("your number stays private") → the eno seal,
                not a generic lucide lock: §0b reserves exactly this moment for the
                signature, at the inline 14px echo tier. */}
            <p className="flex items-start gap-1.5 pt-1 text-2xs leading-relaxed text-ink-4">
              <ShieldCheck className="mt-px h-3.5 w-3.5" />
              {t('Tin hiển thị ngay. Số của bạn được giữ kín.', 'Goes live instantly. Your number stays private.')}
            </p>
          </div>
        </aside>
      </div>

      {/* ── PUBLISH (mobile) ── ui/sticky-action-bar: it sits above the floating tab bar (offset
          4.5rem, the StepWizard canon), measures itself for the spacer at the end of this tree, and
          drops the tab-bar clearance while the keyboard is up (.kb-bottom). The CTA stays solid while
          the form is incomplete — dimming it made a working button look dead (PublishButton's note).
          ⚠️ MOUNTED LAST, AGAINST THE PRIMITIVE'S "MOUNT EARLY" ADVICE, ON PURPOSE: in a form, Publish
          belongs AFTER the fields in tab order — a keyboard user fills the form, then reaches it.
          ⚠️ The "Still needed" chips appear only after a failed Publish. They used to sit in the bar
          permanently, a 200px block of fixed chrome over a form that had barely started; the count
          badge, the desktop checklist and the red per-field flags already carry the same news.
          `null`, not `undefined`, when there is nothing to show: it keeps the bar's stacked shape, so
          the Publish button is never remounted (and never drops focus) when the chips arrive. */}
      <StickyActionBar
        className="lg:hidden"
        offsetBottom="4.5rem"
        label={edit ? t('Lưu thay đổi', 'Save changes') : t('Đăng tin', 'Publish listing')}
        // Not `render`: `disabled` flips while the seller watches, and the primitive's own note
        // says to take the plain path for exactly that.
        primary={{ label: <PublishLabel submitting={submitting} loadingProfile={profileLoading} edit={!!edit} missingCount={badgeCount} t={t} />, onClick: submit, disabled: submitting, loading: profileLoading }}
        above={attempted && pendingSteps.length > 0 ? (
          // ⚠️ ONE ROW: the label beside a horizontal scroller, never `flex-wrap`. The row's height is
          // constant however many items are outstanding, and nothing is ever clipped mid-word
          // (`shrink-0` on each chip). Each chip jumps to its own field — the list IS the navigation.
          <div className="flex items-center gap-2">
            <p className="shrink-0 text-2xs font-semibold text-ink-4">{t('Còn thiếu', 'Still needed')}</p>
            <div className="-mr-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto scrollbar-none pr-1">
              {pendingSteps.map((s) => (
                <Button
                  key={s.key}
                  type="button"
                  variant="bare"
                  size="none"
                  onClick={() => scrollToField(s.target)}
                  // min-h-9 py-2, NOT tap-44: this row is an overflow-x scroller, which clips a
                  // pseudo-element hit area to its own box — the chip has to BE the target.
                  className="press min-h-9 shrink-0 whitespace-nowrap rounded-full bg-warning/10 px-2.5 py-2 text-2xs font-semibold text-warning cursor-pointer"
                >
                  {s.todo}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      />

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
      {/* Stands in for the mobile bar at the end of the flow — the same `lg:hidden` as the bar.
          ⚠️ PLUS THE TAB BAR'S 4.5rem (`h-18`, the same length as `offsetBottom` above), which the
          spacer deliberately leaves out: it counts on the app-wide <BottomNavSpacer /> for that, and
          the BottomNavSpacer sits after the FOOTER. At the end of the form the bar stands 72px panel +
          72px offset tall over a reserve of 72px + main's pb-12, so the Contact section ended 24px
          under the Publish button (measured at 390×844) — reachable only by scrolling on into the
          footer. The reserve belongs to the form, so it goes here. */}
      <StickyActionBarSpacer className="lg:hidden" />
      <div aria-hidden className="h-18 lg:hidden" />
    </div>
  )
}

