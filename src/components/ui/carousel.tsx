"use client"

import * as React from "react"
import useEmblaCarousel, {
  type UseEmblaCarouselType,
} from "embla-carousel-react"

import { Tr } from "@/context/language-context"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons"
import { STROKE_FLOAT_MAX } from "@/lib/icon-tokens"

type CarouselApi = UseEmblaCarouselType[1]
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>
type CarouselOptions = UseCarouselParameters[0]
type CarouselPlugin = UseCarouselParameters[1]

type CarouselProps = {
  opts?: CarouselOptions
  plugins?: CarouselPlugin
  orientation?: "horizontal" | "vertical"
  setApi?: (api: CarouselApi) => void
}

type CarouselContextProps = {
  carouselRef: ReturnType<typeof useEmblaCarousel>[0]
  api: ReturnType<typeof useEmblaCarousel>[1]
  scrollPrev: () => void
  scrollNext: () => void
  canScrollPrev: boolean
  canScrollNext: boolean
} & CarouselProps

const CarouselContext = React.createContext<CarouselContextProps | null>(null)

function useCarousel() {
  const context = React.useContext(CarouselContext)

  if (!context) {
    throw new Error("useCarousel must be used within a <Carousel />")
  }

  return context
}

function Carousel({
  orientation = "horizontal",
  opts,
  setApi,
  plugins,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & CarouselProps) {
  const [carouselRef, api] = useEmblaCarousel(
    {
      ...opts,
      axis: orientation === "horizontal" ? "x" : "y",
    },
    plugins
  )
  const [canScrollPrev, setCanScrollPrev] = React.useState(false)
  const [canScrollNext, setCanScrollNext] = React.useState(false)

  const onSelect = React.useCallback((api: CarouselApi) => {
    if (!api) return
    setCanScrollPrev(api.canScrollPrev())
    setCanScrollNext(api.canScrollNext())
  }, [])

  const scrollPrev = React.useCallback(() => {
    api?.scrollPrev()
  }, [api])

  const scrollNext = React.useCallback(() => {
    api?.scrollNext()
  }, [api])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        scrollPrev()
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        scrollNext()
      }
    },
    [scrollPrev, scrollNext]
  )

  React.useEffect(() => {
    if (!api || !setApi) return
    setApi(api)
  }, [api, setApi])

  React.useEffect(() => {
    if (!api) return
    onSelect(api)
    api.on("reInit", onSelect)
    api.on("select", onSelect)

    return () => {
      api?.off("reInit", onSelect)
      api?.off("select", onSelect)
    }
  }, [api, onSelect])

  return (
    <CarouselContext.Provider
      value={{
        carouselRef,
        api: api,
        opts,
        orientation:
          orientation || (opts?.axis === "y" ? "vertical" : "horizontal"),
        scrollPrev,
        scrollNext,
        canScrollPrev,
        canScrollNext,
      }}
    >
      <div
        onKeyDownCapture={handleKeyDown}
        className={cn("relative", className)}
        role="region"
        aria-roledescription="carousel"
        data-slot="carousel"
        {...props}
      >
        {children}
      </div>
    </CarouselContext.Provider>
  )
}

function CarouselContent({ className, viewportClassName, ...props }: React.ComponentProps<"div"> & { viewportClassName?: string }) {
  const { carouselRef, orientation } = useCarousel()

  return (
    <div
      ref={carouselRef}
      /* ⚠️ ROUND THE VIEWPORT, NOT THE SLIDES. A radius on each slide shows TWO rounded
         cards mid-transition — the corners cut into the artwork as one slide leaves and
         the next arrives (owner, 2026-08-07: "the 3-banner transition does not need corner
         rounding inside, it looks weird when transitioned"). Rounding the clipping
         viewport instead gives one stable rounded frame the slides move through. */
      className={cn("overflow-hidden", viewportClassName)}
      data-slot="carousel-content"
    >
      <div
        className={cn(
          "flex",
          orientation === "horizontal" ? "-ml-4" : "-mt-4 flex-col",
          className
        )}
        {...props}
      />
    </div>
  )
}

function CarouselItem({ className, ...props }: React.ComponentProps<"div">) {
  const { orientation } = useCarousel()

  return (
    <div
      role="group"
      aria-roledescription="slide"
      data-slot="carousel-item"
      className={cn(
        "min-w-0 shrink-0 grow-0 basis-full",
        orientation === "horizontal" ? "pl-4" : "pt-4",
        className
      )}
      {...props}
    />
  )
}

