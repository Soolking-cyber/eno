'use client'

import { Suspense, useReducer, type ComponentType } from 'react'
import { Button } from '@/components/ui/button'
import { retryingLazy } from '@/components/ui/picker-sheet-kit'
import { cn } from '@/lib/utils'
import { SEARCHABLE_FROM, TriggerGlyph, triggerClassName } from './custom-select-trigger'
import type { CustomSelectProps } from './custom-select'

/** The picker's closed face, for the moments its code is not here. Inert: `onPress` only when the code failed to arrive. */
export function StandInSelect({ id, value, options, label, placeholder, className, activeClassName, icon, wrapperClassName, labelClassName, triggerLabel, indicator, searchable, onPress }: CustomSelectProps & { onPress?: () => void }) {
  const selected = options.find((o) => o.value === value)
  return (
    <div className={cn('relative', wrapperClassName ?? 'w-full')}>
      <Button
        type="button"
        variant="bare"
        size="none"
        id={id}
        role="combobox"
        aria-label={label}
        aria-expanded={false}
        aria-haspopup={(searchable ?? options.length >= SEARCHABLE_FROM) ? 'dialog' : 'listbox'}
        className={triggerClassName(false, value, activeClassName, className)}
        onClick={onPress}
      >
        <span className="flex items-center gap-1.5 truncate">
          {icon}
          <span className={cn('truncate', labelClassName)}>{triggerLabel ?? (selected ? selected.label : placeholder)}</span>
        </span>
        <TriggerGlyph indicator={indicator} open={false} />
      </Button>
    </div>
  )
}

type Props = CustomSelectProps & { retry?: () => void }
// The code failed to arrive: a press asks again. Never a reload, which would lose a half-written form, or the whole page when offline.
const LazySelect = retryingLazy<Props>(
  () => import('./custom-select').then((m) => m.CustomSelect as ComponentType<Props>),
  ({ retry, ...props }) => <StandInSelect {...props} onPress={retry} />,
)

/**
 * ⛔ CUSTOMSELECT, OFF THE PATH TO HYDRATION (speed audit, 2026-11-02). The footer's language and currency pickers are on every page and the category page's
 * sort on most, which put Base UI's Select, Combobox and much of floating-ui in front of hydration for controls few people open. On a mid phone hydration
 * waits on the network, at about 5 ms per KB.
 *
 * ⚠️ WHY React.lazy AND NOT A LOOK-ALIKE THAT SWAPS ITSELF OUT: the server still renders the REAL picker, and React hydrates this one boundary when its code
 * arrives while the rest of the page goes on without it. Same DOM node, so focus, keyboard and ARIA are the real ones. A look-alike needed its own hand-over
 * (a tap waiting for the chunk, cancelling it, moving focus) and each review round found another case in it: the wrong mechanism, so it was replaced.
 * ⚠️ A TAP BEFORE THE CODE ARRIVES IS LOST, like any tap before hydration. The code starts loading as hydration reaches this boundary.
 * ⚠️ StandInSelect SHOWS ONLY when this mounts on the client before the code has landed, or React gave up hydrating here because a parent changed first.
 */
export function DeferredSelect(props: CustomSelectProps) {
  const [, again] = useReducer((n: number) => n + 1, 0)
  return (
    <Suspense fallback={<StandInSelect {...props} />}>
      <LazySelect {...props} retry={() => { LazySelect.retry(); again() }} />
    </Suspense>
  )
}
