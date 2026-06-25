import { cn } from '@/lib/utils'

export type MascotName = 'wave' | 'saved' | 'help' | 'key' | 'search' | 'profile' | 'chat' | 'success' | 'cookie'

/**
 * eno.vn's hand-drawn shield mascots — vector-traced from the originals
 * (public/mascots/*.svg) and rendered as a CSS mask filled with `currentColor`,
 * so they're crisp at any size and adapt to the theme automatically: dark line-art
 * in light mode, light line-art in dark mode (via `text-foreground`). No raster,
 * no dark-mode invert hacks. Pass `white` to force white (e.g. on the blue panel).
 */
export function Mascot({ name, className, white = false }: { name: MascotName; className?: string; white?: boolean }) {
  const url = `url(/mascots/${name}.svg)`
  return (
    <span
      aria-hidden
      className={cn('inline-block bg-current', white ? 'text-white' : 'text-line-strong', className)}
      style={{
        maskImage: url,
        WebkitMaskImage: url,
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
      }}
    />
  )
}
