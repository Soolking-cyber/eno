import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TR_OVERRIDES } from './glossary'
import { LANGUAGES } from '@/lib/languages'
import { UI_STRINGS } from '@/generated/ui-strings'

/**
 * ⛔ "CONTINUE WITH APPLE" IS APPLE'S OWN TITLE IN EVERY LANGUAGE (plan §7.16). The HIG allows a custom Sign in
 * with Apple button only with one of Apple's titles, and App Review judges the button by it — so the nine
 * machine-translated languages must never get an engine's paraphrase. The titles below are the ones Apple's own
 * button shows; Apple ships no Khmer title, so Khmer keeps the English, pinned so the engine cannot invent one.
 * The Vietnamese is the tr() pair in sign-in-form.tsx (`vi` never reaches the overrides).
 */
const APPLE_TITLES = {
  vi: 'Tiếp tục với Apple',
  'zh-Hans': '通过 Apple 继续',
  ko: 'Apple로 계속하기',
  ja: 'Appleで続ける',
  ru: 'Продолжить с Apple',
  ms: 'Teruskan dengan Apple',
  th: 'ดำเนินการต่อด้วย Apple',
  fr: 'Continuer avec Apple',
  hi: 'Apple से जारी रखें',
  km: 'Continue with Apple',
} as const
const EN = 'Continue with Apple'

describe('the Sign in with Apple title', () => {
  it('is pinned in TR_OVERRIDES to Apple’s own string for every machine-translated language — km stays English', () => {
    const { vi, ...mt } = APPLE_TITLES
    expect(TR_OVERRIDES[EN]).toEqual(mt)
    expect(vi).toBeTruthy()
  })

  it('covers every language the site offers besides English and Vietnamese', () => {
    const mtLanguages = LANGUAGES.map((l) => l.code as string).filter((c) => c !== 'en' && c !== 'vi')
    expect(Object.keys(TR_OVERRIDES[EN]).sort()).toEqual(mtLanguages.sort())
  })

  it('is mirrored in scripts/glossary-data.json (the Translation table seed), value for value', () => {
    const rows = JSON.parse(readFileSync(join(process.cwd(), 'scripts/glossary-data.json'), 'utf8')) as Array<{ en: string; translations: Record<string, string> }>
    const row = rows.find((r) => r.en === EN)
    expect(row, 'no glossary-data.json row for the Apple title').toBeDefined()
    expect(row!.translations).toEqual(TR_OVERRIDES[EN])
  })

  it('the form renders exactly that English and Apple’s Vietnamese, and the string is in the harvested catalogue', () => {
    const form = readFileSync(join(process.cwd(), 'src/components/marketplace/sign-in-form.tsx'), 'utf8')
    // Assembled, never written out as a call: scripts/gen-ui-strings.mjs scans test files too, and would harvest it.
    const call = ['t', "('", EN, "', '", APPLE_TITLES.vi, "')"].join('')
    expect(form).toContain(call)
    // An override keys the exact English; a key nothing renders would be silently dead.
    expect(UI_STRINGS).toContain(EN)
  })
})
