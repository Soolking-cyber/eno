// @vitest-environment jsdom
/**
 * <Bilingual datesIso>: the date follows the SENTENCE actually shown. A translated line gets the reader's
 * own month name; an English line — the translation still on its way, or a fallback after it lost a
 * placeholder — keeps the English date from `values`, never an English sentence around a Russian date.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const language = { lang: 'ru', translated: '' }
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: language.lang, tr: (en: string, vi: string) => (language.lang === 'vi' ? vi : language.lang === 'en' ? en : language.translated || en) }),
}))

import { Bilingual } from './bilingual'

const EN = 'The changes take effect on {date}.'
const VI = 'Nội dung sửa đổi có hiệu lực từ ngày {date}.'
const show = (lang: string, translated = '') => {
  language.lang = lang
  language.translated = translated
  return render(<Bilingual en={EN} vi={VI} values={{ date: lang === 'vi' ? '01/10/2026' : '1 October 2026' }} datesIso={{ date: '2026-10-01' }} />).container.textContent
}

describe('<Bilingual datesIso>', () => {
  it('en and vi print the authored date forms', () => {
    expect(show('en')).toBe('The changes take effect on 1 October 2026.')
    expect(show('vi')).toBe('Nội dung sửa đổi có hiệu lực từ ngày 01/10/2026.')
  })
  it('a translated line gets the reader\'s own month name', () => {
    expect(show('ru', 'Изменения вступают в силу {date}.')).toMatch(/^Изменения вступают в силу 1\s+октября\s+2026/)
  })
  it('an English line keeps the English date — pending translation, or a fallback', () => {
    expect(show('ru')).toBe('The changes take effect on 1 October 2026.')
    expect(show('ru', 'Изменения вступают в силу.')).toBe('The changes take effect on 1 October 2026.') // lost {date}
  })
})
