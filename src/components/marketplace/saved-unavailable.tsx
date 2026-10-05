'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useFavorites, type SavedUnavailable } from '@/context/favorites-context'
import { useLanguage } from '@/context/language-context'
import { useLocalized } from '@/components/marketplace/listing-content'
import { localizedHref } from '@/lib/lang-pinned'
import { variantOfLanguage } from '@/lib/lang-variant'
import { categoryBrowsePath } from '@/lib/retired-categories'
import { isListingImageUrl, isMockImageUrl } from '@/lib/listing-image'

/**
 * SAVED LISTINGS THAT ENDED — kept, and said so (Emil-skills audit, 2026-10-06). A save whose listing
 * sold, or expired under the apartment availability rules, used to be deleted from the device without a
 * word; renters watched their shortlists shrink every week. They now stay saved and are listed here,
 * apart from the live grid: they cannot be bought, so they get no card, no quick actions and no price.
 *
 * ⚠️ WHAT A ROW MAY SHOW IS ONLY WHAT THIS DEVICE ALREADY HAD. The server says just "sold" or "kept"
 * (feed-query.ts `gone` / `sold`); the thumbnail and title are the card this device last fetched while
 * the listing was live (favorites-context.tsx). A taken-down listing is `gone` and never reaches here.
 * ⚠️ WHERE A ROW LEADS: a sold listing has its own public page; an expired one 404s, so it offers the
 * category instead ("See similar") — never a link to a page that is not there.
 */
export function SavedUnavailableSection({ items }: { items: SavedUnavailable[] }) {
  const { tr } = useLanguage()
  if (items.length === 0) return null
  return (
    <section aria-labelledby="saved-unavailable-title" className="mt-10">
      <h2 id="saved-unavailable-title" className="text-base font-bold text-foreground">
        {tr('No longer available', 'Tin không còn đăng')} <span className="font-normal text-ink-4">· {items.length}</span>
      </h2>
      <p className="mt-1 text-sm text-ink-3">
        {tr('Sold or no longer listed. They stay here until you remove them.', 'Đã bán hoặc đã ngừng đăng. Tin vẫn được lưu ở đây cho đến khi bạn bỏ lưu.')}
      </p>
      <ul className="mt-3 flex flex-col gap-1">
        {items.map((u) => <UnavailableRow key={u.id} item={u} />)}
      </ul>
    </section>
  )
}

function UnavailableRow({ item }: { item: SavedUnavailable }) {
  const { tr, lang } = useLanguage()
  const { toggle } = useFavorites()
  const variant = variantOfLanguage(lang)
  const card = item.card
  const localized = useLocalized(card?.title ?? '', card?.titleVi ?? null, card?.titleI18n)
  const title = localized || tr('A saved listing', 'Một tin đã lưu')
  const img = card?.images?.[0] || null
  // A listing that ended may have had its photos purged since — fall back to the plain tile.
  const [imgBroken, setImgBroken] = useState(false)
  const showImg = !!img && !imgBroken
  const href = item.sold
    ? `/listings/${item.id}`
    : card?.category?.slug ? localizedHref(categoryBrowsePath(card.category.slug), variant) : null

  return (
    <li className="flex items-center gap-3 rounded-2xl p-2">
      <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-tint">
        {showImg && (
          <Image
            src={img}
            alt=""
            width={64}
            height={64}
            quality={60}
            unoptimized={!isListingImageUrl(img) || isMockImageUrl(img)}
            onError={() => setImgBroken(true)}
            className="h-full w-full object-cover opacity-60 grayscale"
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-semibold text-ink-3 [overflow-wrap:anywhere]">{title}</p>
        <Badge size="sm" className="mt-1">
          {item.sold ? tr('Sold', 'Đã bán') : tr('No longer listed', 'Đã ngừng đăng')}
        </Badge>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
        {href && (
          <Button asChild variant="outline" size="sm">
            <Link href={href}>{item.sold ? tr('See listing', 'Xem tin') : tr('See similar', 'Xem tin tương tự')}</Link>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => toggle(item.id)} aria-label={`${tr('Remove from saved', 'Bỏ khỏi tin đã lưu')}: ${title}`}>
          {tr('Remove', 'Bỏ lưu')}
        </Button>
      </div>
    </li>
  )
}
