'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, LogIn, ShieldCheck, Trash2 } from '@/components/ui/icons'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { groupVnd, moneyLocale, parseVnd } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import {
  BAD_TAGS, ELIGIBLE_ACCOUNT_AGE_DAYS, EMPLOYMENTS, PAY_MIN_REPORTS, EMPLOYMENT_LABEL, GOOD_TAGS, HCMC_AREAS, REVIEW_ADVICE_MAX, REVIEW_TEXT_MAX, REVIEW_TEXT_MIN,
  ROLES, ROLE_LABEL, TAG_LABEL, TENURES, TENURE_LABEL,
  type BadTag, type Employment, type GoodTag, type SchoolRole, type Tenure,
} from '@/lib/schools/constants'

type Mine = {
  current: boolean; tenure: Tenure; leftYear: number | null; showLeftYear: boolean; role: SchoolRole; employment: Employment
  district: string | null; pros: string; cons: string; advice: string | null; goodTags: string[]; badTags: string[]
  payAmount: number | null; payCurrency: string | null; payPeriod: string | null; status: string; rejectReason: string | null
}

const NONE = 'none'
/** The tenure labels are lower-case for the review line ("Former teacher · under 1 year"); a control starts a sentence. */
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

/**
 * Write or edit a review of one school (plan v2, 2026-10-04). Every save goes to the moderation queue,
 * edits included; the page says so before the teacher writes, not after.
 * ⚠️ Pay is optional and PRIVATE: it feeds the school's range only once PAY_MIN_REPORTS teachers have
 * reported, and is never shown with the review.
 */
export function ReviewForm(props: { schoolId: string; slug: string; schoolName: string }) {
  const { user } = useAuth()
  // ⛔ ALL FORM STATE BELONGS TO ONE ACCOUNT (diff review): keyed by the user id, so signing out and in as
  // someone else on the same page starts empty — never with the previous account's draft or private pay.
  return <ReviewFormForAccount key={user?.id ?? 'signed-out'} {...props} />
}