/**
 * ⚠️ THE APP'S ONE FLOATING-ARROW LOOK — a bold chevron on the shared translucent disc, never a
 * bordered pill. Owner, 2026-08-07: "arrows inside banner have circle outline, remove it and match
 * arrows to the other arrows on the home screen — clean, minimal, our style"; then 2026-08-29:
 * "put back plates to all arrows around app". What was rejected then was an OUTLINE RING around a
 * chevron; what is here now is `.icon-plate`, the filled scrim every over-media control wears. The
 * "match the other arrows" half of that instruction still holds — use-scroll-arrows.tsx was plated
 * in the same change. This is byte-for-byte that rail-arrow treatment: size-7 at the
 * floating-chevron max stroke on the disc, with a hairline shadow softening its edge. The
 * default variant is `bare`/`none` for the same reason — `outline` + `icon-sm` drew the
 * bordered pill the owner rejected. A caller that genuinely wants a chip can still pass
 * variant/size, but nothing in the app does.
 */
/**
 * ⚠️ `.icon-plate` IS THE BACKING; THE SHADOW ONLY SOFTENS ITS EDGE. Owner, 2026-08-29: "put back
 * plates to all arrows around app". Both carousels that use these arrows put them OVER content —
 * the promo banner sits them at `left-2` on top of the artwork, and the gallery thumbstrip at
 * `-left-2` over the thumbnails — so a bare chevron with a drop-shadow vanished against a busy or
 * dark slide, taking the shadow with it. The disc is defined once in globals.css and shared with
 * every `IconButton variant="overlay"`.
 * ⛔ 28px + 3px EACH SIDE = A 34px DISC, SO A CALLER MUST LEAVE AT LEAST 34px OF BOX. Both callers
 * were checked against that and the gallery thumbstrip failed it — `h-8 w-8` is 32px, and it was
 * moved to `h-9`. An earlier draft of this note called that 2px overflow deliberate while the
 * gallery was being fixed in the same commit; a reviewer caught the contradiction. There is no
 * "on purpose" here: glyph + 6 ≤ button, and the default (`size="none"`) satisfies it by hugging.
 * ⚠️ THE INK IS SET HERE RATHER THAN IN THE PLATE RULE so a call site can override it with an
 * ordinary utility. promo-banner used to set `text-white/80` → `hover:text-white` and had to be
 * changed when the glyph started carrying its own ink — check for that when adding a caller.
 */
const ARROW_GLYPH = 'icon-plate size-7 text-white dark:text-neutral-900 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.22))]'

function CarouselPrevious({
  className,
  variant = "bare",
  size = "none",
  ...props
}: React.ComponentProps<typeof Button>) {
  const { orientation, scrollPrev, canScrollPrev } = useCarousel()

  return (
    <Button
      data-slot="carousel-previous"
      variant={variant}
      size={size}
      className={cn(
        "absolute touch-manipulation rounded-full",
        orientation === "horizontal"
          ? "inset-y-0 -left-12 my-auto"
          : "-top-12 left-1/2 -translate-x-1/2 rotate-90",
        className
      )}
      disabled={!canScrollPrev}
      onClick={scrollPrev}
      {...props}
    >
      <ChevronLeftIcon className={ARROW_GLYPH} strokeWidth={STROKE_FLOAT_MAX} />
      <span className="sr-only"><Tr text="Previous slide" /></span>
    </Button>
  )
}

function CarouselNext({
  className,
  variant = "bare",
  size = "none",
  ...props
}: React.ComponentProps<typeof Button>) {
  const { orientation, scrollNext, canScrollNext } = useCarousel()

  return (
    <Button
      data-slot="carousel-next"
      variant={variant}
      size={size}
      className={cn(
        "absolute touch-manipulation rounded-full",
        orientation === "horizontal"
          ? "inset-y-0 -right-12 my-auto"
          : "-bottom-12 left-1/2 -translate-x-1/2 rotate-90",
        className
      )}
      disabled={!canScrollNext}
      onClick={scrollNext}
      {...props}
    >
      <ChevronRightIcon className={ARROW_GLYPH} strokeWidth={STROKE_FLOAT_MAX} />
      <span className="sr-only"><Tr text="Next slide" /></span>
    </Button>
  )
}

export {
  type CarouselApi,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
  useCarousel,
}
