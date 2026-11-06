// @vitest-environment jsdom
/**
 * ImageShield blocks the browser's menu on a protected photo ("Save image as…"), and lets a LINK laid over a protected
 * photo keep its own menu (owner, 2026-11-07: right-click "Open link in new tab" on a listing photo did nothing). Over
 * the link the pointer meets the <a>, not the <img>, so that menu has no "Save image" in it. Drag stays blocked
 * everywhere protected.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ImageShield } from './image-shield'

afterEach(() => { cleanup(); document.documentElement.classList.remove('show-watermark') })

function page() {
  return render(
    <>
      <ImageShield />
      <div data-protected>
        <img id="bare" alt="" src="data:," />
        <a id="photo-link" href="/listings/l1" data-photo-link="">
          <span id="zone" />
        </a>
      </div>
      <div data-protected>
        <a id="wrapping-link" href="/listings/l2">
          <img id="img-in-link" alt="" src="data:," />
        </a>
      </div>
      <p id="outside" />
    </>,
  )
}

const fire = (id: string, type: 'contextmenu' | 'dragstart') => {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true })
  document.getElementById(id)!.dispatchEvent(ev)
  return ev.defaultPrevented
}

describe('ImageShield', () => {
  it('blocks the menu on a protected photo and flashes the watermark', () => {
    page()
    expect(fire('bare', 'contextmenu')).toBe(true)
    expect(document.documentElement.classList.contains('show-watermark')).toBe(true)
  })

  it.each(['photo-link', 'zone'])('lets the link over the photo keep its menu (%s): no block, no flash', (id) => {
    page()
    expect(fire(id, 'contextmenu')).toBe(false)
    expect(document.documentElement.classList.contains('show-watermark')).toBe(false)
  })

  it('still blocks the menu on an <img> itself, even inside a link: that menu has "Save image"', () => {
    page()
    expect(fire('img-in-link', 'contextmenu')).toBe(true)
  })

  it('still blocks a drag anywhere protected, the link included', () => {
    page()
    expect(fire('bare', 'dragstart')).toBe(true)
    expect(fire('photo-link', 'dragstart')).toBe(true)
  })

  it('leaves everything outside a protected area alone', () => {
    page()
    expect(fire('outside', 'contextmenu')).toBe(false)
  })
})
