'use client'

// ── STEP WIZARD ─────────────────────────────────────────────────────────────────────────────────
//
// The house pattern for EVERY multi-step flow (owner, 2026-09-02): a top rail showing what is done /
// what is current / what is left, ONE screen of body at a time, and the action pinned to the bottom
// edge — never a long scroll where the user hunts for the next button.
//
//   <StepWizard steps={STEPS} current={step} primaryAction={{ label, onClick, disabled }}>
//     {bodyForCurrentStep}
//   </StepWizard>
//
// It owns three things and no copy of its own:
//   1. <StepRail> — the icon-node rail (done = filled + tick, current = filled + ring, upcoming =
//      muted outline; connectors fill brand up to the current step). Reusable on its own.
//   2. Accessibility the ad-hoc wizards missed: `aria-current="step"` on the live node, and a polite
//      live region + focus move to the step body on every change, so a keyboard / screen-reader user
//      is told the step advanced instead of being stranded on the old (now unmounted) content.
//   3. The bottom action — it composes the shared <StickyActionBar> (safe-area, keyboard and
//      bottom-nav clearance already solved there) plus its required spacer.
//
// ⚠️ COPY-FREE, like the rest of ui/*. Every string it shows comes from the caller: `step.label`
// (already translated) and the action labels. The one thing it composes itself — the SR announcement
// — is the caller's label plus a bare `n/total`, so no untranslated words are baked in here.

import { useEffect, useRef, useId } from 'react'
import { Check } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  StickyActionBar,
  StickyActionBarSpacer,
  type StickyActionBarAction,
} from '@/components/ui/sticky-action-bar'

export interface WizardStep {
  /** Stable identity — React key and the value matched against `current`. */
  key: string
  /** Node glyph, already sized by the caller, e.g. `<Camera className="size-4" />`. Shown until the
   *  step is done, when a tick replaces it. */
  icon: React.ReactNode
  /** Accessible step name ("Passport photo") — the node's label and what the live region announces.
   *  Caller-translated. */
  label: string
}

/** Resolve `current` (a 0-based index OR a step key) to a clamped index. */
function activeIndexOf(steps: WizardStep[], current: number | string): number {
  const raw = typeof current === 'number' ? current : steps.findIndex((s) => s.key === current)
  if (raw < 0) return 0
  if (raw > steps.length - 1) return steps.length - 1
  return raw
}

// ── StepRail ──────────────────────────────────────────────────────────────────────────────────
/**
 * The top progress rail. Purely presentational (plus one optional affordance): pass `onStepSelect`
 * to make ALREADY-COMPLETED nodes tappable so the user can jump back to fix an earlier step. A
 * current or upcoming node is never a button — you cannot skip ahead past work not yet done —
 * unless `allowForward` says every step is already done (an edit), when upcoming nodes jump too.
 */
