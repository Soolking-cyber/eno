'use client'

// ── COVER LESSONS FIELDS (owner, 2026-10-07; reworked by the onboarding redesign, 2026-10-08) ─────────────────────────
// "when they post available periods like monday morning tuesday afternoon by tapping quickly and specify hourly rate
// … in areas they selected by district". The switch, the 7×3 free-period grid with its quick picks, the hourly rate —
// and, read-only, where schools find the teacher for cover. Rules and option lists: src/lib/teachers/cover.ts;
// validation: src/lib/teachers/profile.ts.
//
// ⛔ THE SWITCH IS THE CONSENT (2026-10-08 — COVER_CONSENT_VERSION was bumped for it). "Available for cover lessons"
// carries its notice beside it, and switching it ON is the act: coverConsent follows coverOpen, there is no tick box,
// and the form sends the notice's version (coverNotice) so the server records which words were shown. Switching OFF
// withdraws it (the server stamps the withdrawal; the periods and the rate are kept for later).
// ⛔ THE AREAS ARE NOT PICKED HERE ANY MORE: cover reaches the teacher's "Where you teach" places near home
// (places.ts coverReachOf), shown as one read-only line with Change. A second list of places was the plan's first
// thing to go — two lists disagreed.
// ⛔ Base UI throughout: every tappable cell is a <Chip pressed> (ui/toggle — a real aria-pressed button), the switch
// is a ui/switch SwitchRow with a visible label. Place names are never sent through tr() (PlaceName's rule).

import { useId } from 'react'
import { useLanguage } from '@/context/language-context'
import { SwitchRow } from '@/components/ui/switch'
import { Chip } from '@/components/ui/chip'
import { Button } from '@/components/ui/button'
import { Check } from '@/components/ui/icons'
import { VndInput } from '@/components/marketplace/vnd-input'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { COVER_DAYS, COVER_PARTS, COVER_PART_LABELS, COVER_RATE_PRESETS, coverDayShort, coverSlotLabel } from '@/lib/teachers/cover'
import { HCMC, coverReachOf, placeLabel } from '@/lib/teachers/places'
import type { TeacherErrors, TeacherInput } from '@/lib/teachers/profile'

export type CoverValue = Pick<
  TeacherInput,
  'coverOpen' | 'coverSlots' | 'coverRateVnd' | 'coverConsent' | 'livesIn' | 'currentCity' | 'currentProvince' | 'teachAreas'
>
export type CoverPatch = Partial<Pick<TeacherInput, 'coverOpen' | 'coverSlots' | 'coverRateVnd' | 'coverConsent'>>

const WEEKDAYS = COVER_DAYS.slice(0, 5)
/** Quick picks — TOGGLES (a real aria-pressed Chip): pressed while all of its periods are picked; pressing adds them
 * all, un-pressing takes them out (gate review, 2026-10-07 — an action chip hid that state from a screen reader). */
const QUICK_PICKS: { key: string; en: string; vi: string; slots: string[] }[] = [
  { key: 'wd-am', en: 'Weekday mornings', vi: 'Sáng ngày thường', slots: WEEKDAYS.map((d) => `${d}-am`) },
  { key: 'wd-pm', en: 'Weekday afternoons', vi: 'Chiều ngày thường', slots: WEEKDAYS.map((d) => `${d}-pm`) },
  { key: 'wd-eve', en: 'Weekday evenings', vi: 'Tối ngày thường', slots: WEEKDAYS.map((d) => `${d}-eve`) },
  { key: 'we', en: 'Weekends', vi: 'Cuối tuần', slots: (['sat', 'sun'] as const).flatMap((d) => COVER_PARTS.map((p) => `${d}-${p}`)) },
]

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/**
 * The notice beside the switch — ⛔ ITS MEANING IS COVER_CONSENT_VERSION (src/lib/teachers/cover.ts): change what it
 * says is shown, to whom, or for how long, and that version must be bumped in the same change. Wording: owner to
 * approve before deploy (plan amendment A5).
 */
