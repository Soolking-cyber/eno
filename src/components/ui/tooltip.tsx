'use client'

import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from '@/lib/utils'

export function Tooltip({
  content,
  children,
  side = 'top',
  sideOffset = 6,
  align = 'center',
  className,
}: {
  content: ReactNode
  children: ReactElement
  side?: ComponentProps<typeof TooltipPrimitive.Positioner>['side']
  sideOffset?: number
  align?: ComponentProps<typeof TooltipPrimitive.Positioner>['align']
  className?: string
}) {
  if (!content) return children

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="z-[70]">
          <TooltipPrimitive.Popup className={cn('max-w-64 rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-md', className)}>
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
