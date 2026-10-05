import { beforeEach, describe, expect, it } from 'vitest'
import { __resetPageAsksForTests, askHidden, askShown, mayAsk, notePageView } from './page-asks'

// ── UX2 W2 B2-NOTIFY: 'push' is the third ask — the same rule, read for any number of asks ─────────────
// (page-asks.test.ts keeps pinning join × install exactly as UX3 J7f wrote it.)

beforeEach(() => __resetPageAsksForTests())

describe('page-asks with three asks', () => {
  it('push on screen: join and install both wait — and still wait in this view after it is gone', () => {
    askShown('push', '/messages')
    expect(mayAsk('join', '/messages')).toBe(false)
    expect(mayAsk('install', '/messages')).toBe(false)
    askHidden('push')
    expect(mayAsk('install', '/messages')).toBe(false)
    notePageView('/')
    expect(mayAsk('install', '/')).toBe(true)
    expect(mayAsk('join', '/')).toBe(true)
  })

  it('install or join asked in this view: push waits for the next one', () => {
    askShown('install', '/post')
    expect(mayAsk('push', '/post')).toBe(false)
    askHidden('install')
    expect(mayAsk('push', '/post')).toBe(false)
    expect(mayAsk('push', '/messages')).toBe(true)

    __resetPageAsksForTests()
    askShown('join', '/messages')
    expect(mayAsk('push', '/messages')).toBe(false)
  })

  it('a push card still up when the route changes has appeared in the new view too (the inbox list persists across threads)', () => {
    askShown('push', '/messages')
    notePageView('/messages/c1')
    askHidden('push')
    expect(mayAsk('install', '/messages/c1')).toBe(false)
    expect(mayAsk('install', '/messages')).toBe(true)
  })

  it('push is not blocked by itself, and join × install keep their old answers when push never shows', () => {
    askShown('push', '/post')
    expect(mayAsk('push', '/post')).toBe(true)
    __resetPageAsksForTests()
    expect(mayAsk('join', '/')).toBe(true)
    askShown('join', '/')
    expect(mayAsk('install', '/')).toBe(false)
    expect(mayAsk('join', '/')).toBe(true)
  })
})
