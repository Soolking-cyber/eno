'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  MapPin,
  Star,
  BadgeCheck,
  MessageCircle,
  Phone,
  AlertTriangle,
} from 'lucide-react'
import type { SerializedListing } from '@/lib/types'
import { formatPrice, timeAgo, CATEGORY_COLOR_CLASSES, VERIFICATION_METHOD_LABELS } from '@/lib/types'
import { CategoryIcon } from './category-icons'
import { ListingGallery } from './listing-gallery'
import { ReportButton } from './report-button'
import { cn } from '@/lib/utils'
import { telHref, zaloHref } from '@/lib/contact'
import { useLanguage, Tr } from '@/context/language-context'

type Props = {
  listing: SerializedListing | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onLocate?: (listing: SerializedListing) => void
}

export function ListingDetailDialog({ listing, open, onOpenChange, onLocate }: Props) {
  const { lang, tr } = useLanguage()
  if (!listing) return null

  const color = CATEGORY_COLOR_CLASSES[listing.category.color] ?? CATEGORY_COLOR_CLASSES.brand
  const method = listing.verificationMethod ? VERIFICATION_METHOD_LABELS[listing.verificationMethod] : null
  const initials = listing.seller.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const attrs = listing.attributes ? Object.entries(listing.attributes) : []
  const displayTitle = lang === 'vi' ? (listing.titleVi || listing.title) : listing.title
  const displayDesc = listing.description

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white md:rounded-2xl shadow-overlay w-full max-w-full h-full max-h-full top-0 left-0 translate-x-0 translate-y-0 rounded-none md:max-h-[92vh] md:max-w-5xl md:top-[50%] md:left-[50%] md:translate-x-[-50%] md:translate-y-[-50%] gap-0 overflow-hidden p-0 duration-250">
        <DialogHeader className="sr-only">
          <DialogTitle>{displayTitle}</DialogTitle>
          <DialogDescription>{displayDesc.slice(0, 120)}</DialogDescription>
        </DialogHeader>

        <div className="grid h-full max-h-screen md:max-h-[92vh] overflow-y-auto scroll-thin grid-cols-1 md:grid-cols-12 gap-0 pb-16 md:pb-0">
          {/* LEFT: gallery + description + specs */}
          <div className="md:col-span-7 p-5 md:p-6 flex flex-col gap-6">
            {/* Gallery */}
            <ListingGallery
              images={listing.images}
              title={displayTitle}
              showAllLabel={tr('Show all photos', 'Xem tất cả ảnh')}
            />

            {/* Description */}
            <div className="space-y-2">
              <h4 className="text-sm font-bold text-[#1a202c]">
                {tr('Description', 'Mô tả')}
              </h4>
              <p className="whitespace-pre-line text-sm leading-relaxed text-[#475569]">
                <Tr text={displayDesc} />
              </p>
            </div>

            {/* Specs — category-relevant key/value list */}
            {attrs.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-[#1a202c] mb-1">
                  {tr('Details', 'Thông tin')}
                </h4>
                <dl className="divide-y divide-slate-100 text-sm">
                  {attrs.map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-4 py-2">
                      <dt className="capitalize text-[#64748b]"><Tr text={k.replace(/([A-Z])/g, ' $1')} /></dt>
                      <dd className="font-medium text-[#1a202c] text-right"><Tr text={String(v)} /></dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {/* Safety — minimal one-liner */}
            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-[#64748b] mt-auto">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {tr(
                'Meet in a public place and inspect the item before paying. ENO never asks for deposits via links.',
                'Gặp ở nơi công cộng và kiểm tra sản phẩm trước khi thanh toán. ENO không bao giờ yêu cầu đặt cọc qua liên kết.',
              )}
            </p>
          </div>

          {/* RIGHT: title, price, actions, seller */}
          <div className="md:col-span-5 p-5 md:p-6 flex flex-col gap-4 md:border-l border-slate-100">
            {/* Category */}
            <span className={cn('inline-flex w-fit items-center gap-1 text-xs font-semibold', color.text)}>
              <CategoryIcon name={listing.category.icon} className="h-3.5 w-3.5" />
              <Tr text={lang === 'vi' ? listing.category.nameVi : listing.category.name} />
            </span>

            {/* Title + location */}
            <div className="space-y-1.5">
              <h2 className="text-xl font-bold leading-tight text-[#1a202c]"><Tr text={displayTitle} /></h2>
              {onLocate ? (
                <button
                  onClick={() => onLocate(listing)}
                  title={tr('View on map', 'Xem trên bản đồ')}
                  className="group/loc flex w-fit items-center gap-1 text-xs text-[#64748b] hover:text-[#0a66c2] transition-colors cursor-pointer"
                >
                  <MapPin className="h-3.5 w-3.5 text-[#94a3b8] group-hover/loc:text-[#0a66c2] shrink-0 transition-colors" />
                  <span className="truncate group-hover/loc:underline"><Tr text={listing.location} /></span>
                </button>
              ) : (
                <div className="flex items-center gap-1 text-xs text-[#64748b]">
                  <MapPin className="h-3.5 w-3.5 text-[#94a3b8] shrink-0" />
                  <span className="truncate"><Tr text={listing.location} /></span>
                </div>
              )}
            </div>

            {/* Price */}
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-[#1a202c] tracking-tight">
                {formatPrice(listing.price, listing.currency, listing.priceUnit)}
              </span>
              {listing.negotiable && (
                <span className="text-xs text-[#64748b]">{tr('· Negotiable', '· Thương lượng')}</span>
              )}
            </div>

            {/* Verified status — with the actual verification evidence */}
            {listing.verified ? (
              <div className="rounded-lg bg-[#e8f1fb] px-3 py-2 text-xs text-[#0a66c2]">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="h-4 w-4 shrink-0" />
                  <span className="font-semibold">{tr('Verified by ENO', 'Đã xác minh bởi ENO')}</span>
                  {method && <span>· <Tr text={lang === 'vi' ? method.vi : method.label} /></span>}
                </div>
                {(listing.verifiedBy || listing.verifiedAt || listing.verificationNotes) && (
                  <div className="mt-1.5 pl-6 text-[11px] leading-relaxed text-[#0052cc]">
                    {listing.verifiedBy}
                    {listing.verifiedBy && listing.verifiedAt && ' · '}
                    {listing.verifiedAt && new Date(listing.verifiedAt).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {listing.verificationNotes && <div className="italic text-[#0a66c2]">“{listing.verificationNotes}”</div>}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{tr('Pending review — hidden until verified by an ENO agent.', 'Đang chờ kiểm duyệt — tin này bị ẩn cho đến khi được ENO xác minh.')}</span>
              </div>
            )}

            {/* CTAs — real Zalo + tel deep links */}
            <div className="flex gap-2.5">
              <a
                href={zaloHref(listing.seller)}
                target="_blank"
                rel="noreferrer"
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#0a66c2] py-2.5 text-sm font-bold text-white hover:bg-[#004182] active:scale-98 transition-all cursor-pointer"
              >
                <MessageCircle className="h-4 w-4" /> {tr('Message', 'Nhắn tin')}
              </a>
              <a
                href={telHref(listing.seller)}
                className="flex items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-[#1a202c] hover:bg-slate-50 active:scale-98 transition-all cursor-pointer"
              >
                <Phone className="h-4 w-4" /> {tr('Call', 'Gọi')}
              </a>
            </div>

            {/* Seller — links to profile */}
            <a href={`/sellers/${listing.sellerId}`} className="group flex items-center gap-3 border-t border-slate-100 pt-4 cursor-pointer">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e8f1fb] text-sm font-bold text-[#0a66c2]">
                {initials}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-[#1a202c] group-hover:underline">{listing.seller.name}</span>
                  {listing.seller.verifiedSeller && (
                    <BadgeCheck className="h-4 w-4 shrink-0 text-[#0a66c2]" />
                  )}
                </div>
                <span className="flex items-center gap-1 text-xs text-[#64748b]">
                  <Star className="h-3 w-3 fill-[#1a202c] text-[#1a202c] shrink-0" />
                  {listing.seller.rating.toFixed(1)} ({listing.seller.reviewCount}) · {tr('View profile', 'Xem hồ sơ')}
                </span>
              </div>
            </a>

            {/* Posted */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-[#64748b]">
                {tr('Posted', 'Đăng')} {timeAgo(listing.postedAt, lang)}
              </p>
              <a
                href={`/listings/${listing.id}`}
                className="text-xs font-semibold text-[#0a66c2] hover:underline cursor-pointer whitespace-nowrap"
              >
                {tr('View full listing', 'Xem trang chi tiết')} →
              </a>
            </div>

            {/* Report */}
            <ReportButton listingId={listing.id} className="self-start" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
