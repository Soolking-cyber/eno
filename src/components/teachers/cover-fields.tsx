'use client'

// ── COVER LESSONS FIELDS (owner, 2026-10-07) ────────────────────────────────────────────────────────
// "when they post available periods like monday morning tuesday afternoon by tapping quickly and specify
// hourly rate … in areas they selected by district". The switch, the 7×3 free-period grid, the area chips,
// the hourly rate and the SEPARATE cover consent — shared by the profile wizard's "Cover lessons" step on
// both hosts. Rules and option lists: src/lib/teachers/cover.ts; validation: src/lib/teachers/profile.ts.
//
// ⛔ Base UI throughout: every tappable cell and area is a <Chip pressed> (ui/toggle — a real aria-pressed
// button), never a hand-rolled <Button aria-pressed>. Place names are never sent through tr() (PlaceName's rule).

import { useId } from 'react'
import { useLanguage } from '@/context/language-context'
import { Switch } from '@/components/ui/switch'
import { Chip } from '@/components/ui/chip'
import { Checkbox } from '@/components/ui/checkbox'
import { Check } from '@/components/ui/icons'
import { VndInput } from '@/components/marketplace/vnd-input'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import {
  COVER_CITIES, COVER_DAYS, COVER_PARTS, COVER_PART_LABELS, COVER_RATE_PRESETS,
  coverAreasForCities, coverCitiesFor, coverDayShort, coverSlotLabel,
} from '@/lib/teachers/cover'
import type { TeacherErrors, TeacherInput } from '@/lib/teachers/profile'

export type CoverValue = Pick<TeacherInput, 'coverOpen' | 'coverSlots' | 'coverAreas' | 'coverRateVnd' | 'coverConsent' | 'currentCity' | 'preferredCities'>
export type CoverPatch = Partial<Pick<TeacherInput, 'coverOpen' | 'coverSlots' | 'coverAreas' | 'coverRateVnd' | 'coverConsent'>>

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

