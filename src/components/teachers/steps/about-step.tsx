'use client'

// ── STEP 4 · ABOUT YOU (eno.vn, signed in — teacher onboarding redesign, 2026-10-08) ─────────────────────────────────
//   · Full name · Nationality (searchable, country-combobox.tsx — unchanged).
//   · Your English: Native · Fluent · Working — only for English-medium subjects, no default (it replaces the
//     "native speaker" switch whose untouched OFF was published as "non-native").
//   · Other languages you speak (optional, searchable, up to 8 with a visible count; the languages taught are
//     already included).
//   · Headline (10+ characters, with a "Use suggestion" chip built from step 3) · About you (optional), with "Improve
//     with AI" under it once the teacher has written something (owner, 2026-10-21) — the form owns that call
//     (teacher-form.tsx improveBio), as it owns the uploads; this step only shows it (`bioAi`).
// ⚠️ A SIGNED-IN STEP SINCE 2026-10-11 (PRE_SIGNIN_STEPS = ['plans']): teacher.eno.vn hands over, and eno.vn asks for the
// sign-in, right after step 1 — this step was the last one that needed no account before that (2026-10-08).

import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
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
import { BIO_OWN_TEXT_MIN } from '@/lib/teachers/bio-context'
import { BIO_ACTION_LABEL, BIO_NOTICE } from '@/lib/teachers/bio-notice'
import { RADIO_CHIP, type StepProps } from '@/components/teachers/steps/shared'
import { cn } from '@/lib/utils'
import { isMaskedName } from '@/lib/teachers/search-floor'

/** Why the last "Improve with AI" left the text as it was — each one a line under it, never a field error (below). */
export type BioAiError = '' | 'rate' | 'unavailable' | 'failed' | 'notice' | 'session' | 'short' | 'network' | 'changed'
/**
 * "IMPROVE WITH AI" UNDER THE ABOUT TEXT (owner, 2026-10-21) — the form's state, shown here. teacher-form.tsx owns the
 * request (POST /api/teachers/me/bio-rewrite), the app's Google AI question, the rules that drop a late answer, and Undo.
 */
export type BioAi = {
  /** GET /api/teachers/me `bioAi` (Gemini on Vertex is configured) — false: nothing of it shows. */
  available: boolean
  /** A rewrite is on its way: the chip spins and the text is read-only (the text sent is the text replaced). */
  working: boolean
  /** A rewrite let go (the teacher left About) is still settling on the server: the chip spins, the text is the teacher's. */
  settling?: boolean
  /** Another upload or a save is running (the form's `busy` — one at a time): the chip waits, never a dead tap. */
  blocked?: boolean
  error: BioAiError
  /** The text is still the one the AI wrote: the line with Undo shows. */
  canUndo: boolean
  onImprove: () => void
  onUndo: () => void
}

