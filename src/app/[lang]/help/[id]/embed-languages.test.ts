import { describe, expect, it } from 'vitest'
import { embedLanguages, pickEmbedded, readerLanguage } from './embed-languages'

describe('help thread translation embed', () => {
  it('takes the reader from the lang cookie first, then the first supported Accept-Language tag', () => {
    expect(readerLanguage('ko', 'vi,en;q=0.8')).toBe('ko')
    expect(readerLanguage(null, 'de-DE,ja;q=0.9,vi;q=0.5')).toBe('ja')
    expect(readerLanguage(undefined, 'zh-CN,vi;q=0.5')).toBe('zh-Hans')
    // A garbage cookie falls through to the header, as langVariantFor does.
    expect(readerLanguage('xx', 'ru')).toBe('ru')
    expect(readerLanguage(null, 'de-DE')).toBeNull()
    expect(readerLanguage(null, null)).toBeNull()
  })

  it('always keeps en and vi, and adds only the reader language', () => {
    expect([...embedLanguages(null)].sort()).toEqual(['en', 'vi'])
    expect([...embedLanguages('vi')].sort()).toEqual(['en', 'vi'])
    expect([...embedLanguages('ru')].sort()).toEqual(['en', 'ru', 'vi'])
  })

  it('drops every other cached language and returns null when nothing is left', () => {
    const cached = { vi: 'Xin chào', ru: 'Привет', ko: '안녕하세요', ja: 'こんにちは' }
    expect(pickEmbedded(cached, embedLanguages('en'))).toEqual({ vi: 'Xin chào' })
    expect(pickEmbedded(cached, embedLanguages('ko'))).toEqual({ vi: 'Xin chào', ko: '안녕하세요' })
    expect(pickEmbedded({ ru: 'Привет' }, embedLanguages('vi'))).toBeNull()
    expect(pickEmbedded(undefined, embedLanguages('vi'))).toBeNull()
  })
})
