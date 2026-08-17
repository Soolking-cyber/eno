"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Tr } from "@/context/language-context"
import { Button } from "@/components/ui/button"
import { useVirtualKeyboard } from "@/hooks/use-virtual-keyboard"
import { XIcon } from "@/components/ui/icons"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "overlay-scrim fixed inset-0 isolate z-50 duration-100 data-closed:duration-75 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  // KEYBOARD-AWARE GEOMETRY (mobile web + the Capacitor shell) — this file CONSUMES the
  // app-wide contract published in globals.css ("KEYBOARD-AWARE SURFACES"); it must never
  // re-derive it. A dialog centred on the LAYOUT viewport puts its footer buttons underneath
  // the on-screen keyboard — on iOS the keyboard OVERLAYS the page, so `50%` keeps pointing at
  // the middle of a viewport whose bottom half is no longer visible. Two published vars fix it,
  // both written on <html> every frame by use-virtual-keyboard (VisualViewport on the web, the
  // @capacitor/keyboard bridge natively):
  //   var(--kb-h)  px of the LAYOUT viewport the keyboard covers, ALREADY net of WebKit's own
  //                pan, and 0px while closed.
  //   var(--vvh)   the VISIBLE viewport height, i.e. exactly the room left above the keyboard.
  // ⚠️ This used to rebuild --kb-h locally as `100dvh - --vvt - --vvh` (a local `--kb-inset`).
  // That is identical to --kb-h on the WEB but WRONG inside the native app, where --vvt is
  // pinned to 0: the local copy was then the RAW keyboard height, while WebKit ALSO pans the
  // document to reveal the focused field — so the dialog rose twice and either overshot the
  // keyboard or left a gap above it. Consume --kb-h; never re-derive the raw inset.
  //
  // top = 50% + --vvt/2 - --kb-h/2 re-centres the popup on the VISIBLE strip: on the web that
  // is identically (--vvt + --vvh/2), the middle of what is still on screen. Both terms are
  // 0px with the keyboard down (the hook forces --vvt to 0 on close, and :root seeds --kb-h),
  // so the resting `top` computes to a plain 50% — rendered-identical to `top-1/2`, including
  // before hydration. It is deliberately NOT gated on the React boolean: the vars self-zero,
  // and reading them live means the re-centre rides the keyboard's own animation instead of
  // waiting the ~120ms the coalesced boolean costs (which briefly moved the dialog the WRONG
  // way, since only the --vvt term applied in that window).
  //
  // The React boolean is ONLY the on/off switch for the height clamp — one re-render per
  // keyboard toggle. Natively it flips on `keyboardWillShow`, i.e. as the keyboard STARTS
  // animating; on mobile web the hook coalesces it to ~120ms after the visual viewport settles.
  // The per-frame geometry deliberately stays in CSS: a React render on every viewport frame
  // makes iOS abort the keyboard, the same reason the chat composer is CSS-driven (globals.css).
  const { open: keyboardOpen } = useVirtualKeyboard()

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-kb-open={keyboardOpen ? "" : undefined}
        className={cn(
          // bg-popover, not bg-background: in dark mode --card and --background are BOTH #1b1b1b,
          // the page canvas, so a dialog rendered on either is indistinguishable from the page
          // behind it — only the backdrop separated them. --popover is #2a2a2a and lifts the
          // surface off the page. This matches ui/sheet, which is already on bg-popover.
          "fixed left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl bg-popover p-6 shadow-overlay duration-150 data-closed:duration-100 data-closed:ease-in outline-none sm:max-w-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          // Centre on the VISIBLE viewport (see the block above). Both keyboard terms are
          // 0px with no keyboard, so this resolves to a plain 50% and the closed-keyboard
          // rendering is byte-identical to `top-1/2`.
          "top-[calc(50%+var(--vvt,0px)/2-var(--kb-h,0px)/2)]",
          // Only while the keyboard is up does the popup become a clamped scroller: a dialog
          // taller than the visible strip would otherwise push its own footer back under the
          // keyboard. --vvh IS the visible height on both platforms (on the web it equals the
          // old `100dvh - --kb-h - --vvt`, natively the plugin publishes it directly), so this
          // leaves 1rem of clearance top and bottom without another derived quantity. Gated so
          // tall dialogs keep their current (unclamped) layout otherwise.
          "data-kb-open:max-h-[calc(var(--vvh,100dvh)-2rem)] data-kb-open:overflow-y-auto data-kb-open:overscroll-contain",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            /**
             * ⛔ THE GLYPH'S OWN RING IS THE CONTROL — THERE IS NO CHIP. Owner, 2026-08-17: "the x
             * with circle either make it large so circle is the outline of icon or remove and
             * replace with just x whichever is better since now its too small circle with tiny x".
             *
             * It was drawing TWO rings. The app's `XIcon` maps to Solar `close-circle`
             * (scripts/lucide-solar-map.mjs:267) — the ring is part of the GLYPH — and this button
             * wrapped it in a second `rounded-full` chip with its own border and shadow. At
             * 16px inside a 28px chip the actual cross was ~8px: the ring you saw was the chip, and
             * the mark inside it was the smallest thing in the dialog.
             *
             * ⚠️ 24px, AND THE SIZE MUST BE ON THE GLYPH. The parent carries
             * `[&_svg:not([class*='size-'])]:size-4`, so an unsized icon is forced back to 16px —
             * the explicit `size-6` is what opts out of it, not decoration.
             *
             * ⚠️ `tap-44` REPLACES THE PADDING THE CHIP USED TO PROVIDE. Dropping `p-1.5` took the
             * box from 28px to 24px, which is under the touch minimum; the pseudo-element hit area
             * restores it without painting anything. It is safe HERE specifically because this
             * element is `absolute` — an unpositioned `tap-44` anchors to the nearest positioned
             * ancestor and swallows taps meant for it.
             *
             * ⚠️ IT KEEPS THE SPRITE, rather than becoming an inline bare cross. Solar ships no
             * circle-free close, so a bare mark means hand-drawn SVG — which would opt out of the
             * `.i-rest`/`.i-on` weight swap, and out of `scripts/critical-icons.mjs`, where `X` is
             * a measured member of the critical partition. design-lint has no `<svg>` rule, so
             * nothing would have caught it either.
             */
            className="ring-offset-background focus:ring-ring tap-44 absolute top-3.5 right-3.5 rounded-full text-ink-4 hover:text-foreground transition-all hover:scale-105 active:scale-[0.96] z-50 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 cursor-pointer"
          >
            <XIcon className="size-6" />
            <span className="sr-only"><Tr text="Close" /></span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          <Tr text="Close" />
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
