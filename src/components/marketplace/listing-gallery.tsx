'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { X, ChevronLeft, ChevronRight, Images } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tr } from '@/context/language-context'
import { isMockImageUrl } from '@/lib/listing-image'

type Props = {
  images: string[]
  title: string
  showAllLabel?: string
}

/** Airbnb-style photo mosaic (1 big + grid) with a full-screen lightbox. */
export function ListingGallery({ images, title, showAllLabel = 'Show all photos' }: Props) {
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)
  const startX = useRef<number | null>(null)

  const last = images.length - 1
  const goTo = (n: number) => setIdx(Math.max(0, Math.min(last, n)))
  const openAt = (n: number) => { setIdx(n); setOpen(true) }

  if (images.length === 0) {
    return <div className="h-[300px] w-full rounded-2xl bg-tint" />
  }

  const rest = images.slice(1, 5)
  const restGrid =
    rest.length >= 3 ? 'grid-cols-2 grid-rows-2' : rest.length === 2 ? 'grid-rows-2' : 'grid-rows-1'

  return (
    <>
      {images.length === 1 ? (
        <button onClick={() => openAt(0)} className="group block w-full overflow-hidden rounded-2xl cursor-pointer">
          <div data-protected className="relative aspect-[16/10] w-full bg-tint">
            <Image src={images[0]} alt={title} fill sizes="(max-width:1024px) 100vw, 60vw" className="object-cover transition-transform duration-300 group-hover:scale-[1.02]" priority unoptimized={isMockImageUrl(images[0])} />
            <span className="img-watermark" aria-hidden />
          </div>
        </button>
      ) : (
        <div data-protected className="relative grid h-[300px] grid-cols-2 gap-2 overflow-hidden rounded-2xl sm:h-[440px]">
          <button onClick={() => openAt(0)} className="group relative h-full w-full overflow-hidden cursor-pointer">
            <Image src={images[0]} alt={title} fill sizes="(max-width:1024px) 50vw, 40vw" className="object-cover transition-transform duration-300 group-hover:scale-[1.02]" priority unoptimized={isMockImageUrl(images[0])} />
            <span className="img-watermark" aria-hidden />
          </button>
          <div className={cn('grid gap-2', restGrid)}>
            {rest.map((img, i) => (
              <button key={i} onClick={() => openAt(i + 1)} className="group relative h-full w-full overflow-hidden cursor-pointer">
                <Image src={img} alt={`${title} — photo ${i + 2}`} fill sizes="25vw" className="object-cover transition-transform duration-300 group-hover:scale-[1.03]" unoptimized={isMockImageUrl(img)} />
                <span className="img-watermark" aria-hidden />
              </button>
            ))}
          </div>
          <button
            onClick={() => openAt(0)}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white cursor-pointer [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.5))]"
          >
            <Images className="h-4 w-4" /> <Tr text={showAllLabel} />
          </button>
        </div>
      )}

      {/* Lightbox */}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/92 animate-in fade-in duration-150"
          onClick={() => setOpen(false)}
        >
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center text-white cursor-pointer [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.5))]"
          >
            <X className="h-5 w-5" />
          </button>

          <div
            data-protected
            className="relative h-[78vh] w-[92vw] max-w-5xl"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => { startX.current = e.touches[0].clientX }}
            onTouchEnd={(e) => {
              if (startX.current == null) return
              const dx = e.changedTouches[0].clientX - startX.current
              if (Math.abs(dx) > 40) goTo(idx + (dx < 0 ? 1 : -1))
              startX.current = null
            }}
          >
            <Image src={images[idx]} alt={`${title} — photo ${idx + 1} of ${images.length}`} fill sizes="92vw" className="object-contain" unoptimized={isMockImageUrl(images[idx])} />
            <span className="img-watermark" aria-hidden />
          </div>

          {idx > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); goTo(idx - 1) }}
              aria-label="Previous"
              className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-white cursor-pointer [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.55))]"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          {idx < last && (
            <button
              onClick={(e) => { e.stopPropagation(); goTo(idx + 1) }}
              aria-label="Next"
              className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-white cursor-pointer [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.55))]"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}

          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white">
            {idx + 1} / {images.length}
          </div>
        </div>
      )}
    </>
  )
}