export function CoverNotice() {
  const { tr } = useLanguage()
  return (
    <>{tr('Switching this on shows your free periods, your hourly rate and the places where schools find you for cover on your public profile, where schools and search engines can see them — never your phone, email or address. Switch it off any time.', 'Khi bật, các buổi rảnh, mức phí theo giờ và những nơi các trường tìm bạn để dạy thay sẽ hiển thị trên hồ sơ công khai của bạn, nơi các trường và công cụ tìm kiếm có thể xem — không bao giờ hiển thị số điện thoại, email hay địa chỉ. Bạn có thể tắt bất cứ lúc nào.')}</>
  )
}

export function CoverFields({ value, onChange, errors, onChangePlaces, errText }: {
  value: CoverValue
  onChange: (patch: CoverPatch) => void
  errors: TeacherErrors
  /** "Change" beside the read-only reach line: to the "Where you teach" step. */
  onChangePlaces: () => void
  /** An error code → its words (the form's, so every step words them alike). */
  errText: (field: string, code: string | undefined) => string
}) {
  const { tr, lang } = useLanguage()
  // Each error is named, announced and tied to its control (preview check, 2026-10-07: they were bare paragraphs).
  const errId = useId()
  // A GROUP of chips is not a control: aria-invalid is not supported on role=group (ARIA 1.2), so a group carries the
  // description and a data marker the form's error reveal finds (teacher-form revealFirstError).
  const groupErrProps = (key: keyof TeacherErrors, part: string) =>
    errors[key] ? { 'data-invalid': '', 'aria-describedby': `${errId}-${part}` } : {}

  const slots = new Set(value.coverSlots)
  const toggleSlot = (slot: string, on: boolean) =>
    onChange({ coverSlots: on ? [...value.coverSlots, slot] : value.coverSlots.filter((s) => s !== slot) })
  const quickPick = (pick: string[], on: boolean) =>
    onChange({ coverSlots: on ? [...new Set([...value.coverSlots, ...pick])] : value.coverSlots.filter((s) => !pick.includes(s)) })

  // Where schools find the teacher for cover: their teach areas near home, never another city, Online or "anywhere".
  const reach = coverReachOf(value)
  // A consent the record no longer holds (a stale window's merge): the switch must be switched on again to give it.
  const consentLine = errors.coverConsent ? tr('Switch cover lessons off and on again to agree to the notice above.', 'Hãy tắt rồi bật lại dạy thay để đồng ý với thông báo ở trên.') : ''

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {tr('Schools often need a teacher at short notice for a single lesson. Show the periods you are usually free and your hourly rate — schools then message you in the app.', 'Các trường thường cần giáo viên dạy thay gấp cho một buổi học. Hãy cho biết các buổi bạn thường rảnh và mức phí theo giờ — các trường sẽ nhắn tin cho bạn trong ứng dụng.')}
      </p>
      {/* ⛔ THE CONSENT ACT: the switch, its notice beside it — no tick box. */}
      <div className="space-y-2" {...(errors.coverOpen || errors.coverConsent ? { 'data-invalid': '' } : {})}>
        <SwitchRow
          id="tf-cover-switch"
          checked={value.coverOpen}
          onChange={(on) => onChange({ coverOpen: on, coverConsent: on })}
          label={tr('Available for cover lessons', 'Nhận dạy thay')}
          description={<CoverNotice />}
        />
        {errors.coverOpen && <p role="alert" className="text-sm text-destructive">{errText('coverOpen', errors.coverOpen)}</p>}
        {consentLine && <p role="alert" className="text-sm text-destructive">{consentLine}</p>}
      </div>

      {value.coverOpen && (
        <>
          <Block title={tr('When are you usually free?', 'Bạn thường rảnh khi nào?')} hint={tr('Tap every period you can usually teach.', 'Chạm vào mọi buổi bạn thường có thể dạy.')}>
            {/* gap-y-3, not gap-2: each small chip's tap-44 hit area reaches 6px past it, so two rows 8px apart overlapped
                and a tap just under "Weekday afternoons" hit Clear and wiped every period (preview check, 2026-10-07). */}
            <div className="flex flex-wrap gap-x-2 gap-y-3">
              {QUICK_PICKS.map((q) => (
                <Chip key={q.key} size="sm" tone="neutral" className="relative tap-44" pressed={q.slots.every((s) => slots.has(s))} onPressedChange={(v) => quickPick(q.slots, v)}>
                  {tr(q.en, q.vi)}
                </Chip>
              ))}
              {value.coverSlots.length > 0 && (
                <Chip size="sm" tone="ghost" type="button" className="relative tap-44" onClick={() => onChange({ coverSlots: [] })}>
                  {tr('Clear', 'Xóa hết')}
                </Chip>
              )}
            </div>
            <div role="group" aria-label={tr('Free periods', 'Các buổi rảnh')} {...groupErrProps('coverSlots', 'slots')} className="grid grid-cols-[3rem_repeat(3,minmax(0,1fr))] items-center gap-2">
              <span aria-hidden />
              {COVER_PARTS.map((p) => (
                <span key={p} aria-hidden className="text-center text-xs font-semibold text-body">
                  {tr(COVER_PART_LABELS[p].en, COVER_PART_LABELS[p].vi)}
                  <span className="block font-normal text-muted-foreground">{COVER_PART_LABELS[p].hours}</span>
                </span>
              ))}
              {COVER_DAYS.map((d) => (
                <div key={d} className="contents">
                  <span aria-hidden className="text-sm font-semibold text-body">{coverDayShort(d, lang)}</span>
                  {COVER_PARTS.map((p) => {
                    const slot = `${d}-${p}`
                    const on = slots.has(slot)
                    return (
                      <Chip
                        key={slot}
                        pressed={on}
                        onPressedChange={(v) => toggleSlot(slot, v)}
                        size="md"
                        tone="neutral"
                        aria-label={tr(coverSlotLabel(slot, 'en'), coverSlotLabel(slot, 'vi'))}
                        className="min-h-11 w-full rounded-xl"
                      >
                        {on ? <Check className="size-4" /> : <span aria-hidden className="size-1.5 rounded-full bg-border" />}
                      </Chip>
                    )
                  })}
                </div>
              ))}
            </div>
            {errors.coverSlots && <p id={`${errId}-slots`} role="alert" className="text-sm text-destructive">{errText('coverSlots', errors.coverSlots)}</p>}
          </Block>

          <Block title={tr('Your hourly rate for a cover lesson', 'Mức phí dạy thay theo giờ')}>
            <VndInput
              id="tf-cover-rate"
              value={value.coverRateVnd != null ? String(value.coverRateVnd) : ''}
              onChange={(digits) => onChange({ coverRateVnd: digits ? Number(digits) : null })}
              presets={COVER_RATE_PRESETS.map((v) => ({ value: v, label: formatMoneyFull(v, '₫', moneyLocale(lang)) }))}
              unit={tr('/ hour', '/ giờ')}
              placeholder={tr('e.g. 300,000', 'vd. 300.000')}
              maxFactor={1_000_000}
              invalid={!!errors.coverRateVnd}
              aria-describedby={errors.coverRateVnd ? `${errId}-rate` : undefined}
              aria-label={tr('Hourly rate for a cover lesson', 'Mức phí dạy thay theo giờ')}
              aria-required
            />
            {errors.coverRateVnd && <p id={`${errId}-rate`} role="alert" className="text-sm text-destructive">{errText('coverRateVnd', errors.coverRateVnd)}</p>}
          </Block>

          {/* READ-ONLY: the reach is the "Where you teach" places near home (coverReachOf) — changed there, not here. */}
          <div className="space-y-1.5 rounded-xl bg-tint px-3.5 py-3">
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-foreground">
              <span className="font-semibold">{tr('Schools find you for cover in:', 'Các trường tìm bạn để dạy thay tại:')}</span>
              <span data-testid="cover-reach">{reach.length ? reach.map((k) => placeLabel(k, lang)).join(' · ') : tr('nowhere yet', 'chưa có nơi nào')}</span>
              <Button variant="link" size="none" type="button" className="font-semibold" onClick={onChangePlaces}>{tr('Change', 'Thay đổi')}</Button>
            </p>
            {reach.includes(HCMC) && (
              <p className="text-xs text-muted-foreground">{tr('Tip: schools look for cover by district. Choosing your districts on the “Where you teach” step puts you in front of the schools near you.', 'Mẹo: các trường tìm giáo viên dạy thay theo quận. Chọn các quận của bạn ở bước “Nơi bạn dạy” để các trường gần bạn thấy bạn.')}</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
