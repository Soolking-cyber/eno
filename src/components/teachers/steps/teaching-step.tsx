'use client'

// ── STEP 3 · YOUR TEACHING (teacher onboarding redesign, 2026-10-08) ─────────────────────────────────────────────────
//   · What do you teach? (8 subjects) — "Other language" adds "Which language?" (searchable, language-combobox.tsx).
//   · Who do you teach? Kids · Teens · Adults — company classes are the Business English SUBJECT (it derives the
//     `ageGroup:business` facet; the form no longer asks for it).
//   · How long have you been teaching? — five bands, no default (it replaces the years box: an untouched 0 was
//     published as "under 1 year").
//   · Teaching jobs (optional, collapsed) — rows with visible labels, "I still work here".
//   · Qualifications (optional) — the highest degree (tap it again to clear) and its details; certificate chips, each
//     with optional hours · provider · year. ⛔ DATA, NEVER DOCUMENTS (owner: "without uploading any documents").

import { useId, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Field, FieldControl, FieldError } from '@/components/ui/field'
import { Fieldset } from '@/components/ui/fieldset'
import { ChevronDown, Plus, Trash2 } from '@/components/ui/icons'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Radio, RadioGroup } from '@/components/ui/radio-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { LanguagePicker } from '@/components/teachers/language-combobox'
import { EXPERIENCE_BANDS, LIMITS, TEACHER_FORM_OPTIONS, TEACHER_OPTIONS, type CertificateEntry, type ExperienceEntry } from '@/lib/teachers/profile'
import { thisMonth } from '@/components/teachers/teacher-form-rules'
import { RADIO_CHIP, certName, type StepProps } from '@/components/teachers/steps/shared'
import { cn } from '@/lib/utils'

const NO_EXPERIENCE: ExperienceEntry = { role: '', employer: '', city: '', from: '', to: '' }

