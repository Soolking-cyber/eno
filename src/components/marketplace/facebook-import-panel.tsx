'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { X } from '@/components/ui/icons'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { facebookAvailableHere, facebookIosApp } from '@/lib/facebook-signin'
import { startFacebookConnect } from '@/lib/facebook-connect-client'
import { FacebookImportProgress } from './facebook-import-progress'
import { VndInput } from './vnd-input'
import { areaAt, ImportLocationPicker, type ImportPlace } from './import-location-picker'
import { fillTemplate } from '@/lib/i18n/placeholders'
import { askableFacetsFor, isRequiredFacet } from '@/lib/taxonomy'
import { IMPORT_CATEGORY_SLUGS } from '@/lib/fb-import/categories'
import { TAXONOMY } from '@/lib/taxonomy'

type Item = {
  id: string; status: string; title: string | null; description: string | null; titleVi: string | null; descriptionVi: string | null; fbTitle: string; fresh: boolean
  price: number | null; fbPrice: string | null; district: string | null; city: string | null; categorySlug: string | null; subcategorySlug: string | null; listingType: string | null
  attributes: Record<string, unknown> | null; reason: string | null; listingId: string | null; photo: string | null; photoCount: number
}
type State = { on: boolean; connected: boolean; phone: string | null; job: { id: string; status: string; createdAt: string; items: Item[] } | null }

/**
 * My listings › Import from Facebook (owner, 2026-11-04): connect if needed, read, review, publish. How it works and why it runs from a worker on the box: src/lib/fb-import/shared.ts.
 * A browser, or the iOS app through its in-app browser sheet (facebookIosApp), like Connect: Meta's dialog doesn't run in a webview. Nothing goes public until Publish.
 */
