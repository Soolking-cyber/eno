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
      toastOptions={{ duration: 4000 }}
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
