// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { ToggleGroup, ToggleGroupItem } from './toggle-group'

/**
 * ToggleGroup (2026-10-08): chip toggles answering one question — a named role="group" of aria-pressed buttons.
 * Single choice CLEARS on a second tap (a degree, a start month — what a radio cannot do); `multiple` adds and removes.
 */
afterEach(cleanup)
const [BACHELOR, MASTER, KIDS, TEENS, ADULTS] = ['Bachelor’s', 'Master’s', 'Kids', 'Teens', 'Adults']

function Single({ onValueChange }: { onValueChange: (v: string[]) => void }) {
  const [v, setV] = React.useState<string[]>(['bachelor'])
  return (
    <ToggleGroup value={v} onValueChange={(n) => { onValueChange(n); setV(n) }} aria-label="Highest degree">
      <ToggleGroupItem value="bachelor">{BACHELOR}</ToggleGroupItem>
      <ToggleGroupItem value="master">{MASTER}</ToggleGroupItem>
    </ToggleGroup>
  )
}

describe('ToggleGroup', () => {
  it('is a NAMED group of pressed buttons', () => {
    render(<Single onValueChange={() => {}} />)
    expect(screen.getByRole('group', { name: 'Highest degree' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bachelor’s' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Master’s' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('single: another chip replaces the choice, and a second tap on the pressed one CLEARS it', () => {
    const onValueChange = vi.fn()
    render(<Single onValueChange={onValueChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Master’s' }))
    expect(onValueChange).toHaveBeenLastCalledWith(['master'])
    fireEvent.click(screen.getByRole('button', { name: 'Master’s' }))
    expect(onValueChange).toHaveBeenLastCalledWith([])
    expect(screen.getByRole('button', { name: 'Master’s' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('multiple: adds and removes; a disabled chip cannot be pressed', () => {
    const onValueChange = vi.fn()
    render(
      <ToggleGroup multiple value={['kids']} onValueChange={onValueChange} aria-label="Who do you teach?">
        <ToggleGroupItem value="kids">{KIDS}</ToggleGroupItem>
        <ToggleGroupItem value="teens">{TEENS}</ToggleGroupItem>
        <ToggleGroupItem value="adults" disabled>{ADULTS}</ToggleGroupItem>
      </ToggleGroup>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Teens' }))
    expect(onValueChange).toHaveBeenLastCalledWith(['kids', 'teens'])
    fireEvent.click(screen.getByRole('button', { name: 'Adults' }))
    expect(onValueChange).toHaveBeenCalledTimes(1)
  })

  it('wears the chip toggle look and a 44px hit area', () => {
    render(<Single onValueChange={() => {}} />)
    const cls = (screen.getByRole('button', { name: 'Bachelor’s' }).getAttribute('class') ?? '').split(/\s+/)
    expect(cls).toEqual(expect.arrayContaining(['rounded-full', 'min-h-9', 'relative', 'tap-44', 'data-pressed:bg-accent']))
  })
})
