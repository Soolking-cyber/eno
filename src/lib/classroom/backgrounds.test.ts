import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BACKGROUNDS, BACKGROUND_LABEL, DEFAULT_BACKGROUND, backgroundImage, backgroundThumb, isBackground } from './backgrounds'
import { DEFAULT_TRAITS, parseTraits } from './persona'

/** THE ROOM BEHIND THE AVATAR (owner, 2026-10-27: "so students feel like they are in classroom with teacher"). */
describe('backgrounds', () => {
  it('every room has its picture and thumbnail on disk, a label in both languages; plain has none', () => {
    for (const b of BACKGROUNDS) {
      expect(BACKGROUND_LABEL[b].en, b).toBeTruthy()
      expect(BACKGROUND_LABEL[b].vi, b).toBeTruthy()
      if (b === 'plain') {
        expect(backgroundImage(b)).toBeNull()
        expect(backgroundThumb(b)).toBeNull()
        continue
      }
      expect(existsSync(`public${backgroundImage(b)}`), b).toBe(true)
      expect(existsSync(`public${backgroundThumb(b)}`), b).toBe(true)
    }
  })
  it('only a known room is a room', () => {
    expect(isBackground('classroom')).toBe(true)
    expect(isBackground('../../etc/passwd')).toBe(false)
    expect(isBackground(null)).toBe(false)
  })
})

describe('parseTraits — the background', () => {
  it('kept when known; anything else, or an avatar saved before it existed, is in the classroom', () => {
    expect(parseTraits({ ...DEFAULT_TRAITS, background: 'library' }).background).toBe('library')
    expect(parseTraits({ tone: 'warm', pace: 'natural', topics: [] }).background).toBe(DEFAULT_BACKGROUND)
    expect(parseTraits({ background: 'javascript:alert(1)' }).background).toBe(DEFAULT_BACKGROUND)
    expect(DEFAULT_BACKGROUND).toBe('classroom')
  })
})