export function CoverFields({ value, onChange, errors }: { value: CoverValue; onChange: (patch: CoverPatch) => void; errors: TeacherErrors }) {
  const { tr, lang } = useLanguage()
  const switchLabelId = useId()
  // Each error is named, announced and tied to its control (preview check, 2026-10-07: they were bare paragraphs).
  const errId = useId()
  const errProps = (key: keyof TeacherErrors, part: string) =>
    errors[key] ? { 'aria-invalid': true as const, 'aria-describedby': `${errId}-${part}` } : {}
  // A GROUP of chips is not a control: aria-invalid is not supported on role=group (ARIA 1.2), so a group carries the
  // description and a data marker the form's error reveal finds (teacher-form revealFirstError).
  const groupErrProps = (key: keyof TeacherErrors, part: string) =>
    errors[key] ? { 'data-invalid': '', 'aria-describedby': `${errId}-${part}` } : {}
  const err = (code: string | undefined): string =>
    code === 'required' ? tr('This is required.', 'Mục này là bắt buộc.')
      : code === 'rate_range' ? tr('Please enter a rate between 50,000 đ and 2,000,000 đ an hour.', 'Vui lòng nhập mức phí từ 50.000 đ đến 2.000.000 đ một giờ.')
        : code ? tr('Please check this value.', 'Vui lòng kiểm tra lại.') : ''

  const slots = new Set(value.coverSlots)
  const toggleSlot = (slot: string, on: boolean) =>
    onChange({ coverSlots: on ? [...value.coverSlots, slot] : value.coverSlots.filter((s) => s !== slot) })
  const quickPick = (pick: string[], on: boolean) =>
    onChange({ coverSlots: on ? [...new Set([...value.coverSlots, ...pick])] : value.coverSlots.filter((s) => !pick.includes(s)) })

  // The teacher's own cities first, then every other city — ALL stay pickable, so a stored pick never hides.
  const own = coverCitiesFor(value.currentCity, value.preferredCities)
  const cities = [...own, ...COVER_CITIES.map((c) => c.key).filter((k) => !own.includes(k))]
  const areas = coverAreasForCities(cities)
  const pickedAreas = new Set(value.coverAreas)
  const toggleArea = (key: string, on: boolean) =>
    onChange({ coverAreas: on ? [...value.coverAreas, key] : value.coverAreas.filter((k) => k !== key) })
  // i18n-invariant: a place name, never machine-translated (PlaceName's rule) — Vietnamese or English, nothing else.
  const placeName = (o: { en: string; vi: string }) => (lang === 'vi' ? o.vi : o.en)

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {tr('Schools often need a teacher at short notice for a single lesson. Switch this on to show the periods you are usually free, the areas you can reach and your hourly rate — schools then message you in the app.', 'Các trường thường cần giáo viên dạy thay gấp cho một buổi học. Bật để hiển thị các buổi bạn thường rảnh, khu vực bạn có thể đến và mức phí theo giờ — các trường sẽ nhắn tin cho bạn trong ứng dụng.')}
      </p>
      {/* A VISIBLE label (UrgentRow's pattern, post-wizard-sections.tsx): the words sit in the row, and
          aria-labelledby names the switch by the title alone — Base UI would otherwise take the whole row. */}
      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-tint px-4 py-3">
        <span id={switchLabelId} className="text-sm font-semibold text-foreground">{tr('I can take cover lessons', 'Tôi nhận dạy thay')}</span>
        <Switch checked={value.coverOpen} onChange={(v: boolean) => onChange({ coverOpen: v })} aria-labelledby={switchLabelId} />
      </label>

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
            {errors.coverSlots && <p id={`${errId}-slots`} role="alert" className="text-sm text-destructive">{err(errors.coverSlots)}</p>}
          </Block>

          <Block title={tr('Where can you teach a cover?', 'Bạn có thể dạy thay ở đâu?')} hint={tr('Pick the districts you can reach at short notice, or a whole city.', 'Chọn các quận bạn có thể đến gấp, hoặc cả thành phố.')}>
            <div role="group" aria-label={tr('Cover areas', 'Khu vực dạy thay')} {...groupErrProps('coverAreas', 'areas')} className="space-y-4">
                {cities.map((k) => COVER_CITIES.find((c) => c.key === k)!).map((c) => (
                  // Each city is a group named by the city, and its city-wide chip carries the city in its OWN label ("All of
                  // Hanoi"): twelve chips all reading "Anywhere in the city" told a screen reader nothing, and an aria-label
                  // over that visible text broke Label-in-Name for voice control (preview checks, 2026-10-07).
                  <div key={c.key} role="group" aria-labelledby={`${errId}-city-${c.key}`} className="space-y-2">
                    <p id={`${errId}-city-${c.key}`} className="text-xs font-semibold text-muted-foreground">{placeName(c)}</p>
                    <div className="flex flex-wrap gap-2">
                      {areas.filter((a) => a.city === c.key).map((a) => (
                        <Chip
                          key={a.key}
                          pressed={pickedAreas.has(a.key)}
                          onPressedChange={(v) => toggleArea(a.key, v)}
                          size="md"
                          tone="neutral"
                          className="relative tap-44"
                        >
                          {placeName(a)}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
            {errors.coverAreas && <p id={`${errId}-areas`} role="alert" className="text-sm text-destructive">{err(errors.coverAreas)}</p>}
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
            {errors.coverRateVnd && <p id={`${errId}-rate`} role="alert" className="text-sm text-destructive">{err(errors.coverRateVnd)}</p>}
          </Block>

          {/* ⛔ ITS OWN CONSENT (PDP Law 91/2025 — specific, unbundled, provable). The server records the time and
              the notice version (COVER_CONSENT_VERSION) — bump that version whenever these words change meaning. */}
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-relaxed text-body">
              <Checkbox checked={value.coverConsent} onChange={(v: boolean) => onChange({ coverConsent: v })} {...errProps('coverConsent', 'consent')} className="mt-0.5 h-5 w-5" />
              <span>{tr('Show my free periods, hourly rate and cover areas on my public profile, where schools and search engines can see them. Never my phone, email or address. I can switch cover off at any time. Required for cover.', 'Hiển thị các buổi rảnh, mức phí theo giờ và khu vực dạy thay trên hồ sơ công khai của tôi, nơi các trường và công cụ tìm kiếm có thể xem. Không bao giờ hiển thị số điện thoại, email hay địa chỉ. Tôi có thể tắt dạy thay bất cứ lúc nào. Bắt buộc để nhận dạy thay.')}</span>
            </label>
            {errors.coverConsent && <p id={`${errId}-consent`} role="alert" className="text-sm text-destructive">{err(errors.coverConsent)}</p>}
          </div>
        </>
      )}
    </div>
  )
}
