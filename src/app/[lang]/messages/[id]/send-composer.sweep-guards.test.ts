import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Two send-path fixes from the 2026-10-22 sweep, pinned at the source (page.tsx is a landmine file; its harnesses do not
 * drive a failed send followed by a retry with a fresh draft in the composer):
 * - only a send FROM the composer empties it — a retry ("Not sent — tap to retry") or a send-on-tap chip carries its own
 *   body, and emptying the composer for them wiped whatever had been typed since;
 * - a text over the send route's 2,000 characters is refused BEFORE the composer is emptied, with the count — the route
 *   cut it silently and the sender's bubble became the shortened copy.
 */
const page = readFileSync('src/app/[lang]/messages/[id]/page.tsx', 'utf8')
const route = readFileSync('src/app/api/conversations/[id]/messages/route.ts', 'utf8')
const send = page.slice(page.indexOf('const send = async (override?: string'), page.indexOf('haptic()', page.indexOf('const send = async (override?: string')))

describe('chat send path — sweep guards', () => {
  it('the composer is emptied only when the body came from it (override undefined)', () => {
    expect(send).toMatch(/if \(override === undefined\) \{\s*setText\(''\)\s*composerRef\.current\?\.clear\(\)/)
    expect(send.match(/setText\(''\)/g)).toHaveLength(1)
  })

  it('over-long text is refused before the composer is touched, at the route\'s own cap', () => {
    const refuse = send.indexOf('if (body.length > MESSAGE_MAX_CHARS)')
    expect(refuse).toBeGreaterThan(-1)
    expect(refuse).toBeLessThan(send.indexOf("setText('')"))
    expect(page).toContain('const MESSAGE_MAX_CHARS = 2000')
    expect(route).toContain('const MAX_LEN = 2000')
  })
})
