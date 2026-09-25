// @vitest-environment jsdom
/**
 * The back-nav restore, frame by frame (feed-restore.ts). A fake layout stands in for the browser:
 * the tapped card sits at a document offset, the viewport has a scroll offset, and a test can grow
 * the content above the card between frames — which is exactly what the deferred grid commit does
 * after the first jump on a real phone.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CHROME_GAP_PX, PINNED_CHROME_IDS, RESTORE_FIND_FRAMES, RESTORE_LOST_FRAMES, RESTORE_SETTLE_FRAMES, handBackAfterLeaving,
  holdScrollRestoration, pinnedChromeBottom, releaseScrollRestoration, restoreTargetTop, runRestore, type RestoreEnv,
} from './feed-restore'

/** A page: the card's document offset (null = not rendered yet), the scroll offset, the pinned chrome. */
function fakePage(init: { cardAt: number | null; scrollY?: number; chrome?: number; docHeight?: number }) {
  const page = { cardAt: init.cardAt, scrollY: init.scrollY ?? 0, chrome: init.chrome ?? 0, docHeight: init.docHeight ?? 20_000 }
  const frames: (() => void)[] = []
  const env: RestoreEnv = {
    anchorTopOf: () => (page.cardAt == null ? null : page.cardAt - page.scrollY),
    chromeBottom: () => page.chrome,
    scrollBy: (dy) => { page.scrollY += dy },
    scrollTo: (y) => { page.scrollY = y },
    fits: (y) => page.docHeight >= y + 844,
    raf: (cb) => frames.push(cb),
    caf: () => { frames.length = 0 },
  }
  /** Run one animation frame; `before` mutates the layout first (content growing above the card). */
  const frame = (before?: () => void) => {
    before?.()
    const next = frames.splice(0)
    next.forEach((cb) => cb())
    return next.length
  }
  return { page, env, frame, pending: () => frames.length }
}

