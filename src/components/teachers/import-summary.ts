// What "Fill it in from my CV" filled, as the teacher reads it (teacher CV import, 2026-10-15): one row per answer, under
// the step that asks it, in the form's own words — so the summary says WHAT was filled, not just how much. Pure: the
// panel renders it, the tests read it.

import { TEACHER_OPTIONS, type TeacherInput, type TeacherStep } from '@/lib/teachers/profile'
import { countryName } from '@/lib/teachers/countries'
import { storedLanguageLabel } from '@/components/teachers/language-list'
import type { ImportField, ImportedAnswers } from '@/lib/teachers/import-map'

type Tr = (en: string, vi: string) => string
/** `check`: worked out rather than read — the row says so ("check it"). */
export type SummaryRow = { key: string; label: string; value: string; check?: true }
export type SummaryGroup = { step: Extract<TeacherStep, 'teaching' | 'about'>; rows: SummaryRow[] }

const optionLabel = (options: readonly { value: string; label: string; labelVi: string }[], tr: Tr) => (v: string) => {
  const o = options.find((x) => x.value === v)
  return o ? tr(o.label, o.labelVi) : v
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** The rows for what `filled` holds — only answers the import actually put in the form (mergeImport never overwrites). */
export function importSummary(values: ImportedAnswers, filled: readonly ImportField[], tr: Tr, lang: string): SummaryGroup[] {
  const has = (k: ImportField) => filled.includes(k)
  const v = values as Partial<TeacherInput>
  const teaching: SummaryRow[] = []
  const about: SummaryRow[] = []
  if (has('subjects') && v.subjects?.length) teaching.push({ key: 'subjects', label: tr('Subjects', 'Môn dạy'), value: v.subjects.map(optionLabel(TEACHER_OPTIONS.subject, tr)).join(', ') })
  if (has('teachLanguages') && v.teachLanguages?.length) teaching.push({ key: 'teachLanguages', label: tr('Languages you teach', 'Ngôn ngữ bạn dạy'), value: v.teachLanguages.map((l) => storedLanguageLabel(l, lang)).join(', ') })
  if (has('ageGroups') && v.ageGroups?.length) teaching.push({ key: 'ageGroups', label: tr('Who you teach', 'Đối tượng'), value: v.ageGroups.map(optionLabel(TEACHER_OPTIONS.ageGroup, tr)).join(', ') })
  if (has('experienceBand') && v.experienceBand) teaching.push({ key: 'experienceBand', label: tr('Teaching experience', 'Kinh nghiệm giảng dạy'), value: optionLabel(TEACHER_OPTIONS.experience, tr)(v.experienceBand), check: true })
  if (has('experience') && v.experience?.length) {
    const first = v.experience[0]
    const named = [first.role, first.employer].filter(Boolean).join(', ')
    teaching.push({
      key: 'experience',
      label: tr('Teaching jobs', 'Công việc giảng dạy'),
      value: v.experience.length === 1 ? named : `${v.experience.length} · ${named}${tr(' and more', ' và các công việc khác')}`,
    })
  }
  if (has('degreeLevel') || has('degreeMajor') || has('degreeInstitution') || has('degreeYear')) {
    const parts = [
      has('degreeLevel') && v.degreeLevel ? optionLabel(TEACHER_OPTIONS.degree, tr)(v.degreeLevel) : '',
      has('degreeMajor') ? v.degreeMajor ?? '' : '',
      has('degreeInstitution') ? v.degreeInstitution ?? '' : '',
      has('degreeYear') && v.degreeYear ? String(v.degreeYear) : '',
    ].filter(Boolean)
    if (parts.length) teaching.push({ key: 'degree', label: tr('Degree', 'Bằng cấp'), value: parts.join(' · ') })
  }
  if (has('certificates') && v.certificates?.length) teaching.push({ key: 'certificates', label: tr('Certificates', 'Chứng chỉ'), value: v.certificates.map((c) => optionLabel(TEACHER_OPTIONS.cert, tr)(c.type)).join(', ') })

  if (has('fullName') && v.fullName) about.push({ key: 'fullName', label: tr('Name', 'Họ tên'), value: v.fullName })
  if (has('nationality') && v.nationality) about.push({ key: 'nationality', label: tr('Nationality', 'Quốc tịch'), value: countryName(v.nationality, lang) })
  if (has('englishLevel') && v.englishLevel) {
    const level = v.englishLevel === 'native' ? tr('Native', 'Bản ngữ') : v.englishLevel === 'fluent' ? tr('Fluent', 'Lưu loát') : tr('Working level', 'Đủ dùng trong công việc')
    about.push({ key: 'englishLevel', label: tr('Your English', 'Tiếng Anh của bạn'), value: level })
  }
  if (has('languages') && v.languages?.length) about.push({ key: 'languages', label: tr('Other languages', 'Ngôn ngữ khác'), value: v.languages.map((l) => storedLanguageLabel(l, lang)).join(', ') })
  if (has('headline') && v.headline) about.push({ key: 'headline', label: tr('Headline', 'Tiêu đề'), value: v.headline })
  if (has('bio') && v.bio) about.push({ key: 'bio', label: tr('About you', 'Giới thiệu'), value: clip(v.bio.replace(/\s+/g, ' ').trim(), 140) })

  return [
    ...(teaching.length ? [{ step: 'teaching' as const, rows: teaching }] : []),
    ...(about.length ? [{ step: 'about' as const, rows: about }] : []),
  ]
}

/**
 * The imported answers the teacher has NOT changed since — what Undo puts back and what the steps still mark as "from
 * your CV". Compared as values: an answer edited and then typed back counts as untouched, which is what it is.
 */
export function untouchedImport(t: TeacherInput, values: ImportedAnswers, filled: readonly ImportField[]): ImportField[] {
  return filled.filter((k) => JSON.stringify(t[k]) === JSON.stringify(values[k]))
}

/** Undo: each untouched imported answer back to what it was before (the import only ever filled empty answers). */
export function undoImport(t: TeacherInput, values: ImportedAnswers, filled: readonly ImportField[], before: Partial<TeacherInput>): TeacherInput {
  const back = untouchedImport(t, values, filled)
  if (!back.length) return t
  const next: TeacherInput = { ...t }
  for (const k of back) (next as Record<ImportField, unknown>)[k] = before[k]
  return next
}
