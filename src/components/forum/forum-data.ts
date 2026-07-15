export type ForumCommunity = {
  slug: string
  name: string
  nameVi: string
  description: string
  descriptionVi: string
  members: number
  online: number
}

export type ForumPostKind = 'guide' | 'question' | 'experience' | 'event' | 'discussion'
export type ForumTrustBadge = 'verified_seller' | 'trusted_member' | 'established_expat' | 'top_helper'

export type ForumPost = {
  id: string
  community: string
  kind: ForumPostKind
  flair: string
  flairVi: string
  title: string
  body: string
  author: string
  authorId?: string | null
  authorAvatarUrl?: string | null
  authorAvatarColor?: string | null
  authorRole?: string
  trustScore?: number | null
  trustTier?: string | null
  trustBadge?: ForumTrustBadge | null
  minutesAgo: number
  timeLabel: string
  score: number
  commentCount: number
  location: 'all' | 'hcmc' | 'hanoi' | 'danang'
  locationLabel?: string
  pinned?: boolean
  official?: boolean
  live?: boolean
  media?: Array<{ url: string; altText?: string | null; width?: number | null; height?: number | null }>
}

export type ForumComment = {
  id: string
  author: string
  authorId?: string | null
  authorAvatarUrl?: string | null
  authorAvatarColor?: string | null
  authorRole?: string
  trustScore?: number | null
  trustTier?: string | null
  trustBadge?: ForumTrustBadge | null
  body: string
  score: number
  timeLabel: string
  helpful?: boolean
  official?: boolean
  viewerVote?: -1 | 0 | 1
  live?: boolean
  replies?: ForumComment[]
}

export const FORUM_COMMUNITIES: ForumCommunity[] = [
  {
    slug: 'vietnam-101',
    name: 'Vietnam 101',
    nameVi: 'Nhập môn Việt Nam',
    description: 'Practical answers for getting settled.',
    descriptionVi: 'Câu trả lời thực tế để bắt đầu cuộc sống.',
    members: 42800,
    online: 318,
  },
  {
    slug: 'visas-residency',
    name: 'Visas & residency',
    nameVi: 'Thị thực & cư trú',
    description: 'Visas, work permits, TRCs, and border runs.',
    descriptionVi: 'Thị thực, giấy phép lao động, thẻ tạm trú.',
    members: 26700,
    online: 184,
  },
  {
    slug: 'housing',
    name: 'Housing',
    nameVi: 'Nhà ở',
    description: 'Renting, neighborhoods, and landlord questions.',
    descriptionVi: 'Thuê nhà, khu vực sống và chủ nhà.',
    members: 31900,
    online: 241,
  },
  {
    slug: 'jobs-careers',
    name: 'Jobs & careers',
    nameVi: 'Việc làm & sự nghiệp',
    description: 'Contracts, hiring, and working in Vietnam.',
    descriptionVi: 'Hợp đồng, tuyển dụng và làm việc tại Việt Nam.',
    members: 18400,
    online: 96,
  },
  {
    slug: 'daily-life',
    name: 'Daily life',
    nameVi: 'Đời sống hằng ngày',
    description: 'The useful details you only learn by living here.',
    descriptionVi: 'Những điều hữu ích chỉ biết khi sống tại đây.',
    members: 35600,
    online: 275,
  },
  {
    slug: 'hanoi',
    name: 'Hanoi',
    nameVi: 'Hà Nội',
    description: 'Local advice from the capital.',
    descriptionVi: 'Kinh nghiệm địa phương tại thủ đô.',
    members: 22100,
    online: 132,
  },
  {
    slug: 'hcmc',
    name: 'Ho Chi Minh City',
    nameVi: 'TP. Hồ Chí Minh',
    description: 'Life, places, and people around Saigon.',
    descriptionVi: 'Cuộc sống, địa điểm và con người ở Sài Gòn.',
    members: 29400,
    online: 203,
  },
  {
    slug: 'danang',
    name: 'Da Nang',
    nameVi: 'Đà Nẵng',
    description: 'Coastal living and central Vietnam.',
    descriptionVi: 'Cuộc sống ven biển và miền Trung Việt Nam.',
    members: 13800,
    online: 81,
  },
  {
    slug: 'families-schools',
    name: 'Families & schools',
    nameVi: 'Gia đình & trường học',
    description: 'Schools, childcare, and family life.',
    descriptionVi: 'Trường học, chăm sóc trẻ và đời sống gia đình.',
    members: 9700,
    online: 44,
  },
  {
    slug: 'events-meetups',
    name: 'Events & meetups',
    nameVi: 'Sự kiện & gặp gỡ',
    description: 'Find your people offline.',
    descriptionVi: 'Tìm cộng đồng của bạn ngoài đời.',
    members: 16200,
    online: 117,
  },
]

