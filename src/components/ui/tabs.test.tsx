// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { Tabs, TabsList, TabsTrigger } from './tabs'

/**
 * A tab presses (the base transitions `scale`), and a tab CHANGE never animates (no colour/underline
 * transition — Base UI changes tabs on arrow keys). A caller's `transition-colors` used to replace
 * the base list through tailwind-merge, which both deleted the press tween and brought the keyboard
 * fade back; it is dropped now. jsdom sees classes, not frames — the press was measured on the preview.
 */
afterEach(cleanup)
const classes = (el: HTMLElement) => el.className.split(/\s+/)
// Fixture labels as consts: `react/jsx-no-literals` lints tests too.
const [NEWEST, PRICE] = ['Newest', 'Price']

describe('TabsTrigger', () => {
  it('transitions only the press, and a caller transition-colors cannot replace it', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">{NEWEST}</TabsTrigger>
          <TabsTrigger value="b" className="transition-colors duration-100 active:scale-[0.97]">{PRICE}</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    for (const name of [NEWEST, PRICE]) {
      const tab = screen.getByRole('tab', { name })
      expect(classes(tab)).toContain('transition-[scale]')
      expect(classes(tab)).not.toContain('transition-all')
      expect(classes(tab)).not.toContain('transition-colors')
      expect(classes(tab)).not.toContain('after:transition-opacity')
      expect(classes(tab)).toContain('active:scale-[0.97]')
    }
    // The caller's own duration still wins over the base.
    expect(classes(screen.getByRole('tab', { name: PRICE }))).toContain('duration-100')
  })
})
