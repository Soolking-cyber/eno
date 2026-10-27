// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** The page's global hosts never mount inside the concierge's window (its frame is a page of this app — review, opus). */
const nav = vi.hoisted(() => ({ pathname: '/' }))
const HOST = 'host'
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

import { OutsideConciergeFrame } from './outside-frame'

afterEach(() => { nav.pathname = '/' })

describe('OutsideConciergeFrame', () => {
  it('renders its hosts on every page but the frame', () => {
    for (const path of ['/', '/vi', '/listings/x', '/messages', '/classroom', '/concierge-tips']) {
      nav.pathname = path
      const { unmount } = render(<OutsideConciergeFrame><span>{HOST}</span></OutsideConciergeFrame>)
      expect(screen.getByText(HOST), path).toBeTruthy()
      unmount()
    }
  })
  it('renders nothing in the frame (/concierge, as the browser shows it or under its language)', () => {
    for (const path of ['/concierge', '/en/concierge', '/vi/concierge']) {
      nav.pathname = path
      const { container, unmount } = render(<OutsideConciergeFrame><span>{HOST}</span></OutsideConciergeFrame>)
      expect(container.textContent, path).toBe('')
      unmount()
    }
  })
})
