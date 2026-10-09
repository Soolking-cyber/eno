// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { StepRail, StepWizard, type WizardStep } from './step-wizard'

/**
 * StepRail `allowForward` and StepWizard `actionNote` (teacher onboarding redesign, 2026-10-08). The defaults must not
 * move: a flow being filled for the first time still jumps BACK only, and a wizard with no note renders as before.
 */
afterEach(cleanup)
const NOTE = 'Publishing shows your profile.'
const STEPS: WizardStep[] = [
  { key: 'a', icon: null, label: 'Your plans' },
  { key: 'b', icon: null, label: 'Where you teach' },
  { key: 'c', icon: null, label: 'Your teaching' },
]

describe('StepRail', () => {
  it('by default only DONE steps are buttons — no skipping ahead', () => {
    const onStepSelect = vi.fn()
    render(<StepRail steps={STEPS} current="b" onStepSelect={onStepSelect} />)
    expect(screen.getByRole('button', { name: 'Your plans' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Your teaching' })).toBeNull()
    expect(screen.getByRole('img', { name: 'Your teaching' })).toBeTruthy()
  })

  it('allowForward (an edit): upcoming steps jump too; the current one never is a button', () => {
    const onStepSelect = vi.fn()
    render(<StepRail steps={STEPS} current="b" onStepSelect={onStepSelect} allowForward />)
    fireEvent.click(screen.getByRole('button', { name: 'Your teaching' }))
    expect(onStepSelect).toHaveBeenCalledWith('c', 2)
    expect(screen.queryByRole('button', { name: 'Where you teach' })).toBeNull()
  })
})

describe('StepWizard actionNote', () => {
  const primary = { label: 'Publish profile', onClick: () => {} }
  it('rides the action bar (and the desktop actions) when given', () => {
    render(<StepWizard steps={STEPS} current="c" primaryAction={primary} actionNote={<p>{NOTE}</p>}><div /></StepWizard>)
    expect(screen.getAllByText('Publishing shows your profile.')).toHaveLength(2) // the phone's bar + the desktop line
  })
  it('omitted, the wizard renders what it did before: the bar’s plain one-row panel and the old desktop row', () => {
    const { container } = render(<StepWizard steps={STEPS} current="c" primaryAction={primary}><div /></StepWizard>)
    const panel = container.querySelector('[data-slot="sticky-action-bar-panel"]')!
    expect(panel.getAttribute('class')).toBe('mx-auto flex w-full max-w-7xl items-center gap-2 px-3 py-3 sm:px-6 lg:px-8')
    const desktop = [...container.querySelectorAll('div')].find((d) => d.className.includes('justify-end'))!
    expect(desktop.getAttribute('class')).toBe('mt-6 hidden items-center justify-end gap-3 lg:flex')
  })
  it('null (empty but may fill — the teacher form’s earlier steps): the stacked panel, nothing in it', () => {
    const { container } = render(<StepWizard steps={STEPS} current="c" primaryAction={primary} actionNote={null}><div /></StepWizard>)
    expect(container.querySelector('[data-slot="sticky-action-bar-panel"]')!.className).toContain('flex-col')
    expect(container.querySelector('.lg\\:block')).toBeNull()
  })
})
