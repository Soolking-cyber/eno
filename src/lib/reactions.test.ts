import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  DEFAULT_TOP_REACTIONS,
  PRIMARY_REACTION,
  REACTIONS,
  TOP_REACTION_COUNT,
  isReactionEmoji,
  reactionAnimationUrl,
  reactionFor,
  topReactions,
} from '@/lib/reactions'

/**
 * THE REACTION CATALOGUE HAS THREE WAYS TO DRIFT, AND NONE OF THEM IS A TYPE ERROR.
 * A slug can name a file that is not there. The fallback bar can name an emoji the catalogue does
 * not have. Two entries can claim the same glyph. Each ships an interaction with a hole in it that
 * only shows up when a user opens the picker, so each gets an assertion here.
 */

describe('reaction catalogue', () => {
  it('every entry has its artwork on disk — the slug and the file cannot drift apart', () => {
    // ⚠️ Checks the REAL public/emoji directory, which is what the browser fetches. Mocking it
    // would make this test pass while the picker rendered dead animations.
    const missing = REACTIONS.filter((r) => !existsSync(join(process.cwd(), 'public', 'emoji', `${r.lottie}.json`)))
    expect(
      missing.map((m) => `${m.emoji} → public/emoji/${m.lottie}.json`),
      'run: node scripts/import-emoji-pack.mjs "<pack folder>"',
    ).toEqual([])
  })

  it('no glyph is registered twice — a duplicate silently shadows one entry in the lookup', () => {
    const seen = REACTIONS.map((r) => r.emoji)
    expect(seen.length).toBe(new Set(seen).size)
  })

  it('no slug is registered twice', () => {
    const slugs = REACTIONS.map((r) => r.lottie)
    expect(slugs.length).toBe(new Set(slugs).size)
  })

  it('⛔ every fallback-bar emoji exists in the catalogue — a typo here is a bar with a hole', () => {
    const orphans = DEFAULT_TOP_REACTIONS.filter((e) => !isReactionEmoji(e))
    expect(orphans).toEqual([])
    expect(DEFAULT_TOP_REACTIONS.length).toBe(TOP_REACTION_COUNT)
  })

  it('the default single reaction is itself a catalogue entry', () => {
    expect(isReactionEmoji(PRIMARY_REACTION)).toBe(true)
  })

  it('every entry carries both languages — admin chrome is EN-only, chat is not', () => {
    const untranslated = REACTIONS.filter((r) => !r.label.trim() || !r.labelVi.trim())
    expect(untranslated.map((r) => r.emoji)).toEqual([])
  })
})

describe('isReactionEmoji — the server-side write gate', () => {
  it('accepts catalogue members', () => {
    expect(isReactionEmoji('❤️')).toBe(true)
    expect(isReactionEmoji('🐢')).toBe(true)
  })

  it('⛔ rejects everything else, which is the entire point of the column being closed', () => {
    for (const bad of ['', 'heart', '<script>', '🫥', '❤️❤️', ' ❤️', '👍‍👍', 'DROP TABLE']) {
      expect(isReactionEmoji(bad), `expected ${JSON.stringify(bad)} to be refused`).toBe(false)
    }
  })

  it('rejects non-strings without throwing', () => {
    for (const bad of [null, undefined, 42, {}, [], true]) expect(isReactionEmoji(bad)).toBe(false)
  })
})

describe('topReactions — measured ranking merged with the fallback', () => {
  it('an empty tally yields the full fallback bar, which is the state on day one', () => {
    expect(topReactions([])).toEqual([...DEFAULT_TOP_REACTIONS])
    expect(topReactions()).toHaveLength(TOP_REACTION_COUNT)
  })

  it('⚠️ a partial tally is TOPPED UP, not truncated — the normal state for weeks after launch', () => {
    const out = topReactions(['🔥', '🐢'])
    expect(out.slice(0, 2)).toEqual(['🔥', '🐢'])
    expect(out).toHaveLength(TOP_REACTION_COUNT)
    expect(new Set(out).size).toBe(TOP_REACTION_COUNT)
  })

  it('a full tally wins outright', () => {
    const measured = ['🔥', '🐢', '🐙', '👀', '💯']
    expect(topReactions(measured)).toEqual(measured)
  })

  it('⚠️ drops values the catalogue no longer knows — the tally outlives any one deploy', () => {
    const out = topReactions(['🫥', '🔥', 'not-an-emoji'])
    expect(out[0]).toBe('🔥')
    expect(out).toHaveLength(TOP_REACTION_COUNT)
    expect(out.every(isReactionEmoji)).toBe(true)
  })

  it('never repeats an emoji even when the tally already contains a fallback member', () => {
    const out = topReactions(['👍', '👍', '❤️'])
    expect(new Set(out).size).toBe(out.length)
  })
})

describe('reactionAnimationUrl', () => {
  it('builds the one canonical path', () => {
    expect(reactionAnimationUrl('❤️')).toBe('/emoji/heart.json')
  })

  it('⚠️ returns null rather than a 404-bound URL for an unknown glyph', () => {
    expect(reactionAnimationUrl('🫥')).toBeNull()
  })

  it('agrees with reactionFor for every entry', () => {
    for (const r of REACTIONS) {
      expect(reactionFor(r.emoji)?.lottie).toBe(r.lottie)
      expect(reactionAnimationUrl(r.emoji)).toBe(`/emoji/${r.lottie}.json`)
    }
  })
})