describe('runRestore — the tapped card comes back under the finger', () => {
  it('keeps aligning after the first jump: content that grows above the card is absorbed (the 294px drift)', () => {
    const { page, env, frame } = fakePage({ cardAt: 7_795, scrollY: 0 })
    const done = vi.fn()
    runRestore({ y: 7_452, anchorId: 'c1', anchorTop: 343 }, env, done)
    expect(page.cardAt! - page.scrollY).toBe(343) // the synchronous first jump

    // The deferred grid commits and a rail mounts ABOVE the card: +294px. The old loop had already
    // stopped here, which is exactly the card landing at top=49 instead of 343 on production.
    frame(() => { page.cardAt! += 294 })
    expect(page.cardAt! - page.scrollY).toBe(343)
    expect(done).not.toHaveBeenCalled()

    frame(); frame() // two consecutive frames agree → done
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('stops only after TWO consecutive agreeing frames, and never runs past the settle cap', () => {
    const { page, env, frame, pending } = fakePage({ cardAt: 1_000 })
    const done = vi.fn()
    runRestore({ y: 700, anchorId: 'c1', anchorTop: 300 }, env, done)
    frame()
    expect(done).not.toHaveBeenCalled() // one agreeing frame is not enough
    frame()
    expect(done).toHaveBeenCalledTimes(1)
    expect(pending()).toBe(0)

    // A layout that never settles (it grows every frame) is abandoned at the cap, not chased forever.
    const unstable = fakePage({ cardAt: 1_000 })
    const done2 = vi.fn()
    runRestore({ y: 700, anchorId: 'c1', anchorTop: 300 }, unstable.env, done2)
    let n = 0
    while (unstable.pending() && n < 200) { unstable.frame(() => { unstable.page.cardAt! += 50 }); n++ }
    expect(done2).toHaveBeenCalledTimes(1)
    expect(n).toBeLessThanOrEqual(RESTORE_SETTLE_FRAMES)
    void page
  })

  it('never restores the card under the pinned header + filter strip', () => {
    // Tapped while the header was hidden (card top 49); on return the header and strip are pinned (154px).
    const { page, env, frame } = fakePage({ cardAt: 5_049, scrollY: 0, chrome: 154 })
    runRestore({ y: 5_000, anchorId: 'c1', anchorTop: 49 }, env, () => {})
    frame(); frame()
    expect(page.cardAt! - page.scrollY).toBe(154 + CHROME_GAP_PX)
    // …and a card that was already clear of the chrome keeps its exact place.
    expect(restoreTargetTop(343, 154)).toBe(343)
    expect(restoreTargetTop(49, 0)).toBe(49)
  })

  it('waits for the target to hold still: the header sliding away mid-restore moves the card with it', () => {
    const { page, env, frame } = fakePage({ cardAt: 5_049, scrollY: 0, chrome: 154 })
    const done = vi.fn()
    runRestore({ y: 5_000, anchorId: 'c1', anchorTop: 49 }, env, done)
    frame(() => { page.chrome = 90 })  // the header slides up; the strip's sticky top follows it
    frame(() => { page.chrome = 0 })   // both gone
    frame(); frame()
    expect(done).toHaveBeenCalledTimes(1)
    expect(page.cardAt! - page.scrollY).toBe(49) // back exactly where it was tapped
  })

  it('stop() (a finger, a wheel, a key, unmount) ends it at once and reports done exactly once', () => {
    const { page, env, frame, pending } = fakePage({ cardAt: null })
    const done = vi.fn()
    const stop = runRestore({ y: 5_000, anchorId: 'c1', anchorTop: 300 }, env, done)
    frame()
    stop()
    stop()
    expect(done).toHaveBeenCalledTimes(1)
    expect(pending()).toBe(0)
    page.cardAt = 6_000
    frame()
    expect(page.scrollY).toBe(0) // nothing moved after the reader took over
  })

  it('a card that goes away after it was aligned ends the restore in place — no late jump to the raw offset', () => {
    const { page, env, frame, pending } = fakePage({ cardAt: 5_300, docHeight: 20_000 })
    const done = vi.fn()
    runRestore({ y: 9_999, anchorId: 'c1', anchorTop: 300 }, env, done)
    expect(page.scrollY).toBe(5_000)
    page.cardAt = null // a refetch reshuffles the tapped card out of the rows…
    for (let i = 0; i <= RESTORE_LOST_FRAMES; i++) frame()
    expect(done).toHaveBeenCalledTimes(1)
    expect(pending()).toBe(0)
    expect(page.scrollY).toBe(5_000) // not 9,999
  })

  it('…but a card missing for a frame or two (a re-render) is waited for, and aligned again', () => {
    const { page, env, frame } = fakePage({ cardAt: 5_300 })
    const done = vi.fn()
    runRestore({ y: 9_999, anchorId: 'c1', anchorTop: 300 }, env, done)
    frame(() => { page.cardAt = null })
    frame(() => { page.cardAt = 5_380 }) // back, 80px lower: the grid above it changed
    expect(done).not.toHaveBeenCalled()
    frame(); frame()
    expect(done).toHaveBeenCalledTimes(1)
    expect(page.cardAt! - page.scrollY).toBe(300)
  })

  it('a card tapped half under the chrome (top above the bars) comes back fully below them', () => {
    const { page, env, frame } = fakePage({ cardAt: 4_880, chrome: 154 })
    runRestore({ y: 5_000, anchorId: 'c1', anchorTop: -120 }, env, () => {})
    frame(); frame()
    expect(page.cardAt! - page.scrollY).toBe(154 + CHROME_GAP_PX)
  })

  it('falls back to the raw offset only when the page can hold it — never a clamp to the footer', () => {
    const tall = fakePage({ cardAt: null, docHeight: 20_000 })
    runRestore({ y: 7_452, anchorId: 'gone', anchorTop: 300 }, tall.env, () => {})
    for (let i = 0; i <= RESTORE_FIND_FRAMES; i++) tall.frame()
    expect(tall.page.scrollY).toBe(7_452)

    const short = fakePage({ cardAt: null, docHeight: 3_000 })
    runRestore({ y: 7_452, anchorId: 'gone', anchorTop: 300 }, short.env, () => {})
    for (let i = 0; i <= RESTORE_FIND_FRAMES; i++) short.frame()
    expect(short.page.scrollY).toBe(0)
  })
})

describe('pinnedChromeBottom', () => {
  afterEach(() => { document.body.innerHTML = '' })
  it('reads bars that exist: both ids are still on the real header and filter strip', () => {
    const src = (f: string) => readFileSync(join(__dirname, f), 'utf8')
    expect(PINNED_CHROME_IDS).toEqual(['app-header', 'explorer-toolbar'])
    expect(src('header.tsx')).toContain('id="app-header"')
    expect(src('explorer-toolbar.tsx')).toContain('id="explorer-toolbar"')
  })
  function bar(id: string, css: Partial<CSSStyleDeclaration>, rect: { top: number; height: number }) {
    const el = document.createElement('div')
    el.id = id
    Object.assign(el.style, css)
    el.getBoundingClientRect = () => ({ top: rect.top, bottom: rect.top + rect.height, height: rect.height, left: 0, right: 390, width: 390, x: 0, y: rect.top, toJSON: () => ({}) })
    document.body.appendChild(el)
  }
  it('counts a bar sitting at its sticky offset, and ignores one in the flow or slid away', () => {
    bar('app-header', { position: 'sticky', top: '0px' }, { top: 0, height: 64 })
    bar('explorer-toolbar', { position: 'sticky', top: '64px' }, { top: 64, height: 90 })
    expect(pinnedChromeBottom()).toBe(154)
    document.body.innerHTML = ''
    // Near the top of the feed the strip is an ordinary row further down the page: not covering anything.
    bar('app-header', { position: 'sticky', top: '0px' }, { top: 0, height: 64 })
    bar('explorer-toolbar', { position: 'sticky', top: '64px' }, { top: 480, height: 90 })
    expect(pinnedChromeBottom()).toBe(64)
    document.body.innerHTML = ''
    // The header hidden (translated up, faded out) and the strip parked above the viewport.
    bar('app-header', { position: 'sticky', top: '0px', opacity: '0' }, { top: -64, height: 64 })
    bar('explorer-toolbar', { position: 'sticky', top: '-144px' }, { top: -144, height: 90 })
    expect(pinnedChromeBottom()).toBe(0)
  })
})

describe('scroll restoration is held off only for the feed entry', () => {
  afterEach(() => { window.history.replaceState({}, '', '/'); (window.history as { scrollRestoration: string }).scrollRestoration = 'auto' })
  it('holds "manual" on the feed, then gives the destination its "auto" back once it is current', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
    holdScrollRestoration('/')
    expect(window.history.scrollRestoration).toBe('manual')
    frames.splice(0).forEach((cb) => cb(0)) // navigation still pending: still held
    expect(window.history.scrollRestoration).toBe('manual')
    window.history.pushState({}, '', '/listings/abc') // pushState copies 'manual' into the new entry…
    frames.splice(0).forEach((cb) => cb(0))
    expect(window.history.scrollRestoration).toBe('auto') // …and the watcher hands it back
    vi.restoreAllMocks()
  })
  it('a navigation slower than the watcher still hands the destination "auto" back when the feed unmounts', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    holdScrollRestoration('/')
    clock.mockReturnValue(20_000) // the watcher gives up: no navigation after 15s
    frames.splice(0).forEach((cb) => cb(0))
    expect(frames).toHaveLength(0)
    window.history.pushState({}, '', '/listings/slow') // …then it commits, inheriting 'manual'
    handBackAfterLeaving() // the feed unmounts in that commit
    frames.splice(0).forEach((cb) => cb(0))
    expect(window.history.scrollRestoration).toBe('auto')
    vi.restoreAllMocks()
  })

  it('release waits for the document to finish loading (a full-document Back)', () => {
    (window.history as { scrollRestoration: string }).scrollRestoration = 'manual'
    const state = vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive')
    releaseScrollRestoration()
    expect(window.history.scrollRestoration).toBe('manual')
    state.mockReturnValue('complete')
    window.dispatchEvent(new Event('load'))
    expect(window.history.scrollRestoration).toBe('auto')
    vi.restoreAllMocks()
  })
  it('a release that waited for load does not undo a NEW hold made in the meantime (the next card tapped)', () => {
    (window.history as { scrollRestoration: string }).scrollRestoration = 'manual'
    const state = vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive')
    let snapshotWaiting = false
    releaseScrollRestoration(window, () => !snapshotWaiting)
    snapshotWaiting = true // the reader tapped the next card before the page finished loading
    state.mockReturnValue('complete')
    window.dispatchEvent(new Event('load'))
    expect(window.history.scrollRestoration).toBe('manual')
    vi.restoreAllMocks()
  })
})
