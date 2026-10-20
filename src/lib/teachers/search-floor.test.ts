import { describe, expect, it } from 'vitest'
import {
  ABOUT_WORDS_FLOOR, isMaskedName, teacherPublicVideo, teacherRobots, teacherSearchFacts, teacherSearchVerdict, wordCount,
} from './search-floor'
import { maskEmailHandle } from '@/lib/utils'
import { publicSafeName } from '@/lib/publish-guard'

/**
 * THE SEARCH VERDICT (owner decisions 7 and 14, 2026-10-20): a teacher profile is offered to search engines only with an
 * About text of 30 words or more OR an intro video the page plays — never for a masked name, never once the teacher hid
 * it from search engines. One verdict for the robots tag, the JSON-LD, the sitemaps and a teacher-only storefront.
 */
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')
const facts = (over: Partial<Parameters<typeof teacherSearchVerdict>[0] & object> = {}) =>
  ({ name: 'Jane Doe', bio: words(ABOUT_WORDS_FLOOR), publicVideo: null, hideFromSearch: false, ...over })

describe('wordCount — as a word processor counts', () => {
  it('whitespace-separated runs with a letter or a digit: a hyphenated word is one, a dash or a bullet none', () => {
    expect(wordCount('Hi — I am a student-centred teacher • 5-10 years')).toBe(8)
    expect(wordCount("I'm a bachelor's graduate.")).toBe(4)
    expect(wordCount('  many\n\nlines\tand   spaces  ')).toBe(4)
  })
  it('a Vietnamese syllable is a word (as in any Vietnamese word count)', () => {
    expect(wordCount('Tôi là giáo viên tiếng Anh')).toBe(6)
  })
  it('a script written without spaces counts its words (Unicode word boundaries), not one per run', () => {
    expect(wordCount('我是一名英语老师')).toBeGreaterThan(1)
    expect(wordCount('ครูสอนภาษาอังกฤษ')).toBeGreaterThan(1)
  })
  it('nothing, null, emoji and punctuation alone: 0', () => {
    for (const t of ['', '   ', null, undefined, '— • …', '🙂 🙂']) expect(wordCount(t), String(t)).toBe(0)
  })
})

describe('isMaskedName', () => {
  it('⛔ the handle an account carries until it has a real name — "nn***" — is masked, from both maskers', () => {
    expect(isMaskedName(maskEmailHandle('nnguyen@example.com'))).toBe(true)
    expect(isMaskedName(publicSafeName('le.van@example.com'))).toBe(true)
    expect(isMaskedName('a***')).toBe(true)
  })
  it('any asterisk, or no letter at all, says nothing about a person', () => {
    for (const n of ['Jo**', '***', '', '   ', '12345', '—', null]) expect(isMaskedName(n), String(n)).toBe(true)
  })
  it('a real name in any script is not', () => {
    for (const n of ['Jane Doe', 'Nguyễn Văn An', "O'Neil", '王芳', 'Ана', 'J']) expect(isMaskedName(n), n).toBe(false)
  })
})

describe('teacherPublicVideo — the page\'s own player rule', () => {
  it('⛔ kept private: no player, whatever URL survives', () => {
    expect(teacherPublicVideo({ videoOnRequest: true, videoUrl: 'https://x/v.mp4' }, 'https://x/l.mp4')).toBeNull()
  })
  it('the profile\'s URL, else the listing\'s; `??` exactly — an empty string is kept, never replaced by the listing\'s', () => {
    expect(teacherPublicVideo({ videoOnRequest: false, videoUrl: 'https://x/v.mp4' }, 'https://x/l.mp4')).toBe('https://x/v.mp4')
    expect(teacherPublicVideo({ videoOnRequest: false, videoUrl: null }, 'https://x/l.mp4')).toBe('https://x/l.mp4')
    expect(teacherPublicVideo({ videoOnRequest: false, videoUrl: '' }, 'https://x/l.mp4')).toBe('')
    expect(teacherPublicVideo(null, 'https://x/l.mp4')).toBe('https://x/l.mp4')
    expect(teacherPublicVideo(null, null)).toBeNull()
  })
})

describe('teacherSearchVerdict', () => {
  it(`the floor: ${ABOUT_WORDS_FLOOR} words in, ${ABOUT_WORDS_FLOOR - 1} out`, () => {
    expect(ABOUT_WORDS_FLOOR).toBe(30)
    expect(teacherSearchVerdict(facts())).toEqual({ indexable: true, reason: null })
    expect(teacherSearchVerdict(facts({ bio: words(29) }))).toEqual({ indexable: false, reason: 'thin' })
    expect(teacherSearchVerdict(facts({ bio: '' }))).toEqual({ indexable: false, reason: 'thin' })
    expect(teacherSearchVerdict(facts({ bio: null }))).toEqual({ indexable: false, reason: 'thin' })
  })
  it('OR an intro video the page plays', () => {
    expect(teacherSearchVerdict(facts({ bio: '', publicVideo: 'https://x/v.mp4' }))).toEqual({ indexable: true, reason: null })
    expect(teacherSearchVerdict(facts({ bio: '', publicVideo: '' })).indexable).toBe(false)
  })
  it('⛔ a masked name is out FIRST — over a long About and a video', () => {
    expect(teacherSearchVerdict(facts({ name: 'nn***', bio: words(80), publicVideo: 'https://x/v.mp4' }))).toEqual({ indexable: false, reason: 'masked-name' })
  })
  it('⛔ the teacher\'s own switch is out — over a long About and a video', () => {
    expect(teacherSearchVerdict(facts({ hideFromSearch: true, bio: words(80), publicVideo: 'https://x/v.mp4' }))).toEqual({ indexable: false, reason: 'opted-out' })
  })
  it('a listing with no profile row is out', () => {
    expect(teacherSearchVerdict(null)).toEqual({ indexable: false, reason: 'no-profile' })
    expect(teacherSearchVerdict(teacherSearchFacts(null, { video: 'https://x/l.mp4' }))).toEqual({ indexable: false, reason: 'no-profile' })
  })
})

describe('teacherSearchFacts — the page\'s fields, from a row and its listing', () => {
  const row = { fullName: 'Jane Doe', bio: words(5), videoUrl: null, videoOnRequest: false, hideFromSearch: false }
  it('the name the h1 prints, the bio, the video the player plays, the switch', () => {
    expect(teacherSearchFacts(row, { video: 'https://x/l.mp4' })).toEqual({ name: 'Jane Doe', bio: words(5), publicVideo: 'https://x/l.mp4', hideFromSearch: false })
    expect(teacherSearchFacts({ ...row, videoOnRequest: true, videoUrl: 'https://x/v.mp4' }, { video: 'https://x/l.mp4' })?.publicVideo).toBeNull()
  })
})

describe('teacherRobots', () => {
  it('noindex, follow when out; the default (undefined) when in', () => {
    expect(teacherRobots({ indexable: false, reason: 'thin' })).toEqual({ index: false, follow: true })
    expect(teacherRobots({ indexable: true, reason: null })).toBeUndefined()
  })
})