export const INITIAL_FORUM_POSTS: ForumPost[] = [
  {
    id: 'new-to-vietnam-checklist',
    community: 'vietnam-101',
    kind: 'guide',
    flair: 'Newcomer guide',
    flairVi: 'Hướng dẫn người mới',
    title: 'New to Vietnam? Start with these 8 things in your first week',
    body: 'A practical, community-built checklist covering your SIM card, banking, temporary address registration, transport, health cover, useful apps, cash, and the one document folder you should keep ready.',
    author: 'eno team',
    authorRole: 'Community team',
    minutesAgo: 3,
    timeLabel: 'Pinned guide',
    score: 642,
    commentCount: 91,
    location: 'all',
    pinned: true,
    official: true,
  },
  {
    id: 'trc-renewal-new-passport',
    community: 'visas-residency',
    kind: 'experience',
    flair: 'Firsthand experience',
    flairVi: 'Kinh nghiệm thực tế',
    title: 'TRC renewal with a new passport — what actually worked in HCMC',
    body: 'I just finished this after getting three different answers online. Sharing the exact document order, translation step, and timeline that the immigration office accepted last week.',
    author: 'MayaInSaigon',
    authorRole: 'Living here 6 years',
    minutesAgo: 48,
    timeLabel: '48 min ago',
    score: 214,
    commentCount: 37,
    location: 'hcmc',
    locationLabel: 'Ho Chi Minh City',
  },
  {
    id: 'thao-dien-deposit',
    community: 'housing',
    kind: 'question',
    flair: 'Need advice',
    flairVi: 'Cần tư vấn',
    title: 'Landlord wants a 3-month deposit in Thao Dien. Is that normal now?',
    body: 'The apartment is furnished and the agent says three months is standard for foreigners. My last place was one month. I would love a current reality check before I sign anything.',
    author: 'OliverK',
    minutesAgo: 82,
    timeLabel: '1 hr ago',
    score: 147,
    commentCount: 83,
    location: 'hcmc',
    locationLabel: 'Thao Dien',
  },
  {
    id: 'danang-work-cafes',
    community: 'danang',
    kind: 'question',
    flair: 'Local recommendations',
    flairVi: 'Gợi ý địa phương',
    title: 'Quiet cafes for laptop work in Da Nang that do not mind a 3-hour stay?',
    body: 'Stable Wi-Fi and actual chairs are the priorities. Happy to order lunch and drinks; I just do not want to take over a tiny specialty coffee shop.',
    author: 'NomadNina',
    minutesAgo: 126,
    timeLabel: '2 hr ago',
    score: 96,
    commentCount: 29,
    location: 'danang',
    locationLabel: 'Da Nang',
  },
  {
    id: 'bilingual-contract-net-gross',
    community: 'jobs-careers',
    kind: 'question',
    flair: 'Contract check',
    flairVi: 'Kiểm tra hợp đồng',
    title: 'Accepted a job offer, but the bilingual contract is unclear on net vs. gross pay',
    body: 'The English version says net salary while the Vietnamese clause lists deductions. Before I ask HR to amend it, which version controls and what wording should I request?',
    author: 'Samir_HN',
    minutesAgo: 191,
    timeLabel: '3 hr ago',
    score: 78,
    commentCount: 24,
    location: 'hanoi',
    locationLabel: 'Hanoi',
  },
  {
    id: 'tay-ho-board-games',
    community: 'events-meetups',
    kind: 'event',
    flair: 'This Saturday',
    flairVi: 'Thứ Bảy tuần này',
    title: 'Low-key board game meetup in Tay Ho — newcomers very welcome',
    body: 'Saturday at 6:30 pm near Quang An. We will bring easy games and a few longer ones. No fee, no networking pitch, and you can arrive alone.',
    author: 'LinhAndLeo',
    minutesAgo: 238,
    timeLabel: '4 hr ago',
    score: 183,
    commentCount: 46,
    location: 'hanoi',
    locationLabel: 'Tay Ho',
  },
  {
    id: 'motorbike-license-conversion',
    community: 'daily-life',
    kind: 'experience',
    flair: 'How I did it',
    flairVi: 'Cách tôi đã làm',
    title: 'Converting my motorbike license in Hanoi: costs, offices, and timeline',
    body: 'The process was less mysterious than the Facebook threads made it sound. Here is the office I used, what needed notarizing, and the total I paid without an agent.',
    author: 'JonasRides',
    minutesAgo: 412,
    timeLabel: '6 hr ago',
    score: 263,
    commentCount: 52,
    location: 'hanoi',
    locationLabel: 'Hanoi',
  },
  {
    id: 'family-health-insurance',
    community: 'families-schools',
    kind: 'discussion',
    flair: 'Parents',
    flairVi: 'Dành cho phụ huynh',
    title: 'Which health insurance has actually paid claims for your family?',
    body: 'Not looking for broker recommendations. I would like to hear from parents who filed a real inpatient or emergency claim in Vietnam in the past year.',
    author: 'Anya_DN',
    minutesAgo: 630,
    timeLabel: '10 hr ago',
    score: 121,
    commentCount: 68,
    location: 'all',
  },
]

