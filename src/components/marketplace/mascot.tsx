import { cn } from '@/lib/utils'

export type MascotName = 'wave' | 'saved' | 'help' | 'key' | 'search' | 'profile' | 'chat' | 'success'

/**
 * eno.vn's hand-drawn shield mascot illustrations (public/mascots/*.png).
 * They're dark line-art on transparent, so in DARK mode we flip them to clean
 * white via `brightness-0 invert`; pass `white` to force white on any colored
 * surface (e.g. the blue sign-in panel). Decorative → lazy + empty alt.
 */
export function Mascot({ name, className, white = false, alt }: { name: MascotName; className?: string; white?: boolean; alt?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/mascots/${name}.png`}
      alt={alt ?? ''}
      aria-hidden={alt ? undefined : true}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn('select-none object-contain', white ? '[filter:brightness(0)_invert(1)]' : 'dark:[filter:brightness(0)_invert(1)]', className)}
    />
  )
}
