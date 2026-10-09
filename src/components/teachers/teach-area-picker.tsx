'use client'

// ── "WHERE CAN YOU TEACH?" — THE ONE LIST (teacher onboarding redesign, 2026-10-08) ─────────────────────────────────
// One list replaces the four old place questions (where you live as a preference, the cities you would work in,
// "open to online", the cover areas). It is public ("Can teach in"), schools filter by it, and cover lessons reach
// the part of it near home (places.ts coverReachOf). Its rules — what may be listed, what absorbs what — are
// places.ts normalizeTeachAreas; this component only draws them:
//   · ONLINE — one chip, first: the ONLY place Online is asked. "Online only" on step 1 (abroad) derives it, and the
//     chip then shows locked, with a note saying why (plan review B7).
//   · NEAR YOU — the home area (homeAreaKeys): the home city or province is PRE-SELECTED, plus the other places of the
//     same province (HCMC · Bình Dương · Vũng Tàu are one since the 2025 merger; Nha Trang ⇄ Khánh Hòa). Under HCMC:
//     "Anywhere in HCMC" (one place) or "Only some districts" → the 24 curated districts, the home district
//     pre-selected; Thủ Đức shows District 2 and 9 as included (it absorbs them).
//   · OTHER CITIES (whole city only) — only after "Yes, to some other cities" (or "Some cities" from abroad); after
//     "Anywhere" they are ONE line, "Anywhere in Vietnam", with Change.
// ⛔ THE PRE-SELECTION IS A SUGGESTION UNTIL THE TEACHER CONFIRMS IT (plan review B6): "These are the places I can
// teach" — or any edit of the list, which is a choice too. The server stamps teachAreasConfirmedAt from it, and an
// unconfirmed list is refused (validateTeacherInput `confirm`). Nothing is public from an untouched default.
// Place names are never sent through tr() (PlaceName's rule): placeLabel gives Vietnamese or English, nothing else.

import { useId, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Chip } from '@/components/ui/chip'
import { Fieldset } from '@/components/ui/fieldset'
import { Radio, RadioDot, RadioGroup } from '@/components/ui/radio-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  ANYWHERE, HCMC, HCMC_DISTRICT_KEYS, ONLINE, homeAreaKeys, isHub, normalizeTeachAreas, otherCityKeys, placeLabel,
  provinceCodeOfKey,
} from '@/lib/teachers/places'
import type { TeacherInput } from '@/lib/teachers/profile'

type PickerInput = Pick<
  TeacherInput,
  'livesIn' | 'currentCity' | 'currentDistrictKey' | 'currentProvince' | 'jobTypes' | 'relocate' | 'teachAreas' | 'teachAreasConfirmed'
>

/** The one key a ToggleGroup change added or removed. */
function toggled(before: readonly string[], after: readonly string[]): { added?: string; removed?: string } {
  const b = new Set(before)
  const a = new Set(after)
  return { added: after.find((k) => !b.has(k)), removed: before.find((k) => !a.has(k)) }
}

