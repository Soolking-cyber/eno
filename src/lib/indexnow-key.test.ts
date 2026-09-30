import { describe, expect, it } from 'vitest'
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match'
import { INDEXNOW_KEY_REWRITE, readIndexNowKey } from './indexnow-key'

/**
 * THE KEY-FILE REWRITE, RUN THROUGH NEXT'S OWN MATCHER (its bundled path-to-regexp, with the options a
 * custom rewrite is compiled with: strict, unnamed params removed). The production build is checked
 * separately (the rewrite in routes-manifest.json, and curl on the standalone server).
 */
describe('the /<key>.txt rewrite', () => {
  const match = getPathMatch(INDEXNOW_KEY_REWRITE.source, { strict: true, removeUnnamedParams: true })

  it('matches a one-segment key file and captures the key', () => {
    expect(match('/a1b2c3d4e5f6.txt')).toEqual({ key: 'a1b2c3d4e5f6' })
    expect(match('/0123456789abcdef0123456789abcdef.txt')).toEqual({ key: '0123456789abcdef0123456789abcdef' })
    expect(match('/Key-With-Dashes-1.txt')).toEqual({ key: 'Key-With-Dashes-1' })
  })

  it('does not match robots.txt, llms.txt, nested paths, underscores, or other extensions', () => {
    for (const p of ['/robots.txt', '/llms.txt', '/x/abcdefgh.txt', '/abc_defgh.txt', '/abcdefgh.xml', '/abcdefg.txt', `/${'a'.repeat(129)}.txt`, '/abcdefgh.txt/x']) {
      expect(match(p), p).toBe(false)
    }
  })

  it('rewrites to the key route with the key as `k`', () => {
    expect(INDEXNOW_KEY_REWRITE.destination).toBe('/api/indexnow-key?k=:key')
  })
})

describe('readIndexNowKey', () => {
  it('is null when unset, blank or malformed, and the key when well-formed', () => {
    expect(readIndexNowKey({})).toBeNull()
    expect(readIndexNowKey({ INDEXNOW_KEY: '' })).toBeNull()
    expect(readIndexNowKey({ INDEXNOW_KEY: 'short' })).toBeNull()
    expect(readIndexNowKey({ INDEXNOW_KEY: 'has_underscore1' })).toBeNull()
    expect(readIndexNowKey({ INDEXNOW_KEY: 'a'.repeat(129) })).toBeNull()
    expect(readIndexNowKey({ INDEXNOW_KEY: ' 0123456789abcdef0123456789abcdef\n' })).toBe('0123456789abcdef0123456789abcdef')
  })
})
