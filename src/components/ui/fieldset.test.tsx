// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { Fieldset } from './fieldset'
import { Radio, RadioGroup } from './radio-group'
import { ToggleGroup, ToggleGroupItem } from './toggle-group'

/**
 * Fieldset (2026-10-08): a question answered by a group of controls. Its contract is what the error reveal and a
 * screen reader find: a visible legend naming the group, the hint and the error joined to aria-describedby, the error
 * spoken (role="alert"), and `data-invalid` on the group — the marker a form's reveal scrolls to (ARIA 1.2 allows no
 * aria-invalid on a group).
 */
afterEach(cleanup)
const [CHILD, NATIVE, KIDS] = ['x', 'Native', 'Kids']

describe('Fieldset', () => {
  it('is a group NAMED by its visible legend', () => {
    render(<Fieldset legend="Where are you now?"><span>{CHILD}</span></Fieldset>)
    expect(screen.getByRole('group', { name: 'Where are you now?' })).toBeTruthy()
  })

  it('with an error: data-invalid for the reveal, the error spoken and joined to the group with the hint', () => {
    render(<Fieldset legend="What do you teach?" hint="Pick every subject." error="Please pick at least one subject."><span>{CHILD}</span></Fieldset>)
    const group = screen.getByRole('group', { name: 'What do you teach?' })
    expect(group.hasAttribute('data-invalid')).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('Please pick at least one subject.')
    const described = (group.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent)
    expect(described).toEqual(['Pick every subject.', 'Please pick at least one subject.'])
  })

  it('without one: no marker and no alert', () => {
    render(<Fieldset legend="Who do you teach?" hint="Kids, teens or adults."><span>{CHILD}</span></Fieldset>)
    expect(screen.getByRole('group', { name: 'Who do you teach?' }).hasAttribute('data-invalid')).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a radio group inside takes the legend as its name; a toggle group is named by the legend id', () => {
    render(
      <>
        <Fieldset legend="Your English">
          <RadioGroup value="" onValueChange={() => {}}><Radio value="native">{NATIVE}</Radio></RadioGroup>
        </Fieldset>
        <Fieldset legend="Who do you teach?" legendId="ages">
          <ToggleGroup multiple value={[]} onValueChange={() => {}} aria-labelledby="ages"><ToggleGroupItem value="kids">{KIDS}</ToggleGroupItem></ToggleGroup>
        </Fieldset>
      </>,
    )
    expect(screen.getByRole('radiogroup', { name: 'Your English' })).toBeTruthy()
    expect(screen.getAllByRole('group', { name: 'Who do you teach?' }).length).toBe(2) // the fieldset and its toggle group
  })
})
