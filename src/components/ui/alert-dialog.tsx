"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "overlay-scrim fixed inset-0 isolate z-50 duration-100 ease-[var(--ease-out-strong)] data-closed:ease-[var(--ease-out-strong)] data-closed:duration-75 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  size = "default",
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  size?: "default" | "sm"
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          // ⚠️ THESE ARE TWO SEPARATE DECISIONS — do not collapse them.
          // OPEN (duration-150): the two centered modal surfaces were zooming at different speeds
          // (100 vs 150) and 100ms on a fade+zoom reads as a snap. Flagged by all three reviewers
          // in the Base UI audit. Do NOT lower it.
          // CLOSE (data-closed:duration-100): a dismissal should be quicker — the DURATION is what
          // makes it quieter, and the curve is not. `ease-in` used to be here on the reasoning that
          // it softened the exit; measured, it moves 9.3% of the way in the first quarter of the
          // animation, so the overlay is still 90% present at the moment the reader is watching
          // hardest. Both halves now ride `--ease-out-strong` (77.5% by that same point); the
          // asymmetry that matters is 100ms out against 150ms in.
          // than its open — the same pair ui/dialog ships. The scrim behind it closes quicker still
          // (75ms), which is deliberate: the dimming gets out of the way first. That 25ms stagger is
          // HALF what this file had before (100 scrim / 150 content), not a new one.
          "group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-150 ease-[var(--ease-out-strong)] data-closed:duration-100 data-closed:ease-[var(--ease-out-strong)] outline-none data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-4 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogMedia({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "mb-2 inline-flex size-10 items-center justify-center rounded-lg bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-6",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "font-heading text-base font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

/**
 * The confirming button. Renders through AlertDialogPrimitive.Close, so an UNCONTROLLED
 * <AlertDialog> actually closes when you confirm — as a plain <Button> it never did, and
 * every current caller only looked correct because it closed the dialog itself.
 *
 * ASYNC ACTIONS still work. Base UI runs OUR onClick before its own close handler and
 * skips that handler if we call `event.preventBaseUIHandler()` synchronously
 * (see mergeProps → mergeEventHandlers). So if the handler returns a thenable — i.e. it
 * awaits, and wants to render its pending/error state INSIDE the still-open dialog, then
 * close on its own terms — we hold the dialog open. A void handler closes immediately,
 * which is what a confirm button should do.
 *
 * `closeOnClick` overrides the inference in either direction.
 */
function AlertDialogAction({
  className,
  variant,
  size,
  onClick,
  closeOnClick,
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size"> & {
    closeOnClick?: boolean
  }) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-action"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      onClick={(event) => {
        const result = onClick?.(event) as unknown
        const isAsync =
          typeof (result as PromiseLike<unknown> | undefined)?.then === "function"
        if (closeOnClick === false || (closeOnClick === undefined && isAsync)) {
          // Must be synchronous: Base UI checks the flag the moment our handler returns.
          event.preventBaseUIHandler()
        }
        return result
      }}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