export function TeachingStep({ t, set, update, errors, errText }: StepProps) {
  const { tr } = useLanguage()
  const uid = useId()
  const expErrors = t.experience.some((_, i) => errors[`experience.${i}`])
  const [jobsOpen, setJobsOpen] = useState(() => t.experience.length > 0)
  const bandLabel = (b: string) => {
    switch (b) {
      case 'under-1-year': return tr('Under 1 year', 'Dưới 1 năm')
      case '1-3-years': return tr('1–3 years', '1–3 năm')
      case '3-5-years': return tr('3–5 years', '3–5 năm')
      case '5-10-years': return tr('5–10 years', '5–10 năm')
      default: return tr('10+ years', 'Trên 10 năm')
    }
  }
  const setJob = (i: number, patch: Partial<ExperienceEntry>) => set('experience', t.experience.map((y, j) => (j === i ? { ...y, ...patch } : y)))
  const setCert = (i: number, patch: Partial<CertificateEntry>) => set('certificates', t.certificates.map((y, j) => (j === i ? { ...y, ...patch } : y)))
  const certTypes = t.certificates.map((c) => c.type).filter(Boolean)
  const onCerts = (next: string[]) => {
    const added = next.filter((v) => !certTypes.includes(v))
    const kept = t.certificates.filter((c) => !c.type || next.includes(c.type))
    set('certificates', [...kept, ...added.map((type) => ({ type, hours: null, provider: '', year: null }))].slice(0, LIMITS.certificates))
  }
  const num = (v: string): number | null => (v.trim() === '' ? null : Number(v))
  const degreeDetails = !!t.degreeLevel && t.degreeLevel !== 'no-degree'

  return (
    <div className="space-y-8">
      <Fieldset legend={tr('What do you teach?', 'Bạn dạy môn gì?')} legendId={`${uid}-subjects`} error={errText('subjects', errors.subjects)}>
        <ToggleGroup multiple value={t.subjects} onValueChange={(v) => update({ ...t, subjects: v }, ['subjects', 'teachLanguages', 'englishLevel'])} aria-labelledby={`${uid}-subjects`}>
          {TEACHER_OPTIONS.subject.map((o) => <ToggleGroupItem key={o.value} value={o.value}>{tr(o.label, o.labelVi)}</ToggleGroupItem>)}
        </ToggleGroup>
      </Fieldset>

      {t.subjects.includes('other-language') && (
        <Field invalid={!!errors.teachLanguages}>
          <Label htmlFor="tf-teach-langs">{tr('Which language do you teach?', 'Bạn dạy ngôn ngữ nào?')}</Label>
          <LanguagePicker id="tf-teach-langs" value={t.teachLanguages} onChange={(v) => set('teachLanguages', v)} max={LIMITS.teachLanguages} exclude={['en']} />
          {errors.teachLanguages && <FieldError>{errText('teachLanguages', errors.teachLanguages)}</FieldError>}
        </Field>
      )}

      <Fieldset
        legend={tr('Who do you teach?', 'Bạn dạy đối tượng nào?')}
        legendId={`${uid}-ages`}
        hint={tr('Company classes go under the Business English subject.', 'Lớp cho doanh nghiệp thuộc môn Tiếng Anh thương mại.')}
        error={errText('ageGroups', errors.ageGroups)}
      >
        <ToggleGroup multiple value={t.ageGroups} onValueChange={(v) => set('ageGroups', v)} aria-labelledby={`${uid}-ages`}>
          {TEACHER_FORM_OPTIONS.ageGroup.map((o) => <ToggleGroupItem key={o.value} value={o.value}>{tr(o.label, o.labelVi)}</ToggleGroupItem>)}
        </ToggleGroup>
      </Fieldset>

      <Fieldset legend={tr('How long have you been teaching?', 'Bạn đã dạy được bao lâu?')} error={errText('experienceBand', errors.experienceBand)}>
        <RadioGroup value={t.experienceBand ?? ''} onValueChange={(v) => set('experienceBand', v)} className="flex flex-wrap gap-x-2 gap-y-3">
          {EXPERIENCE_BANDS.map((b) => <Radio key={b} value={b} className={RADIO_CHIP}>{bandLabel(b)}</Radio>)}
        </RadioGroup>
      </Fieldset>

      {/* TEACHING JOBS — optional and collapsed; opened by a row's error so a refused Next can reach it. */}
      <Collapsible open={jobsOpen || expErrors} onOpenChange={setJobsOpen}>
        {/* The look lives on the <Button> itself, not on the trigger: a render child's className is concatenated,
            not merged (CLAUDE.md; ladder-compact-row.tsx, the first Collapsible call site). */}
        <CollapsibleTrigger
          render={<Button variant="bare" size="none" type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left" />}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">
              {tr('Teaching jobs (optional)', 'Công việc giảng dạy (không bắt buộc)')}{t.experience.length ? ` · ${t.experience.length}` : ''}
            </span>
            <span className="block text-sm font-normal text-muted-foreground">{tr('Your most recent first. Schools read this closely.', 'Công việc gần nhất trước. Các trường rất quan tâm mục này.')}</span>
          </span>
          <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-spring-snappy', (jobsOpen || expErrors) && 'rotate-180')} />
        </CollapsibleTrigger>
        <CollapsiblePanel className="space-y-4 pt-3">
          <ul className="space-y-4">
            {t.experience.map((x, i) => {
              const id = `tf-exp-${i}`
              const err = errors[`experience.${i}`]
              const still = x.to === ''
              return (
                <li key={i} className="space-y-3 border-b border-border pb-4" {...(err ? { 'data-invalid': '' } : {})}>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field>
                      <Label htmlFor={`${id}-role`}>{tr('Role', 'Vị trí')}</Label>
                      <FieldControl id={`${id}-role`} render={<Input id={`${id}-role`} value={x.role} maxLength={LIMITS.shortText} onChange={(e) => setJob(i, { role: e.target.value })} />} />
                    </Field>
                    <Field>
                      <Label htmlFor={`${id}-employer`}>{tr('School or company', 'Trường hoặc công ty')}</Label>
                      <FieldControl id={`${id}-employer`} render={<Input id={`${id}-employer`} value={x.employer} maxLength={LIMITS.shortText} onChange={(e) => setJob(i, { employer: e.target.value })} />} />
                    </Field>
                    <Field>
                      <Label htmlFor={`${id}-city`}>{tr('City (optional)', 'Thành phố (không bắt buộc)')}</Label>
                      <FieldControl id={`${id}-city`} render={<Input id={`${id}-city`} value={x.city} maxLength={LIMITS.shortText} onChange={(e) => setJob(i, { city: e.target.value })} />} />
                    </Field>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <Field className="w-auto">
                      <Label htmlFor={`${id}-from`}>{tr('From (month)', 'Từ (tháng)')}</Label>
                      <FieldControl id={`${id}-from`} render={<Input id={`${id}-from`} type="month" className="w-44" value={x.from} onChange={(e) => setJob(i, { from: e.target.value })} />} />
                    </Field>
                    {!still && (
                      <Field className="w-auto">
                        <Label htmlFor={`${id}-to`}>{tr('To (month)', 'Đến (tháng)')}</Label>
                        <FieldControl id={`${id}-to`} render={<Input id={`${id}-to`} type="month" className="w-44" value={x.to} onChange={(e) => setJob(i, { to: e.target.value })} />} />
                      </Field>
                    )}
                    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-body">
                      {/* "Present" is an empty end month in the data; the box says it out loud. Unticked, the end month
                          starts at this month for the teacher to move. */}
                      <Checkbox checked={still} onChange={(v) => setJob(i, { to: v ? '' : thisMonth() })} className="h-5 w-5" />
                      <span>{tr('I still work here', 'Tôi vẫn làm ở đây')}</span>
                    </label>
                  </div>
                  <Button variant="ghost" size="sm" type="button" onClick={() => set('experience', t.experience.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />{tr('Remove this job', 'Xoá công việc này')}
                  </Button>
                  {err && <p role="alert" className="text-sm text-destructive">{errText(`experience.${i}`, err)}</p>}
                </li>
              )
            })}
          </ul>
          {t.experience.length < LIMITS.experienceEntries && (
            <Button variant="secondary" size="sm" type="button" onClick={() => set('experience', [...t.experience, NO_EXPERIENCE])}>
              <Plus className="size-4" />{tr('Add a teaching job', 'Thêm công việc giảng dạy')}
            </Button>
          )}
        </CollapsiblePanel>
      </Collapsible>

      <section className="space-y-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">{tr('Qualifications (optional)', 'Bằng cấp (không bắt buộc)')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{tr('Just tell us — please do not upload certificates or diplomas. Schools check documents directly with you.', 'Chỉ cần cho biết — vui lòng không tải lên chứng chỉ hay bằng. Các trường sẽ xác minh trực tiếp với bạn.')}</p>
        </div>

        <Fieldset legend={tr('Highest degree', 'Bằng cấp cao nhất')} legendId={`${uid}-degree`} hint={tr('Tap it again to clear it.', 'Chạm lần nữa để bỏ chọn.')}>
          <ToggleGroup
            value={t.degreeLevel ? [t.degreeLevel] : []}
            onValueChange={(v) => update({ ...t, degreeLevel: v[0] ?? null }, ['degreeLevel', 'degreeMajor', 'degreeInstitution', 'degreeYear'])}
            aria-labelledby={`${uid}-degree`}
          >
            {TEACHER_OPTIONS.degree.map((o) => <ToggleGroupItem key={o.value} value={o.value}>{tr(o.label, o.labelVi)}</ToggleGroupItem>)}
          </ToggleGroup>
          {degreeDetails && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field>
                <Label htmlFor="tf-degree-major">{tr('Major (optional)', 'Chuyên ngành (không bắt buộc)')}</Label>
                <FieldControl id="tf-degree-major" render={<Input id="tf-degree-major" value={t.degreeMajor} maxLength={LIMITS.shortText} onChange={(e) => set('degreeMajor', e.target.value)} />} />
              </Field>
              <Field>
                <Label htmlFor="tf-degree-uni">{tr('University (optional)', 'Trường đại học (không bắt buộc)')}</Label>
                <FieldControl id="tf-degree-uni" render={<Input id="tf-degree-uni" value={t.degreeInstitution} maxLength={LIMITS.shortText} onChange={(e) => set('degreeInstitution', e.target.value)} />} />
              </Field>
              <Field invalid={!!errors.degreeYear}>
                <Label htmlFor="tf-degree-year">{tr('Year (optional)', 'Năm (không bắt buộc)')}</Label>
                <FieldControl id="tf-degree-year" render={<Input id="tf-degree-year" inputMode="numeric" value={t.degreeYear ?? ''} onChange={(e) => set('degreeYear', num(e.target.value.replace(/\D/g, '')))} />} />
                {errors.degreeYear && <FieldError>{errText('degreeYear', errors.degreeYear)}</FieldError>}
              </Field>
            </div>
          )}
        </Fieldset>

        <Fieldset legend={tr('Teaching certificates', 'Chứng chỉ giảng dạy')} legendId={`${uid}-certs`}>
          <ToggleGroup multiple value={certTypes} onValueChange={onCerts} aria-labelledby={`${uid}-certs`}>
            {TEACHER_OPTIONS.cert.map((o) => <ToggleGroupItem key={o.value} value={o.value}>{tr(o.label, o.labelVi)}</ToggleGroupItem>)}
          </ToggleGroup>
          {t.certificates.length > 0 && (
            <ul className="space-y-4">
              {t.certificates.map((c, i) => {
                const id = `tf-cert-${i}`
                const err = errors[`certificates.${i}`]
                const name = certName(c.type, tr)
                return (
                  <li key={`${c.type}-${i}`} className="space-y-3 border-b border-border pb-4" {...(err ? { 'data-invalid': '' } : {})}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">{name}</p>
                      <Button variant="ghost" size="sm" type="button" onClick={() => set('certificates', t.certificates.filter((_, j) => j !== i))}>
                        <Trash2 className="size-4" />{tr('Remove', 'Xoá')}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <Field>
                        <Label htmlFor={`${id}-hours`}>{tr('Hours (optional)', 'Số giờ (không bắt buộc)')}</Label>
                        <FieldControl id={`${id}-hours`} render={<Input id={`${id}-hours`} inputMode="numeric" value={c.hours ?? ''} onChange={(e) => setCert(i, { hours: num(e.target.value.replace(/\D/g, '')) })} />} />
                      </Field>
                      <Field>
                        <Label htmlFor={`${id}-year`}>{tr('Year (optional)', 'Năm (không bắt buộc)')}</Label>
                        <FieldControl id={`${id}-year`} render={<Input id={`${id}-year`} inputMode="numeric" value={c.year ?? ''} onChange={(e) => setCert(i, { year: num(e.target.value.replace(/\D/g, '')) })} />} />
                      </Field>
                      <Field className="col-span-2 sm:col-span-1">
                        <Label htmlFor={`${id}-provider`}>{tr('Provider (optional)', 'Đơn vị cấp (không bắt buộc)')}</Label>
                        <FieldControl id={`${id}-provider`} render={<Input id={`${id}-provider`} value={c.provider} maxLength={LIMITS.shortText} onChange={(e) => setCert(i, { provider: e.target.value })} />} />
                      </Field>
                    </div>
                    {/* ⛔ The row's error names the certificate (plan, 2026-10-08): "CELTA: …". */}
                    {err && <p role="alert" className="text-sm text-destructive">{name}: {errText(`certificates.${i}`, err)}</p>}
                  </li>
                )
              })}
            </ul>
          )}
        </Fieldset>
      </section>
    </div>
  )
}
