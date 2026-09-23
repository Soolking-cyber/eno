// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

/**
 * WHICH THUMB A CHANGE MOVED — RangeSlider's second `onChange` argument.
 *
 * Base UI reports it as `details.activeThumbIndex`, and `-1` is its own "no thumb" value
 * (SliderRoot's `setValue` fills it in when called without details). Base UI 1.6 never emits a
 * range-slider change that way — the keyboard path names the focused thumb and the pointer path
 * returns early without one — so a real slider cannot produce it, and this test drives the Root's
 * `onValueChange` directly through a stand-in primitive. What it pins: a caller reading
 * `activeThumb === 0 ? low : high` (the price panel does) must never receive `-1`, which it would
 * route into the HIGH bound even when the LOW value is what moved.
 */

type RootProps = {
  value: readonly number[]
  onValueChange: (v: number[], details: { activeThumbIndex: number }) => void
  children?: React.ReactNode
}
const h = vi.hoisted(() => ({ root: null as RootProps | null }))

vi.mock('@base-ui/react/slider', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => children ?? null
  return {
    Slider: {
      Root: (props: RootProps) => {
        h.root = props
        return props.children ?? null
      },
      Control: Pass,
      Track: Pass,
      Indicator: () => null,
      Thumb: () => null,
    },
  }
})

import { RangeSlider } from './range-slider'

afterEach(cleanup)

function mount() {
  const onChange = vi.fn()
  render(<RangeSlider value={[2, 8]} min={0} max={10} onChange={onChange} />)
  if (!h.root) throw new Error('Root did not render')
  return { onChange, root: h.root }
}

describe('RangeSlider — the thumb a change moved', () => {
  it("passes Base UI's named thumb straight through", () => {
    const { onChange, root } = mount()
    root.onValueChange([2, 7], { activeThumbIndex: 1 })
    expect(onChange).toHaveBeenLastCalledWith([2, 7], 1)
    root.onValueChange([3, 8], { activeThumbIndex: 0 })
    expect(onChange).toHaveBeenLastCalledWith([3, 8], 0)
  })

  it('an unnamed change (-1) goes to the value that actually moved — never blindly to the high thumb', () => {
    const { onChange, root } = mount()
    root.onValueChange([3, 8], { activeThumbIndex: -1 })
    expect(onChange).toHaveBeenLastCalledWith([3, 8], 0)
    root.onValueChange([2, 6], { activeThumbIndex: -1 })
    expect(onChange).toHaveBeenLastCalledWith([2, 6], 1)
  })
})