export function FacebookImportPanel() {
  const { tr, lang } = useLanguage()
  const { user } = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const [state, setState] = useState<State | null>(null)
  const [canRunHere, setCanRunHere] = useState(false)
  const [starting, setStarting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [phone, setPhone] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [results, setResults] = useState<Record<string, string>>({})
  // Drafts the seller removed with ✕, hidden at once while the server marks them skipped.
  const [gone, setGone] = useState<Set<string>>(new Set())

  const reasonText = useCallback((code: string | null): string | null => {
    if (!code) return null
    const words: Record<string, string> = {
      no_category: tr('Choose a category.', 'Hãy chọn danh mục.'),
      price_required: tr('Add a price in đồng.', 'Hãy thêm giá bằng đồng.'),
      location_required: tr('Add a ward or district to the location above.', 'Hãy thêm phường hoặc quận vào vị trí ở trên.'),
      location_contact: tr('Remove phone numbers, contact details or words we don’t allow from the location above.', 'Hãy bỏ số điện thoại, thông tin liên hệ hoặc từ không được phép khỏi vị trí ở trên.'),
      contact_in_text: tr('Remove the phone number or contact details from the text.', 'Hãy bỏ số điện thoại hoặc thông tin liên hệ khỏi nội dung.'),
      banned_words: tr('The text has a word we don’t allow.', 'Nội dung có từ không được phép.'),
      title_short: tr('The title is too short.', 'Tiêu đề quá ngắn.'),
      translation_failed: tr('We couldn’t write the other language just now. Press Publish again in a minute.', 'Chưa viết được ngôn ngữ còn lại. Hãy nhấn Đăng lại sau một phút.'),
      photos_expired: tr('The photos could not be fetched any more. Import again to refresh them.', 'Không còn tải được ảnh. Hãy nhập lại để làm mới.'),
      phone_required: tr('Add your contact phone above.', 'Hãy thêm số điện thoại liên hệ ở trên.'),
      phone_taken: tr('That phone number belongs to another account.', 'Số điện thoại này thuộc về tài khoản khác.'),
      duplicate_listing: tr('You already have this listing here.', 'Bạn đã có tin này ở đây.'),
      not_available: tr('This one has already been handled.', 'Tin này đã được xử lý.'),
      photo_required: tr('This listing doesn’t have enough different photos. Add it from the post form with more photos.', 'Tin này chưa đủ ảnh khác nhau. Hãy đăng bằng biểu mẫu với nhiều ảnh hơn.'),
      missing_details: tr('Answer the details above.', 'Hãy trả lời các chi tiết ở trên.'),
      account_held: tr('Your account can’t post right now.', 'Tài khoản của bạn hiện không thể đăng tin.'),
      account_suspended: tr('Your account can’t post right now.', 'Tài khoản của bạn hiện không thể đăng tin.'),
      account_restricted: tr('Your account can’t post right now.', 'Tài khoản của bạn hiện không thể đăng tin.'),
      probation_listing_cap: tr('You’ve reached the limit of listings for a new account.', 'Bạn đã đạt giới hạn số tin của tài khoản mới.'),
    }
    return words[code] ?? tr('This one couldn’t be published. Open it from the post form instead.', 'Không đăng được tin này. Hãy đăng bằng biểu mẫu.')
  }, [tr])

  const load = useCallback(async () => {
    const r = await fetch('/api/fb-import', { cache: 'no-store' }).catch(() => null)
    if (r?.ok) setState((await r.json()) as State)
  }, [])

  useEffect(() => { setCanRunHere(facebookAvailableHere() || facebookIosApp()); if (user) void load() }, [user, load])

  // While a job is moving, look again. A person is watching this; a closed tab asks nothing.
  const status = state?.job?.status
  useEffect(() => {
    if (status !== 'queued' && status !== 'reading' && status !== 'sorting') return
    const t = setInterval(() => void load(), 8000)
    return () => clearInterval(t)
  }, [status, load])

  const outcome = params.get('fbi')
  useEffect(() => {
    if (!outcome) return
    const words: Record<string, [string, string]> = {
      queued: ['We’re reading your listings. You can leave this page.', 'Chúng tôi đang đọc các tin của bạn. Bạn có thể rời trang này.'],
      active: ['An import is already running.', 'Một lần nhập đang chạy.'],
      no_picture: ['Your Facebook account needs a profile picture for us to find it.', 'Tài khoản Facebook của bạn cần có ảnh đại diện để chúng tôi tìm thấy.'],
      other: ['That isn’t the Facebook connected to this account.', 'Đó không phải Facebook đã kết nối với tài khoản này.'],
      held: ['That Facebook account already belongs to another eno account.', 'Tài khoản Facebook này đã thuộc về một tài khoản eno khác.'],
      refused: ['Facebook can’t be connected to this account.', 'Không thể kết nối Facebook với tài khoản này.'],
      failed: ['That didn’t work. Please try again.', 'Chưa thực hiện được. Vui lòng thử lại.'],
    }
    const w = words[outcome]
    if (w) (outcome === 'queued' ? toast.success : toast.error)(tr(w[0], w[1]))
    const next = new URLSearchParams(params.toString())
    next.delete('fbi')
    router.replace(`?${next.toString()}`, { scroll: false })
    void load()
    // Once per outcome: tr, params and router change identity between renders.
  }, [outcome])

  // A number already on file means nothing to type at Publish.
  useEffect(() => { if (state?.phone) setPhone((p) => p || (state.phone as string)) }, [state?.phone])
  const drafts = useMemo(() => (state?.job?.items ?? []).filter((i) => i.status === 'draft' && !gone.has(i.id)), [state, gone])
  const chosen = drafts.filter((d) => picked.has(d.id))
  useEffect(() => { setPicked(new Set(drafts.filter((d) => !d.reason && d.price != null).map((d) => d.id))) }, [state?.job?.id, state?.job?.status])

  // ⛔ ONE PLACE FOR THE WHOLE IMPORT, CHECKED BY THE SELLER BEFORE ANYTHING IS PUBLISHED (owner, 2026-11-07: "imported post has wrong location … ask the user
  // if location is correct … not per product but for whole import with default as taken from fb but they have to review it before posting no new buttons").
  // It starts as the place Facebook gave most of these listings; Publish says "Check the location first" until the box is ticked, and every listing gets it.
  // The tick confirms the place as shown: any change to it unticks it (commit gate, codex + opus). Picked with the city and ward picker, an address search
  // and a map pin (owner, 2026-11-07: "like when you pin location on shoppee or … grab"; import-location-picker.tsx).
  const [place, setPlaceRaw] = useState<ImportPlace>({ province: null, ward: null, lat: null, lng: null })
  // `touched`: the seller changed the place, so the default's late answer never lands on their pick (commit gate, opus).
  const touched = useRef(false)
  // The tick confirms the city and ward: a new pin inside the same ones (the ward's own search, a nudge) leaves it ticked (commit gate, opus).
  const setPlace = (next: ImportPlace) => {
    touched.current = true
    if (place.province?.name !== next.province?.name || place.ward?.name !== next.ward?.name) setAreaOk(false)
    setPlaceRaw(next)
  }
  const [areaOk, setAreaOk] = useState(false)
  // Read by the default pin's late answer: it never moves a place the seller has already confirmed.
  const areaOkRef = useRef(false)
  useEffect(() => { areaOkRef.current = areaOk }, [areaOk])
  const placeReady = !!place.province?.name && !!place.ward?.name
  // ⛔ ONCE PER IMPORT, when its drafts are there: a seller's own correction and tick are never put back by a later poll or the job finishing (commit gate, opus).
  const areaFor = useRef<string | null>(null)
  // A new import is never published on the last one's tick (commit gate, codex + opus).
  useEffect(() => { setAreaOk(false) }, [state?.job?.id])
  useEffect(() => {
    const jobId = state?.job?.id ?? null
    const st = state?.job?.status
    // Not while the import runs: the first draft's place is not yet "the place most listings had" (commit gate, opus).
    if (!jobId || areaFor.current === jobId || drafts.length === 0 || st === 'queued' || st === 'reading' || st === 'sorting') return
    areaFor.current = jobId
    const count = new Map<string, { n: number; district: string; city: string | null }>()
    for (const d of drafts) if (d.district) { const k = `${d.district}|${d.city ?? ''}`; const c = count.get(k); count.set(k, { n: (c?.n ?? 0) + 1, district: d.district, city: d.city }) }
    const top = [...count.values()].sort((a, b) => b.n - a.n)[0]
    const geo = (name: string) => ({ code: '', name, nameEn: name })
    setPlaceRaw({ province: top?.city ? geo(top.city) : null, ward: top ? geo(top.district) : null, lat: null, lng: null })
    setAreaOk(false)
    touched.current = false
    // The pin for that default, and its city and ward as the map names them (Facebook's names can be old districts): one search and one lookup, not a stream
    // (OpenStreetMap's rules). Only while the seller hasn't touched the place or ticked it; they move it if Facebook was wrong.
    if (top) {
      const still = () => areaFor.current === jobId && !touched.current && !areaOkRef.current
      void fetch(`/api/geocode/search?q=${encodeURIComponent([top.district, top.city].filter(Boolean).join(', '))}&lang=vi`).then((r) => (r.ok ? r.json() : null)).then(async (d: { results?: { lat: number; lng: number }[] } | null) => {
        const p = d?.results?.[0]
        if (!p || !still()) return
        setPlaceRaw((cur) => ({ ...cur, lat: p.lat, lng: p.lng }))
        const area = await areaAt(p.lat, p.lng, lang)
        // Both from the map, or neither: never the map's city over Facebook's ward (commit gate, codex).
        if (area.province && area.ward && still()) setPlaceRaw((cur) => ({ ...cur, province: area.province, ward: area.ward }))
      }).catch(() => {})
    }
  }, [state?.job?.id, state?.job?.status, drafts])

  // ⛔ AN EDIT SAVES ON BLUR AND THE SAME TAP PRESSES PUBLISH: without waiting for it, the old price goes live and the edit then finds the row taken.
  const saving = useRef(new Set<Promise<boolean>>())
  // A correction that failed earlier still shows in its box while the old value is stored.
  const unsaved = useRef(new Set<string>())
  const patch = (id: string, body: Record<string, unknown>) => {
    const done = patchNow(id, body)
    saving.current.add(done)
    void done.finally(() => saving.current.delete(done))
    return done
  }
  const patchNow = async (id: string, body: Record<string, unknown>): Promise<boolean> => {
    const r = await fetch(`/api/fb-import/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    if (!r?.ok) toast.error(tr('That change didn’t save.', 'Chưa lưu được thay đổi.'))
    if (r?.ok) unsaved.current.delete(id); else unsaved.current.add(id)
    // Filling in what was missing is the seller saying yes to this one; Publish still answers for itself if something else is missing.
    if (r?.ok && ('price' in body || 'district' in body)) setPicked((p) => new Set(p).add(id))
    await load()
    return !!r?.ok
  }

  // ✕ ON A DRAFT (owner, 2026-11-08: "add small x to remove unwanted imports"): the server's own skip, so it never publishes and an older import's copy
  // doesn't come back on the next read. Gone at once, with Undo; a failed save puts it back. A later Import again reads it as a new draft.
  const remove = (id: string) => {
    const wasPicked = picked.has(id)
    const show = (on: boolean) => {
      setGone((g) => { const n = new Set(g); if (on) n.delete(id); else n.add(id); return n })
      setPicked((p) => { const n = new Set(p); if (on && wasPicked) n.add(id); else if (!on) n.delete(id); return n })
    }
    show(false)
    void patch(id, { skip: true }).then((ok) => {
      if (!ok) return show(true)
      toast.success(tr('Removed from this import.', 'Đã bỏ khỏi lần nhập này.'), {
        action: { label: tr('Undo', 'Hoàn tác'), onClick: () => void patch(id, { skip: false }).then((back) => { if (back) show(true) }) },
      })
    })
  }

  const publish = async () => {
    setPublishing(true)
    await Promise.all([...saving.current])
    // A correction that didn't save: don't publish the old value over what the box still shows.
    if (chosen.some((d) => unsaved.current.has(d.id))) {
      toast.error(tr('A change didn’t save. Edit it again before publishing.', 'Một thay đổi chưa được lưu. Hãy sửa lại trước khi đăng.'))
      setPublishing(false)
      return
    }
    const out: Record<string, string> = {}
    for (const { id } of chosen) {
      const r = await fetch(`/api/fb-import/items/${id}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactPhone: phone, place: { province: place.province?.name ?? '', ward: place.ward?.name ?? '', lat: place.lat, lng: place.lng } }) }).catch(() => null)
      const d = (await r?.json().catch(() => null)) as { ok?: boolean; code?: string; error?: string } | null
      out[id] = d?.ok ? 'ok' : d?.code ?? d?.error ?? 'publish_failed'
      setResults({ ...out })
      // These are about the whole import, not this listing: the rest would fail the same way.
      if (out[id] === 'phone_required' || out[id] === 'phone_taken' || out[id] === 'location_required' || out[id] === 'location_contact') break
    }
    const done = Object.values(out).filter((v) => v === 'ok').length
    if (done) toast.success(fillTemplate(tr('Published: {n}', 'Đã đăng: {n}'), 'Published: {n}', { n: String(done) }))
    setPublishing(false)
    await load()
  }

  if (!user || !state) return null
  if (!canRunHere) return <p className="mx-auto max-w-2xl text-sm text-body">{tr('Open eno.vn in your browser to import from Facebook.', 'Hãy mở eno.vn trong trình duyệt để nhập từ Facebook.')}</p>
  if (!state.on) return <p className="mx-auto max-w-2xl text-sm text-body">{tr('Import from Facebook isn’t available right now.', 'Hiện chưa thể nhập từ Facebook.')}</p>

  const categories: [string, string][] = TAXONOMY.filter((c) => IMPORT_CATEGORY_SLUGS.includes(c.slug)).map((c) => [c.slug, tr(c.name, c.nameVi)])
  // A browser leaves for Facebook; the iOS app opens it in its sheet and comes back here (facebook-connect-client.ts).
  const start = async () => {
    setStarting(true)
    const how = await startFacebookConnect(true).catch(() => 'failed' as const)
    if (how === 'failed') toast.error(tr('Facebook didn’t open. Please try again.', 'Chưa mở được Facebook. Vui lòng thử lại.'))
    // Never left spinning: a page that comes back from Facebook by Back (Safari's back-forward cache) must not find it stuck (commit gate, opus).
    setStarting(false)
  }
  const job = state.job
  const moving = job && ['queued', 'reading', 'sorting'].includes(job.status)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {!moving && drafts.length > 0 && <Button variant="outline" size="sm" loading={starting} onClick={() => void start()}>{tr('Import again', 'Nhập lại')}</Button>}
      {!moving && drafts.length === 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-ink">{tr('Import your Facebook Marketplace listings', 'Nhập tin từ Facebook Marketplace')}</h2>
          <p className="text-sm text-body">
            {tr(
              'We’ll find your Facebook profile by your name and profile picture, and read the listings on your Marketplace page. The text and one photo of each go to OpenAI’s AI, or Google’s if it doesn’t answer, to sort them, read the price and write the description. You check every one here, including the price, and nothing is published until you press Publish. Drafts are deleted after 7 days.',
              'Chúng tôi sẽ tìm trang Facebook của bạn theo tên và ảnh đại diện, rồi đọc các tin trên trang Marketplace của bạn. Nội dung và một ảnh của mỗi tin được gửi đến AI của OpenAI, hoặc của Google nếu OpenAI không phản hồi, để phân loại, đọc giá và viết mô tả. Bạn kiểm tra từng tin ở đây, kể cả giá, và không có gì được đăng cho đến khi bạn nhấn Đăng. Bản nháp bị xóa sau 7 ngày.',
            )}
          </p>
          <p className="text-sm text-body">{tr('Import only your own listings. Facebook can also pause this at any time, so it may not always be available.', 'Chỉ nhập tin của chính bạn. Facebook cũng có thể tạm dừng tính năng này bất cứ lúc nào nên không phải lúc nào cũng dùng được.')}</p>
          <Button variant="cta" loading={starting} onClick={() => void start()}>{state.connected ? tr('Import from Facebook', 'Nhập từ Facebook') : tr('Connect Facebook and import', 'Kết nối Facebook và nhập')}</Button>
        </section>
      )}

      {moving && <FacebookImportProgress status={job.status} startedAt={job.createdAt} items={job.items.filter((i) => i.fresh).map((i) => ({ id: i.id, status: i.status, photo: i.photo, fbTitle: i.fbTitle, categorySlug: i.categorySlug }))} />}
      {job?.status === 'not_found' && <p className="text-sm text-body">{tr('We couldn’t confirm your Facebook profile from your name and picture, so nothing was imported. A profile picture that’s visible to everyone helps.', 'Chúng tôi không xác nhận được trang Facebook của bạn từ tên và ảnh đại diện nên chưa nhập gì. Ảnh đại diện công khai sẽ giúp ích.')}</p>}
      {job?.status === 'unavailable' && <p className="text-sm text-body">{tr('Import from Facebook isn’t available right now. Please try again later.', 'Hiện chưa thể nhập từ Facebook. Vui lòng thử lại sau.')}</p>}
      {job?.status === 'failed' && <p className="text-sm text-body">{tr('That import didn’t finish. Please try again.', 'Lần nhập đó chưa hoàn tất. Vui lòng thử lại.')}</p>}
      {job?.status === 'ready' && job.items.length === 0 && <p className="text-sm text-body">{tr('We found your profile, but no listings for sale on it.', 'Chúng tôi đã tìm thấy trang của bạn nhưng không có tin đang bán.')}</p>}

      {/* Drafts stay reviewable while an import runs: a stalled sort must never hide them, nor an earlier import's (commit gate, opus). */}
      {drafts.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            {(!state.phone || Object.values(results).some((r) => r === 'phone_taken' || r === 'phone_required')) && (
            <label className="min-w-0 flex-1 text-sm font-medium text-ink">
              {tr('Contact phone for these listings', 'Số điện thoại liên hệ cho các tin này')}
              <Input className="mt-1" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            )}
            <Button className="ml-auto" variant="cta" loading={publishing} disabled={chosen.length === 0 || phone.replace(/\D/g, '').length < 9 || !areaOk || !placeReady} onClick={() => void publish()}>
              {areaOk && placeReady ? fillTemplate(tr('Publish {n}', 'Đăng {n} tin'), 'Publish {n}', { n: String(chosen.length) }) : tr('Check the location first', 'Kiểm tra vị trí trước')}
            </Button>
          </div>
          <div className="space-y-2 rounded-xl border border-border p-3">
            <h3 className="text-sm font-medium text-ink">{tr('Location of these listings', 'Vị trí của các tin này')}</h3>
            <ImportLocationPicker value={place} onChange={setPlace} />
            <p className="text-xs text-body">{tr('Taken from Facebook, which is often wrong. Every listing in this import gets this place.', 'Lấy từ Facebook, thường không chính xác. Mọi tin trong lần nhập này sẽ dùng vị trí này.')}</p>
            <div className="flex items-center gap-2">
              <Checkbox id="fbi-area-ok" checked={areaOk} disabled={!placeReady} onChange={(on: boolean) => setAreaOk(on)} />
              <label htmlFor="fbi-area-ok" className="text-sm text-ink">{tr('This location is right', 'Vị trí này đúng')}</label>
            </div>
          </div>
          <ul className="space-y-3">
            {drafts.map((d) => {
              const facets = d.categorySlug ? askableFacetsFor(d.categorySlug, d.subcategorySlug).filter((f) => isRequiredFacet(f) && f.key !== 'condition' && f.options?.length && !f.multi) : []
              const why = results[d.id] && results[d.id] !== 'ok' ? results[d.id] : d.reason ?? (d.price == null ? 'price_required' : null)
              // The seller's own language first (owner, 2026-11-06): an edit saves in it, and Publish writes the other one again.
              // ⛔ EACH FIELD SAVES IN THE LANGUAGE OF THE TEXT SHOWN, which is the app's when it has one: an older draft with no Vietnamese shows English, and an
              // edit to it must not land in the Vietnamese field (commit gate, opus).
              const vi = lang === 'vi'
              // `!= null`, not truthiness: a description the seller emptied is still that language's (commit gate, codex).
              const titleLang: 'en' | 'vi' = vi ? (d.titleVi != null ? 'vi' : 'en') : (d.title != null ? 'en' : d.titleVi != null ? 'vi' : 'en')
              const descriptionLang: 'en' | 'vi' = vi ? (d.descriptionVi != null ? 'vi' : 'en') : (d.description != null ? 'en' : d.descriptionVi != null ? 'vi' : 'en')
              const shownTitle = (titleLang === 'vi' ? d.titleVi : d.title) ?? d.fbTitle
              const shownDescription = (descriptionLang === 'vi' ? d.descriptionVi : d.description) ?? ''
              return (
                <li key={d.id} className="rounded-xl border border-border p-3">
                  <div className="flex gap-3">
                    <Checkbox aria-label={shownTitle} className="mt-1 shrink-0" checked={picked.has(d.id)} onChange={(on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(d.id); else n.delete(d.id); return n })} />
                    {d.photo && (
                      // Facebook's own link, for this one seller to check: <Image> would proxy it through the app's optimizer, which only takes our hosts.
                      <img src={d.photo} alt="" referrerPolicy="no-referrer" className="size-20 shrink-0 rounded-lg object-cover" loading="lazy" />
                    )}
                    <div className="min-w-0 flex-1 space-y-2">
                      <Input key={`t-${titleLang}`} aria-label={tr('Title', 'Tiêu đề')} defaultValue={shownTitle} onBlur={(e) => { if (e.target.value !== shownTitle) void patch(d.id, { title: e.target.value, lang: titleLang }) }} />
                      <DraftPrice price={d.price} label={tr('Price in đồng', 'Giá bằng đồng')} onSave={(v) => void patch(d.id, { price: v })} />
                      {d.fbPrice && <p className="text-xs text-body">{fillTemplate(tr('Facebook said ₫{n}. Change it if we read it wrong.', 'Facebook ghi ₫{n}. Hãy sửa nếu chúng tôi đọc sai.'), 'Facebook said ₫{n}. Change it if we read it wrong.', { n: d.fbPrice })}</p>}
                      <ChipSelect label={tr('Category', 'Danh mục')} placeholder={tr('Choose a category', 'Chọn danh mục')} value={d.categorySlug ?? ''} options={categories} onChange={(v) => void patch(d.id, { categorySlug: v })} />
                      {facets.map((f) => (
                        <ChipSelect key={f.key} label={tr(f.label, f.labelVi)} placeholder={tr(f.label, f.labelVi)} value={String(d.attributes?.[f.key] ?? '')} options={f.options.map((o) => [o.value, tr(o.label, o.labelVi)])} onChange={(v) => void patch(d.id, { attributes: { ...(d.attributes ?? {}), [f.key]: v } })} />
                      ))}
                      <Textarea key={`d-${descriptionLang}`} aria-label={tr('Description', 'Mô tả')} rows={3} defaultValue={shownDescription} onBlur={(e) => { if (e.target.value !== shownDescription) void patch(d.id, { description: e.target.value, lang: descriptionLang }) }} />
                      {why && <p role="alert" className="text-sm text-destructive">{reasonText(why === 'missing_details' && facets.length === 0 ? 'publish_failed' : why)}</p>}
                    </div>
                    <IconButton size="sm" disabled={publishing} onClick={() => remove(d.id)} aria-label={fillTemplate(tr('Remove {t}', 'Bỏ {t}'), 'Remove {t}', { t: shownTitle })} title={tr('Remove', 'Bỏ')}
                      className="-mr-1 -mt-1 text-ink-4 transition-colors hover:bg-muted hover:text-ink disabled:opacity-50">
                      <X className="size-4" />
                    </IconButton>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

function ChipSelect({ label, placeholder, value, options, onChange }: { label: string; placeholder: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <Select items={Object.fromEntries(options)} value={value || null} onValueChange={(next: unknown) => { if (typeof next === 'string') onChange(next) }}>
      <SelectTrigger aria-label={label} className="min-h-10 w-full rounded-lg bg-card"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/**
 * A draft's price, grouped as it is typed (owner, 2026-11-06: "has to have a , format example 65,000,000 so user knows how many 0s"): the post form's own
 * VndInput, so the separators follow the app's language (65,000,000 · 65.000.000) and the ×1,000 / ×1,000,000 chips are there. ⛔ SAVED WHEN FOCUS LEAVES
 * THE WHOLE BOX, not the input: a keyboard user tabs from the input to a chip, and saving on the input's own blur would store "65" before the chip made it
 * 65,000,000 (commit gate, opus). Publish waits for the save (`saving`).
 */
export function DraftPrice({ price, label, onSave }: { price: number | null; label: string; onSave: (v: number | null) => void }) {
  const [digits, setDigits] = useState(price != null ? String(price) : '')
  useEffect(() => { setDigits(price != null ? String(price) : '') }, [price])
  const save = () => { const v = digits ? Number(digits) : null; if (v !== price) onSave(v) }
  return (
    <div onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save() }}>
      <VndInput value={digits} onChange={setDigits} aria-label={label} placeholder={label} />
    </div>
  )
}