export const THREAD_COMMENTS: Record<string, ForumComment[]> = {
  'trc-renewal-new-passport': [
    {
      id: 'trc-comment-1',
      author: 'Duc_Nguyen',
      authorRole: 'Verified local contributor',
      body: 'This matches the current process. One useful detail: ask the translation office to include the passport observation page if your old passport number is referenced there. That saved a second trip for my colleague.',
      score: 88,
      timeLabel: '31 min ago',
      helpful: true,
      replies: [
        {
          id: 'trc-reply-1',
          author: 'MayaInSaigon',
          body: 'Great addition. Mine did include that page, but I did not realize it was a requirement rather than just something the translator added.',
          score: 21,
          timeLabel: '18 min ago',
        },
      ],
    },
    {
      id: 'trc-comment-2',
      author: 'KasiaHCMC',
      body: 'How many working days did it take from submission to collection? My receipt says seven, but the officer told me to allow two weeks.',
      score: 14,
      timeLabel: '22 min ago',
    },
  ],
  'thao-dien-deposit': [
    {
      id: 'deposit-comment-1',
      author: 'MinhPropertyLaw',
      authorRole: 'Housing contributor',
      body: 'Three months is not a legal requirement and it is not the norm for a standard one-year residential lease. One month is common; two can happen for expensive furnishings. Ask for a written inventory and a specific return deadline in the contract before paying anything.',
      score: 132,
      timeLabel: '54 min ago',
      helpful: true,
    },
    {
      id: 'deposit-comment-2',
      author: 'SofiaTaoDien',
      body: 'I renewed last month at one month deposit. The agent first asked for two, then accepted one when I offered quarterly rent payments. Three would be a firm no from me.',
      score: 67,
      timeLabel: '43 min ago',
    },
  ],
  'new-to-vietnam-checklist': [
    {
      id: 'guide-comment-1',
      author: 'AriInHanoi',
      body: 'Please add a note about keeping the small address slip from your landlord or hotel. I needed proof of temporary residence much earlier than expected.',
      score: 56,
      timeLabel: '2 hr ago',
      helpful: true,
    },
    {
      id: 'guide-comment-2',
      author: 'eno team',
      authorRole: 'Community team',
      body: 'Good call. We are adding a short temporary residence section and a plain-language message newcomers can send to a landlord.',
      score: 41,
      timeLabel: '1 hr ago',
      official: true,
    },
  ],
}

export const DEFAULT_THREAD_COMMENTS: ForumComment[] = [
  {
    id: 'default-comment-1',
    author: 'MaiLocal',
    authorRole: 'Helpful contributor',
    body: 'Following this. I have dealt with something similar and will add the exact details once I check my documents tonight.',
    score: 18,
    timeLabel: '38 min ago',
  },
  {
    id: 'default-comment-2',
    author: 'Chris_VN',
    body: 'Thanks for asking this clearly. The recent, firsthand answers here are much more useful than the old search results I found.',
    score: 11,
    timeLabel: '21 min ago',
  },
]

export function formatForumCount(value: number): string {
  if (value >= 1000) {
    const rounded = value >= 10000 ? Math.round(value / 1000) : Math.round(value / 100) / 10
    return `${rounded}k`
  }
  return String(value)
}
