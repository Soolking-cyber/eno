"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Tr } from "@/context/language-context"
import { Button } from "@/components/ui/button"
import { useVirtualKeyboard } from "@/hooks/use-virtual-keyboard"
import { XIcon } from "lucide-react"

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
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
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
  // KEYBOARD-AWARE GEOMETRY (mobile web + the Capacitor shell).
  // A dialog centred on the LAYOUT viewport puts its footer buttons underneath the
  // on-screen keyboard — on iOS the keyboard OVERLAYS the page, so `50%` keeps pointing at
  // the middle of a viewport whose bottom half is no longer visible. `--vvh`/`--vvt` (written
  // on <html> every frame by use-virtual-keyboard, from VisualViewport on the web and from the
  // @capacitor/keyboard plugin natively) describe the VISIBLE viewport, so `--kb-inset` below
  // is exactly the strip of the layout viewport the keyboard covers. Re-centring on
  // (--vvt … --vvt + --vvh) keeps the whole dialog — footer included — above it.
  //
  // The React boolean is ONLY the on/off switch — one re-render per keyboard toggle. Natively it
  // flips on `keyboardWillShow`, i.e. as the keyboard STARTS animating, so nothing is ever seen
  // covered; on mobile web the hook coalesces it to ~120ms after the visual viewport settles. The
  // per-frame geometry deliberately stays in CSS: a React render on every viewport frame makes iOS
  // abort the keyboard, the same reason the chat composer is CSS-driven (globals.css).
  const { open: keyboardOpen } = useVirtualKeyboard()

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-kb-open={keyboardOpen ? "" : undefined}
        className={cn(
          "fixed left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl bg-background p-6 shadow-overlay duration-150 outline-none sm:max-w-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          // Keyboard inset — 0px with no keyboard, so `top` below resolves to a plain 50%
          // and the closed-keyboard rendering is byte-identical to `top-1/2`.
          "[--kb-inset:0px] data-kb-open:[--kb-inset:max(0px,calc(100dvh-var(--vvt,0px)-var(--vvh,100dvh)))]",
          "top-[calc(50%+var(--vvt,0px)/2-var(--kb-inset)/2)]",
          // Only while the keyboard is up does the popup become a clamped scroller: a dialog
          // taller than the visible strip would otherwise push its own footer back under the
          // keyboard. Gated so tall dialogs keep their current (unclamped) layout otherwise.
          "data-kb-open:max-h-[calc(100dvh-var(--kb-inset)-var(--vvt,0px)-2rem)] data-kb-open:overflow-y-auto data-kb-open:overscroll-contain",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring absolute top-3.5 right-3.5 rounded-full bg-card/90 hover:bg-card p-1.5 text-muted-foreground shadow-xs border border-border/30 transition-all hover:scale-105 active:scale-95 z-50 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 cursor-pointer"
          >
            <XIcon />
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
