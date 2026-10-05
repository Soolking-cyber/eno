import { beforeEach, describe, expect, it } from 'vitest'
import { __resetPageAsksForTests, askHidden, askShown, mayAsk, notePageView } from './page-asks'

// ── UX3 J7f: never two asks in one page view — the "Join eno" prompt and the app-install card ──────

beforeEach(() => __resetPageAsksForTests())

describe('page-asks', () => {
  it('either ask may appear on a page nothing else has asked on', () => {
    expect(mayAsk('join', '/')).toBe(true)
    expect(mayAsk('install', '/')).toBe(true)
  })

  it('⛔ while one is on screen the other waits — and still waits in the same page view after it is gone', () => {
    askShown('install', '/')
    expect(mayAsk('join', '/')).toBe(false)
    askHidden('install')
    expect(mayAsk('join', '/')).toBe(false)
    expect(mayAsk('join', '/c/phones')).toBe(true)
  })

  it('an ask still on screen when the route changes has appeared in the new page view too', () => {
    askShown('install', '/')
    notePageView('/rentals')
    askHidden('install')
    expect(mayAsk('join', '/rentals')).toBe(false)
    expect(mayAsk('join', '/c/phones')).toBe(true)
  })

  it('A → B → A is three page views, not one', () => {
    askShown('join', '/')
    askHidden('join')
    expect(mayAsk('install', '/')).toBe(false)
    notePageView('/c/phones')
    notePageView('/')
    expect(mayAsk('install', '/')).toBe(true)
  })

  it('the same ask again is not blocked by itself', () => {
    askShown('join', '/')
    expect(mayAsk('join', '/')).toBe(true)
  })
})
