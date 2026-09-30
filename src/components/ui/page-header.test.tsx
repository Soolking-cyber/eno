// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { PageHeader } from './page-header'

/** D-PAGEHEADER (2026-09-29): the page title is ON the heading ramp, whatever screen it is on. */
afterEach(cleanup)
const cls = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)
const [TITLE, META, ACTION] = ['Saved', '3 saved listings', 'Edit']

describe('PageHeader', () => {
  it('renders an h1 on the title ramp by default, with its meta line', () => {
    render(<PageHeader title={TITLE} meta={META} />)
    const h = screen.getByRole('heading', { level: 1, name: TITLE })
    expect(cls(h)).toEqual(expect.arrayContaining(['h-title', 'text-balance', 'text-foreground']))
    expect(screen.getByText(META).tagName).toBe('P')
  })

  it('level="display" is the hero ramp; as="h2" when the page has its h1 elsewhere', () => {
    render(<PageHeader title={TITLE} level="display" as="h2" />)
    const h = screen.getByRole('heading', { level: 2, name: TITLE })
    expect(cls(h)).toContain('h-display')
    expect(cls(h)).not.toContain('h-title')
  })

  it('titleClassName reaches the heading (max-lg:sr-only keeps it in the outline on a phone) and actions render', () => {
    render(<PageHeader title={TITLE} titleClassName="max-lg:sr-only" actions={<button type="button">{ACTION}</button>} />)
    expect(cls(screen.getByRole('heading', { level: 1 }))).toContain('max-lg:sr-only')
    expect(screen.getByRole('button', { name: ACTION })).toBeTruthy()
  })
})
