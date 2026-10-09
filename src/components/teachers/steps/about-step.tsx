'use client'

// ── STEP 4 · ABOUT YOU (the last step that needs no account — teacher onboarding redesign, 2026-10-08) ───────────────
//   · Full name · Nationality (searchable, country-combobox.tsx — unchanged).
//   · Your English: Native · Fluent · Working — only for English-medium subjects, no default (it replaces the
//     "native speaker" switch whose untouched OFF was published as "non-native").
//   · Other languages you speak (optional, searchable, up to 8 with a visible count; the languages taught are
//     already included).
//   · Headline (10+ characters, with a "Use suggestion" chip built from step 3) · About you (optional).
// teacher.eno.vn hands over from here ("Continue on eno.vn"); on eno.vn, signed out, "Sign in" — the form
// owns both actions (teacher-form.tsx).

import { useLanguage } from '@/context/language-context'
import { Chip } from '@/components/ui/chip'
import { Field, FieldControl, FieldDescription, FieldError } from '@/components/ui/field'
import { Fieldset } from '@/components/ui/fieldset'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Radio, RadioGroup } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { Sparkles } from '@/components/ui/icons'
import { CountryCombobox } from '@/components/teachers/country-combobox'
import { LanguagePicker } from '@/components/teachers/language-combobox'
import { languageCodeOf, storedLanguageLabel } from '@/components/teachers/language-list'
import { suggestHeadline } from '@/components/teachers/teacher-form-rules'
import { ENGLISH_LEVELS, LIMITS, englishMedium, type EnglishLevel } from '@/lib/teachers/profile'
import { RADIO_CHIP, type StepProps } from '@/components/teachers/steps/shared'

export function AboutStep({ t, set, errors, errText, prefillName, draftHost, signedIn }: StepProps & {
  /** The account's display name, offered — never filled in unasked (api/teachers/me `prefill`). */
  prefillName: string | null
  draftHost: boolean
  signedIn: boolean
}) {
  const { tr, lang } = useLanguage()
  const levelLabel = (l: EnglishLevel) => (l === 'native' ? tr('Native', 'Bản ngữ') : l === 'fluent' ? tr('Fluent', 'Lưu loát') : tr('Working', 'Đủ dùng trong công việc'))
  const suggestion = suggestHeadline(t, lang)
  const taughtCodes = t.teachLanguages.map(languageCodeOf).filter((c): c is string => !!c)

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field invalid={!!errors.fullName}>
          <Label htmlFor="tf-name">{tr('Full name', 'Họ và tên')}</Label>
          <FieldControl id="tf-name" render={<Input id="tf-name" autoComplete="name" value={t.fullName} maxLength={LIMITS.name} onChange={(e) => set('fullName', e.target.value)} />} />
          {prefillName && !t.fullName && (
            <Chip size="sm" tone="neutral" className="relative tap-44 self-start" onClick={() => set('fullName', prefillName.slice(0, LIMITS.name))}>
              {tr('Use my account name:', 'Dùng tên tài khoản:')} {prefillName}
            </Chip>
          )}
          {errors.fullName && <FieldError>{errText('fullName', errors.fullName)}</FieldError>}
        </Field>
        <Field invalid={!!errors.nationality}>
          <Label htmlFor="tf-nat">{tr('Nationality', 'Quốc tịch')}</Label>
          {/* Searchable (owner, 2026-10-08). `tf-nat` lands on its <input>: the label focuses it, and a refused Next
              reaches it through the Field's data-invalid like every other field (revealFirstError). */}
          <CountryCombobox id="tf-nat" value={t.nationality} onChange={(v) => set('nationality', v)} />
          {errors.nationality && <FieldError>{errText('nationality', errors.nationality)}</FieldError>}
        </Field>
      </div>

      {englishMedium(t.subjects) && (
        <Fieldset legend={tr('Your English', 'Tiếng Anh của bạn')} error={errText('englishLevel', errors.englishLevel)}>
          <RadioGroup value={t.englishLevel ?? ''} onValueChange={(v) => set('englishLevel', v as EnglishLevel)} className="flex flex-wrap gap-x-2 gap-y-3">
            {ENGLISH_LEVELS.map((l) => <Radio key={l} value={l} className={RADIO_CHIP}>{levelLabel(l)}</Radio>)}
          </RadioGroup>
        </Fieldset>
      )}

      <Field>
        <Label htmlFor="tf-langs">{tr('Other languages you speak (optional)', 'Ngôn ngữ khác bạn nói được (không bắt buộc)')}</Label>
        <LanguagePicker id="tf-langs" value={t.languages} onChange={(v) => set('languages', v)} max={LIMITS.languages} exclude={taughtCodes} />
        {t.teachLanguages.length > 0 && (
          <FieldDescription className="text-muted-foreground">
            {tr('Already included, because you teach them:', 'Đã bao gồm, vì bạn dạy những ngôn ngữ này:')} {t.teachLanguages.map((n) => storedLanguageLabel(n, lang)).join(', ')}
          </FieldDescription>
        )}
      </Field>

      <Field invalid={!!errors.headline}>
        <Label htmlFor="tf-headline">{tr('Headline', 'Tiêu đề')}</Label>
        <FieldControl id="tf-headline" render={<Input id="tf-headline" value={t.headline} maxLength={LIMITS.headline} onChange={(e) => set('headline', e.target.value)} />} />
        <FieldDescription className="text-muted-foreground">{tr('One line schools read first — at least 10 characters.', 'Một dòng các trường đọc đầu tiên — ít nhất 10 ký tự.')}</FieldDescription>
        {suggestion && suggestion !== t.headline && (
          <Chip size="sm" tone="neutral" className="relative tap-44 max-w-full self-start whitespace-normal text-left" onClick={() => set('headline', suggestion)}>
            <Sparkles className="size-3.5 shrink-0" aria-hidden />
            <span>{tr('Use suggestion:', 'Dùng gợi ý:')} <span className="font-normal">{suggestion}</span></span>
          </Chip>
        )}
        {errors.headline && <FieldError>{errText('headline', errors.headline)}</FieldError>}
      </Field>

      <Field>
        <Label htmlFor="tf-bio">{tr('About you (optional)', 'Giới thiệu (không bắt buộc)')}</Label>
        <FieldControl id="tf-bio" render={<Textarea id="tf-bio" rows={5} value={t.bio} maxLength={LIMITS.bio} onChange={(e) => set('bio', e.target.value)} />} />
        <FieldDescription className="text-muted-foreground">{tr('Your teaching style and experience. No phone numbers or emails here.', 'Phong cách giảng dạy và kinh nghiệm của bạn. Không ghi số điện thoại hay email.')}</FieldDescription>
      </Field>

      {draftHost ? (
        <p className="text-sm text-muted-foreground">{tr('Next you continue on eno.vn: sign in there to add cover lessons, your photo and publish. Your answers come with you.', 'Tiếp theo bạn tiếp tục trên eno.vn: đăng nhập ở đó để thêm dạy thay, ảnh và đăng hồ sơ. Câu trả lời của bạn được giữ nguyên.')}</p>
      ) : !signedIn ? (
        <p className="text-sm text-muted-foreground">{tr('Next you sign in to add your photo and publish. Your answers are kept.', 'Tiếp theo bạn đăng nhập để thêm ảnh và đăng hồ sơ. Câu trả lời của bạn được giữ lại.')}</p>
      ) : null}
    </div>
  )
}
