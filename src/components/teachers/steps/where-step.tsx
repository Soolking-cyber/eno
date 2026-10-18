'use client'

// ── STEP 2 · WHERE YOU TEACH (teacher onboarding redesign, 2026-10-08) ───────────────────────────────────────────────
// Skipped for a teacher abroad who teaches online only with no full-time / part-time goal (profile.ts whereSkipped):
// Online, answered on step 1, is then the whole list.
//   · The ONE list (teach-area-picker.tsx) — the home pre-selected, ⛔ counted only once confirmed or edited (B6).
//   · When can you start? (optional; full-time / part-time) — Now · from a month. Stored as the month's first day.
//   · Expected monthly salary (optional; full-time only) — ₫ with presets; outside 1–150 million it is REFUSED, never
//     clamped (profile.ts salary_range).

import { useId } from 'react'
import { useLanguage } from '@/context/language-context'
import { Field } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Fieldset } from '@/components/ui/fieldset'
import { CustomSelect } from '@/components/marketplace/custom-select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { VndInput } from '@/components/marketplace/vnd-input'
import { compactPrice, moneyLocale } from '@/lib/vnd'
import { TeachAreaPicker } from '@/components/teachers/teach-area-picker'
import { nextMonths, startChoice, thisMonth } from '@/components/teachers/teacher-form-rules'
import type { StepProps } from '@/components/teachers/steps/shared'

/** Monthly salary presets, in VND (the field holds full đồng; the profile stores millions). */
const SALARY_PRESETS = [15_000_000, 20_000_000, 25_000_000, 30_000_000, 40_000_000, 50_000_000] as const

export function WhereStep({ t, set, patch, errors, errText, coverIntent, onGoTo }: StepProps & {
  coverIntent: boolean
  onGoTo: (step: 'plans') => void
}) {
  const { tr, lang } = useLanguage()
  const uid = useId()
  const wantsJob = t.jobTypes.includes('fulltime') || t.jobTypes.includes('parttime')
  const start = startChoice(t.availableFrom)
  const months = nextMonths(12)
  // A saved month further out than the list still shows as itself.
  const monthOptions = start.kind === 'month' && !months.includes(start.month) ? [...months, start.month] : months
  const monthName = (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    try { return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1))) } catch { return ym }
  }
  const areaError = errors.teachAreas && errors.teachAreas !== 'confirm' ? errText('teachAreas', errors.teachAreas) : undefined
  const confirmError = errors.teachAreas === 'confirm' ? errText('teachAreas', 'confirm') : undefined

  return (
    <div className="space-y-8">
      <TeachAreaPicker
        t={t}
        coverIntent={coverIntent}
        // ⛔ Any edit of the list is the teacher choosing it — it counts as their confirmation (B6). Both clear the
        // list's error (the `confirm` refusal is the list's own code).
        onAreas={(keys) => patch({ teachAreas: keys, teachAreasConfirmed: true })}
        onConfirm={(v) => patch({ teachAreas: t.teachAreas, teachAreasConfirmed: v })}
        onChangeAnswer={() => onGoTo('plans')}
        error={areaError}
        confirmError={confirmError}
      />

      {wantsJob && (
        <Fieldset legend={tr('When can you start? (optional)', 'Khi nào bạn có thể bắt đầu? (không bắt buộc)')} legendId={`${uid}-start`}>
          <ToggleGroup
            value={start.kind === 'none' ? [] : [start.kind]}
            // One choice that can be cleared — tap it again for "not saying".
            onValueChange={(v) => set('availableFrom', v[0] === 'now' ? `${thisMonth()}-01` : v[0] === 'month' ? `${months[0]}-01` : null)}
            aria-labelledby={`${uid}-start`}
          >
            <ToggleGroupItem value="now">{tr('Now', 'Ngay bây giờ')}</ToggleGroupItem>
            <ToggleGroupItem value="month">{tr('Pick a month', 'Chọn tháng')}</ToggleGroupItem>
          </ToggleGroup>
          {start.kind === 'month' && (
            <Field>
              <Label htmlFor={`${uid}-month`}>{tr('From', 'Từ')}</Label>
              {/* The house picker — a bottom sheet on a phone (owner, 2026-10-18) — in the form's filled-field idiom, a
                  44px box. `id` is the trigger's, so the label names it; months are ORDERED, so no search field. */}
              <CustomSelect
                id={`${uid}-month`}
                value={start.month}
                onChange={(v) => { if (v) set('availableFrom', `${v}-01`) }}
                options={monthOptions.map((m) => ({ value: m, label: monthName(m) }))}
                label={tr('From', 'Từ')}
                searchable={false}
                className="min-h-11 rounded-xl bg-tint px-4 font-normal text-foreground hover:bg-muted"
                activeClassName="min-h-11 rounded-xl bg-tint px-4 font-normal text-foreground hover:bg-muted"
                wrapperClassName="w-full sm:w-64"
              />
            </Field>
          )}
        </Fieldset>
      )}

      {t.jobTypes.includes('fulltime') && (
        <Field invalid={!!errors.expectedSalaryM}>
          <Label htmlFor="tf-salary">{tr('Expected monthly salary (optional)', 'Mức lương mong muốn mỗi tháng (không bắt buộc)')}</Label>
          {/* VndInput is a <div>, not a labelable control: its name and its error are handed to it by hand. */}
          <VndInput
            id="tf-salary"
            value={t.expectedSalaryM != null ? String(Math.round(t.expectedSalaryM * 1_000_000)) : ''}
            onChange={(digits) => set('expectedSalaryM', digits ? Number(digits) / 1_000_000 : null)}
            presets={SALARY_PRESETS.map((v) => ({ value: v, label: compactPrice(v, moneyLocale(lang)) }))}
            unit={tr('/ month', '/ tháng')}
            maxFactor={1_000_000}
            invalid={!!errors.expectedSalaryM}
            aria-label={tr('Expected monthly salary', 'Mức lương mong muốn mỗi tháng')}
            aria-describedby={errors.expectedSalaryM ? 'tf-salary-error' : undefined}
          />
          {errors.expectedSalaryM && <p id="tf-salary-error" role="alert" className="text-sm text-destructive">{errText('expectedSalaryM', errors.expectedSalaryM)}</p>}
        </Field>
      )}
    </div>
  )
}
