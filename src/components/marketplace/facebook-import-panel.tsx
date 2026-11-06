'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { facebookAvailableHere, facebookIosApp } from '@/lib/facebook-signin'
import { startFacebookConnect } from '@/lib/facebook-connect-client'
import { fillTemplate } from '@/lib/i18n/placeholders'
import { askableFacetsFor, isRequiredFacet } from '@/lib/taxonomy'
import { IMPORT_CATEGORY_SLUGS } from '@/lib/fb-import/categories'
import { TAXONOMY } from '@/lib/taxonomy'

type Item = {
  id: string; status: string; title: string; description: string; price: number | null; fbPrice: string | null; district: string | null; categorySlug: string | null; subcategorySlug: string | null; listingType: string | null
  attributes: Record<string, unknown> | null; reason: string | null; listingId: string | null; photo: string | null; photoCount: number
}
type State = { on: boolean; connected: boolean; phone: string | null; job: { id: string; status: string; createdAt: string; items: Item[] } | null }

/**
 * My listings › Import from Facebook (owner, 2026-11-04): connect if needed, read, review, publish. How it works and why it runs from a worker on the box: src/lib/fb-import/shared.ts.
 * A browser, or the iOS app through its in-app browser sheet (facebookIosApp), like Connect: Meta's dialog doesn't run in a webview. Nothing goes public until Publish.
 */
