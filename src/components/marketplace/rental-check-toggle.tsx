'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, ClipboardCheck } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { hapticError, hapticTap } from '@/lib/haptics'
import { RENTAL_CHECK_CATEGORY_SLUG, RENTAL_CHECK_MAX_ITEMS, RENTAL_CHECK_PATH } from '@/lib/rental-check/shared'
import {
  addToBasket,
  removeFromBasket,
  takeFirstAddHint,
  useInRentalBasket,
  useRentalBasketCount,
  type RentalCheckSource,
} from '@/lib/rental-check/store'
import { cn } from '@/lib/utils'

type Tr = (en: string, vi?: string) => string

/**
 * ⛔ THE FREE-CHECK PROMISE, WRITTEN ONCE. Owner, 2026-09-25: *"write shortly on every step that all
 * is free checking and eno team doesnt charge the users for checking prices wont change when they go
 * to see the rentals"*. Every step of the flow says it — the first add, the pill, the list page, the
 * button, the sign-in prompt and the success toast — and they all read these three helpers so the
 * wording cannot drift between steps.
 * ⚠️ WORDED AS WHAT eno DOES, NOT AS A PRICE GUARANTEE. eno cannot promise a landlord's price; it
 * can promise that it charges nothing and adds nothing to the listed rent. "No fee or markup" is the
 * honest form of "the price won't change because of us".
 */
export const rentalFreeLine = (tr: Tr) =>
  tr(
    'Free service to find your next home — the price you see is the price you get.',
    'Dịch vụ miễn phí giúp bạn tìm nhà — giá bạn thấy là giá bạn trả.',
  )
/** The pill's second line — the tightest space in the flow. */
export const rentalFreeShort = (tr: Tr) => tr('Free · same price as listed', 'Miễn phí · đúng giá niêm yết')
/** Under the send button: the moment the visitor commits, so it names all three promises. */
export const rentalFreeCta = (tr: Tr) =>
  tr('Free service · the price you see is the price you get', 'Dịch vụ miễn phí · thấy giá nào, trả giá đó')

export type RentalCheckToggleListing = RentalCheckSource & { sellerId: string }

/**
 * Add a rental to the availability check, or take it out again.
 *
 * `card` — a plated chip at the PHOTO's bottom-right: the top corners hold the badges and the save
 *   heart, the bottom-left holds the video / saved chips, the centre holds the slot pips, and the
 *   bottom-right was the one free corner — above the eno.vn mark, which also lives there (see the
 *   chip's className).
 *   ⛔ GLYPH-ONLY AT EVERY WIDTH, AND THAT IS MEASURED, NOT TASTE. The plan put the word "Check" /
 *   "Kiểm tra" beside the glyph from `sm` up. On the /c/rentals grid (dev build, 12 cards per width)
 *   the glyph-only chip clears the pips by 23px at 360, 31 at 390, 36 at 640, 58 at 768 and 16 at
 *   1024; the word adds 41px (EN) / 51px (VI). So at 640 it lands ON the pips, at 1024 the VI chip
 *   clears them by 6px, and a rail card is narrower than the grid at the same viewport — a viewport
 *   breakpoint cannot know the card's width. The name is in the tooltip on a hovering pointer and in
 *   `aria-label` everywhere; the first add explains the feature in a toast.
 * `pdp` — a full-width outline button under the contact block, with the free line beneath it.
 *
 * ⛔ NOT ON THE VIEWER'S OWN LISTING. Asking eno to check whether your own flat is free is a dead
 * end, and a seller browsing their storefront would read the chip as a control over their listing.
 */
export function RentalCheckToggle({
  listing,
  variant,
  className,
}: {
  listing: RentalCheckToggleListing
  variant: 'card' | 'pdp'
  className?: string
}) {
  const { sellerId } = useAuth()
  if (listing.category?.slug !== RENTAL_CHECK_CATEGORY_SLUG) return null
  if (sellerId && sellerId === listing.sellerId) return null
  // Two components, not one with a branch: only the PDP shows the count, and a card subscribed to
  // the count would re-render all ~48 of a feed's chips on every add instead of just its own.
  return variant === 'pdp'
    ? <PdpToggle listing={listing} className={className} />
    : <CardToggle listing={listing} className={className} />
}

/** Add, with the two toasts: "only five" when full, and the free explainer on the session's first add. */
function useAddToCheck(listing: RentalCheckSource) {
  const { tr } = useLanguage()
  const router = useRouter()
  return () => {
    const viewList = { label: tr('View list', 'Xem danh sách'), onClick: () => router.push(RENTAL_CHECK_PATH) }
    const r = addToBasket(listing)
    if (r === 'full') {
      hapticError()
      toast(tr('Up to 5 at a time', 'Tối đa 5 căn mỗi lần'), {
        id: 'rental-check-full',
        description: tr('Remove one from your list to add this rental.', 'Bỏ bớt một căn trong danh sách để thêm căn này.'),
        action: viewList,
      })
      return
    }
    if (r !== 'added') return
    hapticTap()
    if (takeFirstAddHint()) {
      toast(tr('Added to your free availability check', 'Đã thêm vào danh sách kiểm tra miễn phí'), {
        id: 'rental-check-first',
        description: rentalFreeLine(tr),
        action: viewList,
      })
    }
  }
}