function ReviewFormForAccount({ schoolId, slug, schoolName }: { schoolId: string; slug: string; schoolName: string }) {
  const { tr, lang } = useLanguage()
  const { user, loading, openSignIn } = useAuth()
  const router = useRouter()
  const loc = moneyLocale(lang)
  const userId = user?.id ?? null
  // Per mount, not at module load: a long-running server must not offer last year's list after 1 January.
  const YEARS = React.useMemo(() => { const y = new Date().getFullYear(); return Array.from({ length: 12 }, (_, i) => String(y - i)) }, [])

  const [loaded, setLoaded] = React.useState(false)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)
  const [existing, setExisting] = React.useState<Mine | null>(null)
  const [saved, setSaved] = React.useState(false)
  const [countsLater, setCountsLater] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [confirm, setConfirm] = React.useState(false)
  const [current, setCurrent] = React.useState<'current' | 'former'>('former')
  const [tenure, setTenure] = React.useState<Tenure>('lt1')
  const [leftYear, setLeftYear] = React.useState<string>(NONE)
  const [showLeftYear, setShowLeftYear] = React.useState(false)
  const [role, setRole] = React.useState<SchoolRole>('teacher')
  const [employment, setEmployment] = React.useState<Employment>('full_time')
  const [district, setDistrict] = React.useState<string>(NONE)
  const [good, setGood] = React.useState<GoodTag[]>([])
  const [bad, setBad] = React.useState<BadTag[]>([])
  const [pros, setPros] = React.useState('')
  const [cons, setCons] = React.useState('')
  const [advice, setAdvice] = React.useState('')
  const [payAmount, setPayAmount] = React.useState('')
  const [payCurrency, setPayCurrency] = React.useState<'VND' | 'USD'>('VND')
  const [payPeriod, setPayPeriod] = React.useState<'hour' | 'month'>('hour')

  // Loads once per account (not on a token refresh or a language switch, which would wipe unsaved edits).
  React.useEffect(() => {
    if (!userId) return
    let gone = false
    setLoadFailed(false)
    fetch(`/api/schools/${schoolId}/review`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((d) => {
        if (gone) return
        const m: Mine | null = d?.review ?? null
        setExisting(m)
        if (m) {
          setConfirm(true)
          setCurrent(m.current ? 'current' : 'former')
          setTenure(m.tenure); setRole(m.role); setEmployment(m.employment)
          setLeftYear(m.leftYear ? String(m.leftYear) : NONE); setShowLeftYear(m.showLeftYear)
          setDistrict(m.district ?? NONE)
          setGood(m.goodTags.filter((t): t is GoodTag => (GOOD_TAGS as readonly string[]).includes(t)))
          setBad(m.badTags.filter((t): t is BadTag => (BAD_TAGS as readonly string[]).includes(t)))
          setPros(m.pros); setCons(m.cons); setAdvice(m.advice ?? '')
          if (m.payAmount && m.payCurrency && m.payPeriod) {
            setPayCurrency(m.payCurrency === 'USD' ? 'USD' : 'VND')
            setPayPeriod(m.payPeriod === 'month' ? 'month' : 'hour')
            setPayAmount(m.payCurrency === 'USD' ? String(m.payAmount) : groupVnd(String(m.payAmount), loc))
          }
        }
        setLoaded(true)
      })
      // ⛔ A FAILED LOAD IS NOT "NO REVIEW" (diff review): a blank form here would overwrite the saved one.
      .catch(() => { if (!gone) setLoadFailed(true) })
    return () => { gone = true }
  }, [userId, schoolId, attempt])

  if (loading) return <Skeleton className="h-96 w-full rounded-2xl" />
  if (!user) {
    return (
      <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-border">
        <p className="text-base font-semibold text-foreground">{tr('Sign in to write a review', 'Đăng nhập để viết đánh giá')}</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-body">
          {tr('Your name is never shown. Reviews appear with a broad description only, such as "Former teacher · 1–2 years".', 'Tên của bạn không bao giờ hiển thị. Đánh giá chỉ kèm mô tả chung, ví dụ "Giáo viên cũ · 1–2 năm".')}
        </p>
        <Button variant="cta" className="mt-4" onClick={() => openSignIn({ note: tr('Sign in to review {name}.', 'Đăng nhập để đánh giá {name}.').replace('{name}', schoolName) })}>
          <LogIn aria-hidden /> {tr('Sign in', 'Đăng nhập')}
        </Button>
      </div>
    )
  }
  if (loadFailed) {
    return (
      <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-border">
        <p className="text-sm text-body">{tr('We could not load your review. Check your connection and try again.', 'Không tải được đánh giá của bạn. Hãy kiểm tra kết nối và thử lại.')}</p>
        <Button variant="outline" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>{tr('Try again', 'Thử lại')}</Button>
      </div>
    )
  }
  if (!loaded) return <Skeleton className="h-96 w-full rounded-2xl" />

  if (saved) {
    return (
      <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-border">
        <CheckCircle2 aria-hidden className="mx-auto size-10 text-success" />
        <p className="mt-3 text-base font-semibold text-foreground">{tr('Thank you — your review is with our moderators', 'Cảm ơn bạn — đánh giá đang chờ kiểm duyệt')}</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-body">
          {tr('It appears on the school page once a moderator has checked it. You can edit it any time; an edit is checked again.', 'Đánh giá sẽ hiển thị trên trang trường sau khi được kiểm duyệt. Bạn có thể sửa bất cứ lúc nào; bản sửa sẽ được kiểm duyệt lại.')}
        </p>
        {countsLater && (
          <p className="mx-auto mt-2 max-w-md text-sm text-body">
            {tr('Your account is new, so the review also waits until the account is {n} days old.', 'Tài khoản của bạn còn mới, nên đánh giá sẽ chờ đến khi tài khoản được {n} ngày tuổi.').replace('{n}', String(ELIGIBLE_ACCOUNT_AGE_DAYS))}
          </p>
        )}
        <Button variant="outline" className="mt-4" asChild><Link href={`/schools/${slug}`}>{tr('Back to {name}', 'Quay lại {name}').replace('{name}', schoolName)}</Link></Button>
      </div>
    )
  }

  const chars = (x: string) => [...x.trim()].length // as the server and the database count them
  const prosLen = chars(pros), consLen = chars(cons)
  const payNum = payCurrency === 'USD' ? Number(payAmount.replace(/[^0-9.]/g, '')) : parseVnd(payAmount)
  const payGiven = payAmount.trim() !== ''
  const ready = confirm && prosLen >= REVIEW_TEXT_MIN && consLen >= REVIEW_TEXT_MIN && (!payGiven || payNum > 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/schools/${schoolId}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          confirm: true,
          current: current === 'current',
          tenure, role, employment,
          leftYear: current === 'former' && leftYear !== NONE ? Number(leftYear) : null,
          showLeftYear: current === 'former' && leftYear !== NONE && showLeftYear,
          district: district === NONE ? null : district,
          pros: pros.trim(), cons: cons.trim(), advice: advice.trim() || null,
          goodTags: good, badTags: bad,
          pay: payGiven ? { amount: payNum, currency: payCurrency, period: payPeriod } : null,
        }),
      })
      if (res.ok) {
        const d = await res.json().catch(() => ({}))
        setCountsLater(d?.countsNow === false)
        setSaved(true); router.refresh(); return
      }
      if (res.status === 401) { openSignIn(); return }
      const code = (await res.json().catch(() => ({}))).error as string | undefined
      setError(
        code === 'links_not_allowed' ? tr('Links are not allowed in reviews. Describe the school in your own words.', 'Đánh giá không được chứa đường link. Hãy mô tả trường bằng lời của bạn.')
        : code === 'contact_in_text' ? tr('Remove phone numbers, emails and social handles — reviews cannot carry contact details.', 'Hãy xoá số điện thoại, email và tài khoản mạng xã hội — đánh giá không được chứa thông tin liên hệ.')
        : code === 'banned_words' ? tr('Your review contains a word that is not allowed. Please rephrase it.', 'Đánh giá có từ ngữ không được phép. Vui lòng viết lại.')
        : code === 'pay_out_of_range' ? tr('That pay looks off — check the amount and whether it is per hour or per month.', 'Mức lương có vẻ chưa đúng — hãy kiểm tra số tiền và kỳ trả (theo giờ hay theo tháng).')
        : code === 'fx_unavailable' ? tr('We could not convert USD right now. Enter the pay in VND, or try again later.', 'Hiện chưa quy đổi được USD. Hãy nhập lương bằng VND hoặc thử lại sau.')
        : code === 'business_account' ? tr('Business accounts cannot review schools.', 'Tài khoản doanh nghiệp không thể đánh giá trường.')
        : code === 'account_restricted' ? tr('Your account cannot post reviews right now.', 'Tài khoản của bạn hiện không thể đăng đánh giá.')
        : code === 'forbidden' ? tr("A school's own account cannot review it.", 'Tài khoản của chính trường không thể tự đánh giá.')
        : code === 'rate_limited' ? tr('Too many saves — try again in an hour.', 'Bạn lưu quá nhiều lần — thử lại sau một giờ.')
        : tr('Your review was not saved. Check the fields and try again.', 'Chưa lưu được đánh giá. Hãy kiểm tra lại và thử lần nữa.'),
      )
    } catch {
      setError(tr('Your review was not saved. Check your connection and try again.', 'Chưa lưu được đánh giá. Kiểm tra kết nối và thử lại.'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/schools/${schoolId}/review`, { method: 'DELETE' })
      if (res.ok) {
        toast.success(tr('Your review was deleted.', 'Đã xoá đánh giá của bạn.'))
        router.push(`/schools/${slug}`)
      } else toast.error(tr('Not deleted. Try again.', 'Chưa xoá được. Thử lại nhé.'))
    } catch {
      toast.error(tr('Not deleted. Check your connection and try again.', 'Chưa xoá được. Kiểm tra kết nối và thử lại.'))
    } finally {
      setBusy(false)
    }
  }

  const label = 'text-sm font-semibold text-foreground'
  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      {existing && (
        <div className={cn('rounded-2xl p-4 text-sm', existing.status === 'rejected' ? 'bg-destructive/10 text-foreground' : 'bg-tint text-foreground')}>
          <p className="flex items-center gap-2 font-semibold">
            {tr('Your review', 'Đánh giá của bạn')}
            <Badge variant={existing.status === 'published' ? 'success' : existing.status === 'rejected' ? 'destructive' : 'neutral'}>
              {existing.status === 'published' ? tr('Published', 'Đã đăng') : existing.status === 'rejected' ? tr('Not approved', 'Chưa được duyệt') : tr('Waiting for a moderator', 'Đang chờ kiểm duyệt')}
            </Badge>
          </p>
          {existing.status === 'rejected' && existing.rejectReason && (
            <p className="mt-1">{tr('Moderator note:', 'Ghi chú của kiểm duyệt viên:')} {existing.rejectReason}</p>
          )}
          <p className="mt-1 text-body">{tr('Saving an edit sends it to the moderators again.', 'Khi lưu bản sửa, đánh giá sẽ được kiểm duyệt lại.')}</p>
        </div>
      )}

      <div className="flex gap-3 rounded-2xl bg-tint p-4 text-sm text-body">
        <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
        <p>
          {tr('Describe your own experience. Do not name individuals, share anyone\'s personal details or accuse anyone of a crime — stick to what happened to you. A moderator reads every review before it appears, and your name is never shown.', 'Hãy kể trải nghiệm của chính bạn. Không nêu tên cá nhân, không chia sẻ thông tin cá nhân của ai, không cáo buộc ai phạm tội — chỉ kể điều đã xảy ra với bạn. Mọi đánh giá đều được kiểm duyệt trước khi hiển thị, và tên của bạn không bao giờ hiển thị.')}
        </p>
      </div>

      <label className="flex items-start gap-3 text-sm text-foreground">
        <Checkbox checked={confirm} onChange={setConfirm} className="mt-0.5" />
        <span>{tr('I work, or used to work, at {name} as a teacher or teaching assistant.', 'Tôi đang hoặc đã từng làm giáo viên hay trợ giảng tại {name}.').replace('{name}', schoolName)}</span>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className={label}>{tr('Do you still work there?', 'Bạn còn làm ở đó không?')}</legend>
        <Segmented aria-label={tr('Do you still work there?', 'Bạn còn làm ở đó không?')} value={current} onValueChange={setCurrent} className="sm:max-w-sm"
          options={[{ value: 'current', label: tr('Yes, I work there', 'Có, tôi đang làm') }, { value: 'former', label: tr('No, I left', 'Không, tôi đã nghỉ') }]} />
      </fieldset>

      {current === 'former' && (
        <div className="flex flex-col gap-2">
          <span className={label}>{tr('Year you left (optional)', 'Năm bạn nghỉ (không bắt buộc)')}</span>
          <Select items={Object.fromEntries([[NONE, tr('Prefer not to say', 'Không muốn nêu')], ...YEARS.map((y) => [y, y])])} value={leftYear} onValueChange={(v) => setLeftYear(typeof v === 'string' ? v : NONE)}>
            <SelectTrigger aria-label={tr('Year you left', 'Năm bạn nghỉ')} className="min-h-11 w-full rounded-xl bg-card sm:w-60"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{tr('Prefer not to say', 'Không muốn nêu')}</SelectItem>
              {YEARS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          {leftYear !== NONE && (
            <label className="flex items-start gap-3 text-sm text-foreground">
              <Checkbox checked={showLeftYear} onChange={setShowLeftYear} className="mt-0.5" />
              <span>{tr('Show the year I left on my review (it can make you easier to identify at a small centre)', 'Hiển thị năm tôi nghỉ trên đánh giá (ở trung tâm nhỏ, điều này có thể khiến bạn dễ bị nhận ra)')}</span>
            </label>
          )}
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className={label}>{tr('How long?', 'Bao lâu?')}</legend>
        <Segmented aria-label={tr('How long?', 'Bao lâu?')} value={tenure} onValueChange={setTenure} className="sm:max-w-md"
          options={TENURES.map((t) => ({ value: t, label: cap(tr(TENURE_LABEL[t].en, TENURE_LABEL[t].vi)) }))} />
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className={label}>{tr('Your role', 'Vai trò của bạn')}</span>
          <Select items={Object.fromEntries(ROLES.map((r) => [r, tr(ROLE_LABEL[r].en, ROLE_LABEL[r].vi)]))} value={role} onValueChange={(v) => typeof v === 'string' && setRole(v as SchoolRole)}>
            <SelectTrigger aria-label={tr('Your role', 'Vai trò của bạn')} className="min-h-11 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{tr(ROLE_LABEL[r].en, ROLE_LABEL[r].vi)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <span className={label}>{tr('Campus area (optional)', 'Khu vực cơ sở (không bắt buộc)')}</span>
          <Select items={Object.fromEntries([[NONE, tr('Not specified', 'Không nêu')], ...HCMC_AREAS.map((a) => [a, a])])} value={district} onValueChange={(v) => setDistrict(typeof v === 'string' ? v : NONE)}>
            <SelectTrigger aria-label={tr('Campus area', 'Khu vực cơ sở')} className="min-h-11 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{tr('Not specified', 'Không nêu')}</SelectItem>
              {HCMC_AREAS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={label}>{tr('Contract', 'Loại hợp đồng')}</legend>
        <Segmented aria-label={tr('Contract', 'Loại hợp đồng')} value={employment} onValueChange={setEmployment} className="sm:max-w-md"
          options={EMPLOYMENTS.map((e) => ({ value: e, label: tr(EMPLOYMENT_LABEL[e].en, EMPLOYMENT_LABEL[e].vi) }))} />
      </fieldset>

      <TagPicker title={tr("What's good? (pick any)", 'Điểm tốt? (chọn tuỳ ý)')} tags={GOOD_TAGS} value={good} onChange={setGood} />
      <TagPicker title={tr("What's not so good? (pick any)", 'Điểm chưa tốt? (chọn tuỳ ý)')} tags={BAD_TAGS} value={bad} onChange={setBad} />

      <TextBlock id="sr-pros" label={tr("What's good about working here?", 'Làm việc ở đây có gì tốt?')} value={pros} onChange={setPros} max={REVIEW_TEXT_MAX} min={REVIEW_TEXT_MIN}
        placeholder={tr('Pay on time, helpful staff, good materials, students…', 'Trả lương đúng hạn, đồng nghiệp hỗ trợ, tài liệu tốt, học viên…')} />
      <TextBlock id="sr-cons" label={tr("What's not so good?", 'Có gì chưa tốt?')} value={cons} onChange={setCons} max={REVIEW_TEXT_MAX} min={REVIEW_TEXT_MIN}
        placeholder={tr('Unpaid prep, schedule changes, contract terms, deductions…', 'Soạn bài không lương, đổi lịch, điều khoản hợp đồng, khấu trừ lương…')} />
      <TextBlock id="sr-advice" label={tr('Advice for teachers thinking of joining (optional)', 'Lời khuyên cho giáo viên định về đây (không bắt buộc)')} value={advice} onChange={setAdvice} max={REVIEW_ADVICE_MAX} min={0}
        placeholder={tr('What to ask in the interview, what to check in the contract…', 'Nên hỏi gì khi phỏng vấn, cần xem kỹ gì trong hợp đồng…')} />

      <fieldset className="flex flex-col gap-2 rounded-2xl bg-card p-4 ring-1 ring-border">
        <legend className={cn(label, 'px-1')}>{tr('Your pay (optional, private)', 'Mức lương của bạn (không bắt buộc, riêng tư)')}</legend>
        <p className="text-sm text-body">
          {tr('Never shown with your review or your name. It only counts towards the school\'s pay range once at least {n} teachers have reported pay, and then only as part of that range. With few reports, an end of the range can be close to one teacher\'s figure.', 'Không bao giờ hiển thị cùng đánh giá hay tên của bạn. Chỉ được tính vào khoảng lương của trường khi có ít nhất {n} giáo viên báo cáo, và chỉ như một phần của khoảng đó. Khi có ít báo cáo, một đầu của khoảng lương có thể gần với mức lương của một giáo viên.').replace('{n}', String(PAY_MIN_REPORTS))}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input inputMode={payCurrency === 'USD' ? 'decimal' : 'numeric'} value={payAmount}
            onChange={(e) => setPayAmount(payCurrency === 'USD' ? usdInput(e.target.value) : groupVnd(e.target.value, loc).slice(0, 15))}
            placeholder={payCurrency === 'USD' ? '20' : groupVnd(payPeriod === 'hour' ? '400000' : '30000000', loc)}
            aria-label={tr('Pay amount', 'Số tiền lương')} className="min-h-11 w-full rounded-xl sm:w-48" />
          <Segmented aria-label={tr('Currency', 'Tiền tệ')} value={payCurrency} onValueChange={(v) => { setPayCurrency(v); setPayAmount('') }} className="sm:w-40"
            options={[{ value: 'VND', label: 'VND' }, { value: 'USD', label: 'USD' }]} />
          <Segmented aria-label={tr('Paid per', 'Trả theo')} value={payPeriod} onValueChange={setPayPeriod} className="sm:w-56"
            options={[{ value: 'hour', label: tr('per hour', 'theo giờ') }, { value: 'month', label: tr('per month', 'theo tháng') }]} />
        </div>
        <p className="text-xs text-muted-foreground">{tr('Gross pay before tax, as in your contract. USD is converted to VND at today\'s rate.', 'Lương gộp trước thuế, theo hợp đồng. USD được quy đổi sang VND theo tỷ giá hôm nay.')}</p>
      </fieldset>

      {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="cta" size="lg" disabled={!ready || busy}>
          {existing ? tr('Save changes', 'Lưu thay đổi') : tr('Submit review', 'Gửi đánh giá')}
        </Button>
        {!confirm && <span className="text-sm text-muted-foreground">{tr('Tick the box above to confirm you worked here.', 'Hãy đánh dấu ô ở trên để xác nhận bạn từng làm ở đây.')}</span>}
        {existing && (
          <AlertDialog>
            <AlertDialogTrigger render={<Button type="button" variant="ghost" className="ml-auto text-destructive" disabled={busy} />}>
              <Trash2 aria-hidden /> {tr('Delete my review', 'Xoá đánh giá của tôi')}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{tr('Delete your review?', 'Xoá đánh giá của bạn?')}</AlertDialogTitle>
                <AlertDialogDescription>{tr('It is removed from the school page, with its text and pay. This cannot be undone.', 'Đánh giá sẽ bị gỡ khỏi trang trường, cùng nội dung và mức lương. Không thể hoàn tác.')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tr('Keep it', 'Giữ lại')}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={remove}>{tr('Delete', 'Xoá')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </form>
  )
}

function TagPicker<T extends GoodTag | BadTag>({ title, tags, value, onChange }: { title: string; tags: readonly T[]; value: T[]; onChange: (v: T[]) => void }) {
  const { tr } = useLanguage()
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-foreground">{title}</legend>
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <Chip key={t} size="md" pressed={value.includes(t)} onPressedChange={(p) => onChange(p ? [...value, t] : value.filter((x) => x !== t))}>
            {tr(TAG_LABEL[t].en, TAG_LABEL[t].vi)}
          </Chip>
        ))}
      </div>
    </fieldset>
  )
}

/** Digits and at most ONE decimal point ("1.2.3" would turn into NaN and silently disable Submit). */
function usdInput(v: string): string {
  const [whole, ...rest] = v.replace(/[^0-9.]/g, '').split('.')
  return (rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole).slice(0, 9)
}

/** Cut to `max` UTF-16 units (the server's .max()) without splitting an emoji's surrogate pair. */
function clip(v: string, max: number): string {
  if (v.length <= max) return v
  const cut = v.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
}

function TextBlock({ id, label, value, onChange, max, min, placeholder }: {
  id: string; label: string; value: string; onChange: (v: string) => void; max: number; min: number; placeholder: string
}) {
  const { tr } = useLanguage()
  const n = [...value.trim()].length
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-foreground">{label}</label>
      <Textarea id={id} value={value} onChange={(e) => onChange(clip(e.target.value, max))} rows={5} placeholder={placeholder} />
      <p className={cn('text-xs tabular-nums', n > 0 && n < min ? 'text-warning' : 'text-muted-foreground')}>
        {n > 0 && n < min
          ? tr('At least {n} characters', 'Ít nhất {n} ký tự').replace('{n}', String(min))
          : `${n} / ${max}`}
      </p>
    </div>
  )
}