export function FacebookImportPanel() {
  const { tr } = useLanguage()
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

  const reasonText = useCallback((code: string | null): string | null => {
    if (!code) return null
    const words: Record<string, string> = {
      no_category: tr('Choose a category.', 'Hãy chọn danh mục.'),
      price_required: tr('Add a price in đồng.', 'Hãy thêm giá bằng đồng.'),
      location_required: tr('Add the area: a ward or district.', 'Hãy thêm khu vực: phường hoặc quận.'),
      contact_in_text: tr('Remove the phone number or contact details from the text.', 'Hãy bỏ số điện thoại hoặc thông tin liên hệ khỏi nội dung.'),
      banned_words: tr('The text has a word we don’t allow.', 'Nội dung có từ không được phép.'),
      title_short: tr('The title is too short.', 'Tiêu đề quá ngắn.'),
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
  const drafts = useMemo(() => (state?.job?.items ?? []).filter((i) => i.status === 'draft'), [state])
  const chosen = drafts.filter((d) => picked.has(d.id))
  useEffect(() => { setPicked(new Set(drafts.filter((d) => !d.reason && d.price != null && d.district).map((d) => d.id))) }, [state?.job?.id, state?.job?.status])

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
      const r = await fetch(`/api/fb-import/items/${id}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactPhone: phone }) }).catch(() => null)
      const d = (await r?.json().catch(() => null)) as { ok?: boolean; code?: string; error?: string } | null
      out[id] = d?.ok ? 'ok' : d?.code ?? d?.error ?? 'publish_failed'
      setResults({ ...out })
      if (out[id] === 'phone_required' || out[id] === 'phone_taken') break
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

      {moving && <p role="status" className="text-sm text-body">{job.status === 'queued' ? tr('You’re in the queue. We read one seller at a time, so this can take a while. You can leave this page.', 'Bạn đang trong hàng chờ. Chúng tôi đọc lần lượt từng người bán nên có thể mất một lúc. Bạn có thể rời trang này.') : job.status === 'reading' ? tr('Reading your listings…', 'Đang đọc các tin của bạn…') : tr('Sorting your listings…', 'Đang phân loại các tin của bạn…')}</p>}
      {job?.status === 'not_found' && <p className="text-sm text-body">{tr('We couldn’t confirm your Facebook profile from your name and picture, so nothing was imported. A profile picture that’s visible to everyone helps.', 'Chúng tôi không xác nhận được trang Facebook của bạn từ tên và ảnh đại diện nên chưa nhập gì. Ảnh đại diện công khai sẽ giúp ích.')}</p>}
      {job?.status === 'unavailable' && <p className="text-sm text-body">{tr('Import from Facebook isn’t available right now. Please try again later.', 'Hiện chưa thể nhập từ Facebook. Vui lòng thử lại sau.')}</p>}
      {job?.status === 'failed' && <p className="text-sm text-body">{tr('That import didn’t finish. Please try again.', 'Lần nhập đó chưa hoàn tất. Vui lòng thử lại.')}</p>}
      {job?.status === 'ready' && job.items.length === 0 && <p className="text-sm text-body">{tr('We found your profile, but no listings for sale on it.', 'Chúng tôi đã tìm thấy trang của bạn nhưng không có tin đang bán.')}</p>}

      {drafts.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            {(!state.phone || Object.values(results).some((r) => r === 'phone_taken' || r === 'phone_required')) && (
            <label className="min-w-0 flex-1 text-sm font-medium text-ink">
              {tr('Contact phone for these listings', 'Số điện thoại liên hệ cho các tin này')}
              <Input className="mt-1" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            )}
            <Button className="ml-auto" variant="cta" loading={publishing} disabled={chosen.length === 0 || phone.replace(/\D/g, '').length < 9} onClick={() => void publish()}>
              {fillTemplate(tr('Publish {n}', 'Đăng {n} tin'), 'Publish {n}', { n: String(chosen.length) })}
            </Button>
          </div>
          <ul className="space-y-3">
            {drafts.map((d) => {
              const facets = d.categorySlug ? askableFacetsFor(d.categorySlug, d.subcategorySlug).filter((f) => isRequiredFacet(f) && f.key !== 'condition' && f.options?.length && !f.multi) : []
              const why = results[d.id] && results[d.id] !== 'ok' ? results[d.id] : d.reason ?? (d.price == null ? 'price_required' : !d.district ? 'location_required' : null)
              return (
                <li key={d.id} className="rounded-xl border border-border p-3">
                  <div className="flex gap-3">
                    <Checkbox aria-label={d.title} className="mt-1 shrink-0" checked={picked.has(d.id)} onChange={(on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(d.id); else n.delete(d.id); return n })} />
                    {d.photo && (
                      // Facebook's own link, for this one seller to check: <Image> would proxy it through the app's optimizer, which only takes our hosts.
                      <img src={d.photo} alt="" referrerPolicy="no-referrer" className="size-20 shrink-0 rounded-lg object-cover" loading="lazy" />
                    )}
                    <div className="min-w-0 flex-1 space-y-2">
                      <Input aria-label={tr('Title', 'Tiêu đề')} defaultValue={d.title} onBlur={(e) => { if (e.target.value !== d.title) void patch(d.id, { title: e.target.value }) }} />
                      <Input aria-label={tr('Price in đồng', 'Giá bằng đồng')} inputMode="numeric" defaultValue={d.price ?? ''} placeholder={tr('Price in đồng', 'Giá bằng đồng')} onBlur={(e) => { const n = e.target.value.replace(/\D/g, ''); const v = n ? Number(n) : null; if (v !== d.price) void patch(d.id, { price: v }) }} />
                      {d.fbPrice && <p className="text-xs text-body">{fillTemplate(tr('Facebook said ₫{n}. Change it if we read it wrong.', 'Facebook ghi ₫{n}. Hãy sửa nếu chúng tôi đọc sai.'), 'Facebook said ₫{n}. Change it if we read it wrong.', { n: d.fbPrice })}</p>}
                      <Input aria-label={tr('Area (ward or district)', 'Khu vực (phường hoặc quận)')} placeholder={tr('Area (ward or district)', 'Khu vực (phường hoặc quận)')} maxLength={80} defaultValue={d.district ?? ''} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (d.district ?? '')) void patch(d.id, { district: v || null }) }} />
                      <ChipSelect label={tr('Category', 'Danh mục')} placeholder={tr('Choose a category', 'Chọn danh mục')} value={d.categorySlug ?? ''} options={categories} onChange={(v) => void patch(d.id, { categorySlug: v })} />
                      {facets.map((f) => (
                        <ChipSelect key={f.key} label={tr(f.label, f.labelVi)} placeholder={tr(f.label, f.labelVi)} value={String(d.attributes?.[f.key] ?? '')} options={f.options.map((o) => [o.value, tr(o.label, o.labelVi)])} onChange={(v) => void patch(d.id, { attributes: { ...(d.attributes ?? {}), [f.key]: v } })} />
                      ))}
                      <Textarea aria-label={tr('Description', 'Mô tả')} rows={3} defaultValue={d.description} onBlur={(e) => { if (e.target.value !== d.description) void patch(d.id, { description: e.target.value }) }} />
                      {why && <p role="alert" className="text-sm text-destructive">{reasonText(why === 'missing_details' && facets.length === 0 ? 'publish_failed' : why)}</p>}
                    </div>
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
