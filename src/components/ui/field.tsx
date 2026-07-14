'use client'

import { Field as BaseField } from '@base-ui/react/field'
import { cn } from '@/lib/utils'

/** THE accessible form-field wrapper. Ties a label, a control and an error message together so a
 *  screen reader learns THAT a field is invalid and WHY.
 *
 *  ## What was wrong before this existed
 *  29 surfaces in this app render a validation error next to an input; exactly 3 wired ANY
 *  programmatic association. So the message sat visually beside the field and, to assistive tech,
 *  was unrelated to it: the input never announced as invalid, and the reason was never read out as
 *  its description. Sighted users saw red text; everyone else got silence. It is the same failure as
 *  the tab strips that were really `<button>`s — a control that LOOKS correct and REPORTS nothing.
 *
 *  ## What Base UI's Field does for us
 *  `Field.Root` publishes a LabelableContext. `Field.Label` registers its id → the control gets
 *  `aria-labelledby`. `Field.Error` / `Field.Description` register THEIR ids → the provider merges
 *  them into a single `aria-describedby` on the control (internals/labelable-provider, which is the
 *  only place in the package that composes that attribute). `invalid` on the Root sets `aria-invalid`
 *  and is what makes `<FieldError>` render at all.
 *
 *  That last point is the useful one: `<FieldError>` SELF-HIDES when the field is valid, so the
 *  call-site conditional (`{error && <p className="text-destructive">…</p>}`) disappears. Pass the
 *  message as children and drive it entirely from `invalid`.
 *
 *  ## Usage — the control keeps its own primitive
 *  Field does not replace `<Input>`/`<Textarea>`/`<Select>`; it WRAPS one via `render`, which is how
 *  Base UI composes (never `asChild`):
 *
 *      <Field invalid={!!err}>
 *        <FieldLabel>{tr('Title', 'Tiêu đề')}</FieldLabel>
 *        <FieldControl render={<Input variant="outline" />} />
 *        <FieldError>{err}</FieldError>
 *      </Field>
 *
 *  ⚠️ `render` CONCATENATES className — it does not tailwind-merge (see CLAUDE.md). Style the control
 *  through its own primitive props, not by adding a colliding class on `<FieldControl>`.
 *
 *  ⚠️ **IDs — PUT IT IN BOTH PLACES, and this is not belt-and-braces.**
 *
 *      <FieldControl id="pw-title" render={<Input id="pw-title" />} />
 *
 *  Base UI reads the id off `FieldControl`'s OWN props (`useLabelableId({ id: idProp })`). An id on
 *  the `render` CHILD is invisible to it: `registerControlId` is never called, the provider keeps its
 *  generated seed, and the label emits `htmlFor="base-ui-_R_0_"` — an IDREF pointing at nothing —
 *  while `mergeProps` lets the child's id win on the actual DOM node. The accessible NAME still works
 *  (that comes from `aria-labelledby`), which is exactly why this looks correct and isn't: what
 *  breaks is **clicking the label to focus the input**, silently, with no error anywhere.
 *
 *  The child's copy is not redundant — it pins the DOM id from the FIRST paint, before the
 *  registration effect runs, which is what `getElementById` consumers need. `post-wizard`'s title
 *  MUST stay `id="pw-title"` on the `<input>` itself: `scrollToMissing()` does
 *  `getElementById('pw-' + key)` and then focuses it only `if (el instanceof HTMLInputElement)`.
 *
 *  (Learned the hard way: five forms were migrated with the id on the child only, and every one of
 *  them shipped a dangling `htmlFor`.)
 *
 *  ## When NOT to use this
 *  A FORM-level error ("Invalid code", "Something went wrong") belongs to no single input, so
 *  `aria-describedby` is the wrong tool — it would be attached to an arbitrary field. Those need to
 *  be ANNOUNCED instead: give them `role="alert"`, which makes a screen reader speak the message the
 *  moment it appears. Don't wrap a whole form in a Field to get red text.
 */
export function Field({
  invalid,
  className,
  ...props
}: { invalid?: boolean } & React.ComponentPropsWithoutRef<typeof BaseField.Root>) {
  return (
    <BaseField.Root
      invalid={invalid}
      className={cn('flex w-full flex-col gap-1.5', className)}
      {...props}
    />
  )
}

/** The label. Registers itself with the control — no `htmlFor` to keep in sync by hand. */
export function FieldLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseField.Label>) {
  return (
    <BaseField.Label
      className={cn('text-sm font-medium text-foreground', className)}
      {...props}
    />
  )
}

/** The control slot. Pass the real primitive via `render` — `render={<Input />}`. */
export function FieldControl(props: React.ComponentPropsWithoutRef<typeof BaseField.Control>) {
  return <BaseField.Control {...props} />
}

/** The error message, wired into the control's `aria-describedby`.
 *
 *  ⚠️ `match` DEFAULTS TO TRUE HERE, and that is load-bearing. Base UI gates `Field.Error` on the
 *  field's internal VALIDITY state (`validityData.state.valid === false`), which is populated by
 *  native constraint validation or a `validate` fn on the Root — the `invalid` prop alone does NOT
 *  set it. This app validates in React state (`err.price`, `setError(...)`), so out of the box the
 *  error element renders NOTHING and `aria-describedby` silently points only at the description.
 *  (Verified in a DOM probe before this shipped: `aria-invalid="true"` with no error node at all.)
 *
 *  `match` forces it to render, so the CALLER decides when the error exists — same shape as the
 *  `{err && <p>…</p>}` it replaces, but now the message is a registered description of the control
 *  instead of an unrelated paragraph that happens to sit nearby:
 *
 *      <Field invalid={!!err}>
 *        …
 *        {err && <FieldError>{err}</FieldError>}
 *      </Field>
 */
export function FieldError({
  className,
  match = true,
  role = 'alert',
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseField.Error>) {
  return (
    <BaseField.Error
      match={match}
      // ⚠️ role="alert" IS BAKED IN, and it is the other half of the job.
      //
      // Base UI's Field.Error renders a PLAIN <div> — no role, no aria-live. So on its own it is
      // *associated* but *silent*: aria-describedby is only read when the control has FOCUS, and on a
      // failed submit focus is sitting on the Save button. The user presses Save, five fields light up
      // red, and a screen reader says nothing at all.
      //
      // The code this replaced across the app was `<p role="alert">{err}</p>` — announced, but tied to
      // nothing. Associating it while dropping the role would have TRADED one half of the fix for the
      // other. role="alert" on a node that only mounts when the error exists means it is spoken the
      // moment it appears, AND read again as the field's description when focus lands there. Both.
      role={role}
      className={cn('text-xs text-destructive', className)}
      {...props}
    />
  )
}

/** Persistent helper text (hints, formats, limits). Also wired into `aria-describedby`. */
export function FieldDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseField.Description>) {
  return (
    <BaseField.Description
      className={cn('text-xs text-body', className)}
      {...props}
    />
  )
}
