// Canonical Help Center taxonomy — the ONE source of truth for the help topics,
// shared by the /help UI, the /help/[id] thread page, and scripts/sync-help-center.ts
// (which upserts these as real ForumCommunity rows).
//
// WHY topics are communities: the owner's Help Center is Reddit-style — every answer is
// a real ForumPost that can be upvoted, commented on, bookmarked and reported. All of
// those tables key on ForumPost.id, so help content has to be posts, and posts must live
// in a community. Making the help topics communities means the whole existing forum
// stack (voting, comments, moderation, the eno.forum web face) works on help content for
// free, instead of a parallel content system that can only be read.
//
// ⚠️ Adding a topic here is NOT enough on its own. A community must also exist as a DB
// row (run `npx tsx scripts/sync-help-center.ts`) AND be listed in
// apps/forum/src/components/forum/forum-data.ts — the forum gates rendering on that
// hardcoded array, so a community missing from it is invisible on eno.forum.
//
// No `import 'server-only'`: the /help client components read this too.

export type HelpTopic = {
  /** ForumCommunity.slug */
  slug: string
  name: string
  nameVi: string
  description: string
  descriptionVi: string
  /** lucide-react icon name; mirrored into ForumCommunity.icon */
  icon: string
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    slug: 'help-getting-started',
    name: 'Getting started',
    nameVi: 'Bắt đầu',
    description: 'What eno.vn is and how to find your way around.',
    descriptionVi: 'eno.vn là gì và cách sử dụng cơ bản.',
    icon: 'rocket',
  },
  {
    slug: 'help-buying',
    name: 'Buying & offers',
    nameVi: 'Mua hàng & trả giá',
    description: 'Messaging sellers, making offers, saving listings.',
    descriptionVi: 'Nhắn tin cho người bán, trả giá, lưu tin đăng.',
    icon: 'shopping-bag',
  },
  {
    slug: 'help-selling',
    name: 'Selling & listings',
    nameVi: 'Bán hàng & tin đăng',
    description: 'Posting, pricing, photos and managing what you sell.',
    descriptionVi: 'Đăng tin, định giá, hình ảnh và quản lý tin đăng.',
    icon: 'tag',
  },
  {
    slug: 'help-trust-safety',
    name: 'Trust & safety',
    nameVi: 'Uy tín & an toàn',
    description: 'Trust scores, safe meet-ups, scams and reporting.',
    descriptionVi: 'Điểm uy tín, gặp mặt an toàn, lừa đảo và báo cáo.',
    icon: 'shield-check',
  },
  {
    slug: 'help-account',
    name: 'Account & app',
    nameVi: 'Tài khoản & ứng dụng',
    description: 'Signing in, notifications, language and settings.',
    descriptionVi: 'Đăng nhập, thông báo, ngôn ngữ và cài đặt.',
    icon: 'user-round-cog',
  },
  {
    slug: 'vietnam-travel',
    name: 'Vietnam travel',
    nameVi: 'Du lịch Việt Nam',
    description: 'Arriving, getting around, eating well and staying safe.',
    descriptionVi: 'Nhập cảnh, đi lại, ăn uống và giữ an toàn.',
    icon: 'plane',
  },
]

export const HELP_TOPIC_SLUGS: string[] = HELP_TOPICS.map((topic) => topic.slug)

const BY_SLUG = new Map(HELP_TOPICS.map((topic) => [topic.slug, topic]))

export function helpTopic(slug: string): HelpTopic | null {
  return BY_SLUG.get(slug) ?? null
}

/** Is this community one of the Help Center topics? Used to keep help threads out of
 *  the general community feed and vice versa. */
export function isHelpTopic(slug: string): boolean {
  return BY_SLUG.has(slug)
}
