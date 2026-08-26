import { describe, it, expect } from 'vitest'
import { coarseUserAgent, hasAnyStat, COARSE_UA_FAMILIES, COARSE_UA_PLATFORMS } from './site-stats-shared'

/**
 * The footer prints an all-time visit count as a trust signal, and half the visitor identity is a
 * header the caller chooses. These tests pin the two properties that keep that honest: the same
 * person stays the same visitor across a browser update, and a stranger cannot mint new ones.
 */

const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7331.2 Mobile Safari/537.36'
const CHROME_ANDROID_PATCHED = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7999.14 Mobile Safari/537.36'
const CHROME_ANDROID_MAJOR = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.1.1 Mobile Safari/537.36'
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7331.2 Mobile/15E148 Safari/604.1'
const EDGE_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68'
const FIREFOX_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0'
const SAFARI_IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1'

/**
 * ⛔ THE TEST THAT MATTERS, AND THE ONE I GOT WRONG FIRST. The earlier version fed 500 forged
 * agents in and asserted the result was "at most 500 distinct" — which is true of any function at
 * all, so it passed while the identity was in fact unbounded (the version digits were part of it).
 * A bound has to be an absolute number the implementation cannot exceed, and it has to be checked
 * against inputs chosen to break it. This enumerates the entire declared output space and then
 * tries hard to escape it.
 */
describe('the visitor identity is bounded — a stranger cannot mint visitors', () => {
  const SPACE = COARSE_UA_FAMILIES.length * COARSE_UA_PLATFORMS.length

  it('cannot produce more shapes than families x platforms, however hard it is pushed', () => {
    const adversarial: string[] = []
    // Version sweeping — the dial that used to work.
    for (let i = 0; i < 3000; i++) adversarial.push(`Mozilla/5.0 Chrome/${i}.0.0.0 Safari/537.36`)
    for (let i = 0; i < 500; i++) adversarial.push(`Mozilla/5.0 (iPhone) Version/${i}.0 Mobile/15E148 Safari/604.1`)
    // Padding, junk, unicode, absurd length.
    for (let i = 0; i < 500; i++) adversarial.push(`x${'y'.repeat(i)}z`)
    for (let i = 0; i < 200; i++) adversarial.push(`Chrome/140.0.0.0 ${'💥'.repeat(i % 7)} Safari/537.36`)
    // Every real shape too, so the bound is measured against a full mix.
    adversarial.push(CHROME_ANDROID, SAFARI_IPHONE, CHROME_IOS, EDGE_WINDOWS, FIREFOX_MAC, SAFARI_IPAD)

    const shapes = new Set(adversarial.map(coarseUserAgent))
    expect(shapes.size).toBeLessThanOrEqual(SPACE)
    // And every shape really is one of the declared values — no surprise third component.
    for (const shape of shapes) {
      const [family, platform] = shape.split('|')
      expect(COARSE_UA_FAMILIES, shape).toContain(family)
      expect(COARSE_UA_PLATFORMS, shape).toContain(platform)
    }
  })

  it('is small enough that the bound means something', () => {
    // If this ever grows into the thousands the property above stops being a defence.
    expect(SPACE).toBeLessThanOrEqual(64)
  })

  it('collapses arbitrary junk to one bucket', () => {
    const forged = ['a', 'b', 'zzzzzzzzzz', '<script>x</script>', '', '💥', 'x'.repeat(4000)]
    expect(new Set(forged.map(coarseUserAgent))).toEqual(new Set(['other|other']))
  })
})

describe('the same person stays one visitor', () => {
  it('survives a browser patch update', () => {
    expect(coarseUserAgent(CHROME_ANDROID)).toBe(coarseUserAgent(CHROME_ANDROID_PATCHED))
  })

  /** ⚠️ Deliberate, and the opposite of the first implementation: a MAJOR upgrade must not make a
   *  returning reader a new visitor either. Versions are not part of the identity at all. */
  it('survives a major version upgrade too', () => {
    expect(coarseUserAgent(CHROME_ANDROID)).toBe(coarseUserAgent(CHROME_ANDROID_MAJOR))
  })
})

describe('the families that actually matter here', () => {
  /** ⚠️ ORDER IS THE WHOLE IMPLEMENTATION. Every Chromium UA also says "Safari", Edge and Opera
   *  also say "Chrome", and Chrome on iOS says both. Each of these fails if the list is reordered. */
  it.each([
    ['chrome on android', CHROME_ANDROID, 'chrome|android'],
    ['safari on iphone', SAFARI_IPHONE, 'safari|ios'],
    ['chrome on ios (CriOS, still says Safari)', CHROME_IOS, 'chrome|ios'],
    ['edge on windows (also says Chrome)', EDGE_WINDOWS, 'edge|windows'],
    ['firefox on mac', FIREFOX_MAC, 'firefox|mac'],
    ['safari on ipad is not ios', SAFARI_IPAD, 'safari|ipados'],
  ])('%s', (_label, ua, expected) => {
    expect(coarseUserAgent(ua)).toBe(expected)
  })

  it('tells the real browsers apart from each other', () => {
    const all = [CHROME_ANDROID, SAFARI_IPHONE, CHROME_IOS, EDGE_WINDOWS, FIREFOX_MAC, SAFARI_IPAD]
    expect(new Set(all.map(coarseUserAgent)).size).toBe(all.length)
  })
})

it('never returns something that could collide with the digest separator', () => {
  // The digest joins salt + ip + this with spaces; a shape containing a space would let two
  // different (ip, ua) pairs produce the same input string.
  for (const ua of [CHROME_ANDROID, SAFARI_IPHONE, 'nonsense', '', 'a b c']) {
    expect(coarseUserAgent(ua)).not.toContain(' ')
  }
})

describe('an all-zero reply is "no answer", not "nobody"', () => {
  const LIVE = { visits: 1200, now: 3, members: 9, sellers: 3 }

  it('rejects the shape the route sends when throttled or unhappy', () => {
    expect(hasAnyStat({ visits: 0, now: 0, members: 0, sellers: 0 })).toBe(false)
  })

  it('rejects nothing at all', () => {
    expect(hasAnyStat(null)).toBe(false)
    expect(hasAnyStat(undefined)).toBe(false)
  })

  it('accepts a reply with any single number in it', () => {
    expect(hasAnyStat(LIVE)).toBe(true)
    for (const k of ['visits', 'now', 'members', 'sellers'] as const) {
      const onlyOne = { visits: 0, now: 0, members: 0, sellers: 0, [k]: 1 }
      expect(hasAnyStat(onlyOne), k).toBe(true)
    }
  })

  /** A quiet moment is legitimate: nobody is on the site right now, but the other three stand. */
  it('accepts a real reply whose live count is zero', () => {
    expect(hasAnyStat({ ...LIVE, now: 0 })).toBe(true)
  })
})
