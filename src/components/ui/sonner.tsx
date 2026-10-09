"use client"

import { useTheme } from "@/context/theme-context"
import { useLanguage } from "@/context/language-context"
import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme() // app theme choice, not OS — next-themes had no provider mounted
  const { tr } = useLanguage()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      richColors
      toastOptions={{
        duration: 4000,
        // ⚠️ A 44px REACH ON SONNER'S `{ label, onClick }` ACTION, which it draws 24px tall — the button a thumb
        // most often misses on the toasts that ask for something (Verify, Undo, View list). `tap-44` adds the
        // hit area without changing the drawing; `relative` is what keeps it on the button (see the tap-44 note
        // in globals.css — sonner leaves the button unpositioned). The reach ends inside the toast's 16px
        // padding, and the close ✕ sits in the opposite corner. As with the ✕'s own reach, a swipe-to-dismiss
        // cannot START in those ~10px above and below the button (sonner starts one only off a <button>);
        // the rest of the toast still swipes.
        classNames: { actionButton: 'relative tap-44' },
      }}
      // The live region's name (sonner appends its hotkey, "alt+T"). Its default is the English
      // "Notifications", announced on every page in every language.
      containerAriaLabel={tr("Notifications", "Thông báo")}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
