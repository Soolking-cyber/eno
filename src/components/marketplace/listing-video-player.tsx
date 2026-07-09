'use client'

import { useEffect, useRef } from 'react'
import { Video } from 'lucide-react'
import { Tr } from '@/context/language-context'

// The listing's own video on the detail page. Unlike the card-hover preview this has full
// controls (buyers judge condition — they want to scrub/replay/unmute). Muted autoplay while
// in view, pauses when scrolled away, so it's alive without hijacking the page's audio.
export function ListingVideoPlayer({ src, poster, title }: { src: string; poster?: string; title: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause() },
      { threshold: 0.5 },
    )
    obs.observe(v)
    return () => obs.disconnect()
  }, [])
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Video className="h-4 w-4 text-muted-foreground" />
        <Tr text="Video" />
      </div>
      <div className="overflow-hidden rounded-2xl bg-black">
        <video
          ref={ref}
          src={src}
          poster={poster}
          controls
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={title}
          className="max-h-[75vh] w-full object-contain"
        />
      </div>
    </div>
  )
}
