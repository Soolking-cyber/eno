// @vitest-environment jsdom
/**
 * THE INTRO VIDEO AS A POSTER WITH ONE PLAY BUTTON (owner-approved 2026-11-15, build 7 — cook r07 teachers): no native controls
 * and nothing playing until the tap; the tap is a real button that turns the controls on, plays the same <video> and hands it
 * the focus; the length plate comes from the video's own metadata after mount, so the server HTML and the first client render
 * are the same.
 */
import React from 'react'
import { renderToString } from 'react-dom/server'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reader = vi.hoisted(() => ({ lang: 'en' as 'en' | 'vi' }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: reader.lang, tr: (en: string, viText?: string) => (reader.lang === 'vi' && viText ? viText : en) }),
}))

const { TeacherIntroVideo, videoClock } = await import('./teacher-intro-video')

const play = vi.fn(() => Promise.resolve())
beforeEach(() => { Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play }) })
afterEach(() => { cleanup(); play.mockClear(); reader.lang = 'en' })

/** A video element's metadata, as the browser would report it. */
function metadata(v: HTMLVideoElement, duration: number, readyState = 1) {
  Object.defineProperty(v, 'duration', { configurable: true, get: () => duration })
  Object.defineProperty(v, 'readyState', { configurable: true, get: () => readyState })
}

describe('videoClock', () => {
  it('m:ss, whole seconds; nothing for an unknown, live or empty length', () => {
    expect(videoClock(59.4)).toBe('0:59')
    expect(videoClock(61)).toBe('1:01')
    expect(videoClock(725)).toBe('12:05')
    for (const d of [NaN, Infinity, 0, -3]) expect(videoClock(d)).toBeNull()
  })
})

describe('TeacherIntroVideo', () => {
  it('⛔ the server HTML: NATIVE controls (a reader with no JavaScript, or tapping during hydration, can play it), no autoplay, no overlay yet', () => {
    const el = document.createElement('div')
    el.innerHTML = renderToString(<TeacherIntroVideo src="https://x/v.mp4" />)
    const video = el.querySelector('video')!
    expect(video.getAttribute('src')).toBe('https://x/v.mp4#t=0.001') // iOS paints the opening frame
    expect(video.hasAttribute('controls')).toBe(true)
    expect(video.hasAttribute('autoplay')).toBe(false)
    expect(video.getAttribute('preload')).toBe('metadata')
    expect(video.hasAttribute('playsinline')).toBe(true)
    expect(el.querySelector('button')).toBeNull()
    expect(el.querySelector('[data-teacher-video-length]')).toBeNull()
  })

  it('in Vietnamese the button is "Phát video" (the gallery\'s own curated pair)', () => {
    reader.lang = 'vi'
    const { container } = render(<TeacherIntroVideo src="https://x/v.mp4" />)
    expect(container.querySelector('button')!.getAttribute('aria-label')).toBe('Phát video')
  })

  it('the length plate arrives with the metadata — on the event, and when it loaded before hydration', () => {
    const { container } = render(<TeacherIntroVideo src="https://x/v.mp4" />)
    const v = container.querySelector('video')!
    metadata(v, 59.2)
    act(() => { v.dispatchEvent(new Event('loadedmetadata')) })
    const plate = container.querySelector('[data-teacher-video-length]')!
    expect(plate.textContent).toBe('0:59')
    expect(plate.getAttribute('aria-hidden')).toBe('true')
    expect(plate.getAttribute('class')).toMatch(/\bphoto-badge\b.*\bbottom-3\b.*\bleft-3\b/)
  })

  it('metadata that loaded BEFORE hydration (no event left to hear) is read on mount', () => {
    const proto = HTMLMediaElement.prototype
    const saved = { readyState: Object.getOwnPropertyDescriptor(proto, 'readyState'), duration: Object.getOwnPropertyDescriptor(proto, 'duration') }
    Object.defineProperty(proto, 'readyState', { configurable: true, get: () => 1 })
    Object.defineProperty(proto, 'duration', { configurable: true, get: () => 125 })
    try {
      const { container } = render(<TeacherIntroVideo src="https://x/v.mp4" />)
      expect(container.querySelector('[data-teacher-video-length]')!.textContent).toBe('2:05')
    } finally {
      for (const [k, d] of Object.entries(saved)) {
        if (d) Object.defineProperty(proto, k, d)
        else Reflect.deleteProperty(proto, k)
      }
    }
  })

  it('a tap turns the native controls on, plays the SAME video once, hands it the focus, and the button goes', () => {
    const { container } = render(<TeacherIntroVideo src="https://x/v.mp4" />)
    const v = container.querySelector('video')!
    const focus = vi.spyOn(v, 'focus')
    fireEvent.click(container.querySelector('button')!)
    expect(play).toHaveBeenCalledTimes(1)
    expect(v.controls).toBe(true)
    expect(focus).toHaveBeenCalled()
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelectorAll('video')).toHaveLength(1)
  })

  it('a refused play (no gesture credit, a format the phone cannot play) never throws out of the tap', async () => {
    play.mockImplementationOnce(() => Promise.reject(new Error('NotAllowedError')))
    const { container } = render(<TeacherIntroVideo src="https://x/v.mp4" />)
    expect(() => fireEvent.click(container.querySelector('button')!)).not.toThrow()
    await Promise.resolve()
    expect(container.querySelector('video')!.controls).toBe(true)
  })
})
