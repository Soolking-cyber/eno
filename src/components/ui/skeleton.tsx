import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  // One skeleton system app-wide: the GPU-composited .shimmer sweep (globals.css).
  // .shimmer already sets the base background (var(--skeleton)) — no bg-* needed.
  return (
    <div
      data-slot="skeleton"
      className={cn("shimmer rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
