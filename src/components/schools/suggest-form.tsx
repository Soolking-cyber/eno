'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { HCMC_AREAS, KIND_LABEL, SCHOOL_KINDS, SUGGESTIONS_PENDING_MAX, SUGGESTION_NOTE_MAX, type SchoolKind } from '@/lib/schools/constants'

type Mine = { id: string; name: string; kind: string; status: 'pending' | 'added' | 'duplicate' | 'rejected'; rejectReason: string | null; createdAt: string; school: { slug: string; name: string } | null }
type Found = { kind: 'listed' | 'possible'; slug: string; name: string }

const NONE = '__none__'
const label = 'text-sm font-semibold text-foreground'

/**
 * The /schools/suggest form and the teacher's own suggestions (server: /api/schools/suggest). A school already
 * listed is answered with its page, and one with the same website as a listed school is asked about first —
 * so most duplicates never reach a moderator.
 */
export function SuggestForm() {
  const { tr } = useLanguage()
  const { user, loading, openSignIn } = useAuth()
  const [name, setName] = React.useState('')
  const [kind, setKind] = React.useState<SchoolKind>('language_centre')
  const [website, setWebsite] = React.useState('')
  const [district, setDistrict] = React.useState(NONE)
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [found, setFound] = React.useState<Found | null>(null)
  const [mine, setMine] = React.useState<Mine[] | null>(null)

  const load = React.useCallback(() => {
    fetch('/api/schools/suggest', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setMine(Array.isArray(d?.suggestions) ? d.suggestions : []))
      .catch(() => setMine([]))
  }, [])
  React.useEffect(() => { if (user) load() }, [user, load])

  const message = (code: string | undefined) =>
    code === 'school_name_invalid' ? tr('Give the school’s own name, not a description such as “English centre”.', 'Hãy nhập tên riêng của trường, không phải mô tả như “trung tâm tiếng Anh”.')
    : code === 'website_invalid' ? tr('That website address does not look right.', 'Địa chỉ website có vẻ chưa đúng.')
    : code === 'district_invalid' ? tr('Choose an area from the list.', 'Hãy chọn khu vực trong danh sách.')
    : code === 'contact_in_text' ? tr('Leave out phone numbers and email addresses.', 'Vui lòng không ghi số điện thoại hay email.')
    : code === 'banned_words' ? tr('Some words are not allowed. Please rephrase.', 'Có từ ngữ không được phép. Vui lòng viết lại.')
    : code === 'already_submitted' ? tr('You have already suggested this school. A moderator will look at it.', 'Bạn đã đề xuất trường này. Kiểm duyệt viên sẽ xem xét.')
    : code === 'too_many_suggestions' ? tr('You have {n} suggestions waiting. Please wait until a moderator has looked at them.', 'Bạn đang có {n} đề xuất chờ duyệt. Vui lòng đợi kiểm duyệt viên xem xét.').replace('{n}', String(SUGGESTIONS_PENDING_MAX))
    : code === 'rate_limited' ? tr('Too many tries. Wait a while and try again.', 'Bạn thử quá nhiều lần. Hãy đợi một lúc rồi thử lại.')
    : code === 'account_restricted' ? tr('Your account cannot do this right now.', 'Tài khoản của bạn hiện không thể làm việc này.')
    : tr('Not sent. Try again.', 'Chưa gửi được. Thử lại nhé.')

  async function submit(confirmNew: boolean) {
    if (!user) { openSignIn({ note: tr('Sign in to suggest a school.', 'Đăng nhập để đề xuất trường.') }); return }
    setBusy(true)
    try {
      const res = await fetch('/api/schools/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, kind, website: website.trim() || null, district: district === NONE ? null : district, note: note.trim() || null, confirmNew }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(message(d?.error)); return }
      if (d.listed) { setFound({ kind: 'listed', ...d.listed }); return }
      if (d.possible) { setFound({ kind: 'possible', ...d.possible }); return }
      setFound(null)
      setName(''); setWebsite(''); setDistrict(NONE); setNote('')
      toast.success(tr('Thanks! A moderator will look at it.', 'Cảm ơn bạn! Kiểm duyệt viên sẽ xem xét.'))
      load()
    } catch {
      toast.error(message(undefined))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-8 flex flex-col gap-8">
      <form
        className="flex flex-col gap-4 rounded-2xl bg-card p-4 ring-1 ring-border sm:p-6"
        onSubmit={(e) => { e.preventDefault(); void submit(false) }}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="suggest-name" className={label}>{tr('Name of the school or centre', 'Tên trường hoặc trung tâm')}</label>
          <Input id="suggest-name" required minLength={2} maxLength={120} value={name} onChange={(e) => { setName(e.target.value); setFound(null) }} className="min-h-11 rounded-xl" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className={label}>{tr('What kind of place', 'Loại hình')}</span>
            <Select items={Object.fromEntries(SCHOOL_KINDS.map((k) => [k, tr(KIND_LABEL[k].en, KIND_LABEL[k].vi)]))} value={kind} onValueChange={(v) => typeof v === 'string' && setKind(v as SchoolKind)}>
              <SelectTrigger aria-label={tr('What kind of place', 'Loại hình')} className="min-h-11 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger>
              <SelectContent>{SCHOOL_KINDS.map((k) => <SelectItem key={k} value={k}>{tr(KIND_LABEL[k].en, KIND_LABEL[k].vi)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <span className={label}>{tr('Area (optional)', 'Khu vực (không bắt buộc)')}</span>
            <Select items={Object.fromEntries([[NONE, tr('Not specified', 'Không nêu')], ...HCMC_AREAS.map((a) => [a, a])])} value={district} onValueChange={(v) => setDistrict(typeof v === 'string' ? v : NONE)}>
              <SelectTrigger aria-label={tr('Area', 'Khu vực')} className="min-h-11 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{tr('Not specified', 'Không nêu')}</SelectItem>
                {HCMC_AREAS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="suggest-website" className={label}>{tr('Website or Facebook page (optional)', 'Website hoặc trang Facebook (không bắt buộc)')}</label>
          {/* type="text", NOT "url": the browser's own URL check would refuse "example.edu.vn" — what the placeholder
              invites — before the server, which accepts a bare domain, ever sees it (found on the scratch preview). */}
          <Input id="suggest-website" type="text" inputMode="url" autoComplete="url" maxLength={300} placeholder="example.edu.vn" value={website} onChange={(e) => { setWebsite(e.target.value); setFound(null) }} className="min-h-11 rounded-xl" />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="suggest-note" className={label}>{tr('Anything that helps us find it (optional)', 'Thông tin giúp chúng tôi tìm nơi này (không bắt buộc)')}</label>
          <Textarea id="suggest-note" rows={3} maxLength={SUGGESTION_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} className="rounded-xl" />
          <p className="text-xs text-muted-foreground">{tr('For example the street or the brand it trades under. No phone numbers or emails.', 'Ví dụ tên đường hoặc thương hiệu. Không ghi số điện thoại hay email.')}</p>
        </div>

        {found?.kind === 'listed' && (
          <p className="rounded-xl bg-tint px-3 py-2 text-sm text-foreground">
            {tr('It is already listed:', 'Trường này đã có trong danh sách:')}{' '}
            <Link href={`/schools/${found.slug}`} className="font-semibold text-accent-foreground hover:underline">{found.name}</Link>
          </p>
        )}
        {found?.kind === 'possible' && (
          <div className="flex flex-col gap-3 rounded-xl bg-tint px-3 py-3 text-sm text-foreground">
            <p>
              {tr('A listed school has the same website. Is it this one?', 'Một trường trong danh sách có cùng website. Có phải nơi này không?')}{' '}
              <Link href={`/schools/${found.slug}`} className="font-semibold text-accent-foreground hover:underline">{found.name}</Link>
            </p>
            <Button type="button" variant="outline" size="sm" className="self-start" disabled={busy} onClick={() => void submit(true)}>
              {tr('No, it is a different school: send it', 'Không, đây là nơi khác: gửi đề xuất')}
            </Button>
          </div>
        )}

        {/* Signed out it is a plain sign-in button (diff review): a disabled one, or the form's own field checks, would
            keep a visitor from ever reaching sign-in. */}
        {user || loading ? (
          <Button type="submit" variant="cta" className="self-start" disabled={busy || loading || name.trim().length < 2}>
            {tr('Send suggestion', 'Gửi đề xuất')}
          </Button>
        ) : (
          <Button type="button" variant="cta" className="self-start" onClick={() => openSignIn({ note: tr('Sign in to suggest a school.', 'Đăng nhập để đề xuất trường.') })}>
            {tr('Sign in to suggest', 'Đăng nhập để đề xuất')}
          </Button>
        )}
      </form>

      {user && (
        <section aria-labelledby="my-suggestions-h">
          <h2 id="my-suggestions-h" className="text-lg font-bold text-foreground">{tr('Your suggestions', 'Đề xuất của bạn')}</h2>
          {mine === null ? <Skeleton className="mt-3 h-16 w-full rounded-2xl" />
            : mine.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{tr('None yet.', 'Chưa có.')}</p>
            : (
              <ul className="mt-3 flex flex-col gap-2">
                {mine.map((s) => (
                  <li key={s.id} className="rounded-2xl bg-card p-4 text-sm ring-1 ring-border">
                    <p className="font-semibold text-foreground">{s.name}</p>
                    <p className="mt-1 text-body">
                      {s.status === 'pending' ? tr('Waiting for a moderator.', 'Đang chờ kiểm duyệt viên.')
                        : s.status === 'rejected' ? `${tr('Not added.', 'Chưa được thêm.')}${s.rejectReason ? ` ${s.rejectReason}` : ''}`
                        : s.school ? (
                          <>
                            {s.status === 'added' ? tr('Added:', 'Đã thêm:') : tr('Already listed as', 'Đã có trong danh sách với tên')}{' '}
                            <Link href={`/schools/${s.school.slug}`} className="font-semibold text-accent-foreground hover:underline">{s.school.name}</Link>
                          </>
                        ) : tr('Done.', 'Đã xử lý.')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
        </section>
      )}
    </div>
  )
}
