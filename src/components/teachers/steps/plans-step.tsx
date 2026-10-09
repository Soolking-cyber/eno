'use client'

// ── STEP 1 · YOUR PLANS (both hosts, taps only — teacher onboarding redesign, 2026-10-08) ────────────────────────────
// The SITUATION first: where the teacher is now and what work they want — every later step shows only what fits it.
//   · Where are you now? — the 12 city chips · Somewhere else in Vietnam · Not in Vietnam yet (one radio group).
//     HCMC → the optional district (where they live — the Area filter); somewhere else → the province, searchable,
//     town aliases included ("Hội An" switches to the Da Nang chip).
//   · What work are you looking for? — Full-time · Part-time · Private students. It may stay EMPTY only where cover
//     lessons are offered (the Cover step then asks for cover or a job).
//   · Full-time / part-time in Vietnam → Would you move for a job?   · Abroad → Where in Vietnam would you like to teach?
// Each answer re-derives what hangs on it (teacher-form-rules.ts) — the places pre-selected for the home, the
// relocation answer — through `update`, which on an EDIT warns before anything saved is dropped.

import { useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Field, FieldError } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Fieldset } from '@/components/ui/fieldset'
import { Radio, RadioDot, RadioGroup } from '@/components/ui/radio-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DISTRICT_NOT_SAYING, DistrictCombobox } from '@/components/teachers/district-combobox'
import { ProvinceCombobox } from '@/components/teachers/province-combobox'
import { HCMC, HUBS, homeHasCover, isHub, placeLabel, provinceKeyOf, relocationAllowed, situationForPlace } from '@/lib/teachers/places'
import { FORM_JOB_TYPES, type Relocate } from '@/lib/teachers/profile'
import { withJobTypes, withRelocate, withSituation } from '@/components/teachers/teacher-form-rules'
import { RADIO_CARD, RADIO_CHIP, type StepProps } from '@/components/teachers/steps/shared'

const SITUATION_FIELDS = ['livesIn', 'currentCity', 'currentProvince', 'currentDistrictKey', 'teachAreas', 'teachAreasConfirmed', 'relocate'] as const