function CardToggle({ listing, className }: { listing: RentalCheckSource; className?: string }) {
  const { tr } = useLanguage()
  const added = useInRentalBasket(listing.id)
  const add = useAddToCheck(listing)
  return (
    <Tooltip content={tr('Check availability — free', 'Kiểm tra phòng trống — miễn phí')} side="top">
      <Button
        type="button"
        variant="bare"
        size="none"
        // ⚠️ THE NAME IS CONSTANT, `aria-pressed` CARRIES THE STATE — the save heart's rule (ARIA APG,
        // Button-Toggle).
        aria-label={tr('Check availability', 'Kiểm tra phòng trống')}
        aria-pressed={added}
        data-rental-check-toggle=""
        onClick={(e) => {
          // The media box opens the listing on click; this chip must not.
          e.stopPropagation()
          if (added) { hapticTap(); removeFromBasket(listing.id) } else add()
        }}
        className={cn(
          // `absolute` also positions the `tap-44` pseudo — an unpositioned tap-44 covers its ancestor.
          // ⚠️ `bottom-[calc(7.9%+4px)]`, NOT `bottom-2`: the photo's bottom-right corner already holds
          // the app-drawn eno.vn mark (image-mark.tsx: inset 3%, 28% wide, 1588.3/9132.3 tall = 4.87%),
          // and at bottom-2 this chip hid more than half of it — measured on the dev build, the card
          // read "eno.[chip]". 3% + 4.87% + a 4px gap sets the chip just above the mark. The media box
          // is aspect-square, so a % bottom (height-relative) and the mark's width-relative height are
          // the same length.
          'absolute bottom-[calc(7.9%+4px)] right-2 z-10 h-7 w-7 rounded-full tap-44',
          'focus-visible:ring-2 focus-visible:ring-white',
          // The resting chip wears the bottom-left status chips' own plate (dark on light, light on
          // dark); the added state is the brand fill — user state, the one solid moment (icon-language §5).
          added ? 'bg-brand text-white' : 'bg-foreground/70 text-background material backdrop-blur-[2px]',
          className,
        )}
      >
        {/* ⛔ `icon-own-ink` IS WHAT MAKES THE TICK VISIBLE. `aria-pressed="true"` trips the global
            selected-icon rule in globals.css, which paints the Bold layer accent-blue — on this chip's
            brand-blue fill, i.e. nothing. Measured on the dev build before the class: a blue disc with
            no mark. The saved heart and the checked checkbox hit the same rule; this is its opt-out. */}
        {added
          ? <Check className="icon-own-ink h-4 w-4" aria-hidden />
          : <ClipboardCheck className="icon-own-ink h-4 w-4" aria-hidden />}
      </Button>
    </Tooltip>
  )
}

function PdpToggle({ listing, className }: { listing: RentalCheckSource; className?: string }) {
  const { tr } = useLanguage()
  const added = useInRentalBasket(listing.id)
  const count = useRentalBasketCount()
  const add = useAddToCheck(listing)
  const addedLabel = `${tr('Added', 'Đã thêm')} (${count}/${RENTAL_CHECK_MAX_ITEMS}) · ${tr('View list', 'Xem danh sách')}`
  return (
    <div className={cn('mt-3', className)}>
      {added ? (
        <Button asChild variant="outline" className="min-h-11 w-full gap-2 font-semibold">
          <Link href={RENTAL_CHECK_PATH} prefetch={false}>
            <Check className="h-4 w-4 text-brand" aria-hidden />
            {addedLabel}
          </Link>
        </Button>
      ) : (
        <Button type="button" variant="outline" onClick={add} className="min-h-11 w-full gap-2 font-semibold">
          <ClipboardCheck className="h-4 w-4" aria-hidden />
          {tr('Add to free availability check', 'Thêm vào danh sách kiểm tra miễn phí')}
        </Button>
      )}
      <p className="mt-1.5 text-xs text-body">{rentalFreeLine(tr)}</p>
    </div>
  )
}

/** The one-line explainer under the /c/rentals lede — the feature is invisible until someone says it exists. */
export function RentalCheckHint({ className }: { className?: string }) {
  const { tr } = useLanguage()
  return (
    <p className={cn('flex items-start gap-2 text-sm text-body', className)}>
      <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
      <span>
        {tr(
          'Pick up to 5 rentals and the eno team checks availability for you — a free service to find your next home, and the price you see is the price you get.',
          'Chọn tối đa 5 căn, đội ngũ eno kiểm tra phòng trống giúp bạn — dịch vụ miễn phí giúp bạn tìm nhà, giá bạn thấy là giá bạn trả.',
        )}
      </span>
    </p>
  )
}
