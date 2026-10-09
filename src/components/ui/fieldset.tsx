'use client'

import { useId } from 'react'
import { Fieldset as BaseFieldset } from '@base-ui/react/fieldset'
import { cn } from '@/lib/utils'

/**
 * A QUESTION ANSWERED BY A GROUP OF CONTROLS — Base UI's Fieldset: a real `<fieldset>` named by its legend
 * (`aria-labelledby`). For chips, radios or switches that answer one question together, where ui/field (one label →
 * one control) does not fit. It owns three things:
 *   · `legend` — the question, VISIBLE. A placeholder or an aria-label alone is not a name a sighted person can read.
 *   · `hint` — persistent help, joined to the group's `aria-describedby`.
 *   · `error` — the refusal: `role="alert"` (spoken the moment it appears), joined to `aria-describedby`, and the
 *     group itself carries `data-invalid` — the marker a form's error reveal looks for to scroll to and focus into
 *     (teacher-form revealFirstError). `aria-invalid` is NOT allowed on a group (ARIA 1.2), which is why the marker
 *     is a data attribute.
 * ⚠️ A ui/radio-group INSIDE TAKES THE LEGEND AS ITS NAME (Base UI's RadioGroup reads the fieldset's legend id), so
 * give it no aria-label of its own. A ui/toggle-group does NOT (Base UI's ToggleGroup has no fieldset hook): pass it
 * `aria-labelledby={legendId}` — `legendId` is the Legend's id, so a caller can name its own group by it.
 */
export function Fieldset({
  legend,
  legendId,
  hint,
  error,
  legendClassName,
  className,
  children,
  ...props
}: {
  legend: React.ReactNode
  /** The legend's id — for a toggle group inside to name itself by (`aria-labelledby`). Generated when omitted. */
  legendId?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  legendClassName?: string
  className?: string
  children?: React.ReactNode
} & Omit<BaseFieldset.Root.Props, 'className' | 'children'>) {
  const uid = useId()
  const describedBy = [hint ? `${uid}-hint` : null, error ? `${uid}-error` : null].filter(Boolean).join(' ') || undefined
  return (
    <BaseFieldset.Root
      data-invalid={error ? '' : undefined}
      aria-describedby={describedBy}
      // min-w-0: a <fieldset> defaults to `min-inline-size: min-content`, which lets a row of chips push the page wider
      // than a 375px phone instead of wrapping.
      className={cn('min-w-0 space-y-3', className)}
      {...props}
    >
      <BaseFieldset.Legend id={legendId} className={cn('text-sm font-semibold text-foreground', legendClassName)}>
        {legend}
      </BaseFieldset.Legend>
      {hint ? <p id={`${uid}-hint`} className="-mt-2 text-sm text-muted-foreground">{hint}</p> : null}
      {children}
      {error ? <p id={`${uid}-error`} role="alert" className="text-sm text-destructive">{error}</p> : null}
    </BaseFieldset.Root>
  )
}
