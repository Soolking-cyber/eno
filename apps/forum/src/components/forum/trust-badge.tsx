'use client'

import { BadgeCheck, Medal, ShieldCheck, Sparkles } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Tooltip } from '@/components/ui/tooltip'
import type { ForumTrustBadge } from './forum-data'

export function ForumTrustBadgeIcon({ badge, trustScore }: { badge?: ForumTrustBadge | null; trustScore?: number | null }) {
  const { tr } = useLanguage()
  if (!badge) return null
  const details = {
    verified_seller: {
      Icon: BadgeCheck,
      label: tr('Verified marketplace seller', 'Người bán đã xác minh'),
      detail: tr('This member runs a verified storefront on eno.vn.', 'Thành viên này vận hành cửa hàng đã xác minh trên eno.vn.'),
    },
    trusted_member: {
      Icon: ShieldCheck,
      label: tr('Trusted eno member', 'Thành viên eno đáng tin cậy'),
      detail: tr('Strong standing earned through verified marketplace interactions.', 'Uy tín cao nhờ các tương tác đã xác minh trên chợ eno.'),
    },
    established_expat: {
      Icon: Sparkles,
      label: tr('Established in Vietnam', 'Đã sống lâu năm tại Việt Nam'),
      detail: tr('This member has shared a multi-year history living in Vietnam.', 'Thành viên này đã chia sẻ quá trình sống nhiều năm tại Việt Nam.'),
    },
    top_helper: {
      Icon: Medal,
      label: tr('Top community helper', 'Người hỗ trợ cộng đồng hàng đầu'),
      detail: tr('Multiple answers from this member were marked helpful.', 'Nhiều câu trả lời của thành viên này được đánh dấu hữu ích.'),
    },
  }[badge]
  const { Icon, label, detail } = details
  const score = typeof trustScore === 'number' ? tr(` Marketplace trust: ${trustScore}/100.`, ` Điểm uy tín chợ: ${trustScore}/100.`) : ''

  return (
    <Tooltip content={`${detail}${score}`}>
      <span tabIndex={0} role="img" aria-label={label} className="inline-flex rounded-full text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <Icon className="h-3.5 w-3.5 fill-accent" />
      </span>
    </Tooltip>
  )
}