export function StepRail({
  steps,
  current,
  onStepSelect,
  allowForward = false,
  className,
}: {
  steps: WizardStep[]
  current: number | string
  onStepSelect?: (key: string, index: number) => void
  /**
   * Upcoming nodes are tappable too — for a form whose every step is already answered (an EDIT of a saved
   * profile), where "jump ahead" skips nothing. Off by default: a flow being filled for the first time must
   * not let anyone skip past work not yet done.
   */
  allowForward?: boolean
  className?: string
}) {
  const active = activeIndexOf(steps, current)
  return (
    <ol data-slot="step-rail" className={cn('flex items-center', className)}>
      {steps.map((step, i) => {
        const state = i < active ? 'done' : i === active ? 'current' : 'upcoming'
        const filled = state === 'done' || state === 'current'
        const node = (
          <span
            aria-hidden
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-full border-2 transition-colors',
              filled ? 'border-brand bg-brand text-white' : 'border-border bg-card text-muted-foreground',
              // A ring lifts the CURRENT node off the done ones (both are brand-filled).
              state === 'current' && 'ring-2 ring-brand/25 ring-offset-2 ring-offset-card',
            )}
          >
            {state === 'done' ? <Check className="size-4" /> : step.icon}
          </span>
        )
        return (
          <li
            key={step.key}
            // Every node but the last flex-grows so the connectors distribute the row evenly.
            className={cn('flex items-center', i < steps.length - 1 && 'flex-1')}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            {(state === 'done' || (allowForward && state === 'upcoming')) && onStepSelect ? (
              <button
                type="button"
                onClick={() => onStepSelect(step.key, i)}
                aria-label={step.label}
                // relative tap-44: the node draws at 36px; the 4px the hit area reaches past each
                // side stays inside the connector's 6px margin, never on the next node.
                className="press relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand/40 tap-44"
              >
                {node}
              </button>
            ) : (
              <span role="img" aria-label={step.label}>
                {node}
              </span>
            )}
            {i < steps.length - 1 && (
              <span aria-hidden className={cn('mx-1.5 h-0.5 flex-1 rounded-full', i < active ? 'bg-brand' : 'bg-border')} />
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ── StepWizard ────────────────────────────────────────────────────────────────────────────────
export function StepWizard({
  steps,
  current,
  onStepSelect,
  allowForward,
  header,
  children,
  primaryAction,
  secondaryAction,
  actionNote,
  actionBarLabel,
  offsetBottom,
  className,
}: {
  steps: WizardStep[]
  /** 0-based index OR the active step's `key`. */
  current: number | string
  /** Optional: tap a completed rail node to jump back to it. */
  onStepSelect?: (key: string, index: number) => void
  /** With `onStepSelect`: upcoming nodes jump too (StepRail — an edit, where every step is already done). */
  allowForward?: boolean
  /** Optional chrome above the rail (a title + close). Kept a slot so the primitive stays copy-free. */
  header?: React.ReactNode
  /** The current step's body — exactly one step's worth. */
  children: React.ReactNode
  /** When given, the bottom action bar is rendered (with its spacer). Omit for a step with no CTA. */
  primaryAction?: StickyActionBarAction
  secondaryAction?: StickyActionBarAction
  /**
   * One short line the primary action depends on — a consent notice beside Publish. It rides the phone's sticky
   * bar (StickyActionBar `above`, measured with the panel) and sits above the desktop's inline actions.
   * ⚠️ PASS `null`, NOT `undefined`, WHILE IT IS EMPTY BUT MAY FILL — StickyActionBar's rule: flipping between the
   * two shapes re-parents the actions and remounts the primary button. Omitted entirely, the wizard renders exactly
   * what it did before this prop existed.
   */
  actionNote?: React.ReactNode
  /** Accessible name for the action bar. */
  actionBarLabel?: string
  /** CSS length of whatever owns the bottom edge on this surface — `'4.5rem'` where <MobileNav> is
   *  mounted, omitted elsewhere. Forwarded verbatim to <StickyActionBar>. */
  offsetBottom?: string
  className?: string
}) {
  const active = activeIndexOf(steps, current)
  const step: WizardStep | undefined = steps[active]
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const liveId = useId()
  // Skip the very first render so mounting the wizard doesn't yank focus / scroll the page; move
  // focus to the new step body only on an actual STEP CHANGE (SPA route-change focus pattern).
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    bodyRef.current?.focus()
  }, [active])

  return (
    <div data-slot="step-wizard" className={cn('flex flex-col', className)}>
      {header}
      <StepRail steps={steps} current={active} onStepSelect={onStepSelect} allowForward={allowForward} className="mb-6" />

      {/* Polite live region — announces "<label> · n/total" on change without stealing focus. The
          visible rail carries the same information for sighted users. */}
      <p id={liveId} aria-live="polite" className="sr-only">
        {step ? `${step.label} · ${active + 1}/${steps.length}` : ''}
      </p>

      {/* The body is a programmatic focus target (tabIndex -1, no focus ring) so a step change lands
          the keyboard/SR user on the fresh content. */}
      <div ref={bodyRef} tabIndex={-1} className="outline-none">
        {children}
      </div>

      {primaryAction && (
        <>
          {/* MOBILE: the pinned action line the pattern is about. <MobileNav> is lg:hidden, so this
              bar (and its spacer) are too, and `offsetBottom` clears that 4.5rem nav on mobile. */}
          <StickyActionBar
            primary={primaryAction}
            secondary={secondaryAction}
            offsetBottom={offsetBottom}
            label={actionBarLabel}
            above={actionNote}
            className="lg:hidden"
          />
          <StickyActionBarSpacer className="lg:hidden" />
          {/* DESKTOP (≥lg): no bottom nav and a fixed full-width bar reads heavy on a centred form, so
              the SAME actions render inline at the end of the flow. Built here from the same objects
              so no caller duplicates them. `render` (link) actions are honoured via ui/button's bridge. */}
          {actionNote != null && <div className="mt-6 hidden lg:block">{actionNote}</div>}
          <div className={actionNote != null ? 'mt-3 hidden items-center justify-end gap-3 lg:flex' : 'mt-6 hidden items-center justify-end gap-3 lg:flex'}>
            {secondaryAction && <InlineAction action={secondaryAction} variant="outline" />}
            <InlineAction action={primaryAction} variant="cta" />
          </div>
        </>
      )}
    </div>
  )
}

/** The desktop inline twin of a StickyActionBar action. Mirrors ui/button; forwards `render` so a
 *  link-based action still works, and drops it when disabled (a link has no disabled state). */
function InlineAction({ action, variant }: { action: StickyActionBarAction; variant: 'cta' | 'outline' }) {
  const { label, icon, onClick, render, disabled, ariaLabel, type = 'button' } = action
  return (
    <Button
      variant={variant}
      type={type}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
      {...(render && !disabled ? { render } : {})}
    >
      {icon}
      {label}
    </Button>
  )
}