// ⚠️ No "sign in next" note here any more (2026-10-11): sign-in comes right after "Your plans" (PRE_SIGNIN_STEPS), so this
// step is only ever shown signed in on eno.vn — the plans step says what comes next instead.
export function AboutStep({ t, set, errors, errText, prefillName, bioAi }: StepProps & {
  /** The account's display name, offered — never filled in unasked (api/teachers/me `prefill`). */
  prefillName: string | null
  /** "Improve with AI" under the About text — absent: the field as it was before it. */
  bioAi?: BioAi
}) {
  const { tr, lang } = useLanguage()
  const levelLabel = (l: EnglishLevel) => (l === 'native' ? tr('Native', 'Bản ngữ') : l === 'fluent' ? tr('Fluent', 'Lưu loát') : tr('Working level', 'Đủ dùng trong công việc'))
  const suggestion = suggestHeadline(t, lang)
  const taughtCodes = t.teachLanguages.map(languageCodeOf).filter((c): c is string => !!c)
  // Each refusal as the teacher's next step (the route's answers — teacher-form.tsx bioErrorOf).
  const bioErrorLine = (e: BioAiError): string => {
    switch (e) {
      case 'rate': return tr('Too many tries — please try again in a few minutes.', 'Bạn đã thử quá nhiều lần — vui lòng thử lại sau vài phút.')
      case 'unavailable': return tr('AI isn’t available right now — please try again later.', 'Hiện chưa dùng được AI — vui lòng thử lại sau.')
      case 'failed': return tr('AI couldn’t improve this text. Try again, or add a little more about how you teach.', 'AI chưa cải thiện được đoạn giới thiệu này. Hãy thử lại, hoặc viết thêm một chút về cách bạn dạy.')
      // The CV reader's words for the same two cases (teacher-import-panel.tsx) — one string each, and "eno", never
      // "eno.vn": the form ships to both editions (gate review, opus 2026-10-22).
      case 'notice': return tr('The words on this page changed since you opened it. Reload the page to read them, then try again.', 'Nội dung trên trang đã thay đổi kể từ khi bạn mở. Hãy tải lại trang để đọc, rồi thử lại.')
      case 'session': return tr('Your session ended — sign in again to use AI.', 'Phiên đăng nhập đã kết thúc — hãy đăng nhập lại để dùng AI.')
      case 'short': return tr('Write a little more first.', 'Hãy viết thêm một chút trước đã.')
      case 'network': return tr('Couldn’t reach eno — check your connection and try again.', 'Không kết nối được với eno — hãy kiểm tra kết nối rồi thử lại.')
      case 'changed': return tr('Your answers changed while AI was writing — tap “Improve with AI” again.', 'Câu trả lời của bạn đã thay đổi trong lúc AI đang viết — hãy nhấn “Cải thiện bằng AI” lần nữa.')
      default: return ''
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field invalid={!!errors.fullName}>
          <Label htmlFor="tf-name">{tr('Full name', 'Họ và tên')}</Label>
          <FieldControl id="tf-name" render={<Input id="tf-name" autoComplete="name" value={t.fullName} maxLength={LIMITS.name} onChange={(e) => set('fullName', e.target.value)} />} />
          {/* ⚠️ Never offered when the account name is a MASKED email handle ("gi***") — an email-code sign-up's display name.
              The chip published profiles as "gi***", nameless to schools and dropped from search (sweep, 2026-10-22). */}
          {prefillName && !t.fullName && !isMaskedName(prefillName) && (
            <Chip size="sm" tone="neutral" className="relative tap-44 max-w-full self-start whitespace-normal text-left" onClick={() => set('fullName', prefillName.slice(0, LIMITS.name))}>
              {tr('Use my account name:', 'Dùng tên tài khoản:')} {prefillName}
            </Chip>
          )}
          {errors.fullName && <FieldError>{errText('fullName', errors.fullName, [t.fullName])}</FieldError>}
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

      <Field invalid={!!errors.languages}>
        <Label htmlFor="tf-langs">{tr('Other languages you speak (optional)', 'Ngôn ngữ khác bạn nói được (không bắt buộc)')}</Label>
        <LanguagePicker id="tf-langs" value={t.languages} onChange={(v) => set('languages', v)} max={LIMITS.languages} exclude={taughtCodes} />
        {t.teachLanguages.length > 0 && (
          <FieldDescription className="text-muted-foreground">
            {tr('Already included, because you teach them:', 'Đã bao gồm, vì bạn dạy những ngôn ngữ này:')} {t.teachLanguages.map((n) => storedLanguageLabel(n, lang)).join(', ')}
          </FieldDescription>
        )}
        {errors.languages && <FieldError>{errText('languages', errors.languages, t.languages)}</FieldError>}
      </Field>

      <Field invalid={!!errors.headline}>
        <Label htmlFor="tf-headline">{tr('Headline', 'Tiêu đề')}</Label>
        <FieldControl id="tf-headline" render={<Input id="tf-headline" value={t.headline} maxLength={LIMITS.headline} onChange={(e) => set('headline', e.target.value)} />} />
        <FieldDescription className="text-muted-foreground">{tr('One line schools read first — at least 10 characters.', 'Dòng đầu tiên các trường sẽ đọc — ít nhất 10 ký tự.')}</FieldDescription>
        {suggestion && suggestion !== t.headline && (
          <Chip size="sm" tone="neutral" className="relative tap-44 max-w-full self-start whitespace-normal text-left" onClick={() => set('headline', suggestion)}>
            <Sparkles className="size-3.5 shrink-0" aria-hidden />
            <span>{tr('Use suggestion:', 'Dùng gợi ý:')} <span className="font-normal">{suggestion}</span></span>
          </Chip>
        )}
        {errors.headline && <FieldError>{errText('headline', errors.headline, [t.headline])}</FieldError>}
      </Field>

      {/* ⛔ The bio had NO error slot (2026-10-21): a refused About text showed nothing at the field the teacher typed in. */}
      <Field invalid={!!errors.bio}>
        <Label htmlFor="tf-bio">{tr('About you (optional)', 'Giới thiệu (không bắt buộc)')}</Label>
        {/* Read-only while "Improve with AI" runs: its answer replaces the text that was sent, so anything typed in those
            seconds would be lost to it (the post wizard's rule). */}
        <FieldControl id="tf-bio" render={<Textarea id="tf-bio" rows={5} value={t.bio} maxLength={LIMITS.bio} readOnly={!!bioAi?.working} onChange={(e) => set('bio', e.target.value)} />} />
        <FieldDescription className="text-muted-foreground">{tr('Your teaching style and experience. No phone numbers or emails here.', 'Phong cách giảng dạy và kinh nghiệm của bạn. Không ghi số điện thoại hay email vào đây.')}</FieldDescription>
        {errors.bio && <FieldError>{errText('bio', errors.bio, [t.bio])}</FieldError>}
        {/* ⛔ "IMPROVE WITH AI" SITS UNDER THE DESCRIPTION, NEVER IN THE LABEL ROW: a refused Publish focuses the Field's FIRST
            focusable child (revealFirstError) — that must stay the textarea — and the chip's tap-44 would reach into the
            textarea's top edge. Its notice is a plain <p> the chip names in aria-describedby (a second FieldDescription
            would be read with the textarea instead), and every line under it is role="status" — never role="alert",
            data-invalid or aria-invalid, which revealFirstError would scroll to and focus on the next refusal. */}
        {bioAi?.available && (t.bio.trim().length >= BIO_OWN_TEXT_MIN ? (
          <>
            <Chip size="sm" tone="neutral" className="relative tap-44 max-w-full self-start whitespace-normal text-left" loading={bioAi.working || !!bioAi.settling} disabled={bioAi.working || !!bioAi.settling || !!bioAi.blocked} aria-describedby="tf-bio-ai-note" onClick={bioAi.onImprove}>
              <Sparkles className="size-3.5 shrink-0" aria-hidden />
              {tr(BIO_ACTION_LABEL.en, BIO_ACTION_LABEL.vi)}
            </Chip>
            {/* ⛔ THE NOTICE BESIDE THE ACT (bio-notice.ts — the tap is the consent): the label and these words are what the
                consent record's hash covers, so both are rendered exactly as authored, in this order. */}
            <p id="tf-bio-ai-note" className="text-xs text-muted-foreground">{BIO_NOTICE.map((p) => tr(p.en, p.vi)).join(' ')}</p>
          </>
        ) : (
          // "Once they write about them" (owner): until there is something to improve, what to write first.
          <p className="text-xs text-muted-foreground">{tr('Write a line or two about how you teach — then AI can polish it.', 'Hãy viết một vài dòng về cách bạn dạy — rồi AI sẽ giúp bạn hoàn thiện.')}</p>
        ))}
        {/* ONE status line, mounted while the feature is on and only its words changing (gate review, opus 2026-10-22: a
            role="status" inserted already holding its text is often not announced — VoiceOver, in-app WebViews). Empty, it
            is visually hidden, so it adds no gap. The Undo button sits beside it, outside the region: its label is not
            part of what is read out. */}
        {bioAi?.available && (
          <div className={cn('flex flex-wrap items-center gap-x-2', !bioAi.error && !bioAi.canUndo && 'sr-only')}>
            <p role="status" className={cn('text-sm', bioAi.error ? 'text-warning' : 'text-body')}>
              {bioAi.error ? bioErrorLine(bioAi.error) : bioAi.canUndo ? tr('Rewritten with AI — read it and make it yours.', 'Đã viết lại bằng AI — hãy đọc lại và chỉnh sửa cho đúng với bạn.') : ''}
            </p>
            {/* Its own name: the CV summary's "Undo" is another button (teacher-import-panel.tsx). */}
            {bioAi.canUndo && <Button variant="ghost" size="sm" type="button" className="relative tap-44" aria-label={tr('Undo the AI rewrite', 'Hoàn tác bản viết lại bằng AI')} onClick={bioAi.onUndo}>{tr('Undo', 'Hoàn tác')}</Button>}
          </div>
        )}
      </Field>
    </div>
  )
}
