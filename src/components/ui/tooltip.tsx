'use client'

import type { ReactElement, ReactNode } from 'react'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from '@/lib/utils'

export function Tooltip({ content, children, className }: { content: ReactNode; children: ReactElement; className?: string }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side="top" sideOffset={6} className="z-[70]">
          <TooltipPrimitive.Popup className={cn('max-w-64 rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-md', className)}>
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