export function PlansStep({ t, update, errors, errText, coverIntent, signedIn, districtNotSaying, onDistrictNotSaying }: StepProps & {
  /** Came for cover lessons (/teachers/join?goal=cover). */
  coverIntent: boolean
  /** Signed in already: the cover switch is one step away, not behind a sign-in. */
  signedIn: boolean
  /** "Prefer not to say" was the district answer — the FORM keeps it (it stores nothing; district-combobox.tsx). */
  districtNotSaying: boolean
  onDistrictNotSaying: (v: boolean) => void
}) {
  const { tr, lang } = useLanguage()
  // "Hội An" picked in the province search switched the answer to a city chip: say so where the chip is.
  const [aliasCity, setAliasCity] = useState('')
  const where = t.livesIn === 'city' ? t.currentCity : t.livesIn ?? ''
  const situate = (next: Parameters<typeof withSituation>[1]) => update(withSituation(t, next, coverIntent), SITUATION_FIELDS)
  // The district alone: "Prefer not to say" clears it — the teacher's own answer, never warned about — and the form
  // remembers that it WAS answered (a saved district always shows as itself; the flag only speaks for an empty one).
  const pickDistrict = (row: string) => {
    onDistrictNotSaying(row === DISTRICT_NOT_SAYING)
    update(withSituation(t, { currentDistrictKey: row === DISTRICT_NOT_SAYING ? '' : row }, coverIntent), SITUATION_FIELDS, ['currentDistrictKey'])
  }
  const pickWhere = (v: string) => {
    setAliasCity('')
    if (isHub(v)) situate({ livesIn: 'city', currentCity: v })
    else if (v === 'elsewhere' || v === 'abroad') situate({ livesIn: v })
  }
  const pickProvince = (key: string) => {
    if (!key) return situate({ livesIn: 'elsewhere', currentProvince: '' })
    const s = situationForPlace(key)
    if (!s) return
    if (s.livesIn === 'city') { setAliasCity(s.currentCity); situate(s) }
    else situate(s)
  }
  const jobLabel = (v: string) =>
    v === 'fulltime' ? tr('Full-time', 'Toàn thời gian') : v === 'parttime' ? tr('Part-time', 'Bán thời gian') : tr('Private students', 'Học viên riêng')
  const cover = homeHasCover(t)
  const homeName = t.livesIn === 'city' ? placeLabel(t.currentCity, lang) : t.livesIn === 'elsewhere' ? placeLabel(provinceKeyOf(t.currentProvince) ?? '', lang) : ''
  const moveAsked = relocationAllowed(t)

  return (
    <div className="space-y-8">
      <Fieldset legend={tr('Where are you now?', 'Hiện bạn đang ở đâu?')} error={errText('livesIn', errors.livesIn) || errText('currentCity', errors.currentCity)}>
        <RadioGroup value={where} onValueChange={pickWhere} className="flex flex-wrap gap-x-2 gap-y-3">
          {HUBS.map((h) => <Radio key={h} value={h} className={RADIO_CHIP}>{placeLabel(h, lang)}</Radio>)}
          <Radio value="elsewhere" className={RADIO_CHIP}>{tr('Somewhere else in Vietnam', 'Nơi khác ở Việt Nam')}</Radio>
          <Radio value="abroad" className={RADIO_CHIP}>{tr('Not in Vietnam yet', 'Chưa ở Việt Nam')}</Radio>
        </RadioGroup>
        {aliasCity && t.currentCity === aliasCity && (
          <p role="status" className="text-sm text-body">{tr('That town is part of this city — we picked it for you:', 'Thị xã đó thuộc thành phố này — chúng tôi đã chọn giúp bạn:')} <span className="font-semibold">{placeLabel(aliasCity, lang)}</span></p>
        )}
      </Fieldset>

      {t.livesIn === 'city' && t.currentCity === HCMC && (
        <Field>
          <Label htmlFor="tf-district">{tr('Which district do you live in? (optional)', 'Bạn sống ở quận nào? (không bắt buộc)')}</Label>
          <DistrictCombobox id="tf-district" value={t.currentDistrictKey || (districtNotSaying ? DISTRICT_NOT_SAYING : '')} onChange={pickDistrict} />
        </Field>
      )}

      {t.livesIn === 'elsewhere' && (
        <Field invalid={!!errors.currentProvince}>
          <Label htmlFor="tf-province">{tr('Which province?', 'Tỉnh nào?')}</Label>
          <ProvinceCombobox id="tf-province" value={provinceKeyOf(t.currentProvince) ?? ''} onPick={pickProvince} />
          {errors.currentProvince && <FieldError>{errText('currentProvince', errors.currentProvince)}</FieldError>}
          {coverIntent && t.currentProvince && !cover && (
            <p className="text-sm text-muted-foreground">{tr('Cover lessons are open in the 12 main teaching cities for now.', 'Hiện dạy thay chỉ mở ở 12 thành phố giảng dạy chính.')}</p>
          )}
        </Field>
      )}

      {t.livesIn && (
        <Fieldset
          legend={coverIntent ? tr('Also looking for a job? (optional)', 'Bạn cũng đang tìm việc? (không bắt buộc)') : tr('What work are you looking for?', 'Bạn đang tìm công việc gì?')}
          legendId="tf-jobtypes"
          hint={cover && !coverIntent
            ? (signedIn
              ? tr('Only want cover lessons? Leave this empty — you switch cover on in the Cover step.', 'Chỉ muốn dạy thay? Hãy để trống — bạn bật dạy thay ở bước Dạy thay.')
              : tr('Only want cover lessons? Leave this empty. You switch cover on after you sign in.', 'Chỉ muốn dạy thay? Hãy để trống. Bạn bật dạy thay sau khi đăng nhập.'))
            : undefined}
          error={errText('jobTypes', errors.jobTypes)}
        >
          <ToggleGroup multiple value={t.jobTypes} onValueChange={(v) => update(withJobTypes(t, v), ['jobTypes', 'relocate', 'teachAreas'])} aria-labelledby="tf-jobtypes">
            {FORM_JOB_TYPES.map((j) => <ToggleGroupItem key={j} value={j}>{jobLabel(j)}</ToggleGroupItem>)}
          </ToggleGroup>
        </Fieldset>
      )}

      {moveAsked && t.livesIn !== 'abroad' && (
        <Fieldset legend={tr('Would you move for a job?', 'Bạn có chuyển đi vì công việc không?')} error={errText('relocate', errors.relocate)}>
          <RadioGroup value={t.relocate} onValueChange={(v) => update(withRelocate(t, v as Relocate), ['relocate', 'teachAreas'])} className="grid gap-2">
            <Radio value="no" className={RADIO_CARD}>
              <RadioDot className="mt-0.5" />
              <span className="text-sm font-semibold text-foreground">{tr('No, only around', 'Không, chỉ quanh')} {homeName}</span>
            </Radio>
            <Radio value="some" className={RADIO_CARD}>
              <RadioDot className="mt-0.5" />
              <span className="text-sm font-semibold text-foreground">{tr('Yes, to some other cities', 'Có, đến một số thành phố khác')}</span>
            </Radio>
            <Radio value="anywhere" className={RADIO_CARD}>
              <RadioDot className="mt-0.5" />
              <span className="text-sm font-semibold text-foreground">{tr('Yes, anywhere in Vietnam', 'Có, bất kỳ đâu tại Việt Nam')}</span>
            </Radio>
          </RadioGroup>
        </Fieldset>
      )}

      {t.livesIn === 'abroad' && (
        <Fieldset legend={tr('Where in Vietnam would you like to teach?', 'Bạn muốn dạy ở đâu tại Việt Nam?')} error={errText('relocate', errors.relocate)}>
          <RadioGroup value={t.relocate} onValueChange={(v) => update(withRelocate(t, v as Relocate), ['relocate', 'teachAreas'])} className="grid gap-2">
            <Radio value="anywhere" className={RADIO_CARD}>
              <RadioDot className="mt-0.5" />
              <span className="text-sm font-semibold text-foreground">{tr('Anywhere', 'Bất kỳ đâu')}</span>
            </Radio>
            <Radio value="some" className={RADIO_CARD}>
              <RadioDot className="mt-0.5" />
              <span className="text-sm font-semibold text-foreground">{tr('Some cities', 'Một số thành phố')}</span>
            </Radio>
            <Radio value="online-only" className={RADIO_CARD}>
              <RadioDot className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{tr('Online only', 'Chỉ dạy trực tuyến')}</span>
                <span className="block text-xs text-muted-foreground">{tr('Staying abroad and teaching online.', 'Ở nước ngoài và dạy trực tuyến.')}</span>
              </span>
            </Radio>
          </RadioGroup>
        </Fieldset>
      )}
    </div>
  )
}