export function TeachAreaPicker({ t, onAreas, onConfirm, onChangeAnswer, coverIntent = false, error, confirmError }: {
  t: PickerInput
  /** A new list — an edit, which is the teacher choosing (the form marks the list confirmed). */
  onAreas: (teachAreas: string[]) => void
  onConfirm: (confirmed: boolean) => void
  /** "Change" beside "Anywhere in Vietnam" / the locked Online: back to that answer on step 1. */
  onChangeAnswer: () => void
  /** Came for cover (?goal=cover): HCMC opens on "Only some districts". */
  coverIntent?: boolean
  /** The list's refusal, in words (required / other_city_required). */
  error?: string
  /** The confirmation's refusal, in words. */
  confirmError?: string
}) {
  const { tr, lang } = useLanguage()
  const uid = useId()
  const picked = new Set(t.teachAreas)
  const home = homeAreaKeys(t)
  const homeHubs = home.filter(isHub)
  const homeProvinceKeys = home.filter((k) => provinceCodeOfKey(k) !== null)
  const nearKeys = [...homeHubs, ...homeProvinceKeys]
  const hasHcmc = homeHubs.includes(HCMC)
  const districts = HCMC_DISTRICT_KEYS.filter((k) => picked.has(k))
  // "Only some districts" chosen before any district is: the choice is the teacher's, so it stays open until they pick
  // one — or until they choose "Anywhere in HCMC" or take HCMC off. Cover's entry (?goal=cover) opens here.
  const [someDistricts, setSomeDistricts] = useState(() => hasHcmc && !picked.has(HCMC) && (districts.length > 0 || (coverIntent && t.currentCity === HCMC)))
  const hcmcMode: 'all' | 'some' | 'off' = picked.has(HCMC) ? 'all' : districts.length || someDistricts ? 'some' : 'off'
  const relocating = t.relocate === 'some'
  const others = relocating ? otherCityKeys(t) : []
  const onlineLocked = t.relocate === 'online-only'

  /** Every edit goes through the ONE normaliser, so the list never holds a double selection. */
  const commit = (keys: readonly string[]) => onAreas(normalizeTeachAreas(keys, t))
  const without = (drop: (k: string) => boolean) => t.teachAreas.filter((k) => !drop(k))

  const nearValue = nearKeys.filter((k) => (k === HCMC ? hcmcMode !== 'off' : picked.has(k)))
  const onNear = (next: string[]) => {
    const { added, removed } = toggled(nearValue, next)
    if (added === HCMC) { setSomeDistricts(false); commit([...t.teachAreas, HCMC]) }
    else if (removed === HCMC) { setSomeDistricts(false); commit(without((k) => k === HCMC || HCMC_DISTRICT_KEYS.includes(k))) }
    else if (added) commit([...t.teachAreas, added])
    else if (removed) commit(without((k) => k === removed))
  }
  const onHcmcMode = (mode: string) => {
    if (mode === 'all') { setSomeDistricts(false); commit([...without((k) => HCMC_DISTRICT_KEYS.includes(k)), HCMC]) }
    else {
      setSomeDistricts(true)
      commit([...without((k) => k === HCMC), ...(t.currentDistrictKey ? [t.currentDistrictKey] : [])])
    }
  }
  // Thủ Đức absorbs District 2 and 9 (cover.ts COVER_AREAS `parts`): while it is picked they show as included —
  // pressed and not tappable — and the list holds Thủ Đức alone.
  const thuDuc = picked.has('thu-duc')
  const absorbed = (k: string) => thuDuc && (k === 'd2' || k === 'd9')
  const districtValue = [...districts, ...(thuDuc ? ['d2', 'd9'] : [])]
  const onDistricts = (next: string[]) => {
    const { added, removed } = toggled(districtValue, next)
    if (added) commit([...t.teachAreas, added])
    else if (removed) commit(without((k) => k === removed))
  }
  const onOthers = (next: string[]) => commit([...without((k) => others.includes(k)), ...next])

  const ids = { near: `${uid}-near`, hcmc: `${uid}-hcmc`, districts: `${uid}-districts`, others: `${uid}-others`, confirm: `${uid}-confirm` }
  const place = (k: string) => placeLabel(k, lang)

  return (
    <div className="space-y-4">
      <Fieldset
        legend={tr('Where can you teach?', 'Bạn có thể dạy ở đâu?')}
        hint={tr('Schools find you by these places — this is the list your profile shows.', 'Các trường tìm bạn theo những nơi này — đây là danh sách hồ sơ của bạn hiển thị.')}
        error={error}
        className="space-y-5"
      >
        {/* ONLINE — asked here and nowhere else. */}
        <div className="space-y-2">
          <Chip
            size="md"
            tone="neutral"
            className="relative tap-44"
            pressed={onlineLocked || picked.has(ONLINE)}
            disabled={onlineLocked}
            onPressedChange={(on) => commit(on ? [...t.teachAreas, ONLINE] : without((k) => k === ONLINE))}
          >
            {tr('Online lessons', 'Dạy trực tuyến')}
          </Chip>
          {onlineLocked && (
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              {tr('You chose “Online only” in step 1.', 'Bạn đã chọn “Chỉ dạy trực tuyến” ở bước 1.')}
              <Button variant="link" size="none" type="button" className="font-semibold" onClick={onChangeAnswer}>{tr('Change', 'Thay đổi')}</Button>
            </p>
          )}
        </div>

        {nearKeys.length > 0 && (
          <div className="space-y-3">
            <p id={ids.near} className="text-sm font-semibold text-body">{tr('Near you', 'Gần bạn')}</p>
            <ToggleGroup multiple value={nearValue} onValueChange={onNear} aria-labelledby={ids.near}>
              {nearKeys.map((k) => <ToggleGroupItem key={k} value={k}>{place(k)}</ToggleGroupItem>)}
            </ToggleGroup>
            {hasHcmc && hcmcMode !== 'off' && (
              <div className="space-y-3 border-l-2 border-border pl-3">
                <p id={ids.hcmc} className="text-sm text-body">{place(HCMC)}</p>
                {/* Named by its own line: inside the fieldset, a radio group would otherwise take the legend as its name. */}
                <RadioGroup value={hcmcMode} onValueChange={onHcmcMode} aria-labelledby={ids.hcmc} className="grid gap-2 sm:grid-cols-2">
                  <Radio value="all" className="flex w-full items-center justify-start gap-2.5 whitespace-normal rounded-xl border border-border p-3 text-left data-checked:border-brand">
                    <RadioDot />
                    <span className="text-sm font-semibold text-foreground">{tr('Anywhere in the city', 'Bất kỳ đâu trong thành phố')}</span>
                  </Radio>
                  <Radio value="some" className="flex w-full items-center justify-start gap-2.5 whitespace-normal rounded-xl border border-border p-3 text-left data-checked:border-brand">
                    <RadioDot />
                    <span className="text-sm font-semibold text-foreground">{tr('Only some districts', 'Chỉ một số quận')}</span>
                  </Radio>
                </RadioGroup>
                {hcmcMode === 'some' && (
                  <div className="space-y-2">
                    <p id={ids.districts} className="sr-only">{tr('Districts', 'Các quận')}</p>
                    <ToggleGroup multiple value={districtValue} onValueChange={onDistricts} aria-labelledby={ids.districts}>
                      {HCMC_DISTRICT_KEYS.map((k) => (
                        <ToggleGroupItem key={k} value={k} disabled={absorbed(k)}>{place(k)}</ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    {thuDuc && <p className="text-xs text-muted-foreground">{tr('Thủ Đức includes the former District 2 and District 9.', 'TP Thủ Đức bao gồm Quận 2 và Quận 9 cũ.')}</p>}
                    {districts.length === 0 && <p className="text-sm text-muted-foreground">{tr('Pick at least one district — or choose “Anywhere in the city”.', 'Chọn ít nhất một quận — hoặc chọn “Bất kỳ đâu trong thành phố”.')}</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {relocating && others.length > 0 && (
          <div className="space-y-3">
            <p id={ids.others} className="text-sm font-semibold text-body">
              {t.livesIn === 'abroad' ? tr('Cities in Vietnam (whole city only)', 'Các thành phố tại Việt Nam (cả thành phố)') : tr('Other cities you would move to (whole city only)', 'Các thành phố khác bạn sẽ chuyển đến (cả thành phố)')}
            </p>
            <ToggleGroup multiple value={others.filter((k) => picked.has(k))} onValueChange={onOthers} aria-labelledby={ids.others}>
              {others.map((k) => <ToggleGroupItem key={k} value={k}>{place(k)}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
        )}

        {t.relocate === 'anywhere' && (
          <p className="flex flex-wrap items-center gap-x-2 rounded-xl bg-tint px-3.5 py-2.5 text-sm text-foreground">
            <span className="font-semibold">{place(ANYWHERE)}</span>
            <Button variant="link" size="none" type="button" className="font-semibold" onClick={onChangeAnswer}>{tr('Change', 'Thay đổi')}</Button>
          </p>
        )}
      </Fieldset>

      {/* ⛔ THE CONFIRMATION (plan review B6): the pre-selected places count only once confirmed — or edited. */}
      <div className="space-y-1.5">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm font-semibold leading-relaxed text-foreground">
          <Checkbox
            id={ids.confirm}
            checked={t.teachAreasConfirmed}
            onChange={onConfirm}
            className="mt-0.5 h-5 w-5"
            aria-invalid={confirmError ? true : undefined}
            aria-describedby={confirmError ? `${ids.confirm}-error` : undefined}
          />
          <span>{tr('These are the places I can teach', 'Đây là những nơi tôi có thể dạy')}</span>
        </label>
        {confirmError && <p id={`${ids.confirm}-error`} role="alert" className="text-sm text-destructive">{confirmError}</p>}
      </div>
    </div>
  )
}
